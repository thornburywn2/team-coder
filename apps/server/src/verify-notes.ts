export {}; // module marker for top-level await

// Step 3 acceptance check: project notes. Post a note over REST and assert it
// (a) lands in GET /api/notes, (b) arrives LIVE as a NOTE_ADDED ws delta, and
// (c) stays isolated — a note posted to another project never reaches this
// project's socket or list. Requires the server running + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const WS_URL = process.env.WS_URL ?? `ws://localhost:${process.env.PORT ?? 6300}/ws`;
const TOKEN_A = process.env.TEAM_TOKEN ?? 'change-me-team-token';

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

const hdr = (t: string) => ({ 'x-team-token': t, 'content-type': 'application/json' });
async function jget<T>(t: string, p: string): Promise<T> {
  const r = await fetch(`${BASE}${p}`, { headers: hdr(t) });
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return r.json() as Promise<T>;
}
async function postNote(t: string, content: string, authorId?: string) {
  const r = await fetch(`${BASE}/api/notes`, { method: 'POST', headers: hdr(t), body: JSON.stringify({ content, authorId }) });
  if (!r.ok) throw new Error(`POST /api/notes -> ${r.status}`);
  return r.json() as Promise<{ id: string }>;
}

try {
  // Project B with its own token
  const projB = (await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Notes Test B' }) })).json()) as { token: string };
  const TOKEN_B = projB.token;
  const usersA = await jget<Array<{ id: string }>>(TOKEN_A, '/api/users');
  const usersB = await jget<Array<{ id: string }>>(TOKEN_B, '/api/users');

  const stamp = `${Math.floor(performance.now())}`;
  const noteA = `A-note-${stamp}`;
  const noteB = `B-note-${stamp}`;

  // open a socket scoped to project A and collect NOTE_ADDED deltas
  const received: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const done = () => { ws.close(); resolve(); };
    ws.onerror = () => reject(new Error('socket error'));
    ws.onmessage = async (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string; payload?: { content?: string } };
      if (msg.type === 'HELLO') {
        ws.send(JSON.stringify({ type: 'AUTH', payload: { token: TOKEN_A } }));
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { eventTypes: ['NOTE_ADDED'] } }));
        setTimeout(async () => {
          await postNote(TOKEN_A, noteA, usersA[0]?.id); // should reach A's socket
          await postNote(TOKEN_B, noteB, usersB[0]?.id); // must NOT reach A's socket
          setTimeout(done, 1200); // window to collect deltas
        }, 400);
        return;
      }
      if (msg.type === 'NOTE_ADDED' && msg.payload?.content) received.push(msg.payload.content);
    };
  });

  check(received.includes(noteA), `A's socket received its own NOTE_ADDED live`);
  check(!received.includes(noteB), `A's socket did NOT receive B's note (isolation)`);

  const listA = await jget<Array<{ content: string }>>(TOKEN_A, '/api/notes');
  const listB = await jget<Array<{ content: string }>>(TOKEN_B, '/api/notes');
  check(listA.some((n) => n.content === noteA) && !listA.some((n) => n.content === noteB), `GET /api/notes (A) has A's note, not B's`);
  check(listB.some((n) => n.content === noteB) && !listB.some((n) => n.content === noteA), `GET /api/notes (B) has B's note, not A's`);

  // empty content rejected
  const bad = await fetch(`${BASE}/api/notes`, { method: 'POST', headers: hdr(TOKEN_A), body: JSON.stringify({ content: '  ' }) });
  check(bad.status === 400, `empty note rejected (${bad.status})`);
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
}

console.log(ok ? '\n[verify-notes] ✅ notes live + isolated' : '\n[verify-notes] ❌ failed');
process.exit(ok ? 0 : 1);
