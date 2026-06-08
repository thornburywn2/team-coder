import { eq } from 'drizzle-orm';
import { db, queryClient, schema } from './index';

// Populate the Default Project with a realistic ~3-day project so the whole portal
// is "fully loaded" for a demo: 5 coders with distinct strengths, tasks in every
// state, proposals + votes + threads, adopted proposals → ADRs + reuse-kit
// patterns, notes, 3 days of hook activity (timeline/ownership/languages/layers),
// agent sessions (live + idle), git commits (LOC report), and a live feed.
// Re-runnable: clears the Default Project's data first. Run: bun run demo:seed

const DEFAULT_TOKEN = process.env.TEAM_TOKEN ?? 'change-me-team-token';
const now = Date.now();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const ago = (ms: number) => new Date(now - ms);
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

try {
  const [proj] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.token, DEFAULT_TOKEN));
  if (!proj) throw new Error('Default Project not found — run db:seed first');
  const pid = proj.id;

  const users = await db.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, color: schema.users.color, email: schema.users.email }).from(schema.users).where(eq(schema.users.projectId, pid));
  const U = Object.fromEntries(users.map((u) => [u.username, u]));
  const need = ['alice', 'bob', 'carol', 'dave', 'erin'];
  if (!need.every((n) => U[n])) throw new Error('expected seeded coders alice..erin — run db:seed first');
  const name = (u: { displayName: string | null; username: string }) => u.displayName ?? u.username;

  // ── clear prior Default Project data (child→parent) ─────────────────────────
  for (const tbl of [schema.votes, schema.gitFileChanges, schema.comments, schema.feedItems, schema.hookEvents, schema.sessions, schema.adrs, schema.codePatterns, schema.projectNotes, schema.tasks, schema.gitCommits, schema.proposals] as const) {
    await db.delete(tbl).where(eq((tbl as typeof schema.tasks).projectId, pid));
  }

  // ── modules (+ owners) ──────────────────────────────────────────────────────
  const MODULES = [
    { name: 'frontend', pathPrefix: 'apps/web/', owner: 'alice' },
    { name: 'backend', pathPrefix: 'apps/server/', owner: 'bob' },
    { name: 'database', pathPrefix: 'apps/server/src/db/', owner: 'carol' },
    { name: 'shared', pathPrefix: 'packages/shared/', owner: 'erin' },
    { name: 'infra', pathPrefix: 'deploy/', owner: 'dave' },
  ];
  for (const m of MODULES) {
    await db.insert(schema.modules).values({ projectId: pid, name: m.name, pathPrefix: m.pathPrefix, ownerId: U[m.owner]!.id })
      .onConflictDoUpdate({ target: [schema.modules.projectId, schema.modules.pathPrefix], set: { ownerId: U[m.owner]!.id, name: m.name } });
  }
  const mods = await db.select().from(schema.modules).where(eq(schema.modules.projectId, pid));
  const sortedMods = [...mods].sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);
  const moduleOf = (f: string) => sortedMods.find((m) => f.startsWith(m.pathPrefix))?.id ?? null;

  // ── per-coder file domains (drive languages/layers/ownership) ───────────────
  const FILES: Record<string, string[]> = {
    alice: ['apps/web/src/components/Board.tsx', 'apps/web/src/components/Tasks.tsx', 'apps/web/src/components/Report.tsx', 'apps/web/src/components/Agents.tsx', 'apps/web/src/Login.tsx', 'apps/web/src/styles.css', 'apps/web/src/lib/api.ts'],
    bob: ['apps/server/src/routes/api.ts', 'apps/server/src/routes/tasks.ts', 'apps/server/src/routes/proposals.ts', 'apps/server/src/ws.ts', 'apps/server/src/auth.ts', 'apps/server/src/ownership.ts'],
    carol: ['apps/server/src/db/schema.ts', 'apps/server/src/db/migrate.ts', 'apps/server/src/db/listener.ts', 'apps/server/src/db/migrations/0007_indexes.sql', 'apps/server/src/db/migrations/0008_feed.sql'],
    dave: ['deploy/Dockerfile', 'deploy/docker-compose.yml', 'deploy/nginx.conf', '.github/workflows/ci.yml', 'DEPLOY.md', 'README.md'],
    erin: ['packages/shared/src/schemas.ts', 'packages/shared/src/enums.ts', 'packages/shared/src/ws.ts', 'apps/server/src/report.ts', 'apps/web/src/store.ts'],
  };
  // relative LOC weight so awards differ: Alice=Heavy Lifter, Bob=Master Builder(tools), Erin=Closer(tasks), Dave=Architect(ADRs)
  const LOC: Record<string, [number, number]> = { alice: [40, 160], bob: [25, 90], carol: [15, 60], dave: [5, 30], erin: [20, 80] };

  // ── git history over 3 days ─────────────────────────────────────────────────
  const commits: (typeof schema.gitCommits.$inferInsert)[] = [];
  const changes: (typeof schema.gitFileChanges.$inferInsert)[] = [];
  let c = 0;
  for (const uname of need) {
    const u = U[uname]!;
    const count = uname === 'alice' ? 16 : uname === 'bob' ? 13 : uname === 'erin' ? 11 : uname === 'carol' ? 9 : 6;
    for (let i = 0; i < count; i++) {
      const sha = `demo${String(c++).padStart(4, '0')}${crypto.randomUUID().replace(/-/g, '').slice(0, 28)}`;
      const when = ago(rand(0, 3 * DAY));
      const files = Array.from({ length: rand(1, 3) }, () => pick(FILES[uname]!));
      let add = 0, del = 0;
      const fileRows: (typeof schema.gitFileChanges.$inferInsert)[] = [];
      for (const f of [...new Set(files)]) {
        const a = rand(LOC[uname]![0], LOC[uname]![1]); const d = rand(0, Math.floor(a / 3));
        add += a; del += d;
        fileRows.push({ projectId: pid, sha, developerId: u.id, filePath: f, moduleId: moduleOf(f), additions: a, deletions: d });
      }
      commits.push({ sha, projectId: pid, developerId: u.id, authorName: name(u), authorEmail: u.email, message: pick(['feat: ', 'fix: ', 'refactor: ', 'chore: ', 'test: ']) + pick(['wire up board', 'tighten types', 'handle edge case', 'add tests', 'polish UI', 'speed up query', 'extract helper']), committedAt: when, additions: add, deletions: del });
      changes.push(...fileRows);
    }
  }
  await db.insert(schema.gitCommits).values(commits);
  await db.insert(schema.gitFileChanges).values(changes);

  // ── sessions (agents) — historical + some live-now + one idle ──────────────
  const sess: (typeof schema.sessions.$inferInsert)[] = [];
  const mkSess = (uname: string, startMs: number, lastMs: number, prompts: number, tools: number, id?: string) =>
    sess.push({ sessionId: id ?? `demo-${uname}-${crypto.randomUUID().slice(0, 8)}`, projectId: pid, developerId: U[uname]!.id, project: 'product', startedAt: ago(startMs), lastSeenAt: ago(lastMs), promptCount: prompts, toolCount: tools });
  // historical sessions across 3 days (counts feed the report + leaderboard)
  for (const uname of need) {
    const sessions = uname === 'bob' ? 6 : uname === 'alice' ? 5 : 4; // Bob = Master Builder (tools)
    for (let i = 0; i < sessions; i++) {
      const start = rand(2 * HOUR, 3 * DAY);
      const toolsPer = uname === 'bob' ? rand(40, 90) : rand(10, 45);
      mkSess(uname, start, start - rand(20 * MIN, 3 * HOUR), rand(3, 18), toolsPer);
    }
  }
  // live now (explicit ids so their hook events join → currentFile + filesTouched):
  // Alice 2 agents (active + idle), Bob active, Erin idle, Carol went quiet (idle alert)
  const LIVE = [
    { u: 'alice', id: 'demo-alice-live', start: 40 * MIN, last: 25_000, p: 9, t: 35 },
    { u: 'alice', id: 'demo-alice-live2', start: 25 * MIN, last: 80_000, p: 5, t: 18 },
    { u: 'bob', id: 'demo-bob-live', start: 55 * MIN, last: 45_000, p: 7, t: 60 },
    { u: 'erin', id: 'demo-erin-live', start: 30 * MIN, last: 3 * MIN, p: 6, t: 22 },
    { u: 'carol', id: 'demo-carol-live', start: 50 * MIN, last: 9 * MIN, p: 8, t: 24 }, // 9m quiet → idle alert
  ];
  for (const l of LIVE) mkSess(l.u, l.start, l.last, l.p, l.t, l.id);
  await db.insert(schema.sessions).values(sess);

  // ── hook events over 3 days (timeline, edits, ownership) ───────────────────
  const events: (typeof schema.hookEvents.$inferInsert)[] = [];
  for (const uname of need) {
    const n = uname === 'alice' ? 90 : uname === 'bob' ? 80 : uname === 'erin' ? 70 : uname === 'carol' ? 55 : 35;
    for (let i = 0; i < n; i++) {
      const f = pick(FILES[uname]!);
      const ev = pick(['PreToolUse', 'PreToolUse', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']);
      const isEdit = ev === 'PreToolUse' || ev === 'PostToolUse';
      events.push({ projectId: pid, ts: ago(rand(0, 3 * DAY)), sessionId: `demo-${uname}-hist`, developerId: U[uname]!.id, project: 'product', cwd: `/home/${uname}/product`, eventName: ev, toolName: isEdit ? pick(['Write', 'Edit']) : null, filePath: isEdit ? f : null, payload: {} });
    }
  }
  // recent edits tied to each LIVE session id → live ownership/presence + agent currentFile/filesTouched
  const liveIds: Record<string, string[]> = { alice: ['demo-alice-live', 'demo-alice-live2'], bob: ['demo-bob-live'], erin: ['demo-erin-live'], carol: ['demo-carol-live'] };
  for (const [uname, ids] of Object.entries(liveIds)) {
    for (const id of ids) {
      for (let i = 0; i < rand(3, 6); i++) events.push({ projectId: pid, ts: ago(rand(1 * MIN, 25 * MIN)), sessionId: id, developerId: U[uname]!.id, project: 'product', cwd: `/home/${uname}/product`, eventName: 'PreToolUse', toolName: 'Edit', filePath: pick(FILES[uname]!), payload: {} });
    }
  }
  await db.insert(schema.hookEvents).values(events);

  // ── presence ────────────────────────────────────────────────────────────────
  const presence: { u: string; status: 'active' | 'idle' | 'offline'; last: number; file?: string; prompt?: string }[] = [
    { u: 'alice', status: 'active', last: 25_000, file: 'apps/web/src/components/Board.tsx', prompt: 'make the swim lanes responsive' },
    { u: 'bob', status: 'active', last: 45_000, file: 'apps/server/src/routes/api.ts', prompt: 'add the leaderboard endpoint' },
    { u: 'erin', status: 'idle', last: 3 * MIN, file: 'packages/shared/src/schemas.ts' },
    { u: 'carol', status: 'idle', last: 9 * MIN, file: 'apps/server/src/db/schema.ts' },
    { u: 'dave', status: 'offline', last: 6 * HOUR },
  ];
  for (const p of presence) {
    await db.insert(schema.userPresence).values({ userId: U[p.u]!.id, projectId: pid, status: p.status, lastSeen: ago(p.last), sessionId: `demo-${p.u}-live`, currentFile: p.file ?? null, currentPrompt: p.prompt ?? null })
      .onConflictDoUpdate({ target: schema.userPresence.userId, set: { status: p.status, lastSeen: ago(p.last), currentFile: p.file ?? null, currentPrompt: p.prompt ?? null } });
  }

  // ── project goal (PRD) ──────────────────────────────────────────────────────
  const prd = `# Nimbus — team task & coordination app\n\nA fast, collaborative board for small teams.\n\n## Requirements\n- [ ] Real-time board with presence\n- [ ] Task CRUD with priority + tags\n- [ ] Auth with shared team token\n- [ ] Activity feed\n- [ ] Contribution report\n- [ ] Proposals + voting\n- [ ] Reusable pattern library\n- [ ] One-command deploy\n`;
  // null the repo URL: Nimbus is synthetic demo data, so it must NOT be git-polled
  // (that would clone the real team-coder repo and overwrite this seeded history).
  await db.update(schema.projects).set({ prd, githubRepoUrl: null }).where(eq(schema.projects.id, pid));

  // ── tasks (every state, source, priority) ───────────────────────────────────
  const prdTitles = ['Real-time board with presence', 'Task CRUD with priority + tags', 'Auth with shared team token', 'Activity feed', 'Contribution report', 'Proposals + voting', 'Reusable pattern library', 'One-command deploy'];
  const manualTitles = ['Debounce the search box', 'Fix flaky websocket reconnect', 'Add empty states to the board', 'Paginate the activity feed', 'Cache module ownership', 'Add keyboard shortcuts', 'Tighten Zod schemas', 'Add dark-mode toggle', 'Rate-limit the hooks endpoint', 'Write e2e smoke test', 'Compress API responses', 'Add task due-date picker', 'Improve mobile layout', 'Seed demo data', 'Add CSV export', 'Handle token expiry', 'Add toast notifications', 'Optimize the report query', 'Add a health dashboard', 'Document the MCP tools'];
  const statuses = ['done', 'done', 'done', 'done', 'in_progress', 'in_progress', 'in_review', 'todo', 'todo', 'blocked'] as const;
  const prios = ['low', 'medium', 'medium', 'high', 'urgent'] as const;
  const tagPool = ['ui', 'api', 'db', 'infra', 'bug', 'perf', 'cleanup', 'docs', 'security'];
  const taskRows: (typeof schema.tasks.$inferInsert)[] = [];
  prdTitles.forEach((t, i) => {
    const done = i < 4;
    taskRows.push({ projectId: pid, title: t, description: 'From the project PRD.', status: done ? 'done' : i < 6 ? 'in_progress' : 'todo', source: 'prd', priority: pick(prios as unknown as string[]) as 'low', tags: [pick(tagPool)], assigneeId: U[pick(need)]!.id, reporterId: U['erin']!.id, createdAt: ago(3 * DAY - i * HOUR), updatedAt: ago(rand(1 * HOUR, 2 * DAY)) });
  });
  manualTitles.forEach((t, i) => {
    const st = statuses[i % statuses.length]!;
    taskRows.push({ projectId: pid, title: t, description: null, status: st, source: 'manual', priority: pick(prios as unknown as string[]) as 'low', tags: Array.from(new Set([pick(tagPool), pick(tagPool)])), assigneeId: st === 'todo' ? null : U[pick(need)]!.id, reporterId: U[pick(need)]!.id, createdAt: ago(rand(2 * HOUR, 3 * DAY)), updatedAt: ago(rand(10 * MIN, 1 * DAY)) });
  });
  // give Erin extra completed tasks → "The Closer"
  for (let i = 0; i < 6; i++) taskRows.push({ projectId: pid, title: `Ship ${pick(['polish', 'cleanup', 'fix', 'tweak'])} #${i + 1}`, status: 'done', source: 'manual', priority: 'medium', tags: ['cleanup'], assigneeId: U['erin']!.id, reporterId: U['erin']!.id, createdAt: ago(rand(2 * HOUR, 3 * DAY)), updatedAt: ago(rand(10 * MIN, 1 * DAY)) });
  const insertedTasks = await db.insert(schema.tasks).values(taskRows).returning({ id: schema.tasks.id, title: schema.tasks.title });

  // ── proposals + votes + (one adopted → ADR + pattern + tasks) ───────────────
  const propRows = [
    { title: 'Adopt Tailwind for styling', description: 'Standardize styling. Faster, consistent.\n\n## Tasks\n- [ ] Add Tailwind + config\n- [ ] Migrate the board\n- [ ] Remove ad-hoc CSS', status: 'accepted', author: 'alice', branch: 'exp/tailwind', code: 'export const card = "rounded-lg border border-border bg-panel p-4";', lang: 'ts' },
    { title: 'Switch task IDs to ULIDs', description: 'Sortable, URL-friendly IDs.', status: 'open', author: 'carol', branch: 'exp/ulid', code: null, lang: null },
    { title: 'Add request rate limiting', description: 'Protect the hooks + API endpoints.', status: 'open', author: 'bob', branch: null, code: null, lang: null },
    { title: 'Move to a monorepo task runner (Turbo)', description: 'Speed up CI.', status: 'rejected', author: 'dave', branch: null, code: null, lang: null },
    { title: 'Standardize error envelopes', description: 'One error shape across the API.', status: 'accepted', author: 'erin', branch: 'exp/errors', code: 'export type ApiError = { error: string; code?: string };', lang: 'ts' },
  ] as const;
  for (const p of propRows) {
    const [prop] = await db.insert(schema.proposals).values({ projectId: pid, title: p.title, description: p.description, status: p.status, authorId: U[p.author]!.id, experimentBranch: p.branch, codeSnippet: p.code, language: p.lang, createdAt: ago(rand(1 * DAY, 3 * DAY)), updatedAt: ago(rand(2 * HOUR, 1 * DAY)) }).returning({ id: schema.proposals.id });
    const pidp = prop!.id;
    // votes from a few coders
    const voters = need.filter(() => Math.random() > 0.25);
    for (const v of voters) {
      await db.insert(schema.votes).values({ projectId: pid, proposalId: pidp, voterId: U[v]!.id, vote: p.status === 'rejected' ? pick(['reject', 'reject', 'abstain'] as string[]) as 'reject' : pick(['approve', 'approve', 'approve', 'abstain'] as string[]) as 'approve', comment: Math.random() > 0.6 ? pick(['+1', 'makes sense', 'lets try it', 'careful with scope']) : null }).onConflictDoNothing();
    }
    // a short discussion thread
    for (let i = 0; i < rand(1, 3); i++) await db.insert(schema.comments).values({ projectId: pid, authorId: U[pick(need)]!.id, targetType: 'proposal', targetId: pidp, content: pick(['Strong +1.', 'What about the migration cost?', 'Can we prove it on the branch first?', 'Agreed, lets adopt.']), createdAt: ago(rand(2 * HOUR, 1 * DAY)) });
    // adoption side-effects for accepted proposals carrying code
    if (p.status === 'accepted' && p.code) {
      await db.insert(schema.codePatterns).values({ projectId: pid, title: p.title, description: `Adopted from proposal "${p.title}".`, codeSnippet: p.code, language: p.lang, tags: ['adopted'], authorId: U[p.author]!.id, createdAt: ago(rand(2 * HOUR, 1 * DAY)) });
      await db.insert(schema.adrs).values({ projectId: pid, title: p.title, context: `Adopted from proposal "${p.title}".`, decision: p.description, status: 'accepted', authorId: U[p.author]!.id, createdAt: ago(rand(2 * HOUR, 1 * DAY)) });
      await db.insert(schema.tasks).values({ projectId: pid, title: `Adopt: ${p.title}`, description: p.description, status: 'in_progress', source: 'proposal', priority: 'high', tags: ['adopted'], assigneeId: U[p.author]!.id, reporterId: U[p.author]!.id, createdAt: ago(rand(2 * HOUR, 1 * DAY)), updatedAt: ago(1 * HOUR) });
    }
  }

  // ── ADRs (decisions of record) — Dave authors the most → "The Architect" ────
  const adrRows = [
    { t: 'Use Postgres LISTEN/NOTIFY for realtime', a: 'dave' },
    { t: 'Single-origin server serves web + API + WS + MCP', a: 'dave' },
    { t: 'Per-dev agent tokens for attribution', a: 'dave' },
    { t: 'Soft, non-blocking claims (no hard locks)', a: 'bob' },
  ];
  for (const a of adrRows) await db.insert(schema.adrs).values({ projectId: pid, title: a.t, context: 'Recorded during the build.', decision: a.t, status: 'accepted', authorId: U[a.a]!.id, createdAt: ago(rand(1 * DAY, 3 * DAY)) });

  // ── reuse-kit patterns ──────────────────────────────────────────────────────
  const patRows = [
    { t: 'Reconnecting WebSocket hook', code: 'export function useSocket(url){ /* partysocket */ }', lang: 'ts', tags: ['ui', 'realtime'], a: 'alice' },
    { t: 'Zod-validated route handler', code: 'const body = Schema.parse(await c.req.json());', lang: 'ts', tags: ['api'], a: 'bob' },
    { t: 'Idempotent upsert', code: 'insert().values(v).onConflictDoUpdate({...})', lang: 'ts', tags: ['db'], a: 'carol' },
    { t: 'Secret scrubber', code: 'text.replace(/sk-[A-Za-z0-9]+/g, "[redacted]")', lang: 'ts', tags: ['security'], a: 'erin' },
  ];
  for (const p of patRows) await db.insert(schema.codePatterns).values({ projectId: pid, title: p.t, codeSnippet: p.code, language: p.lang, tags: p.tags, authorId: U[p.a]!.id, createdAt: ago(rand(2 * HOUR, 3 * DAY)) });

  // ── notes ───────────────────────────────────────────────────────────────────
  const noteRows = [
    { c: 'Standup at 10am — post blockers here before.', a: 'erin', pin: true },
    { c: 'Staging is on :6300, prod deploy Friday.', a: 'dave', pin: false },
    { c: 'Anyone free to pair on the report query?', a: 'carol', pin: false },
    { c: 'Design tokens live in styles.css for now.', a: 'alice', pin: false },
  ];
  for (const n of noteRows) await db.insert(schema.projectNotes).values({ projectId: pid, authorId: U[n.a]!.id, content: n.c, pinned: n.pin, createdAt: ago(rand(1 * HOUR, 2 * DAY)) });

  // ── task discussion threads ─────────────────────────────────────────────────
  for (let i = 0; i < 8; i++) {
    const t = pick(insertedTasks);
    await db.insert(schema.comments).values({ projectId: pid, authorId: U[pick(need)]!.id, targetType: 'task', targetId: t.id, content: pick(['Picking this up.', 'Blocked on the API — will ping.', 'Done, ready for review.', 'Can you add a test?', 'Reviewed, looks good 👍']), createdAt: ago(rand(30 * MIN, 2 * DAY)) });
  }

  // ── live activity feed (recent stream) ──────────────────────────────────────
  const feedRows: (typeof schema.feedItems.$inferInsert)[] = [];
  const fkinds = ['edit', 'prompt', 'claim', 'done', 'comment', 'proposal', 'vote', 'pattern', 'decision', 'session_start'] as const;
  for (let i = 0; i < 50; i++) {
    const uname = pick(need); const u = U[uname]!; const k = pick(fkinds as unknown as string[]);
    feedRows.push({ projectId: pid, ts: ago(rand(1 * MIN, 8 * HOUR)), developerId: u.id, developer: name(u), color: u.color, kind: k, detail: k === 'edit' ? `editing ${pick(FILES[uname]!)}` : k === 'done' ? 'completed a task' : k === 'claim' ? 'claimed a task' : k === 'proposal' ? 'raised a proposal' : k === 'vote' ? 'voted on a proposal' : k === 'pattern' ? 'shared a pattern' : k === 'decision' ? 'recorded a decision' : k === 'comment' ? 'commented' : k === 'prompt' ? 'submitted a prompt' : 'started a session', file: k === 'edit' ? pick(FILES[uname]!) : null });
  }
  feedRows.push({ projectId: pid, ts: ago(9 * MIN), developerId: U['carol']!.id, developer: name(U['carol']!), color: U['carol']!.color, kind: 'idle', detail: 'agent went idle — 9m quiet' });
  await db.insert(schema.feedItems).values(feedRows);

  console.log(`[demo-seed] ✅ loaded Default Project: ${commits.length} commits, ${changes.length} file-changes, ${events.length} hook events, ${sess.length} agent sessions, ${insertedTasks.length}+ tasks, 5 proposals, ${patRows.length + 2} patterns, notes, and a live feed (3-day span).`);
} catch (err) {
  console.error('[demo-seed] failed:', err);
  process.exitCode = 1;
} finally {
  await queryClient.end();
}
