import { sql } from 'drizzle-orm';
import { db, queryClient, schema } from './index';

// Idempotent dev seed: example coders, their presence rows, and example module
// path_prefixes. Re-runnable — existing rows are updated. The team can be any
// size: add or remove entries here (or add coders via the portal at kickoff).
// Emails map git commit authors -> coders for the git-poll / contribution report.
// NOTE: agentToken values are dev placeholders; each coder sets their own.

const CODERS = [
  { username: 'alice', displayName: 'Alice', email: 'alice@teamcoder.dev', color: '#e6194B', agentToken: 'dev-token-alice' },
  { username: 'bob', displayName: 'Bob', email: 'bob@teamcoder.dev', color: '#3cb44b', agentToken: 'dev-token-bob' },
  { username: 'carol', displayName: 'Carol', email: 'carol@teamcoder.dev', color: '#4363d8', agentToken: 'dev-token-carol' },
  { username: 'dave', displayName: 'Dave', email: 'dave@teamcoder.dev', color: '#f58231', agentToken: 'dev-token-dave' },
  { username: 'erin', displayName: 'Erin', email: 'erin@teamcoder.dev', color: '#911eb4', agentToken: 'dev-token-erin' },
];

// Example modules — replace path_prefixes with the real product repo layout at kickoff.
const MODULES = [
  { name: 'frontend', pathPrefix: 'apps/web/' },
  { name: 'backend', pathPrefix: 'apps/server/' },
  { name: 'shared', pathPrefix: 'packages/shared/' },
];

try {
  const insertedUsers = await db
    .insert(schema.users)
    .values(CODERS)
    .onConflictDoUpdate({
      target: schema.users.username,
      set: {
        displayName: sql`excluded.display_name`,
        email: sql`excluded.email`,
        color: sql`excluded.color`,
        agentToken: sql`excluded.agent_token`,
      },
    })
    .returning({ id: schema.users.id });

  // presence rows for everyone currently in the table
  const allUsers = await db.select({ id: schema.users.id }).from(schema.users);
  if (allUsers.length > 0) {
    await db
      .insert(schema.userPresence)
      .values(allUsers.map((u) => ({ userId: u.id, status: 'offline' as const })))
      .onConflictDoNothing({ target: schema.userPresence.userId });
  }

  await db
    .insert(schema.modules)
    .values(MODULES)
    .onConflictDoNothing({ target: schema.modules.pathPrefix });

  console.log(
    `[seed] users +${insertedUsers.length} (total ${allUsers.length}), presence + modules ensured`,
  );
} catch (err) {
  console.error('[seed] failed:', err);
  process.exitCode = 1;
} finally {
  await queryClient.end();
}
