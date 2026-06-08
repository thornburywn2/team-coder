export {}; // module marker for top-level await

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestProject, deleteProject } from './test-utils';

// Optional-polish acceptance check: search_tasks filters + pagination, idempotency
// keys on post_decision / add_shared_pattern (retry-safe), and decompose mode
// reporting (deterministic default + LLM fallback). Throwaway project. Server + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const textOf = (r: { content: Array<{ text?: string }> }) => JSON.parse(r.content[0]?.text ?? 'null');

let ok = true;
let projectId = '';
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

try {
  const tp = await createTestProject('verify-polish');
  projectId = tp.id;
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tp.agentToken('alice')}` } } });
  const client = new Client({ name: 'verify-polish', version: '1.0.0' });
  await client.connect(transport);
  const callJson = async (name: string, args: Record<string, unknown>) => textOf((await client.callTool({ name, arguments: args })) as never);

  // ── search_tasks: filters + pagination ─────────────────────────────────────
  await callJson('create_task', { title: 'polish-frontend-thing', tags: ['ui'], module: 'frontend' });
  await callJson('create_task', { title: 'polish-backend-thing', tags: ['api'] });
  const claimed = (await callJson('create_task', { title: 'polish-mine-thing', tags: ['ui'] })) as { task: { id: string } };
  await callJson('claim_task', { task_id: claimed.task.id }); // assigns to alice (me)

  const byTag = (await callJson('search_tasks', { tag: 'ui' })) as { tasks: Array<{ title: string }>; total: number };
  check(byTag.total === 2 && byTag.tasks.every((t) => t.title.includes('thing')), `search_tasks tag filter (ui → ${byTag.total})`);
  const byTagApi = (await callJson('search_tasks', { tag: 'api' })) as { total: number };
  check(byTagApi.total === 1, `search_tasks tag filter (api → ${byTagApi.total})`);
  const mine = (await callJson('search_tasks', { assignee: 'me' })) as { tasks: Array<{ id: string }> };
  check(mine.tasks.some((t) => t.id === claimed.task.id), 'search_tasks assignee=me returns my claimed task');
  const byMod = (await callJson('search_tasks', { module: 'frontend' })) as { total: number };
  check(byMod.total >= 1, `search_tasks module filter (frontend → ${byMod.total})`);
  const page = (await callJson('search_tasks', { limit: 2, offset: 0 })) as { tasks: unknown[]; total: number; limit: number };
  check(page.tasks.length === 2 && page.total === 3 && page.limit === 2, `search_tasks pagination (page=${page.tasks.length}/${page.total}, limit=${page.limit})`);

  // ── idempotency: post_decision ─────────────────────────────────────────────
  const d1 = (await callJson('post_decision', { title: 'Use Postgres', context: 'c', decision: 'd', idempotency_key: 'dec-1' })) as { adr: { id: string }; deduped?: boolean };
  const d2 = (await callJson('post_decision', { title: 'Use Postgres', context: 'c', decision: 'd', idempotency_key: 'dec-1' })) as { adr: { id: string }; deduped?: boolean };
  check(!d1.deduped && d2.deduped === true && d1.adr.id === d2.adr.id, 'post_decision idempotency: retry deduped to same ADR');
  const decisions = (await callJson('get_team_decisions', {})) as Array<{ title: string }>;
  check(decisions.filter((x) => x.title === 'Use Postgres').length === 1, 'only one "Use Postgres" ADR exists');

  // ── idempotency: add_shared_pattern ────────────────────────────────────────
  const p1 = (await callJson('add_shared_pattern', { title: 'retry helper', code: 'x', idempotency_key: 'pat-1' })) as { pattern: { id: string }; deduped?: boolean };
  const p2 = (await callJson('add_shared_pattern', { title: 'retry helper', code: 'x', idempotency_key: 'pat-1' })) as { pattern: { id: string }; deduped?: boolean };
  check(!p1.deduped && p2.deduped === true && p1.pattern.id === p2.pattern.id, 'add_shared_pattern idempotency: retry deduped to same pattern');

  await client.close();

  // ── decompose: mode reporting (deterministic default + fallback) ───────────
  const hdr = { 'x-team-token': tp.token, 'content-type': 'application/json' };
  await fetch(`${BASE}/api/projects/current/prd`, { method: 'PUT', headers: hdr, body: JSON.stringify({ prd: '## Requirements\n- [ ] build login\n- [ ] build api' }) });
  const dec = (await (await fetch(`${BASE}/api/projects/current/decompose`, { method: 'POST', headers: hdr, body: JSON.stringify({ mode: 'deterministic' }) })).json()) as { candidates: unknown[]; mode: string };
  check(dec.candidates.length === 2 && dec.mode === 'deterministic', `decompose mode=deterministic works (${dec.candidates.length} tasks, mode=${dec.mode})`);
  // auto mode with LLM disabled (default) still returns deterministic (graceful fallback)
  const auto = (await (await fetch(`${BASE}/api/projects/current/decompose`, { method: 'POST', headers: hdr, body: JSON.stringify({}) })).json()) as { candidates: unknown[]; mode: string };
  check(auto.candidates.length === 2 && auto.mode === 'deterministic', `decompose auto falls back to deterministic when LLM off (mode=${auto.mode})`);
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  if (projectId) await deleteProject(projectId);
}

console.log(ok ? '\n[verify-polish] ✅ search filters/pagination + idempotency + decompose mode' : '\n[verify-polish] ❌ failed');
process.exit(ok ? 0 : 1);
