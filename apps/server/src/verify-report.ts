export {}; // module marker for top-level await

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queryClient } from './db';
import { pollGitRepo } from './git-poll';
import { createTestProject, deleteProject } from './test-utils';

// P11 acceptance check: the contribution report aggregates signals into a sane
// per-coder breakdown with blended %s summing to ~100. Self-contained: it stands
// up a throwaway project, ingests a known git history (Carol → packages/shared),
// asserts the report for THAT project, then deletes it. No reliance on other
// verifies and no debris. Requires the server running + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;

interface Report {
  coders: Array<{ name: string; commits: number; linesAdded: number; edits: number; pct: { blended: number } }>;
  modules: Array<{ pathPrefix: string; totalLines: number; contributors: Array<{ name: string }> }>;
  totals: { commits: number; linesAdded: number };
}

let ok = true;
let projectId = '';
const dir = mkdtempSync(join(tmpdir(), 'tc-report-'));
const git = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: dir });
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};

try {
  // throwaway project + a small git history authored by Carol in the shared module
  const tp = await createTestProject('verify-report');
  projectId = tp.id;
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Carol']);
  git(['config', 'user.email', 'carol@teamcoder.dev']);
  mkdirSync(join(dir, 'packages/shared'), { recursive: true });
  writeFileSync(join(dir, 'packages/shared/foo.ts'), 'export const x = 1;\nexport const y = 2;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: add foo']);
  await pollGitRepo({ projectId: tp.id, repoDir: dir });

  const res = await fetch(`${BASE}/api/report`, { headers: { 'x-team-token': tp.token } });
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
} finally {
  rmSync(dir, { recursive: true, force: true });
  if (projectId) await deleteProject(projectId);
  await queryClient.end();
}

console.log(ok ? '\n[verify-report] ✅ report OK' : '\n[verify-report] ❌ failed');
process.exit(ok ? 0 : 1);
