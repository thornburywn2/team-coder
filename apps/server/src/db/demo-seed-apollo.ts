import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, queryClient, schema } from './index';
import { pollGitRepo } from '../git-poll';

// Second demo project — "Apollo" — to show MULTI-PROJECT ISOLATION (its own token,
// roster, board; never crosses Nimbus) AND a LIVE GITHUB REPO INTEGRATION: Apollo
// is linked to a real repo and its contribution data comes from actually polling
// it (clone → ingest git log → attribute to coders by email). Re-runnable.
// Run: bun run demo:seed:apollo   (needs network to clone the repo)

const TOKEN = 'apollo-demo-token';
const REPO = process.env.APOLLO_REPO_URL ?? 'https://github.com/thornburywn2/testtesttest.git';
const now = Date.now();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const ago = (ms: number) => new Date(now - ms);
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

try {
  // fresh start (cascade removes any prior Apollo data + coders)
  await db.delete(schema.projects).where(eq(schema.projects.token, TOKEN));
  const [proj] = await db.insert(schema.projects).values({ name: 'Apollo (demo)', token: TOKEN, githubRepoUrl: REPO,
    prd: '# Apollo — real-time analytics dashboard\n\n## Requirements\n- [ ] Metrics ingestion API\n- [ ] Dashboard grid + charts\n- [ ] Time-range filters\n- [ ] Saved dashboards\n- [ ] CSV export\n' }).returning({ id: schema.projects.id });
  const pid = proj!.id;

  // roster — emails MATCH the repo commit authors so git-poll attributes their work
  const defs = [
    { username: 'frank', displayName: 'Frank', email: 'frank@apollo.dev', color: '#e6194B', role: 'frontend' },
    { username: 'grace', displayName: 'Grace', email: 'grace@apollo.dev', color: '#3cb44b', role: 'backend' },
    { username: 'heidi', displayName: 'Heidi', email: 'heidi@apollo.dev', color: '#4363d8', role: 'database' },
    { username: 'ivan', displayName: 'Ivan', email: 'ivan@apollo.dev', color: '#f58231', role: 'shared' },
  ];
  const coders = await db.insert(schema.users).values(defs.map((d) => ({ projectId: pid, username: d.username, displayName: d.displayName, email: d.email, color: d.color, agentToken: `dev-${crypto.randomUUID()}` }))).returning({ id: schema.users.id, username: schema.users.username });
  const byRole = Object.fromEntries(defs.map((d) => [d.role, coders.find((c) => c.username === d.username)!]));
  const U = Object.fromEntries(coders.map((c) => [c.username, c]));
  await db.insert(schema.userPresence).values(coders.map((c) => ({ userId: c.id, projectId: pid, status: 'offline' as const })));

  // modules (match the repo's layout so git files map cleanly)
  const MODULES = [
    { name: 'frontend', pathPrefix: 'apps/web/', role: 'frontend' },
    { name: 'backend', pathPrefix: 'apps/server/', role: 'backend' },
    { name: 'database', pathPrefix: 'db/', role: 'database' },
    { name: 'shared', pathPrefix: 'packages/shared/', role: 'shared' },
    { name: 'infra', pathPrefix: 'deploy/', role: 'frontend' },
  ];
  await db.insert(schema.modules).values(MODULES.map((m) => ({ projectId: pid, name: m.name, pathPrefix: m.pathPrefix, ownerId: byRole[m.role]!.id })));

  const FILES: Record<string, string[]> = {
    frank: ['apps/web/src/Dashboard.tsx', 'apps/web/src/Chart.tsx', 'apps/web/src/Filters.tsx', 'apps/web/src/styles.css'],
    grace: ['apps/server/src/index.ts', 'apps/server/src/routes/metrics.ts'],
    heidi: ['db/schema.sql', 'db/migrations/0001_seed.sql', 'db/migrations/0002_dashboards.sql'],
    ivan: ['packages/shared/src/types.ts', 'packages/shared/src/util.ts'],
  };

  // ── hooks + sessions (live presence/agents) — NO synthetic git (real repo poll below) ──
  const events: (typeof schema.hookEvents.$inferInsert)[] = [];
  const sess: (typeof schema.sessions.$inferInsert)[] = [];
  for (const c of coders) {
    for (let i = 0; i < rand(30, 55); i++) events.push({ projectId: pid, ts: ago(rand(0, 3 * DAY)), sessionId: `ap-${c.username}-hist`, developerId: c.id, project: 'apollo', cwd: `/home/${c.username}/apollo`, eventName: pick(['PreToolUse', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']), toolName: pick(['Write', 'Edit']), filePath: pick(FILES[c.username]!), payload: {} });
    for (let i = 0; i < 3; i++) { const pr = rand(3, 14), tl = rand(12, 50); sess.push({ sessionId: `ap-${c.username}-h${i}`, projectId: pid, developerId: c.id, project: 'apollo', startedAt: ago(rand(2 * HOUR, 3 * DAY)), lastSeenAt: ago(rand(3 * HOUR, 2 * DAY)), promptCount: pr, toolCount: tl, inputTokens: tl * rand(1200, 2600) + pr * rand(3000, 6000), outputTokens: (tl + pr) * rand(700, 1700) }); }
  }
  // live now: Frank active, Grace active, Ivan idle, Heidi away (idle alert)
  const live = [
    { u: 'frank', last: 30_000, st: 'active' as const }, { u: 'grace', last: 60_000, st: 'active' as const },
    { u: 'ivan', last: 4 * MIN, st: 'idle' as const }, { u: 'heidi', last: 11 * MIN, st: 'idle' as const },
  ];
  for (const l of live) {
    const id = `ap-${l.u}-live`;
    { const pr = rand(5, 10), tl = rand(20, 45); sess.push({ sessionId: id, projectId: pid, developerId: U[l.u]!.id, project: 'apollo', startedAt: ago(45 * MIN), lastSeenAt: ago(l.last), promptCount: pr, toolCount: tl, inputTokens: tl * rand(1200, 2600) + pr * rand(3000, 6000), outputTokens: (tl + pr) * rand(700, 1700) }); }
    for (let i = 0; i < rand(3, 5); i++) events.push({ projectId: pid, ts: ago(rand(1 * MIN, 20 * MIN)), sessionId: id, developerId: U[l.u]!.id, project: 'apollo', cwd: `/home/${l.u}/apollo`, eventName: 'PreToolUse', toolName: 'Edit', filePath: pick(FILES[l.u]!), payload: {} });
    await db.update(schema.userPresence).set({ status: l.st, lastSeen: ago(l.last), sessionId: id, currentFile: pick(FILES[l.u]!) }).where(eq(schema.userPresence.userId, U[l.u]!.id));
  }
  await db.insert(schema.hookEvents).values(events);
  await db.insert(schema.sessions).values(sess);

  // ── tasks ───────────────────────────────────────────────────────────────────
  const prd = ['Metrics ingestion API', 'Dashboard grid + charts', 'Time-range filters', 'Saved dashboards', 'CSV export'];
  const manual = ['Add tooltip to charts', 'Cache metric queries', 'Handle empty datasets', 'Add date-range presets', 'Paginate the metrics API', 'Dark theme for charts', 'Export to PNG', 'Add health endpoint'];
  const states = ['done', 'done', 'in_progress', 'in_review', 'todo', 'blocked'] as const;
  const prios = ['low', 'medium', 'high', 'urgent'] as const;
  const tasks: (typeof schema.tasks.$inferInsert)[] = [];
  prd.forEach((t, i) => tasks.push({ projectId: pid, title: t, description: 'From the Apollo PRD.', status: i < 2 ? 'done' : i < 4 ? 'in_progress' : 'todo', source: 'prd', priority: pick(prios as unknown as string[]) as 'low', tags: ['mvp'], assigneeId: pick(coders).id, reporterId: byRole['shared']!.id, createdAt: ago(3 * DAY - i * HOUR), updatedAt: ago(rand(1 * HOUR, 1 * DAY)) }));
  manual.forEach((t, i) => tasks.push({ projectId: pid, title: t, status: states[i % states.length]!, source: 'manual', priority: pick(prios as unknown as string[]) as 'low', tags: [pick(['ui', 'api', 'db', 'perf'])], assigneeId: i % 4 === 0 ? null : pick(coders).id, reporterId: pick(coders).id, createdAt: ago(rand(2 * HOUR, 3 * DAY)), updatedAt: ago(rand(20 * MIN, 1 * DAY)) }));
  const insertedTasks = await db.insert(schema.tasks).values(tasks).returning({ id: schema.tasks.id });

  // ── proposals + votes + threads ─────────────────────────────────────────────
  const props = [
    { title: 'Adopt ECharts for visualizations', desc: 'Richer, faster charts.', status: 'accepted', role: 'frontend', code: 'export const opt = { xAxis:{}, yAxis:{}, series:[] };', lang: 'ts' },
    { title: 'Add SSO (OIDC) login', desc: 'Enterprise auth.', status: 'open', role: 'backend', code: null, lang: null },
    { title: 'Roll up metrics hourly', desc: 'Pre-aggregate for speed.', status: 'open', role: 'database', code: null, lang: null },
  ] as const;
  for (const p of props) {
    const [pr] = await db.insert(schema.proposals).values({ projectId: pid, title: p.title, description: p.desc, status: p.status, authorId: byRole[p.role]!.id, codeSnippet: p.code, language: p.lang, createdAt: ago(rand(1 * DAY, 3 * DAY)), updatedAt: ago(rand(2 * HOUR, 1 * DAY)) }).returning({ id: schema.proposals.id });
    for (const c of coders) if (Math.random() > 0.3) await db.insert(schema.votes).values({ projectId: pid, proposalId: pr!.id, voterId: c.id, vote: pick(['approve', 'approve', 'abstain'] as string[]) as 'approve' }).onConflictDoNothing();
    for (let i = 0; i < rand(1, 2); i++) await db.insert(schema.comments).values({ projectId: pid, authorId: pick(coders).id, targetType: 'proposal', targetId: pr!.id, content: pick(['+1', 'lets prototype it', 'what about cost?']), createdAt: ago(rand(2 * HOUR, 1 * DAY)) });
    if (p.status === 'accepted' && p.code) {
      await db.insert(schema.codePatterns).values({ projectId: pid, title: p.title, description: `Adopted from proposal "${p.title}".`, codeSnippet: p.code, language: p.lang, tags: ['adopted'], authorId: byRole[p.role]!.id, createdAt: ago(3 * HOUR) });
      await db.insert(schema.adrs).values({ projectId: pid, title: p.title, context: `Adopted from proposal.`, decision: p.desc, status: 'accepted', authorId: byRole[p.role]!.id, createdAt: ago(3 * HOUR) });
      await db.insert(schema.tasks).values({ projectId: pid, title: `Adopt: ${p.title}`, status: 'in_progress', source: 'proposal', priority: 'high', tags: ['adopted'], assigneeId: byRole[p.role]!.id, reporterId: byRole[p.role]!.id, createdAt: ago(3 * HOUR), updatedAt: ago(1 * HOUR) });
    }
  }
  // a couple standalone patterns + ADRs + notes
  await db.insert(schema.codePatterns).values([
    { projectId: pid, title: 'Time-range parser', codeSnippet: 'const ms = {"1h":3.6e6,"24h":8.64e7,"7d":6.04e8}[r];', language: 'ts', tags: ['util'], authorId: byRole['shared']!.id, createdAt: ago(1 * DAY) },
    { projectId: pid, title: 'SQL hourly rollup', codeSnippet: 'select date_trunc(\'hour\',ts), avg(value) from metrics group by 1;', language: 'sql', tags: ['db'], authorId: byRole['database']!.id, createdAt: ago(2 * DAY) },
  ]);
  await db.insert(schema.adrs).values({ projectId: pid, title: 'Postgres for metrics storage', context: 'Start simple.', decision: 'Use Postgres with a time index; revisit if scale demands.', status: 'accepted', authorId: byRole['database']!.id, createdAt: ago(2 * DAY) });
  await db.insert(schema.projectNotes).values([
    { projectId: pid, authorId: byRole['frontend']!.id, content: 'Design review Thursday — bring chart mocks.', pinned: true, createdAt: ago(1 * DAY) },
    { projectId: pid, authorId: byRole['backend']!.id, content: 'Repo: thornburywn2/testtesttest — keep commits small.', pinned: false, createdAt: ago(5 * HOUR) },
  ]);

  // feed
  const feed: (typeof schema.feedItems.$inferInsert)[] = [];
  for (let i = 0; i < 28; i++) { const c = pick(coders); feed.push({ projectId: pid, ts: ago(rand(1 * MIN, 6 * HOUR)), developerId: c.id, developer: c.username, color: defs.find((d) => d.username === c.username)!.color, kind: pick(['edit', 'prompt', 'claim', 'done', 'proposal', 'vote', 'comment', 'pattern']), detail: 'working on Apollo' }); }
  feed.push({ projectId: pid, ts: ago(11 * MIN), developerId: U['heidi']!.id, developer: 'heidi', color: '#4363d8', kind: 'idle', detail: 'agent went idle — 11m quiet' });
  await db.insert(schema.feedItems).values(feed);

  // ── LIVE REPO INTEGRATION: clone + poll the real repo → contribution data ───
  const repoDir = resolve(process.env.PRODUCT_REPOS_DIR ?? '.product-repos', pid);
  const res = await pollGitRepo({ projectId: pid, repoDir, repoUrl: REPO });
  console.log(`[apollo] git-poll: cloned + ingested ${res.newCommits} commit(s) from ${REPO}`);

  console.log(`[demo-seed-apollo] ✅ Apollo seeded. Login token: ${TOKEN} | repo: ${REPO} | tasks ${insertedTasks.length}+, 3 proposals, real git history ingested.`);
} catch (err) {
  console.error('[demo-seed-apollo] failed:', err);
  process.exitCode = 1;
} finally {
  await queryClient.end();
}
