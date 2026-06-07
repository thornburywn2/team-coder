import postgres from 'postgres';
import { DATABASE_URL } from './index';

// Verifies the LISTEN/NOTIFY spine end-to-end: register a listener, insert a
// task on a separate connection, and assert the trigger's id-only payload
// arrives on 'db_notifications'. This is the P1 acceptance check.

const listener = postgres(DATABASE_URL, { max: 1 });
const writer = postgres(DATABASE_URL, { max: 1 });

async function main(): Promise<boolean> {
  let received: string | null = null;

  const got = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout: no NOTIFY in 5s')), 5000);
    listener.listen('db_notifications', (payload) => {
      received = payload;
      clearTimeout(timeout);
      resolve();
    });
  });

  // let LISTEN register before we write
  await new Promise((r) => setTimeout(r, 300));

  const [row] = await writer<{ id: string }[]>`
    INSERT INTO tasks (title) VALUES ('notify round-trip probe') RETURNING id
  `;
  console.log('[verify] inserted task', row!.id);

  await got;
  console.log('[verify] received payload:', received);

  await writer`DELETE FROM tasks WHERE id = ${row!.id}`;

  const parsed = JSON.parse(received!) as { op: string; table: string; id: string };
  return parsed.table === 'tasks' && parsed.op === 'INSERT' && parsed.id === row!.id;
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
