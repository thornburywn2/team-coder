export {}; // module marker so top-level await is allowed

// P3 acceptance check: replay a realistic Claude Code hook sequence for one
// coder against /hooks/event, then assert the portal derived live presence
// (status/current file/scrubbed prompt) and emitted feed items. Proves the full
// ingestion -> derivation pipeline. Requires the server to be running.

import { createTestProject, deleteProject } from './test-utils';

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const SESSION = `sim-${Math.floor(performance.now())}`;
let TEAM_TOKEN = '';
let AGENT_TOKEN = '';
let projectId = '';

async function hook(body: Record<string, unknown>): Promise<number> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/hooks/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${AGENT_TOKEN}`, 'x-developer-id': 'alice' },
    body: JSON.stringify({ session_id: SESSION, cwd: '/home/alice/product/apps/web', ...body }),
  });
  if (!res.ok) throw new Error(`hook ${body['hook_event_name']} -> ${res.status}`);
  return performance.now() - t0;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-team-token': TEAM_TOKEN } });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

try {
  const tp = await createTestProject('verify-hooks');
  projectId = tp.id;
  TEAM_TOKEN = tp.token;
  AGENT_TOKEN = tp.agentToken('alice');
  // warm up the route once — a long-running server's cold first-hit (JIT/route
  // compile) doesn't represent steady-state latency, which is what matters.
  await hook({ hook_event_name: 'SessionStart' });

  const t1 = await hook({ hook_event_name: 'SessionStart' });
  check(t1 < 50, `SessionStart (warm) responded in ${t1.toFixed(0)}ms (<50)`);

  await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'add a login form. my key is sk-ABCD1234EFGH5678IJKL do not leak it' });
  await hook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/components/Login.tsx' } });

  // give the async ingest a beat to flush
  await new Promise((r) => setTimeout(r, 200));

  const presence = await getJson<Array<{ status: string; currentFile: string | null; currentPrompt: string | null; sessionId: string | null }>>('/api/presence');
  const alice = presence.find((p) => p.sessionId === SESSION);
  check(!!alice, 'alice presence row reflects the session');
  check(alice?.status === 'active', `alice status is active (got ${alice?.status})`);
  check(alice?.currentFile === 'src/components/Login.tsx', `current file is Login.tsx (got ${alice?.currentFile})`);
  check(!!alice?.currentPrompt && !alice.currentPrompt.includes('sk-ABCD'), 'prompt captured AND secret scrubbed');

  const feed = await getJson<Array<{ kind: string; file?: string }>>('/api/feed');
  check(feed.some((f) => f.kind === 'session_start'), 'feed has session_start');
  check(feed.some((f) => f.kind === 'edit' && f.file === 'src/components/Login.tsx'), 'feed has edit of Login.tsx');
  check(feed.some((f) => f.kind === 'prompt'), 'feed has prompt');
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  if (projectId) await deleteProject(projectId);
}

console.log(ok ? '\n[simulate-hooks] ✅ ingestion pipeline OK' : '\n[simulate-hooks] ❌ failed');
process.exit(ok ? 0 : 1);
