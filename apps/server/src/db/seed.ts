import { sql } from 'drizzle-orm';
import { db, queryClient, schema } from './index';

// Idempotent dev seed. Ensures a DEFAULT PROJECT (one project = one GitHub repo),
// backfills any pre-existing rows to it, and seeds example coders + modules under
// it. Re-runnable. The team/projects can be any size: add coders via the portal,
// or create new projects (each with its own token + repo) at login.

const DEFAULT_TOKEN = process.env.TEAM_TOKEN ?? 'change-me-team-token';
const DEFAULT_NAME = 'Default Project';
const DEFAULT_REPO = 'https://github.com/thornburywn2/team-coder.git';

const CODERS = [
  { username: 'alice', displayName: 'Alice', email: 'alice@teamcoder.dev', color: '#e6194B', agentToken: 'dev-token-alice' },
  { username: 'bob', displayName: 'Bob', email: 'bob@teamcoder.dev', color: '#3cb44b', agentToken: 'dev-token-bob' },
  { username: 'carol', displayName: 'Carol', email: 'carol@teamcoder.dev', color: '#4363d8', agentToken: 'dev-token-carol' },
  { username: 'dave', displayName: 'Dave', email: 'dave@teamcoder.dev', color: '#f58231', agentToken: 'dev-token-dave' },
  { username: 'erin', displayName: 'Erin', email: 'erin@teamcoder.dev', color: '#911eb4', agentToken: 'dev-token-erin' },
];

const MODULES = [
  { name: 'frontend', pathPrefix: 'apps/web/' },
  { name: 'backend', pathPrefix: 'apps/server/' },
  { name: 'shared', pathPrefix: 'packages/shared/' },
];

// tables that gained a nullable project_id and need backfilling to the default project
const BACKFILL = [
  'user_presence', 'modules', 'tasks', 'proposals', 'votes', 'adrs', 'code_patterns',
  'comments', 'activity_events', 'hook_events', 'sessions', 'git_commits', 'git_file_changes', 'project_notes',
];

try {
  const [proj] = await db
    .insert(schema.projects)
    .values({ name: DEFAULT_NAME, token: DEFAULT_TOKEN, githubRepoUrl: DEFAULT_REPO })
    .onConflictDoUpdate({ target: schema.projects.token, set: { name: DEFAULT_NAME } })
    .returning({ id: schema.projects.id });
  const projectId = proj!.id;

  // Backfill FIRST so pre-existing coders/rows belong to the project — otherwise
  // the upsert below would create duplicate coders and collide on agent_token.
  await db.execute(sql`update users set project_id = ${projectId} where project_id is null`);
  for (const t of BACKFILL) {
    await db.execute(sql`update ${sql.identifier(t)} set project_id = ${projectId} where project_id is null`);
  }

  await db
    .insert(schema.users)
    .values(CODERS.map((c) => ({ ...c, projectId })))
    .onConflictDoUpdate({
      target: [schema.users.projectId, schema.users.username],
      set: {
        displayName: sql`excluded.display_name`,
        email: sql`excluded.email`,
        color: sql`excluded.color`,
        agentToken: sql`excluded.agent_token`,
      },
    });

  const allUsers = await db.select({ id: schema.users.id }).from(schema.users);
  if (allUsers.length > 0) {
    await db
      .insert(schema.userPresence)
      .values(allUsers.map((u) => ({ userId: u.id, projectId, status: 'offline' as const })))
      .onConflictDoNothing({ target: schema.userPresence.userId });
  }

  await db
    .insert(schema.modules)
    .values(MODULES.map((m) => ({ ...m, projectId })))
    .onConflictDoNothing({ target: [schema.modules.projectId, schema.modules.pathPrefix] });

  console.log(`[seed] default project ${projectId} ensured; ${allUsers.length} coders, modules + backfill done`);
} catch (err) {
  console.error('[seed] failed:', err);
  process.exitCode = 1;
} finally {
  await queryClient.end();
}
