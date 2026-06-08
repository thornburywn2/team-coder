export {}; // module marker for top-level await

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestProject, deleteProject } from './test-utils';

// P4b acceptance check: connect to /mcp as a coder's agent (Bearer token), list
// tools, claim a task via MCP, read it back, confirm the write landed in the DB
// (visible to the human portal), and read a resource. Runs in a throwaway project
// (deleted at the end) — no debris. Requires the server running.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const textOf = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]?.text ?? 'null');

let ok = true;
let projectId = '';
let teamHeaders: Record<string, string> = {};
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

try {
  const tp = await createTestProject('verify-mcp');
  projectId = tp.id;
  teamHeaders = { 'x-team-token': tp.token, 'content-type': 'application/json' };

  // a task to claim, and alice's id for cross-check
  const task = (await (await fetch(`${BASE}/api/tasks`, { method: 'POST', headers: teamHeaders, body: JSON.stringify({ title: 'mcp probe task' }) })).json()) as { id: string };
  const users = (await (await fetch(`${BASE}/api/users`, { headers: teamHeaders })).json()) as Array<{ id: string; username: string }>;
  const alice = users.find((u) => u.username === 'alice')!;

  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tp.agentToken('alice')}` } },
  });
  const client = new Client({ name: 'verify-mcp', version: '1.0.0' });
  await client.connect(transport);

  const tools = (await client.listTools()).tools.map((t) => t.name);
  check(['get_my_tasks', 'claim_task', 'create_task', 'edit_task', 'get_module_context', 'post_decision', 'add_shared_pattern'].every((t) => tools.includes(t)), `tools exposed (${tools.length}): ${tools.join(', ')}`);

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

  // create_task + edit_task (the newly added write tools)
  const created = textOf((await client.callTool({ name: 'create_task', arguments: { title: 'mcp-created task' } })) as never) as { ok: boolean; task?: { id: string } };
  check(!!created.ok && !!created.task?.id, 'create_task created a task via MCP');
  const restTasks = (await (await fetch(`${BASE}/api/tasks`, { headers: teamHeaders })).json()) as Array<{ id: string; title: string }>;
  check(restTasks.some((t) => t.id === created.task?.id && t.title === 'mcp-created task'), 'created task visible in portal/REST');
  if (created.task?.id) {
    const edited = textOf((await client.callTool({ name: 'edit_task', arguments: { task_id: created.task.id, title: 'mcp-renamed task' } })) as never) as { ok: boolean };
    check(!!edited.ok, 'edit_task renamed the task');

    // assign_task to a different coder (bob), confirm cross-assignment
    const bob = users.find((u) => u.username === 'bob')!;
    const assigned = textOf((await client.callTool({ name: 'assign_task', arguments: { task_id: created.task.id, assignee: 'bob' } })) as never) as { ok: boolean };
    const after = (await (await fetch(`${BASE}/api/tasks`, { headers: teamHeaders })).json()) as Array<{ id: string; assigneeId: string }>;
    const t2 = after.find((t) => t.id === created.task?.id);
    check(!!assigned.ok && t2?.assigneeId === bob.id, 'assign_task delegated to Bob (not self)');
  }

  await client.close();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  if (projectId) await deleteProject(projectId);
}

console.log(ok ? '\n[verify-mcp] ✅ MCP server OK' : '\n[verify-mcp] ❌ failed');
process.exit(ok ? 0 : 1);
