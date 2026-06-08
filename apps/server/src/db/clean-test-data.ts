import { and, eq, inArray, like, ne, or, sql } from 'drizzle-orm';
import { db, queryClient, schema } from './index';

// One-off cleanup of test debris (run: bun run db:clean). Removes:
//   1. every project except the Default Project (cascades all their data) —
//      these are throwaway projects left by verify scripts.
//   2. known probe tasks (+ their comments) on the Default board.
//   3. synthetic hook events / sessions (sim-*, own-*) and the throwaway
//      git-poll commits ingested into the Default project.
// Real data (your actual tasks/decisions/patterns) is left untouched.

const DEFAULT_TOKEN = process.env.TEAM_TOKEN ?? 'change-me-team-token';

const PROBE_TITLES = [
  'mcp probe task', 'mcp-created task', 'mcp-renamed task',
  'cap probe', 'audit lifecycle probe', 'notify round-trip probe', 'ws probe',
];

try {
  const [def] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.token, DEFAULT_TOKEN));
  if (!def) throw new Error('Default Project not found — run db:seed first');
  const pid = def.id;

  // 1. drop all non-default projects (cascade removes their tasks/comments/etc.)
  const others = await db.delete(schema.projects).where(ne(schema.projects.id, pid)).returning({ id: schema.projects.id });
  console.log(`[clean] deleted ${others.length} throwaway project(s)`);

  // 2. probe tasks on the default board (exact titles + the isolation-test
  //    'A-only task …' / 'B-only task …' patterns) + their comments
  const probes = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(
      eq(schema.tasks.projectId, pid),
      or(inArray(schema.tasks.title, PROBE_TITLES), like(schema.tasks.title, 'A-only task %'), like(schema.tasks.title, 'B-only task %')),
    ));
  const probeIds = probes.map((p) => p.id);
  if (probeIds.length) {
    await db.delete(schema.comments).where(and(eq(schema.comments.projectId, pid), eq(schema.comments.targetType, 'task'), inArray(schema.comments.targetId, probeIds)));
    await db.delete(schema.tasks).where(inArray(schema.tasks.id, probeIds));
  }
  console.log(`[clean] deleted ${probeIds.length} probe task(s) + their comments`);

  // 3. synthetic hook events / sessions + throwaway git-poll data on the default project
  const hooks = await db.delete(schema.hookEvents).where(and(eq(schema.hookEvents.projectId, pid), sql`(${schema.hookEvents.sessionId} LIKE 'sim-%' OR ${schema.hookEvents.sessionId} LIKE 'own-%')`)).returning({ id: schema.hookEvents.id });
  await db.delete(schema.sessions).where(and(eq(schema.sessions.projectId, pid), sql`(${schema.sessions.sessionId} LIKE 'sim-%' OR ${schema.sessions.sessionId} LIKE 'own-%')`));
  const commits = await db.delete(schema.gitCommits).where(eq(schema.gitCommits.projectId, pid)).returning({ sha: schema.gitCommits.sha });
  console.log(`[clean] deleted ${hooks.length} synthetic hook event(s), test sessions, and ${commits.length} throwaway git commit(s)`);

  console.log('[clean] ✅ test debris removed');
} catch (err) {
  console.error('[clean] failed:', err);
  process.exitCode = 1;
} finally {
  await queryClient.end();
}
