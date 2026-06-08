export {}; // module marker for top-level await

import { deleteProjectsByToken } from './test-utils';

// Acceptance check for: (1) team members chosen AT CREATION (not hardcoded),
// (2) live AGENTS endpoint (multiple agents per coder + stats), (3) report
// language/layer analysis from live hook edits (edit basis, no git). Throwaway
// project, deleted at end. Requires the server running.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
let ok = true;
const cleanup: string[] = [];
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};
const hdr = (t: string) => ({ 'x-team-token': t, 'content-type': 'application/json' });

async function edit(token: string, dev: string, session: string, file: string) {
  const r = await fetch(`${BASE}/hooks/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-developer-id': dev },
    body: JSON.stringify({ session_id: session, cwd: '/home/p', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } }),
  });
  if (!r.ok) throw new Error(`edit ${file} -> ${r.status}`);
}

try {
  // (1) create a project with CUSTOM members (not the Alice/Bob default)
  const proj = (await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Extras Test', members: ['Ada Lovelace', 'Grace Hopper'] }) })).json()) as { token: string; coders: { id: string; username: string; displayName: string; agentToken: string }[] };
  cleanup.push(proj.token);
  check(proj.coders.length === 2, `created with exactly the 2 named members (got ${proj.coders.length})`);
  const ada = proj.coders.find((c) => c.displayName === 'Ada Lovelace');
  const grace = proj.coders.find((c) => c.displayName === 'Grace Hopper');
  check(ada?.username === 'ada-lovelace' && grace?.username === 'grace-hopper', `names slugified to usernames (${ada?.username}, ${grace?.username})`);
  check(!!ada?.agentToken && ada.agentToken !== grace?.agentToken, 'each member got a distinct agent token');
  const users = (await (await fetch(`${BASE}/api/users`, { headers: hdr(proj.token) })).json()) as Array<{ displayName: string }>;
  check(users.length === 2 && !users.some((u) => u.displayName === 'Alice'), 'roster is the custom members, not the hardcoded defaults');

  // (2)+(3) drive live edits: Ada runs TWO agents (two sessions) across languages/layers
  await edit(ada!.agentToken, 'ada-lovelace', 'ada-sess-1', 'apps/web/src/Login.tsx'); // frontend / TypeScript
  await edit(ada!.agentToken, 'ada-lovelace', 'ada-sess-2', 'services/api/main.py');    // backend / Python (2nd agent)
  await edit(grace!.agentToken, 'grace-hopper', 'grace-sess-1', 'db/migrations/001.sql'); // database / SQL
  await new Promise((r) => setTimeout(r, 300)); // let fire-and-forget ingest flush

  // agents endpoint: Ada should show 2 agents, Grace 1, with stats
  const agents = (await (await fetch(`${BASE}/api/agents`, { headers: hdr(proj.token) })).json()) as Array<{ developerName: string; sessionId: string; status: string; filesTouched: number; tools: number }>;
  const adaAgents = agents.filter((a) => a.developerName === 'Ada Lovelace');
  check(adaAgents.length === 2, `Ada shows 2 concurrent agents (got ${adaAgents.length})`);
  check(agents.some((a) => a.developerName === 'Grace Hopper'), 'Grace shows an agent');
  check(agents.every((a) => a.status === 'active'), 'all agents reported active');
  check(adaAgents.every((a) => a.filesTouched >= 1 && a.tools >= 1), 'agents carry per-agent stats (files + tools)');

  // report language + layer analysis from hook edits (no git → edit basis)
  interface CoderB { name: string; languages: Array<{ name: string }>; layers: Array<{ name: string }> }
  const report = (await (await fetch(`${BASE}/api/report`, { headers: hdr(proj.token) })).json()) as { languages: Array<{ name: string }>; layers: Array<{ name: string }>; analysisBasis: string; coders: CoderB[] };
  check(report.analysisBasis === 'edits', `report falls back to edit basis without git (got ${report.analysisBasis})`);
  const langs = report.languages.map((l) => l.name);
  check(['TypeScript', 'Python', 'SQL'].every((l) => langs.includes(l)), `team languages detected: ${langs.join(', ')}`);
  const layers = report.layers.map((l) => l.name);
  check(['frontend', 'backend', 'database'].every((l) => layers.includes(l)), `team layers detected: ${layers.join(', ')}`);

  // PER-CODER breakdown: Ada did frontend+backend (TS+Python); Grace did database (SQL)
  const ada2 = report.coders.find((c) => c.name === 'Ada Lovelace');
  const grace2 = report.coders.find((c) => c.name === 'Grace Hopper');
  const aLangs = (ada2?.languages ?? []).map((l) => l.name);
  const aLayers = (ada2?.layers ?? []).map((l) => l.name);
  check(aLangs.includes('TypeScript') && aLangs.includes('Python'), `Ada's languages: ${aLangs.join(', ')}`);
  check(aLayers.includes('frontend') && aLayers.includes('backend'), `Ada's layers: ${aLayers.join(', ')}`);
  const gLangs = (grace2?.languages ?? []).map((l) => l.name);
  check(gLangs.includes('SQL') && !gLangs.includes('TypeScript'), `Grace's languages isolated to her work: ${gLangs.join(', ')}`);
  check((grace2?.layers ?? []).some((l) => l.name === 'database'), `Grace's layers include database`);
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  await deleteProjectsByToken(...cleanup);
}

console.log(ok ? '\n[verify-extras] ✅ custom members + agents + language/layer analysis' : '\n[verify-extras] ❌ failed');
process.exit(ok ? 0 : 1);
