import postgres from 'postgres';
import { DATABASE_URL } from './index';

// Verifies the LISTEN/NOTIFY spine end-to-end: register a listener, insert a
// task on a separate connection, and assert the trigger's id-only payload
// arrives on 'db_notifications'. This is the P1 acceptance check.

const listener = postgres(DATABASE_URL, { max: 1 });
const writer = postgres(DATABASE_URL, { max: 1 });

async function main(): Promise<boolean> {
  let matched: { op: string; table: string; id: string } | null = null;
  let targetId = '';

  // resolve only when we see OUR task's notification — other NOTIFYs (a busy shared
  // DB: git-poll, idle, etc.) are ignored instead of clobbering the captured one.
  const got = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout: no matching NOTIFY in 5s')), 5000);
    listener.listen('db_notifications', (payload) => {
      try {
        const p = JSON.parse(payload) as { op: string; table: string; id: string };
        if (p.table === 'tasks' && p.op === 'INSERT' && p.id === targetId) {
          matched = p;
          clearTimeout(timeout);
          resolve();
        }
      } catch { /* ignore non-JSON */ }
    });
  });

  // let LISTEN register before we write
  await new Promise((r) => setTimeout(r, 300));

  const [row] = await writer<{ id: string }[]>`
    INSERT INTO tasks (title) VALUES ('notify round-trip probe') RETURNING id
  `;
  targetId = row!.id;
  console.log('[verify] inserted task', row!.id);

  await got;
  console.log('[verify] received payload:', JSON.stringify(matched));

  await writer`DELETE FROM tasks WHERE id = ${row!.id}`;

  return !!matched && matched.table === 'tasks' && matched.op === 'INSERT' && matched.id === row!.id;
}

let ok = false;
try {
  ok = await main();
  console.log(ok ? '[verify] ✅ LISTEN/NOTIFY round-trip OK' : '[verify] ❌ payload mismatch');
} catch (err) {
  console.error('[verify] ❌', err instanceof Error ? err.message : err);
} finally {
  await listener.end();
  await writer.end();
}
process.exit(ok ? 0 : 1);
