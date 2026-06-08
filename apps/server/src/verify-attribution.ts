export {};

import { and, eq } from 'drizzle-orm';
import { db, schema } from './db';
import { createTestProject, deleteProject } from './test-utils';

// Attribution acceptance check: an unmapped commit author shows up in
// /api/attribution; mapping it to a coder remembers the git email AND backfills
// the existing commit + file-change (retroactive credit). Needs server + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
let ok = true;
let projectId = '';
const check = (cond: boolean, label: string) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) ok = false; };
const hdr = (token: string) => ({ 'x-team-token': token, 'content-type': 'application/json' });

try {
  const tp = await createTestProject('verify-attribution');
  projectId = tp.id;
  const coder = tp.coders[0]!;
  const GHOST = 'ghost@nowhere.dev';

  // an ingested commit whose author we couldn't map to a coder
  await db.insert(schema.gitCommits).values({ sha: 'attr-test-sha-1', projectId: tp.id, developerId: null, authorEmail: GHOST, authorName: 'Ghost Coder', message: 'mystery work', additions: 12, deletions: 1 });
  await db.insert(schema.gitFileChanges).values({ sha: 'attr-test-sha-1', projectId: tp.id, developerId: null, filePath: 'apps/web/x.ts', additions: 12, deletions: 1, moduleId: null });

  type Attr = { coders: Array<{ id: string; gitEmails: string[] }>; unattributed: Array<{ authorEmail: string; commits: number }> };
  const a1 = (await (await fetch(`${BASE}/api/attribution`, { headers: hdr(tp.token) })).json()) as Attr;
  check(a1.unattributed.some((u) => u.authorEmail === GHOST && u.commits >= 1), 'unmapped author surfaced in /api/attribution');

  const mapRes = (await (await fetch(`${BASE}/api/attribution/map`, { method: 'POST', headers: hdr(tp.token), body: JSON.stringify({ developerId: coder.id, email: GHOST }) })).json()) as { ok: boolean; backfilled: number };
  check(mapRes.ok && mapRes.backfilled >= 1, `mapping backfilled the commit (${mapRes.backfilled})`);

  const [commit] = await db.select({ dev: schema.gitCommits.developerId }).from(schema.gitCommits).where(and(eq(schema.gitCommits.projectId, tp.id), eq(schema.gitCommits.sha, 'attr-test-sha-1')));
  check(commit?.dev === coder.id, 'commit now attributed to the coder');
  const [fc] = await db.select({ dev: schema.gitFileChanges.developerId }).from(schema.gitFileChanges).where(and(eq(schema.gitFileChanges.projectId, tp.id), eq(schema.gitFileChanges.sha, 'attr-test-sha-1')));
  check(fc?.dev === coder.id, 'file-change now attributed to the coder');

  const a2 = (await (await fetch(`${BASE}/api/attribution`, { headers: hdr(tp.token) })).json()) as Attr;
  check(!a2.unattributed.some((u) => u.authorEmail === GHOST), 'author no longer unattributed');
  check(a2.coders.find((c) => c.id === coder.id)?.gitEmails.includes(GHOST) ?? false, 'git email remembered on the coder');

  // token capture: mode:set is idempotent (no double-count) + cost is computed
  await fetch(`${BASE}/hooks/usage`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${coder.agentToken}` }, body: JSON.stringify({ session_id: 'attr-usage', input_tokens: 1_000_000, output_tokens: 200_000, model: 'claude-opus-4-8', mode: 'set' }) });
  await fetch(`${BASE}/hooks/usage`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${coder.agentToken}` }, body: JSON.stringify({ session_id: 'attr-usage', input_tokens: 1_000_000, output_tokens: 200_000, model: 'claude-opus-4-8', mode: 'set' }) });
  const usage = (await (await fetch(`${BASE}/api/usage`, { headers: hdr(tp.token) })).json()) as { total: number; totalCostUsd: number; models: Array<{ model: string }> };
  check(usage.total === 1_200_000, `mode:set is idempotent — total is ${usage.total} (not doubled)`);
  check(usage.totalCostUsd > 0, `cost estimated from model rate ($${usage.totalCostUsd})`);
  check(usage.models.some((m) => m.model === 'claude-opus-4-8'), 'per-model breakdown present');
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  if (projectId) await deleteProject(projectId);
}

console.log(ok ? '\n[verify-attribution] ✅ attribution mapping + token capture' : '\n[verify-attribution] ❌ failed');
process.exit(ok ? 0 : 1);
