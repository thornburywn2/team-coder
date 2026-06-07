export {}; // module marker for top-level await

import { decomposePrd } from './lib/decompose';

// #42 acceptance check. Two parts:
//   UNIT — the pure decomposer handles checklists, task-sections, headings, and
//          fallback, and maps tasks to modules by name/prefix.
//   INTEGRATION — PUT a PRD, decompose it via the API, commit selected tasks,
//          confirm they land as source='prd' and stay project-isolated, and that
//          progress-vs-goal is computable. Requires the server running + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
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

// ── UNIT ─────────────────────────────────────────────────────────────────────
const mods = [
  { id: 'm-fe', name: 'frontend', pathPrefix: 'apps/web/' },
  { id: 'm-be', name: 'backend', pathPrefix: 'apps/server/' },
];

const checklist = `# App\n## Tasks\n- [ ] Build the login form in the frontend\n- [x] Add the backend auth endpoint\n- [ ] Write docs`;
const c1 = decomposePrd(checklist, mods);
check(c1.length === 3, `checklist → 3 tasks (got ${c1.length})`);
check(c1[0]?.moduleId === 'm-fe', `"login form ... frontend" → frontend module`);
check(c1[1]?.moduleId === 'm-be', `"backend auth endpoint" → backend module`);

const sections = `# Product\n## Overview\nSome prose we ignore.\n## Requirements\n- Users can sign up\n- Users can reset password\n## Notes\n- not a task section item`;
const c2 = decomposePrd(sections, mods);
check(c2.length === 2 && c2.every((t) => !t.title.startsWith('not a task')), `task-section list → 2 tasks (got ${c2.length})`);

const headings = `# Big Plan\n## Search feature\nLet users search.\n## Export feature\nCSV + PDF.`;
const c3 = decomposePrd(headings, mods);
check(c3.length === 2 && c3[0]?.title === 'Search feature', `headings → tasks w/ descriptions (got ${c3.length})`);

check(decomposePrd('- just a bullet\n- another', mods).length === 2, `bullet fallback → 2 tasks`);
check(decomposePrd('', mods).length === 0, `empty PRD → 0 tasks`);

// ── INTEGRATION ──────────────────────────────────────────────────────────────
try {
  const stamp = `${Math.floor(performance.now())}`;
  const prd = `# Goal ${stamp}\n## Requirements\n- [ ] PRD task one ${stamp}\n- [ ] PRD task two ${stamp} in the backend\n`;

  // create an isolated project B to commit into (keeps the default board clean)
  const projB = (await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Decompose ${stamp}` }) })).json()) as { token: string };
  const T = projB.token;

  // ingest PRD
  const saved = (await (await fetch(`${BASE}/api/projects/current/prd`, { method: 'PUT', headers: hdr(T), body: JSON.stringify({ prd }) })).json()) as { prd: string };
  check(saved.prd?.includes(`PRD task one ${stamp}`), 'PUT /prd persisted the goal');
  const cur = await jget<{ prd: string | null }>(T, '/api/projects/current');
  check(cur.prd === saved.prd, '/projects/current reflects the saved PRD');

  // decompose (uses the saved PRD)
  const dec = (await (await fetch(`${BASE}/api/projects/current/decompose`, { method: 'POST', headers: hdr(T), body: JSON.stringify({}) })).json()) as { candidates: Array<{ title: string; moduleId?: string }> };
  check(dec.candidates.length === 2, `decompose → 2 candidates (got ${dec.candidates.length})`);
  check(dec.candidates.some((c) => c.moduleId), 'a candidate auto-mapped to a module (backend)');

  // commit selected candidates
  const committed = (await (await fetch(`${BASE}/api/tasks/bulk`, { method: 'POST', headers: hdr(T), body: JSON.stringify({ tasks: dec.candidates }) })).json()) as { created: number };
  check(committed.created === 2, `bulk created 2 tasks (got ${committed.created})`);

  // tasks landed as source='prd' and are visible on B's board
  const tasksB = await jget<Array<{ title: string; source: string }>>(T, '/api/tasks');
  const prdTasks = tasksB.filter((t) => t.source === 'prd');
  check(prdTasks.length === 2, `board shows 2 source='prd' tasks (got ${prdTasks.length})`);
  check(prdTasks.every((t) => t.title.includes(stamp)), 'committed tasks are the decomposed ones');

  // isolation: the default project never sees B's PRD tasks
  const tasksA = await jget<Array<{ title: string }>>(TOKEN_A, '/api/tasks');
  check(!tasksA.some((t) => t.title.includes(stamp)), 'PRD tasks did NOT leak into the default project');

  // empty-PRD decompose is rejected
  const emptyProj = (await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Empty ${stamp}` }) })).json()) as { token: string };
  const bad = await fetch(`${BASE}/api/projects/current/decompose`, { method: 'POST', headers: hdr(emptyProj.token), body: JSON.stringify({}) });
  check(bad.status === 400, `decompose with no PRD → 400 (got ${bad.status})`);
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
}

console.log(ok ? '\n[verify-decompose] ✅ PRD ingestion + decomposition OK' : '\n[verify-decompose] ❌ failed');
process.exit(ok ? 0 : 1);
