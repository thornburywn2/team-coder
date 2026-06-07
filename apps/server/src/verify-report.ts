export {}; // module marker for top-level await

// P11 acceptance check: GET /api/report and assert it aggregates the signals we
// captured across this session (git LOC from verify-gitpoll, hook edits from the
// other verifies) into a sane per-coder breakdown with blended %s summing to ~100.
// Requires the server running (and prior verify scripts to have populated data).

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const TEAM = process.env.TEAM_TOKEN ?? 'change-me-team-token';

interface Report {
  coders: Array<{ name: string; commits: number; linesAdded: number; edits: number; pct: { blended: number } }>;
  modules: Array<{ pathPrefix: string; totalLines: number; contributors: Array<{ name: string }> }>;
  totals: { commits: number; linesAdded: number };
}

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

try {
  const res = await fetch(`${BASE}/api/report`, { headers: { 'x-team-token': TEAM } });
  check(res.ok, `GET /api/report -> ${res.status}`);
  const report = (await res.json()) as Report;

  check(report.coders.length > 0, `report has ${report.coders.length} coders`);
  const carol = report.coders.find((c) => c.name === 'Carol');
  check(!!carol && carol.commits >= 1 && carol.linesAdded >= 1, `Carol has git contributions (commits=${carol?.commits}, +${carol?.linesAdded})`);

  const blendedSum = Math.round(report.coders.reduce((a, c) => a + c.pct.blended, 0));
  check(blendedSum >= 95 && blendedSum <= 105, `blended contribution %s sum to ~100 (got ${blendedSum})`);

  const shared = report.modules.find((m) => m.pathPrefix === 'packages/shared/');
  check(!!shared && shared.contributors.some((c) => c.name === 'Carol'), 'shared module credits Carol by LOC');

  check(report.totals.commits >= 1 && report.totals.linesAdded >= 1, `totals populated (commits=${report.totals.commits}, +${report.totals.linesAdded})`);
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
}

console.log(ok ? '\n[verify-report] ✅ report OK' : '\n[verify-report] ❌ failed');
process.exit(ok ? 0 : 1);
