import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASE_URL } from './index';

// Applies generated table migrations, then the idempotent triggers.
// onnotice is silenced — the idempotent DROP TRIGGER IF EXISTS emits a benign
// NOTICE on first run.
const client = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

try {
  const migrationsFolder = join(import.meta.dir, '../../drizzle');
  await migrate(drizzle(client), { migrationsFolder });
  console.log('[migrate] table migrations applied');

  const triggersSql = readFileSync(join(import.meta.dir, 'triggers.sql'), 'utf8');
  await client.unsafe(triggersSql);
  console.log('[migrate] LISTEN/NOTIFY triggers applied');
} catch (err) {
  console.error('[migrate] failed:', err);
  process.exitCode = 1;
} finally {
  await client.end();
}
