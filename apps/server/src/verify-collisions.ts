export {}; // module marker for top-level await

import { createTestProject, deleteProject } from './test-utils';

// #37 acceptance check: advisory concurrent-edit warnings. Two coders editing the
// SAME file within the window → a COLLISION_WARNING is broadcast live and shows in
// GET /api/collisions; one coder alone, or two coders on different files → no
// warning. Project-isolated. Runs in a throwaway project. Server + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const WS_URL = process.env.WS_URL ?? `ws://localhost:${process.env.PORT ?? 6300}/ws`;

let ok = true;
let projectId = '';
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

async function edit(agentToken: string, dev: string, file: string): Promise<void> {
  const res = await fetch(`${BASE}/hooks/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${agentToken}`, 'x-developer-id': dev },
    body: JSON.stringify({ session_id: `col-${dev}`, cwd: `/home/${dev}/p`, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } }),
  });
  if (!res.ok) throw new Error(`edit ${file} -> ${res.status}`);
}

interface Collision { file: string; developers: { name: string }[] }

try {
  const tp = await createTestProject('verify-collisions');
  projectId = tp.id;
  const alice = tp.agentToken('alice');
  const bob = tp.agentToken('bob');
  const carol = tp.agentToken('carol');
  const SHARED = 'apps/server/src/index.ts';

  // collect COLLISION_WARNING deltas over a socket scoped to this project
  const live: Collision[] = [];
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.onerror = () => reject(new Error('socket error'));
    ws.onmessage = async (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string; payload?: Collision };
      if (msg.type === 'HELLO') {
        ws.send(JSON.stringify({ type: 'AUTH', payload: { token: tp.token } }));
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { eventTypes: ['COLLISION_WARNING'] } }));
        setTimeout(async () => {
          await edit(alice, 'alice', SHARED);              // alice touches the shared file
          await new Promise((r) => setTimeout(r, 80));
          await edit(carol, 'carol', 'packages/shared/x.ts'); // unrelated file — no collision
          await new Promise((r) => setTimeout(r, 80));
          await edit(bob, 'bob', SHARED);                  // bob touches the SAME file → collision
          setTimeout(() => { ws.close(); resolve(); }, 700);
        }, 350);
        return;
      }
      if (msg.type === 'COLLISION_WARNING' && msg.payload) live.push(msg.payload);
    };
  });

  const onShared = live.find((c) => c.file === SHARED);
  check(!!onShared, 'COLLISION_WARNING broadcast live for the shared file');
  const names = (onShared?.developers ?? []).map((d) => d.name).sort().join(',');
  check(names.includes('Alice') && names.includes('Bob'), `warning names both editors (got ${names})`);
  check(!live.some((c) => c.file === 'packages/shared/x.ts'), 'no warning for the unrelated file');

  // hydration endpoint reflects the active warning, scoped to this project
  const res = await fetch(`${BASE}/api/collisions`, { headers: { 'x-team-token': tp.token } });
  const list = (await res.json()) as Collision[];
  check(list.some((c) => c.file === SHARED), 'GET /api/collisions shows the active warning');

  // isolation: the default project sees none of this project's collisions
  const aRes = await fetch(`${BASE}/api/collisions`, { headers: { 'x-team-token': process.env.TEAM_TOKEN ?? 'change-me-team-token' } });
  const aList = (await aRes.json()) as Collision[];
  check(!aList.some((c) => c.file === SHARED), 'collisions did NOT leak into the default project');
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  if (projectId) await deleteProject(projectId);
}

console.log(ok ? '\n[verify-collisions] ✅ advisory collision warnings live & isolated' : '\n[verify-collisions] ❌ failed');
process.exit(ok ? 0 : 1);
