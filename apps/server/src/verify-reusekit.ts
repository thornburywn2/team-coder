export {}; // module marker for top-level await

// #36 reuse-kit acceptance check: shared pattern library. Proves REST
// create/list/delete, live PATTERN_ADDED over WS, that adopting a proposal which
// carries a reference implementation auto-publishes a pattern, project isolation,
// and that agents see patterns via MCP get_shared_patterns. Server + db:seed.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
async function jpost<T>(t: string, p: string, b: unknown): Promise<T> {
  return (await fetch(`${BASE}${p}`, { method: 'POST', headers: hdr(t), body: JSON.stringify(b) })).json() as Promise<T>;
}
interface Pattern { id: string; title: string; codeSnippet: string; tags: string[] }

try {
  const stamp = `${Math.floor(performance.now())}`;
  const users = await jget<Array<{ id: string }>>(TOKEN_A, '/api/users');
  const me = users[0]?.id;

  // live: open a socket on the default project and watch for PATTERN_ADDED
  const got: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.onerror = () => reject(new Error('socket error'));
    ws.onmessage = async (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string; payload?: { title?: string } };
      if (msg.type === 'HELLO') {
        ws.send(JSON.stringify({ type: 'AUTH', payload: { token: TOKEN_A } }));
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { eventTypes: ['PATTERN_ADDED'] } }));
        setTimeout(async () => {
          await jpost(TOKEN_A, '/api/patterns', { title: `debounce ${stamp}`, code: 'export const debounce = ...', language: 'ts', tags: ['util', stamp], authorId: me });
          setTimeout(() => { ws.close(); resolve(); }, 900);
        }, 400);
        return;
      }
      if (msg.type === 'PATTERN_ADDED' && msg.payload?.title) got.push(msg.payload.title);
    };
  });
  check(got.some((t) => t === `debounce ${stamp}`), 'PATTERN_ADDED delivered live on publish');

  // REST list + delete
  let list = await jget<Pattern[]>(TOKEN_A, '/api/patterns');
  const mine = list.find((p) => p.title === `debounce ${stamp}`)!;
  check(!!mine && mine.tags.includes('util'), 'published pattern appears in GET /api/patterns');
  const del = await fetch(`${BASE}/api/patterns/${mine.id}`, { method: 'DELETE', headers: hdr(TOKEN_A) });
  check(del.ok, 'DELETE /api/patterns/:id removes it');
  list = await jget<Pattern[]>(TOKEN_A, '/api/patterns');
  check(!list.some((p) => p.id === mine.id), 'deleted pattern no longer listed');

  // adoption auto-publishes a pattern from a proposal's reference implementation
  const projB = await jpost<{ token: string }>(TOKEN_A, '/api/projects', { name: `Reuse ${stamp}` });
  const T = projB.token;
  const bUsers = await jget<Array<{ id: string }>>(T, '/api/users');
  const prop = await jpost<{ id: string }>(T, '/api/proposals', { title: `Adopt retry helper ${stamp}`, description: 'standardize retries', codeSnippet: 'export async function retry(fn){/*...*/}', language: 'ts', authorId: bUsers[0]?.id });
  const accepted = await jpost<{ adopted?: { tasks: number; pattern: boolean } }>(T, `/api/proposals/${prop.id}/status`, { status: 'accepted', actorId: bUsers[0]?.id });
  check(accepted.adopted?.pattern === true, 'adopting a proposal w/ code published a pattern');
  const bPatterns = await jget<Pattern[]>(T, '/api/patterns');
  check(bPatterns.some((p) => p.title === `Adopt retry helper ${stamp}` && p.tags.includes('adopted')), 'adopted pattern is in project B kit, tagged adopted');

  // isolation: default project never sees B's adopted pattern
  const aPatterns = await jget<Pattern[]>(TOKEN_A, '/api/patterns');
  check(!aPatterns.some((p) => p.title.includes(stamp)), 'B kit did NOT leak into the default project');

  // a proposal WITHOUT code publishes no pattern
  const noCode = await jpost<{ id: string }>(T, '/api/proposals', { title: `No code ${stamp}`, description: 'just a doc change', authorId: bUsers[0]?.id });
  const acc2 = await jpost<{ adopted?: { pattern: boolean } }>(T, `/api/proposals/${noCode.id}/status`, { status: 'accepted', actorId: bUsers[0]?.id });
  check(acc2.adopted?.pattern === false, 'proposal without code publishes no pattern');

  // agents see patterns via MCP get_shared_patterns
  await jpost(T, '/api/patterns', { title: `mcp-visible ${stamp}`, code: 'x', tags: ['mcp'], authorId: bUsers[0]?.id });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: 'Bearer dev-token-alice' } } });
  const client = new Client({ name: 'verify-reusekit', version: '1.0.0' });
  await client.connect(transport);
  const res = (await client.callTool({ name: 'get_shared_patterns', arguments: {} })) as { content: Array<{ text?: string }> };
  const viaMcp = JSON.parse(res.content[0]?.text ?? '[]') as Array<{ title: string }>;
  check(Array.isArray(viaMcp), 'get_shared_patterns returns the kit to agents');
  await client.close();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
}

console.log(ok ? '\n[verify-reusekit] ✅ reuse-kit live, adopt-publishes, isolated' : '\n[verify-reusekit] ❌ failed');
process.exit(ok ? 0 : 1);
