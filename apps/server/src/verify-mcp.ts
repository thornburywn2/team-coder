export {}; // module marker for top-level await

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// P4b acceptance check: connect to /mcp as a coder's agent (Bearer token), list
// tools, claim a task via MCP, read it back, confirm the write landed in the DB
// (visible to the human portal), and read a resource. Requires the server running.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const TEAM = process.env.TEAM_TOKEN ?? 'change-me-team-token';

const teamHeaders = { 'x-team-token': TEAM, 'content-type': 'application/json' };
const textOf = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]?.text ?? 'null');

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

try {
  // a task to claim, and alice's id for cross-check
  const task = (await (await fetch(`${BASE}/api/tasks`, { method: 'POST', headers: teamHeaders, body: JSON.stringify({ title: 'mcp probe task' }) })).json()) as { id: string };
  const users = (await (await fetch(`${BASE}/api/users`, { headers: teamHeaders })).json()) as Array<{ id: string; username: string }>;
  const alice = users.find((u) => u.username === 'alice')!;

  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { authorization: 'Bearer dev-token-alice' } },
  });
  const client = new Client({ name: 'verify-mcp', version: '1.0.0' });
  await client.connect(transport);

  const tools = (await client.listTools()).tools.map((t) => t.name);
  check(['get_my_tasks', 'claim_task', 'get_module_context', 'post_decision', 'add_shared_pattern'].every((t) => tools.includes(t)), `tools exposed (${tools.length}): ${tools.join(', ')}`);

  await client.callTool({ name: 'claim_task', arguments: { task_id: task.id } });
  const my = textOf((await client.callTool({ name: 'get_my_tasks', arguments: {} })) as never) as Array<{ id: string }>;
  check(my.some((t) => t.id === task.id), 'get_my_tasks returns the just-claimed task');

  // confirm the MCP write is visible through the human REST API (same DB)
  const tasks = (await (await fetch(`${BASE}/api/tasks`, { headers: teamHeaders })).json()) as Array<{ id: string; assigneeId: string; status: string }>;
  const t = tasks.find((x) => x.id === task.id)!;
  check(t.assigneeId === alice.id && t.status === 'in_progress', `portal sees claim: assignee=alice, status=${t.status}`);

  const resContents = (await client.readResource({ uri: 'project://my-context' })).contents[0] as { text: string };
  const ctx = JSON.parse(resContents.text) as { me: string };
  check(!!ctx.me, `resource project://my-context readable (me=${ctx.me})`);

  await client.close();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
}

console.log(ok ? '\n[verify-mcp] ✅ MCP server OK' : '\n[verify-mcp] ❌ failed');
process.exit(ok ? 0 : 1);
