export {}; // module marker for top-level await

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestProject, deleteProject } from './test-utils';

// Cooperative work-lock acceptance check: agent A acquires a file; agent B's
// check_file/acquire_file see it held (so B holds); A releases; B then acquires.
// /api/locks reflects the active hold. Throwaway project. Server + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const textOf = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]?.text ?? 'null');

let ok = true;
let projectId = '';
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};
async function mcp(token: string) {
  const t = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  const c = new Client({ name: 'verify-locks', version: '1.0.0' });
  await c.connect(t);
  return c;
}

try {
  const tp = await createTestProject('verify-locks');
  projectId = tp.id;
  const a = await mcp(tp.agentToken('alice'));
  const b = await mcp(tp.agentToken('bob'));
  const FILE = 'apps/server/src/routes/api.ts';

  const acq = textOf((await a.callTool({ name: 'acquire_file', arguments: { file_path: FILE } })) as never) as { acquired: boolean };
  check(acq.acquired === true, 'Alice acquires the file');

  const bCheck = textOf((await b.callTool({ name: 'check_file', arguments: { file_path: FILE } })) as never) as { available: boolean; held_by?: string };
  check(bCheck.available === false && bCheck.held_by === 'Alice', `Bob sees it held by Alice (${bCheck.held_by})`);

  const bAcq = textOf((await b.callTool({ name: 'acquire_file', arguments: { file_path: FILE } })) as never) as { acquired: boolean; held_by?: string };
  check(bAcq.acquired === false && bAcq.held_by === 'Alice', 'Bob cannot acquire while Alice holds it (must hold)');

  const list = (await (await fetch(`${BASE}/api/locks`, { headers: { 'x-team-token': tp.token, 'content-type': 'application/json' } })).json()) as Array<{ file: string; holderName: string }>;
  check(list.some((l) => l.file === FILE && l.holderName === 'Alice'), 'GET /api/locks shows the active hold');

  const rel = textOf((await a.callTool({ name: 'release_file', arguments: { file_path: FILE } })) as never) as { released: boolean };
  check(rel.released === true, 'Alice releases the file');

  const bAcq2 = textOf((await b.callTool({ name: 'acquire_file', arguments: { file_path: FILE } })) as never) as { acquired: boolean };
  check(bAcq2.acquired === true, 'Bob acquires once released');

  // token-usage trend endpoint responds
  await a.callTool({ name: 'report_usage', arguments: { input_tokens: 1000, output_tokens: 400 } });
  const trend = (await (await fetch(`${BASE}/api/usage/trend`, { headers: { 'x-team-token': tp.token } })).json()) as { series: unknown[]; total: number };
  check(trend.total >= 1400, `token trend reflects reported usage (total ${trend.total})`);

  await a.close();
  await b.close();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  if (projectId) await deleteProject(projectId);
}

console.log(ok ? '\n[verify-locks] ✅ cooperative work-locks + token trend' : '\n[verify-locks] ❌ failed');
process.exit(ok ? 0 : 1);
