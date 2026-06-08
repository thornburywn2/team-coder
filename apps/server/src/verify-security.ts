export {};

import { createTestProject, deleteProject } from './test-utils';

// Security + management acceptance: security headers present; team/project
// management (add/edit/remove coder, rotate agent token) works; rotating the team
// token invalidates the old one. Needs server + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
let ok = true;
let projectId = '';
const check = (cond: boolean, label: string) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) ok = false; };
const H = (token: string) => ({ 'x-team-token': token, 'content-type': 'application/json' });

try {
  // security headers on a basic response
  const health = await fetch(`${BASE}/health`);
  check(health.headers.get('x-content-type-options') === 'nosniff', 'security headers present (X-Content-Type-Options)');

  const tp = await createTestProject('verify-security');
  projectId = tp.id;
  let team = tp.token;

  // add a coder → returns an agent token
  const added = (await (await fetch(`${BASE}/api/team/members`, { method: 'POST', headers: H(team), body: JSON.stringify({ displayName: 'Zoe Quinn', email: 'zoe@x.dev' }) })).json()) as { id: string; agentToken: string };
  check(!!added.id && added.agentToken.startsWith('dev-'), 'add coder returns an agent token');

  const roster = (await (await fetch(`${BASE}/api/team`, { headers: H(team) })).json()) as Array<{ id: string; agentToken: string }>;
  check(roster.some((u) => u.id === added.id && u.agentToken === added.agentToken), 'new coder appears in /api/team with token');

  // edit (set git emails for attribution)
  const patched = await fetch(`${BASE}/api/team/members/${added.id}`, { method: 'PATCH', headers: H(team), body: JSON.stringify({ gitEmails: ['zoe@laptop.dev'] }) });
  check(patched.ok, 'edit coder (git emails)');

  // rotate the coder's agent token
  const rot = (await (await fetch(`${BASE}/api/team/members/${added.id}/rotate-token`, { method: 'POST', headers: H(team) })).json()) as { agentToken: string };
  check(rot.agentToken !== added.agentToken && rot.agentToken.startsWith('dev-'), 'rotate agent token returns a new one');

  // remove the coder
  const del = await fetch(`${BASE}/api/team/members/${added.id}`, { method: 'DELETE', headers: H(team) });
  check(del.ok, 'remove coder');

  // project settings
  const setp = await fetch(`${BASE}/api/projects/current`, { method: 'PATCH', headers: H(team), body: JSON.stringify({ name: 'Renamed', gitPollEnabled: false }) });
  check(setp.ok, 'update project settings');

  // rotate team token → old token rejected, new accepted
  const newTok = (await (await fetch(`${BASE}/api/projects/current/rotate-token`, { method: 'POST', headers: H(team) })).json()) as { token: string };
  check(newTok.token !== team && newTok.token.startsWith('tc-'), 'rotate team token returns a new one');
  const oldDenied = await fetch(`${BASE}/api/projects/current`, { headers: H(team) });
  check(oldDenied.status === 401, 'old team token now rejected (401)');
  const newOk = await fetch(`${BASE}/api/projects/current`, { headers: H(newTok.token) });
  check(newOk.ok, 'new team token works');
  team = newTok.token;
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  if (projectId) await deleteProject(projectId);
}

console.log(ok ? '\n[verify-security] ✅ headers + team/project management + token rotation' : '\n[verify-security] ❌ failed');
process.exit(ok ? 0 : 1);
