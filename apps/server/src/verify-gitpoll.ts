export {}; // module marker for top-level await

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, queryClient, schema } from './db';
import { computeOwnership } from './ownership';
import { pollGitRepo } from './git-poll';
import { deleteProject } from './test-utils';

// P10 git-poll acceptance check: build a throwaway product repo with commits by
// a known author, run the poller, and assert commits/file-changes are ingested,
// the author maps to the right coder, and ownership reflects the git signal —
// isolated to the 'shared' module (no hook activity touches it).

const dir = mkdtempSync(join(tmpdir(), 'tc-git-'));
const git = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: dir });

let ok = true;
let projectId = '';
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

try {
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Carol']);
  git(['config', 'user.email', 'carol@teamcoder.dev']);
  mkdirSync(join(dir, 'packages/shared'), { recursive: true });
  writeFileSync(join(dir, 'packages/shared/foo.ts'), 'export const x = 1;\nexport const y = 2;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: add foo']);
  writeFileSync(join(dir, 'packages/shared/foo.ts'), 'export const x = 1;\nexport const y = 2;\nexport const z = 3;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: extend foo']);

  // create a throwaway project (with carol + the shared module) to ingest into,
  // so this test leaves no debris on any real board. Deleted in finally.
  const [proj] = await db.insert(schema.projects).values({ name: 'verify-gitpoll', token: `gitpoll-${crypto.randomUUID()}` }).returning({ id: schema.projects.id });
  projectId = proj!.id;
  await db.insert(schema.users).values({ projectId, username: 'carol', displayName: 'Carol', email: 'carol@teamcoder.dev', agentToken: `dev-${crypto.randomUUID()}` });
  await db.insert(schema.modules).values({ projectId, name: 'shared', pathPrefix: 'packages/shared/' });

  const res = await pollGitRepo({ projectId, repoDir: dir }); // local repo as-is, no clone/pull
  check(res.configured && res.newCommits >= 2, `ingested >=2 commits (got ${res.newCommits})`);

  const [carol] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.email, 'carol@teamcoder.dev'), eq(schema.users.projectId, projectId)));
  const commits = await db
    .select({ developerId: schema.gitCommits.developerId, additions: schema.gitCommits.additions })
    .from(schema.gitCommits)
    .where(and(eq(schema.gitCommits.projectId, projectId), eq(schema.gitCommits.authorEmail, 'carol@teamcoder.dev')));
  check(commits.length >= 2, `git_commits has Carol's commits (${commits.length})`);
  check(!!carol && commits.every((c) => c.developerId === carol.id), 'commits mapped to Carol by email');

  const changes = await db
    .select({ moduleId: schema.gitFileChanges.moduleId })
    .from(schema.gitFileChanges)
    .innerJoin(schema.gitCommits, eq(schema.gitFileChanges.sha, schema.gitCommits.sha))
    .where(and(eq(schema.gitCommits.projectId, projectId), eq(schema.gitCommits.authorEmail, 'carol@teamcoder.dev')));
  const sharedMod = (await db.select().from(schema.modules).where(and(eq(schema.modules.projectId, projectId), eq(schema.modules.pathPrefix, 'packages/shared/'))))[0];
  check(changes.some((c) => c.moduleId === sharedMod?.id), 'file changes mapped to the shared module');

  const ownership = await computeOwnership(projectId);
  const shared = ownership.find((m) => m.pathPrefix === 'packages/shared/');
  check(shared?.ownerName === 'Carol' && shared.inferred, `shared auto-owned by Carol via git (got ${shared?.ownerName})`);
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  rmSync(dir, { recursive: true, force: true });
  if (projectId) await deleteProject(projectId);
  await queryClient.end();
}

console.log(ok ? '\n[verify-gitpoll] ✅ git ingestion + blend OK' : '\n[verify-gitpoll] ❌ failed');
process.exit(ok ? 0 : 1);
