export {}; // module marker for top-level await

// P4a acceptance check: drive Write activity for two coders into two different
// modules via /hooks, then assert auto-inferred ownership attributes each module
// to the right coder. Requires the server running.

import { createTestProject, deleteProject } from './test-utils';

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
let TEAM_TOKEN = '';
let projectId = '';

async function edit(agentToken: string, dev: string, file: string): Promise<void> {
  const res = await fetch(`${BASE}/hooks/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${agentToken}`, 'x-developer-id': dev },
    body: JSON.stringify({
      session_id: `own-${dev}`,
      cwd: `/home/${dev}/product`,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: file },
    }),
  });
  if (!res.ok) throw new Error(`edit ${file} -> ${res.status}`);
}

interface Ownership {
  pathPrefix: string;
  ownerName: string | null;
  inferred: boolean;
}

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

try {
  const tp = await createTestProject('verify-ownership');
  projectId = tp.id;
  TEAM_TOKEN = tp.token;
  const aliceTok = tp.agentToken('alice');
  const bobTok = tp.agentToken('bob');

  // alice edits the frontend repeatedly; bob edits the backend
  await Promise.all([
    edit(aliceTok, 'alice', 'apps/web/src/Login.tsx'),
    edit(aliceTok, 'alice', 'apps/web/src/Board.tsx'),
    edit(aliceTok, 'alice', 'apps/web/src/Feed.tsx'),
    edit(bobTok, 'bob', 'apps/server/src/routes/api.ts'),
    edit(bobTok, 'bob', 'apps/server/src/ws.ts'),
  ]);

  await new Promise((r) => setTimeout(r, 300)); // let fire-and-forget ingest flush

  const res = await fetch(`${BASE}/api/modules/ownership`, { headers: { 'x-team-token': TEAM_TOKEN } });
  const own = (await res.json()) as Ownership[];
  const fe = own.find((m) => m.pathPrefix === 'apps/web/');
  const be = own.find((m) => m.pathPrefix === 'apps/server/');

  check(fe?.ownerName === 'Alice' && fe.inferred, `frontend auto-owned by Alice (got ${fe?.ownerName}, inferred=${fe?.inferred})`);
  check(be?.ownerName === 'Bob' && be.inferred, `backend auto-owned by Bob (got ${be?.ownerName}, inferred=${be?.inferred})`);
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  if (projectId) await deleteProject(projectId);
}

console.log(ok ? '\n[verify-ownership] ✅ auto-inference OK' : '\n[verify-ownership] ❌ failed');
process.exit(ok ? 0 : 1);
