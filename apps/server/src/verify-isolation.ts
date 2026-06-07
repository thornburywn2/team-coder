export {}; // module marker for top-level await

// Step 2 acceptance check: multi-project isolation. Create a second project, then
// prove that data created under one project's token is never visible through the
// other's — tasks, users, feed, and the current-project header all stay scoped.
// Also checks backward-compat (the default token still works) and that an unknown
// token is rejected. Requires the server running + db:seed (Default Project).

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const TOKEN_A = process.env.TEAM_TOKEN ?? 'change-me-team-token'; // Default Project

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

const hdr = (token: string) => ({ 'x-team-token': token, 'content-type': 'application/json' });
async function jget<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: hdr(token) });
  if (!res.ok) throw new Error(`GET ${path} (tokenβ) -> ${res.status}`);
  return res.json() as Promise<T>;
}
async function mkTask(token: string, title: string): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/tasks`, { method: 'POST', headers: hdr(token), body: JSON.stringify({ title }) });
  if (!res.ok) throw new Error(`POST /api/tasks -> ${res.status}`);
  return res.json() as Promise<{ id: string }>;
}

try {
  // 1. create Project B (open endpoint, no token) → mints its own token
  const created = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Isolation Test B' }),
  });
  check(created.status === 201, `POST /api/projects -> ${created.status}`);
  const projB = (await created.json()) as { id: string; name: string; token: string };
  const TOKEN_B = projB.token;
  check(!!TOKEN_B && TOKEN_B !== TOKEN_A, `Project B got a distinct token`);

  // 2. current-project header is correctly scoped per token
  const curA = await jget<{ id: string; name: string }>(TOKEN_A, '/api/projects/current');
  const curB = await jget<{ id: string; name: string }>(TOKEN_B, '/api/projects/current');
  check(curB.id === projB.id && curB.name === 'Isolation Test B', `B sees its own project (${curB.name})`);
  check(curA.id !== curB.id, `A and B resolve to different projects`);

  // 3. tasks created under each token never cross over
  const tA = await mkTask(TOKEN_A, 'A-only task ' + curA.id.slice(0, 8));
  const tB = await mkTask(TOKEN_B, 'B-only task ' + projB.id.slice(0, 8));
  const tasksA = await jget<Array<{ id: string }>>(TOKEN_A, '/api/tasks');
  const tasksB = await jget<Array<{ id: string }>>(TOKEN_B, '/api/tasks');
  check(tasksA.some((t) => t.id === tA.id) && !tasksA.some((t) => t.id === tB.id), `A sees A's task, NOT B's`);
  check(tasksB.some((t) => t.id === tB.id) && !tasksB.some((t) => t.id === tA.id), `B sees B's task, NOT A's`);

  // 4. user rosters are disjoint (each project seeded its own coders)
  const usersA = await jget<Array<{ id: string }>>(TOKEN_A, '/api/users');
  const usersB = await jget<Array<{ id: string }>>(TOKEN_B, '/api/users');
  const idsA = new Set(usersA.map((u) => u.id));
  check(usersB.length > 0 && usersB.every((u) => !idsA.has(u.id)), `user rosters disjoint (A=${usersA.length}, B=${usersB.length})`);

  // 5. feed isolation: claim a task in B, confirm it shows in B's feed but not A's
  const bClaimer = usersB[0]!;
  await fetch(`${BASE}/api/tasks/${tB.id}/claim`, { method: 'POST', headers: hdr(TOKEN_B), body: JSON.stringify({ userId: bClaimer.id }) });
  await new Promise((r) => setTimeout(r, 100));
  const feedA = await jget<Array<{ detail?: string }>>(TOKEN_A, '/api/feed');
  const feedB = await jget<Array<{ detail?: string }>>(TOKEN_B, '/api/feed');
  check(feedB.some((f) => f.detail?.includes('B-only task')), `B's feed has B's claim`);
  check(!feedA.some((f) => f.detail?.includes('B-only task')), `A's feed does NOT have B's claim`);

  // 6. report + ownership are scoped (B's report should not count A's coders/tasks)
  const reportB = await jget<{ coders: Array<{ id: string }> }>(TOKEN_B, '/api/report');
  check(reportB.coders.every((c) => !idsA.has(c.id)), `B's report contains only B's coders`);

  // 7. backward-compat + auth: default token works; an unknown token is 401
  const unknown = await fetch(`${BASE}/api/tasks`, { headers: hdr('definitely-not-a-real-token') });
  check(unknown.status === 401, `unknown token rejected (${unknown.status})`);
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
}

console.log(ok ? '\n[verify-isolation] ✅ projects fully isolated' : '\n[verify-isolation] ❌ leak detected');
process.exit(ok ? 0 : 1);
