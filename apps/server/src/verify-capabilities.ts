export {}; // module marker for top-level await

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Capability-gap closure check (MCP). Proves the agent can now: list the whole
// backlog (list_tasks), list teammates (list_team), read a task thread
// (get_comments), set priority/tags/due-date on create + edit, and that a
// progress note written via update_task_progress is READ BACK as a comment.
// Requires the server running + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const textOf = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]?.text ?? 'null');

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

try {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
    requestInit: { headers: { authorization: 'Bearer dev-token-alice' } },
  });
  const client = new Client({ name: 'verify-capabilities', version: '1.0.0' });
  await client.connect(transport);

  const tools = (await client.listTools()).tools.map((t) => t.name);
  check(['list_tasks', 'list_team', 'get_comments'].every((t) => tools.includes(t)), `new tools exposed (${tools.length} total): list_tasks, list_team, get_comments`);

  // list_team — roster
  const team = textOf((await client.callTool({ name: 'list_team', arguments: {} })) as never) as Array<{ id: string; username: string }>;
  check(team.length >= 2 && team.some((u) => u.username === 'bob'), `list_team returns the roster (${team.length})`);

  // create_task with priority + tags + due date
  const created = textOf((await client.callTool({ name: 'create_task', arguments: { title: 'cap probe', priority: 'high', tags: ['infra', 'urgent-ish'], due_date: '2030-01-01T00:00:00Z' } })) as never) as { ok: boolean; task?: { id: string; priority: string; tags: string[]; dueDate: string | null } };
  check(created.task?.priority === 'high' && created.task?.tags?.includes('infra') && !!created.task?.dueDate, 'create_task set priority + tags + due date');
  const taskId = created.task!.id;

  // list_tasks — full backlog includes the new task
  const all = textOf((await client.callTool({ name: 'list_tasks', arguments: {} })) as never) as Array<{ id: string }>;
  check(all.some((t) => t.id === taskId), `list_tasks returns the full backlog (${all.length}, includes new task)`);

  // edit_task — change priority + tags
  const edited = textOf((await client.callTool({ name: 'edit_task', arguments: { task_id: taskId, priority: 'urgent', tags: ['infra'] } })) as never) as { task?: { priority: string; tags: string[] } };
  check(edited.task?.priority === 'urgent' && edited.task?.tags.length === 1, 'edit_task changed priority + tags');

  // update_task_progress note → readable back via get_comments
  await client.callTool({ name: 'update_task_progress', arguments: { task_id: taskId, status: 'in_progress', note: 'spiked the approach, looks good' } });
  await client.callTool({ name: 'post_comment', arguments: { target_type: 'task', target_id: taskId, content: 'agreed, ship it' } });
  const thread = textOf((await client.callTool({ name: 'get_comments', arguments: { target_type: 'task', target_id: taskId } })) as never) as Array<{ content: string }>;
  check(thread.some((c) => c.content.includes('spiked the approach')), 'progress note is readable back via get_comments');
  check(thread.some((c) => c.content.includes('ship it')), 'posted comment also readable in the thread');

  // assign_task (already existed — confirm it works for a teammate)
  const assigned = textOf((await client.callTool({ name: 'assign_task', arguments: { task_id: taskId, assignee: 'bob' } })) as never) as { ok: boolean; assignedTo?: string };
  check(!!assigned.ok && assigned.assignedTo === 'Bob', 'assign_task delegates to a teammate');

  await client.close();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
}

console.log(ok ? '\n[verify-capabilities] ✅ MCP write/read gaps closed' : '\n[verify-capabilities] ❌ failed');
process.exit(ok ? 0 : 1);
