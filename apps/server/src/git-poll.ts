import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, isNotNull } from 'drizzle-orm';
import { db, schema } from './db';

// Tool-agnostic ground truth: for each project that has a githubRepoUrl, poll a
// clone of its product repo and ingest `git log --numstat` into git_commits +
// git_file_changes, mapping each commit author to one of that project's coders
// (by email, then name) and each file to one of that project's modules. Works for
// anyone who commits, regardless of which agent/tool they use. Everything is
// scoped by project_id so repos never cross-contaminate.
//
// Auto-cloning is opt-in (ENABLE_GIT_POLL=1) so local dev stays a no-op by
// default; at deploy time the work environment flips it on per its product repos.

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const proc = Bun.spawnSync(['git', ...args], { cwd });
  return { ok: proc.exitCode === 0, out: proc.stdout ? new TextDecoder().decode(proc.stdout) : '' };
}

function isGitRepo(path: string): boolean {
  return existsSync(path) && git(path, ['rev-parse', '--is-inside-work-tree']).ok;
}

function norm(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

export interface GitPollResult {
  projectId: string;
  configured: boolean;
  newCommits: number;
}

/**
 * Poll one project's repo at `repoDir` and ingest its history, scoped to that
 * project. If `repoUrl` is given, clone (first time) or pull (ff-only). Author →
 * coder and file → module mapping only ever considers THIS project's rows.
 */
export async function pollGitRepo(opts: {
  projectId: string;
  repoDir: string;
  repoUrl?: string;
}): Promise<GitPollResult> {
  const { projectId, repoUrl } = opts;
  const repoDir = resolve(opts.repoDir);

  if (!isGitRepo(repoDir)) {
    if (!repoUrl) return { projectId, configured: false, newCommits: 0 };
    const clone = git(process.cwd(), ['clone', '--quiet', repoUrl, repoDir]);
    if (!clone.ok) {
      console.error(`[git-poll] clone failed for project ${projectId}`);
      return { projectId, configured: true, newCommits: 0 };
    }
  } else if (repoUrl) {
    git(repoDir, ['pull', '--quiet', '--ff-only']);
  }

  const [users, mods, existing] = await Promise.all([
    db
      .select({ id: schema.users.id, email: schema.users.email, username: schema.users.username, displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.projectId, projectId)),
    db.select().from(schema.modules).where(eq(schema.modules.projectId, projectId)),
    db.select({ sha: schema.gitCommits.sha }).from(schema.gitCommits).where(eq(schema.gitCommits.projectId, projectId)),
  ]);

  const seen = new Set(existing.map((e) => e.sha));
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u.id]));
  const byName = new Map(users.map((u) => [(u.displayName ?? u.username).toLowerCase(), u.id]));
  const byUser = new Map(users.map((u) => [u.username.toLowerCase(), u.id]));
  const sortedMods = [...mods].sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);

  const moduleOf = (file: string): string | null =>
    sortedMods.find((m) => norm(file).startsWith(m.pathPrefix))?.id ?? null;
  const devOf = (email: string, name: string): string | null =>
    byEmail.get(email.toLowerCase()) ?? byName.get(name.toLowerCase()) ?? byUser.get(name.toLowerCase()) ?? null;

  const SEP = '\x1e';
  const log = git(repoDir, ['log', '--no-merges', '-n', '1000', '--numstat', `--pretty=format:${SEP}%H|%an|%ae|%aI|%s`]);
  if (!log.ok) return { projectId, configured: true, newCommits: 0 };

  const records = log.out.split(SEP).map((s) => s.trim()).filter(Boolean);
  let newCommits = 0;

  for (const rec of records) {
    const [header, ...fileLines] = rec.split('\n');
    const parts = (header ?? '').split('|');
    const sha = parts[0];
    if (!sha || seen.has(sha)) continue;
    const [, authorName = '', authorEmail = '', iso = ''] = parts;
    const message = parts.slice(4).join('|');
    const devId = devOf(authorEmail, authorName);

    let additions = 0;
    let deletions = 0;
    const files: { filePath: string; additions: number; deletions: number; moduleId: string | null }[] = [];
    for (const fl of fileLines) {
      const m = fl.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const a = m[1] === '-' ? 0 : parseInt(m[1]!, 10);
      const d = m[2] === '-' ? 0 : parseInt(m[2]!, 10);
      additions += a;
      deletions += d;
      files.push({ filePath: m[3]!, additions: a, deletions: d, moduleId: moduleOf(m[3]!) });
    }

    await db
      .insert(schema.gitCommits)
      .values({
        sha,
        projectId,
        developerId: devId,
        authorName: authorName || null,
        authorEmail: authorEmail || null,
        message: message || null,
        committedAt: iso ? new Date(iso) : null,
        additions,
        deletions,
      })
      .onConflictDoNothing();

    if (files.length) {
      await db.insert(schema.gitFileChanges).values(files.map((f) => ({ sha, projectId, developerId: devId, ...f })));
    }
    newCommits++;
  }

  if (newCommits) console.log(`[git-poll] ${newCommits} new commit(s) ingested for project ${projectId} from ${repoDir}`);
  return { projectId, configured: true, newCommits };
}

/**
 * Poll every project that has a configured repo. Opt-in via ENABLE_GIT_POLL so
 * local dev (where the Default Project points at the team-coder repo) doesn't
 * trigger surprise network clones. Each project's clone lives in its own subdir.
 */
export async function pollGitAll(): Promise<GitPollResult[]> {
  if (process.env.ENABLE_GIT_POLL !== '1' && process.env.ENABLE_GIT_POLL !== 'true') return [];

  const baseDir = process.env.PRODUCT_REPOS_DIR ?? '.product-repos';
  const projects = await db
    .select({ id: schema.projects.id, githubRepoUrl: schema.projects.githubRepoUrl })
    .from(schema.projects)
    .where(isNotNull(schema.projects.githubRepoUrl));

  const results: GitPollResult[] = [];
  for (const p of projects) {
    if (!p.githubRepoUrl) continue;
    results.push(
      await pollGitRepo({ projectId: p.id, repoDir: resolve(baseDir, p.id), repoUrl: p.githubRepoUrl }),
    );
  }
  return results;
}
