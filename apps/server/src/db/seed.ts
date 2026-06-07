import { db, queryClient, schema } from './index';

// Idempotent dev seed: 5 coders (2-2-1), their presence rows, and example
// module path_prefixes. Re-runnable — conflicts are ignored.
// NOTE: agentToken values here are dev placeholders; each coder sets their own.

const CODERS = [
  { username: 'alice', displayName: 'Alice (Frontend)', color: '#e6194B', agentToken: 'dev-token-alice' },
  { username: 'bob', displayName: 'Bob (Frontend)', color: '#3cb44b', agentToken: 'dev-token-bob' },
  { username: 'carol', displayName: 'Carol (Backend)', color: '#4363d8', agentToken: 'dev-token-carol' },
  { username: 'dave', displayName: 'Dave (Backend)', color: '#f58231', agentToken: 'dev-token-dave' },
  { username: 'erin', displayName: 'Erin (Integrator)', color: '#911eb4', agentToken: 'dev-token-erin' },
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
    .onConflictDoNothing({ target: schema.users.username })
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
