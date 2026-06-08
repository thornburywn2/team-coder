export {}; // module marker for top-level await

// #36 inheritance acceptance check: accepting a proposal adopts it — auto-creates
// implementation tasks (source='proposal') from the proposal description (via the
// PRD decomposer) and records an ADR. Idempotent on re-accept; project-isolated.
// Requires the server running + db:seed.

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
async function jpost<T>(t: string, p: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: hdr(t), body: JSON.stringify(body) });
  return r.json() as Promise<T>;
}
interface Task { id: string; title: string; source: string }

try {
  const stamp = `${Math.floor(performance.now())}`;
  const projB = await jpost<{ token: string }>(TOKEN_A, '/api/projects', { name: `Inherit ${stamp}` });
  // NOTE: project create is open; jpost with any token works (no auth on create)
  const T = projB.token;
  const users = await jget<Array<{ id: string }>>(T, '/api/users');
  const me = users[0]?.id;

  // structured proposal → decomposed into multiple tasks
  const structured = await jpost<{ id: string }>(T, '/api/proposals', {
    title: `Switch to the new router ${stamp}`,
    description: `## Requirements\n- [ ] swap the router in the frontend\n- [ ] update the backend routes\n- [ ] write migration docs`,
    authorId: me,
  });
  const accepted = await jpost<{ status: string; adopted?: { tasks: number; adr: boolean } }>(T, `/api/proposals/${structured.id}/status`, { status: 'accepted', actorId: me });
  check(accepted.status === 'accepted', 'proposal moved to accepted');
  check(accepted.adopted?.tasks === 3, `adoption created 3 tasks from the checklist (got ${accepted.adopted?.tasks})`);
  check(accepted.adopted?.adr === true, 'adoption recorded an ADR');

  let tasks = await jget<Task[]>(T, '/api/tasks');
  let prop = tasks.filter((x) => x.source === 'proposal');
  check(prop.length === 3, `board shows 3 source='proposal' tasks (got ${prop.length})`);
  check(prop.some((x) => x.title.toLowerCase().includes('frontend')), 'a derived task mentions the frontend step');

  // ADR-of-record is listed
  const decisions = await jget<Array<{ title: string }>>(T, '/api/decisions');
  check(decisions.some((d) => d.title.includes(stamp)), 'ADR-of-record listed in /api/decisions');

  // idempotent: re-accepting does NOT create more tasks
  const again = await jpost<{ adopted?: { tasks: number } }>(T, `/api/proposals/${structured.id}/status`, { status: 'accepted', actorId: me });
  check(again.adopted === undefined || again.adopted === null, 're-accept is a no-op (no second adoption)');
  tasks = await jget<Task[]>(T, '/api/tasks');
  check(tasks.filter((x) => x.source === 'proposal').length === 3, 'still exactly 3 proposal tasks after re-accept');

  // prose proposal (no structure) → a single "Adopt: …" task
  const prose = await jpost<{ id: string }>(T, '/api/proposals', { title: `Rename the service ${stamp}`, description: 'We should rename it for clarity. No specific steps.', authorId: me });
  const accepted2 = await jpost<{ adopted?: { tasks: number } }>(T, `/api/proposals/${prose.id}/status`, { status: 'accepted', actorId: me });
  check(accepted2.adopted?.tasks === 1, `prose proposal → 1 adopt task (got ${accepted2.adopted?.tasks})`);
  tasks = await jget<Task[]>(T, '/api/tasks');
  check(tasks.some((x) => x.title === `Adopt: Rename the service ${stamp}`), 'single task titled "Adopt: <proposal>"');

  // isolation: default project never sees B's adopted tasks
  const tasksA = await jget<Task[]>(TOKEN_A, '/api/tasks');
  check(!tasksA.some((x) => x.title.includes(stamp)), 'adopted tasks did NOT leak into the default project');

  // rejecting does NOT adopt
  prop = (await jget<Task[]>(T, '/api/tasks')).filter((x) => x.source === 'proposal');
  const beforeReject = prop.length;
  const rej = await jpost<{ id: string }>(T, '/api/proposals', { title: `Bad idea ${stamp}`, description: '- [ ] do not do this', authorId: me });
  await jpost(T, `/api/proposals/${rej.id}/status`, { status: 'rejected', actorId: me });
  const afterReject = (await jget<Task[]>(T, '/api/tasks')).filter((x) => x.source === 'proposal').length;
  check(afterReject === beforeReject, 'rejecting a proposal creates no tasks');
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
}

console.log(ok ? '\n[verify-inheritance] ✅ proposal adoption auto-creates tasks' : '\n[verify-inheritance] ❌ failed');
process.exit(ok ? 0 : 1);
