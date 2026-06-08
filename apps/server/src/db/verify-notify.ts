import postgres from 'postgres';
import { DATABASE_URL } from './index';

// Verifies the LISTEN/NOTIFY spine end-to-end: register a listener, insert a
// task on a separate connection, and assert the trigger's id-only payload
// arrives on 'db_notifications'. This is the P1 acceptance check.

const listener = postgres(DATABASE_URL, { max: 1 });
const writer = postgres(DATABASE_URL, { max: 1 });

async function main(): Promise<boolean> {
  type Note = { op: string; table: string; id: string };
  const seen: Note[] = [];
  let targetId = '';
  let resolveGot: () => void = () => {};

  const matches = () => !!targetId && seen.some((p) => p.table === 'tasks' && p.op === 'INSERT' && p.id === targetId);

  // buffer every notification; resolve once OUR task's insert shows up. Buffering
  // avoids a race where the NOTIFY arrives before we learn the inserted id, and
  // ignores unrelated NOTIFYs from a busy shared DB (git-poll, idle, etc.).
  let timeout: ReturnType<typeof setTimeout>;
  const got = new Promise<void>((resolve, reject) => {
    resolveGot = () => { clearTimeout(timeout); resolve(); };
    timeout = setTimeout(() => reject(new Error('timeout: no matching NOTIFY in 5s')), 5000);
    listener.listen('db_notifications', (payload) => {
      try { seen.push(JSON.parse(payload) as Note); } catch { /* ignore non-JSON */ }
      if (matches()) resolveGot();
    });
  });

  await new Promise((r) => setTimeout(r, 300)); // let LISTEN register before we write

  const [row] = await writer<{ id: string }[]>`
    INSERT INTO tasks (title) VALUES ('notify round-trip probe') RETURNING id
  `;
  targetId = row!.id;
  console.log('[verify] inserted task', row!.id);
  if (matches()) resolveGot(); // it may have arrived before we set targetId

  await got;
  await writer`DELETE FROM tasks WHERE id = ${row!.id}`;
  return matches();
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
