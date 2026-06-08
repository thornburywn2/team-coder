import { Hono } from 'hono';
import { and, count, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { teamAuth, type Project } from '../auth';
import { getConnection, getConnections } from '../connections';
import { recentCollisions } from '../collisions';
import { activeLocks } from '../locks';
import { recentFeed } from '../feed';
import { computeOwnership, refreshOwnership } from '../ownership';
import { buildReport } from '../report';
import { estimateCost } from '../lib/pricing';
import { decomposePrd } from '../lib/decompose';
import { decomposePrdLlm, llmEnabled } from '../lib/decompose-llm';
import { computeAwards } from '../lib/awards';
import { taskRoutes } from './tasks';
import { proposalRoutes } from './proposals';
import { commentRoutes } from './comments';
import { patternRoutes } from './patterns';

// Human portal REST. Read endpoints for initial hydration; the WebSocket keeps
// the client hot after load. All gated by a project's team token, which teamAuth
// resolves to a project — so every read here is scoped to that project.

export const apiRoutes = new Hono<{ Variables: { project: Project } }>();

apiRoutes.use('*', teamAuth);

// the project this token belongs to (name / repo / PRD) — for the board header
apiRoutes.get('/projects/current', (c) => c.json(c.get('project')));

// repo sync status — the linked repo + latest ingested commit, so engineers'
// local-sync watchers (and the UI) know the team's current HEAD.
apiRoutes.get('/repo/status', async (c) => {
  const project = c.get('project');
  const [latest] = await db
    .select({ sha: schema.gitCommits.sha, committedAt: schema.gitCommits.committedAt, authorName: schema.gitCommits.authorName, message: schema.gitCommits.message })
    .from(schema.gitCommits).where(eq(schema.gitCommits.projectId, project.id)).orderBy(desc(schema.gitCommits.committedAt)).limit(1);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.gitCommits).where(eq(schema.gitCommits.projectId, project.id));
  return c.json({ repoUrl: project.githubRepoUrl, commitCount: Number(n), latest: latest ?? null });
});

// PRD ingestion — save/update the project's goal document (markdown).
apiRoutes.put('/projects/current/prd', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as { prd?: string };
  const prd = typeof body.prd === 'string' ? body.prd : '';
  const [row] = await db
    .update(schema.projects)
    .set({ prd: prd.trim() || null })
    .where(eq(schema.projects.id, project.id))
    .returning({ id: schema.projects.id, name: schema.projects.name, githubRepoUrl: schema.projects.githubRepoUrl, prd: schema.projects.prd });
  return c.json(row);
});

// Decompose a PRD into candidate tasks for review (preview only — NO writes).
// Uses the posted PRD if given (preview unsaved edits), else the saved one.
// Deterministic by default; if DECOMPOSE_LLM is enabled (and mode != 'deterministic')
// it tries an LLM first and transparently falls back to the parser. The response
// reports which `mode` produced the candidates.
apiRoutes.post('/projects/current/decompose', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as { prd?: string; mode?: 'auto' | 'deterministic' | 'llm' };
  const prd = (typeof body.prd === 'string' ? body.prd : project.prd) ?? '';
  if (!prd.trim()) return c.json({ error: 'no PRD to decompose — add a project goal first' }, 400);
  const mods = await db
    .select({ id: schema.modules.id, name: schema.modules.name, pathPrefix: schema.modules.pathPrefix })
    .from(schema.modules)
    .where(eq(schema.modules.projectId, project.id));

  let candidates = null;
  let mode = 'deterministic';
  if (body.mode !== 'deterministic' && llmEnabled()) {
    candidates = await decomposePrdLlm(prd, mods); // null on any failure → fall back
    if (candidates?.length) mode = 'llm';
  }
  if (!candidates?.length) candidates = decomposePrd(prd, mods);
  return c.json({ candidates, mode });
});

// at-a-glance KPIs for the board header strip (one cheap call)
apiRoutes.get('/summary', async (c) => {
  const pid = c.get('project').id;
  const since = new Date(Date.now() - 5 * 60_000);
  const [taskAgg, presence, liveAgents, openProps, git, tok] = await Promise.all([
    db.select({ status: schema.tasks.status, n: count() }).from(schema.tasks).where(eq(schema.tasks.projectId, pid)).groupBy(schema.tasks.status),
    db.select({ status: schema.userPresence.status }).from(schema.userPresence).where(eq(schema.userPresence.projectId, pid)),
    db.select({ dev: schema.sessions.developerId }).from(schema.sessions).where(and(eq(schema.sessions.projectId, pid), isNotNull(schema.sessions.developerId), gte(schema.sessions.lastSeenAt, since))),
    db.select({ n: count() }).from(schema.proposals).where(and(eq(schema.proposals.projectId, pid), eq(schema.proposals.status, 'open'))),
    db.select({ commits: count(), lines: sql<number>`coalesce(sum(${schema.gitCommits.additions}),0)` }).from(schema.gitCommits).where(eq(schema.gitCommits.projectId, pid)),
    db.select({ tokens: sql<number>`coalesce(sum(${schema.sessions.inputTokens} + ${schema.sessions.outputTokens}),0)` }).from(schema.sessions).where(eq(schema.sessions.projectId, pid)),
  ]);
  const tByStatus = Object.fromEntries(taskAgg.map((r) => [r.status, Number(r.n)]));
  const total = taskAgg.reduce((a, r) => a + Number(r.n), 0);
  return c.json({
    tasks: { total, done: tByStatus['done'] ?? 0, blocked: tByStatus['blocked'] ?? 0, inProgress: tByStatus['in_progress'] ?? 0 },
    activeCoders: presence.filter((p) => p.status === 'active').length,
    liveAgents: new Set(liveAgents.map((s) => s.dev)).size,
    liveSessions: liveAgents.length,
    openProposals: Number(openProps[0]?.n ?? 0),
    commits: Number(git[0]?.commits ?? 0),
    linesAdded: Number(git[0]?.lines ?? 0),
    tokens: Number(tok[0]?.tokens ?? 0),
  });
});

// token usage per coder (tokens + estimated $) and a per-model breakdown — track +
// minimize spend. Cost is computed per session at its model's rate. Sorted desc.
apiRoutes.get('/usage', async (c) => {
  const pid = c.get('project').id;
  const [users, rows] = await Promise.all([
    db.select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username, color: schema.users.color }).from(schema.users).where(eq(schema.users.projectId, pid)),
    db.select({ dev: schema.sessions.developerId, inputTokens: schema.sessions.inputTokens, outputTokens: schema.sessions.outputTokens, cacheReadTokens: schema.sessions.cacheReadTokens, model: schema.sessions.model }).from(schema.sessions).where(and(eq(schema.sessions.projectId, pid), isNotNull(schema.sessions.developerId))),
  ]);
  type Acc = { tokensIn: number; tokensOut: number; cacheRead: number; cost: number };
  const perDev = new Map<string, Acc>();
  const perModel = new Map<string, Acc>();
  const bump = (m: Map<string, Acc>, k: string, r: { inputTokens: number; outputTokens: number; cacheReadTokens: number; model: string | null }) => {
    const a = m.get(k) ?? { tokensIn: 0, tokensOut: 0, cacheRead: 0, cost: 0 };
    a.tokensIn += Number(r.inputTokens); a.tokensOut += Number(r.outputTokens); a.cacheRead += Number(r.cacheReadTokens);
    a.cost += estimateCost({ inputTokens: Number(r.inputTokens), outputTokens: Number(r.outputTokens), cacheReadTokens: Number(r.cacheReadTokens), model: r.model });
    m.set(k, a);
  };
  for (const r of rows) {
    if (r.dev) bump(perDev, r.dev, r);
    bump(perModel, r.model ?? 'unknown', r);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const coders = users
    .map((u) => {
      const a = perDev.get(u.id) ?? { tokensIn: 0, tokensOut: 0, cacheRead: 0, cost: 0 };
      return { developerId: u.id, name: u.displayName ?? u.username, color: u.color, tokensIn: a.tokensIn, tokensOut: a.tokensOut, total: a.tokensIn + a.tokensOut, costUsd: round(a.cost) };
    })
    .sort((a, b) => b.total - a.total);
  const models = [...perModel.entries()]
    .map(([model, a]) => ({ model, tokensIn: a.tokensIn, tokensOut: a.tokensOut, total: a.tokensIn + a.tokensOut, costUsd: round(a.cost) }))
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);
  return c.json({ coders, models, total: coders.reduce((s, c2) => s + c2.total, 0), totalCostUsd: round(coders.reduce((s, c2) => s + c2.costUsd, 0)) });
});

// attribution health: coders' git identities + commit authors we couldn't map to
// any coder (so they can be fixed). Powers the Report's attribution panel.
apiRoutes.get('/attribution', async (c) => {
  const pid = c.get('project').id;
  const [users, unmapped] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.displayName, username: schema.users.username, email: schema.users.email, gitEmails: schema.users.gitEmails, color: schema.users.color }).from(schema.users).where(eq(schema.users.projectId, pid)),
    db
      .select({ authorEmail: schema.gitCommits.authorEmail, authorName: sql<string>`max(${schema.gitCommits.authorName})`, commits: count() })
      .from(schema.gitCommits)
      .where(and(eq(schema.gitCommits.projectId, pid), sql`${schema.gitCommits.developerId} is null`, isNotNull(schema.gitCommits.authorEmail)))
      .groupBy(schema.gitCommits.authorEmail).orderBy(desc(count())),
  ]);
  return c.json({ coders: users.map((u) => ({ ...u, name: u.name ?? u.username })), unattributed: unmapped.map((r) => ({ authorEmail: r.authorEmail, authorName: r.authorName, commits: Number(r.commits) })) });
});

// map an unattributed git author email to a coder: remember the email AND backfill
// existing commits/file-changes so the attribution is retroactive.
apiRoutes.post('/attribution/map', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as { developerId?: string; email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!body.developerId || !email) return c.json({ error: 'developerId and email required' }, 400);
  const [dev] = await db.select({ id: schema.users.id, gitEmails: schema.users.gitEmails }).from(schema.users).where(and(eq(schema.users.id, body.developerId), eq(schema.users.projectId, project.id)));
  if (!dev) return c.json({ error: 'unknown coder' }, 400);
  const emails = Array.from(new Set([...(dev.gitEmails ?? []).map((e) => e.toLowerCase()), email]));
  await db.update(schema.users).set({ gitEmails: emails }).where(eq(schema.users.id, dev.id));
  // backfill: claim every commit + file-change by that email for this project
  const claimed = await db.update(schema.gitCommits).set({ developerId: dev.id }).where(and(eq(schema.gitCommits.projectId, project.id), sql`lower(${schema.gitCommits.authorEmail}) = ${email}`)).returning({ sha: schema.gitCommits.sha });
  if (claimed.length) await db.update(schema.gitFileChanges).set({ developerId: dev.id }).where(and(eq(schema.gitFileChanges.projectId, project.id), inArray(schema.gitFileChanges.sha, claimed.map((x) => x.sha))));
  void refreshOwnership();
  return c.json({ ok: true, backfilled: claimed.length });
});

// ── Project + team management (team-token gated — a member can manage their project) ──
const MGMT_COLORS = ['#e6194B', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'];

// update project settings: name, repo URL, per-project git-poll toggle
apiRoutes.patch('/projects/current', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; githubRepoUrl?: string | null; gitPollEnabled?: boolean };
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch['name'] = body.name.trim().slice(0, 120);
  if (body.githubRepoUrl !== undefined) patch['githubRepoUrl'] = body.githubRepoUrl?.trim() || null;
  if (typeof body.gitPollEnabled === 'boolean') patch['gitPollEnabled'] = body.gitPollEnabled;
  if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400);
  await db.update(schema.projects).set(patch).where(eq(schema.projects.id, project.id));
  return c.json({ ok: true });
});

// rotate the project's team token (invalidates the old one for everyone)
apiRoutes.post('/projects/current/rotate-token', async (c) => {
  const project = c.get('project');
  const token = `tc-${crypto.randomUUID()}`;
  await db.update(schema.projects).set({ token }).where(eq(schema.projects.id, project.id));
  return c.json({ token });
});

// archive (soft) the project — hides it from active lists; data is retained
apiRoutes.post('/projects/current/archive', async (c) => {
  const project = c.get('project');
  await db.update(schema.projects).set({ archivedAt: new Date() }).where(eq(schema.projects.id, project.id));
  return c.json({ ok: true });
});

// team roster WITH agent tokens (for onboarding/management within the team)
apiRoutes.get('/team', async (c) => {
  const pid = c.get('project').id;
  const rows = await db.select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, email: schema.users.email, gitEmails: schema.users.gitEmails, color: schema.users.color, agentToken: schema.users.agentToken }).from(schema.users).where(eq(schema.users.projectId, pid)).orderBy(schema.users.createdAt);
  return c.json(rows);
});

// add a coder to the team
apiRoutes.post('/team/members', async (c) => {
  const pid = c.get('project').id;
  const body = (await c.req.json().catch(() => ({}))) as { displayName?: string; email?: string };
  const displayName = body.displayName?.trim().slice(0, 100);
  if (!displayName) return c.json({ error: 'displayName required' }, 400);
  const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'coder';
  const existing = await db.select({ username: schema.users.username }).from(schema.users).where(eq(schema.users.projectId, pid));
  let username = base; let i = 1;
  const taken = new Set(existing.map((u) => u.username));
  while (taken.has(username)) username = `${base}-${i++}`;
  const color = MGMT_COLORS[existing.length % MGMT_COLORS.length]!;
  const [u] = await db.insert(schema.users).values({ projectId: pid, username, displayName, email: body.email?.trim() || null, color, agentToken: `dev-${crypto.randomUUID()}` }).returning({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, agentToken: schema.users.agentToken });
  await db.insert(schema.userPresence).values({ userId: u!.id, projectId: pid, status: 'offline' }).onConflictDoNothing({ target: schema.userPresence.userId });
  return c.json(u, 201);
});

// edit a coder (name, login email, git emails for attribution, color)
apiRoutes.patch('/team/members/:id', async (c) => {
  const pid = c.get('project').id;
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { displayName?: string; email?: string | null; gitEmails?: string[]; color?: string };
  const patch: Record<string, unknown> = {};
  if (typeof body.displayName === 'string' && body.displayName.trim()) patch['displayName'] = body.displayName.trim().slice(0, 100);
  if (body.email !== undefined) patch['email'] = body.email?.trim() || null;
  if (Array.isArray(body.gitEmails)) patch['gitEmails'] = body.gitEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (typeof body.color === 'string') patch['color'] = body.color.slice(0, 20);
  if (Object.keys(patch).length === 0) return c.json({ error: 'nothing to update' }, 400);
  const [u] = await db.update(schema.users).set(patch).where(and(eq(schema.users.id, id), eq(schema.users.projectId, pid))).returning({ id: schema.users.id });
  if (!u) return c.json({ error: 'unknown coder' }, 404);
  return c.json({ ok: true });
});

// remove a coder from the team
apiRoutes.delete('/team/members/:id', async (c) => {
  const pid = c.get('project').id;
  const id = c.req.param('id');
  const [u] = await db.delete(schema.users).where(and(eq(schema.users.id, id), eq(schema.users.projectId, pid))).returning({ id: schema.users.id });
  if (!u) return c.json({ error: 'unknown coder' }, 404);
  return c.json({ ok: true });
});

// rotate a coder's agent token (revokes the old one)
apiRoutes.post('/team/members/:id/rotate-token', async (c) => {
  const pid = c.get('project').id;
  const id = c.req.param('id');
  const agentToken = `dev-${crypto.randomUUID()}`;
  const [u] = await db.update(schema.users).set({ agentToken }).where(and(eq(schema.users.id, id), eq(schema.users.projectId, pid))).returning({ id: schema.users.id });
  if (!u) return c.json({ error: 'unknown coder' }, 404);
  return c.json({ agentToken });
});

// token-usage trend — tokens per day (from session rollups, by last-seen day) so
// the team can watch spend over time and drive it down.
apiRoutes.get('/usage/trend', async (c) => {
  const pid = c.get('project').id;
  const rows = await db.select({ ts: schema.sessions.lastSeenAt, tin: schema.sessions.inputTokens, tout: schema.sessions.outputTokens }).from(schema.sessions).where(and(eq(schema.sessions.projectId, pid), isNotNull(schema.sessions.developerId)));
  const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
  const m = new Map<string, number>();
  for (const r of rows) m.set(day(r.ts), (m.get(day(r.ts)) ?? 0) + Number(r.tin) + Number(r.tout));
  const series = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, tokens]) => ({ date, tokens }));
  return c.json({ series, total: series.reduce((s, p) => s + p.tokens, 0) });
});

// burndown — daily cumulative scope vs done (and remaining) over the project, so
// the team sees momentum toward the goal. Completion time = the task's completedAt
// (accurate), falling back to updatedAt for rows finished before that was tracked.
apiRoutes.get('/burndown', async (c) => {
  const pid = c.get('project').id;
  const rows = await db.select({ createdAt: schema.tasks.createdAt, updatedAt: schema.tasks.updatedAt, completedAt: schema.tasks.completedAt, status: schema.tasks.status }).from(schema.tasks).where(eq(schema.tasks.projectId, pid));
  if (!rows.length) return c.json({ series: [], total: 0, done: 0 });
  const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
  const created = rows.map((r) => day(r.createdAt));
  const doneDays = rows.filter((r) => r.status === 'done').map((r) => day(r.completedAt ?? r.updatedAt));
  const start = created.reduce((a, b) => (a < b ? a : b));
  const end = day(new Date());
  const days: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`); day(d) <= end && days.length < 60; d = new Date(d.getTime() + 86_400_000)) days.push(day(d));
  const series = days.map((date) => {
    const scope = created.filter((x) => x <= date).length;
    const done = doneDays.filter((x) => x <= date).length;
    return { date, scope, done, remaining: scope - done };
  });
  return c.json({ series, total: rows.length, done: doneDays.length });
});

// live activity feed (durable, most-recent-first), this project only
apiRoutes.get('/feed', async (c) => c.json(await recentFeed(c.get('project').id)));

// advisory concurrent-edit warnings (active, non-expired) for this project
apiRoutes.get('/collisions', (c) => c.json(recentCollisions(c.get('project').id)));

// active cooperative work-locks (who's holding which file right now)
apiRoutes.get('/locks', async (c) => c.json(await activeLocks(c.get('project').id)));

// team AWARDS — a positive "leaderboard": everyone gets an award reflecting a real
// strength (nothing negative). Built from the full contribution report + live
// agent counts. It's a team event — celebrate each person's strengths.
apiRoutes.get('/leaderboard', async (c) => {
  const pid = c.get('project').id;
  const activeSince = new Date(Date.now() - 5 * 60_000);
  const [report, activeAgg] = await Promise.all([
    buildReport(pid, new Date().toISOString()),
    db.select({ dev: schema.sessions.developerId, n: count() }).from(schema.sessions).where(and(eq(schema.sessions.projectId, pid), isNotNull(schema.sessions.developerId), gte(schema.sessions.lastSeenAt, activeSince))).groupBy(schema.sessions.developerId),
  ]);
  const active = new Map(activeAgg.filter((r) => r.dev).map((r) => [r.dev as string, Number(r.n)]));
  const awards = computeAwards(report.coders);
  const board = report.coders
    .map((c2) => ({
      developerId: c2.id,
      name: c2.name,
      color: c2.color,
      award: awards.get(c2.id) ?? { title: 'Team Player', emoji: '🌟', reason: 'here for the team' },
      tasksDone: c2.tasksCompleted,
      prompts: c2.prompts,
      tools: c2.toolCalls,
      linesAdded: c2.linesAdded,
      filesTouched: c2.filesTouched,
      activeMinutes: c2.activeMinutes,
      topLanguage: c2.languages[0]?.name ?? null,
      topLayer: c2.layers[0]?.name ?? null,
      activeAgents: active.get(c2.id) ?? 0,
    }))
    // most "active" first, but it's awards not ranks — everyone's celebrated
    .sort((a, b) => b.tasksDone + b.tools - (a.tasksDone + a.tools));
  return c.json(board);
});

// active AGENTS — each running session (a coder may drive several at once), with
// per-agent stats. Powers "who/which agent is active right now".
apiRoutes.get('/agents', async (c) => {
  const pid = c.get('project').id;
  const since = new Date(Date.now() - 15 * 60_000); // agents seen in the last 15 min
  const sess = await db
    .select({ sessionId: schema.sessions.sessionId, developerId: schema.sessions.developerId, startedAt: schema.sessions.startedAt, lastSeenAt: schema.sessions.lastSeenAt, prompts: schema.sessions.promptCount, tools: schema.sessions.toolCount })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.projectId, pid), isNotNull(schema.sessions.developerId), gte(schema.sessions.lastSeenAt, since)))
    .orderBy(desc(schema.sessions.lastSeenAt));

  const sids = sess.map((s) => s.sessionId);
  const [people, events] = await Promise.all([
    db.select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username, color: schema.users.color }).from(schema.users).where(eq(schema.users.projectId, pid)),
    sids.length
      ? db.select({ sessionId: schema.hookEvents.sessionId, filePath: schema.hookEvents.filePath, ts: schema.hookEvents.ts }).from(schema.hookEvents).where(and(eq(schema.hookEvents.projectId, pid), inArray(schema.hookEvents.sessionId, sids), isNotNull(schema.hookEvents.filePath)))
      : Promise.resolve([] as { sessionId: string; filePath: string | null; ts: Date }[]),
  ]);
  const user = (id: string | null) => people.find((p) => p.id === id);
  const now = Date.now();

  const agents = sess.map((s) => {
    const evs = events.filter((e) => e.sessionId === s.sessionId && e.filePath);
    const files = new Set(evs.map((e) => e.filePath));
    const latest = evs.reduce<{ filePath: string | null; ts: Date } | null>((a, e) => (!a || e.ts > a.ts ? e : a), null);
    const ageMs = now - new Date(s.lastSeenAt).getTime();
    const u = user(s.developerId);
    return {
      sessionId: s.sessionId,
      developerId: s.developerId,
      developerName: u?.displayName ?? u?.username ?? '?',
      color: u?.color ?? null,
      startedAt: s.startedAt,
      lastSeenAt: s.lastSeenAt,
      prompts: s.prompts,
      tools: s.tools,
      activeMinutes: Math.max(0, Math.round((new Date(s.lastSeenAt).getTime() - new Date(s.startedAt).getTime()) / 60000)),
      filesTouched: files.size,
      currentFile: latest?.filePath ?? null,
      status: ageMs < 90_000 ? 'active' : ageMs < 5 * 60_000 ? 'idle' : 'away',
    };
  });
  return c.json(agents);
});

apiRoutes.get('/presence', async (c) =>
  c.json(await db.select().from(schema.userPresence).where(eq(schema.userPresence.projectId, c.get('project').id))),
);

// auto-inferred module ownership (live, computed on demand)
apiRoutes.get('/modules/ownership', async (c) => c.json(await computeOwnership(c.get('project').id)));

// contribution report (who built what — for during + after the hackathon)
apiRoutes.get('/report', async (c) => {
  const days = Number(c.req.query('days'));
  const sinceDays = Number.isFinite(days) && days > 0 ? days : undefined;
  return c.json(await buildReport(c.get('project').id, new Date().toISOString(), { sinceDays }));
});

apiRoutes.get('/users', async (c) =>
  c.json(
    await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        color: schema.users.color,
      })
      .from(schema.users)
      .where(eq(schema.users.projectId, c.get('project').id)),
  ),
);

// team-wide agent connection liveness (per coder: last MCP + hook activity)
apiRoutes.get('/connections', (c) => c.json(getConnections(c.get('project').id)));

// per-coder connect info: agent token + live connection status. Used by the
// "Connect your agent" screen to render copy-paste setup + a live indicator.
apiRoutes.get('/connect/:userId', async (c) => {
  const userId = c.req.param('userId');
  const [u] = await db
    .select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, agentToken: schema.users.agentToken })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.projectId, c.get('project').id)));
  if (!u) return c.json({ error: 'unknown coder' }, 404);
  return c.json({ ...u, connection: getConnection(userId) });
});

// project notes — anyone on the project can post; the project_notes trigger
// emits NOTE_ADDED over the WebSocket so the panel updates live for everyone.
apiRoutes.get('/notes', async (c) =>
  c.json(
    await db
      .select()
      .from(schema.projectNotes)
      .where(eq(schema.projectNotes.projectId, c.get('project').id))
      .orderBy(desc(schema.projectNotes.createdAt))
      .limit(100),
  ),
);

apiRoutes.post('/notes', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as { content?: string; authorId?: string };
  if (!body.content?.trim()) return c.json({ error: 'content required' }, 400);
  const [row] = await db
    .insert(schema.projectNotes)
    .values({ projectId: project.id, authorId: body.authorId ?? null, content: body.content.trim() })
    .returning();
  return c.json(row, 201);
});

// tasks: list / create / claim / done (taskRoutes reads the project from context)
apiRoutes.route('/tasks', taskRoutes);

// proposals (design-evolution channel + voting) and comments (anchored threads)
apiRoutes.route('/proposals', proposalRoutes);
apiRoutes.route('/comments', commentRoutes);
apiRoutes.route('/patterns', patternRoutes); // reuse-kit: shared code patterns

// decisions of record (ADRs) — captured when proposals are adopted, so the team
// doesn't relitigate. Newest first.
apiRoutes.get('/decisions', async (c) =>
  c.json(
    await db
      .select({ id: schema.adrs.id, seq: schema.adrs.sequenceNum, title: schema.adrs.title, context: schema.adrs.context, decision: schema.adrs.decision, status: schema.adrs.status, authorId: schema.adrs.authorId, createdAt: schema.adrs.createdAt })
      .from(schema.adrs)
      .where(eq(schema.adrs.projectId, c.get('project').id))
      .orderBy(desc(schema.adrs.createdAt))
      .limit(100),
  ),
);
