export {}; // module marker for top-level await

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestProject, deleteProject } from './test-utils';

// MCP audit-feedback closure check: identity (whoami), full read-after-write via
// get_task (notes + blocker reason + completion summary all readable back), and
// soft claim-contention warnings. Runs in a throwaway project (deleted at end).
// Requires the server running + db:seed.

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
  const c = new Client({ name: 'verify-audit', version: '1.0.0' });
  await c.connect(t);
  return c;
}

try {
  const tp = await createTestProject('verify-audit');
  projectId = tp.id;
  const alice = await mcp(tp.agentToken('alice'));
  const tools = (await alice.listTools()).tools.map((t) => t.name);
  check(['whoami', 'get_task'].every((t) => tools.includes(t)), `audit tools exposed (${tools.length} total): whoami, get_task`);

  // whoami
  const who = textOf((await alice.callTool({ name: 'whoami', arguments: {} })) as never) as { developerId: string; name: string; project: string };
  check(!!who.developerId && who.name === 'Alice' && !!who.project, `whoami returns identity (name=${who.name}, project=${who.project})`);

  // create a task, then run the full lifecycle and read every write back via get_task
  const created = textOf((await alice.callTool({ name: 'create_task', arguments: { title: 'audit lifecycle probe' } })) as never) as { task: { id: string } };
  const id = created.task.id;
  await alice.callTool({ name: 'claim_task', arguments: { task_id: id } });
  await alice.callTool({ name: 'update_task_progress', arguments: { task_id: id, status: 'in_progress', note: 'started the spike' } });
  await alice.callTool({ name: 'flag_blocker', arguments: { task_id: id, reason: 'waiting on the API key' } });
  await alice.callTool({ name: 'complete_task', arguments: { task_id: id, summary: 'shipped behind a flag' } });

  const detail = textOf((await alice.callTool({ name: 'get_task', arguments: { task_id: id } })) as never) as { status: string; assignee: string; thread: Array<{ author: string; content: string }> };
  check(detail.status === 'done' && detail.assignee === 'Alice', `get_task returns status + assignee name (status=${detail.status}, assignee=${detail.assignee})`);
  const thread = detail.thread.map((c) => c.content).join(' | ');
  check(thread.includes('started the spike'), 'progress note readable back in get_task thread');
  check(thread.includes('Blocked: waiting on the API key'), 'blocker reason readable back (was write-only)');
  check(thread.includes('Completed: shipped behind a flag'), 'completion summary readable back (was write-only)');
  check(detail.thread.every((c) => c.author === 'Alice'), 'thread entries carry author names');

  // claim contention: Bob claims Alice's task → soft warning, still claims
  const bob = await mcp(tp.agentToken('bob'));
  const claim = textOf((await bob.callTool({ name: 'claim_task', arguments: { task_id: id } })) as never) as { ok: boolean; warning?: string };
  check(!!claim.ok && !!claim.warning && claim.warning.includes('Alice'), `claim_task warns on contention (${claim.warning ?? 'no warning'})`);

  await alice.close();
  await bob.close();
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  if (projectId) await deleteProject(projectId);
}

console.log(ok ? '\n[verify-audit] ✅ identity + read-after-write + contention closed' : '\n[verify-audit] ❌ failed');
process.exit(ok ? 0 : 1);
