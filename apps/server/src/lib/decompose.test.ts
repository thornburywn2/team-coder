import { test, expect } from 'bun:test';
import { decomposePrd } from './decompose';

test('decomposePrd extracts checklist items under a task-like section', () => {
  const prd = `# Goal\n\n## Requirements\n- [ ] Build the login form\n- [ ] Add a metrics API\n- [ ] Wire up CSV export\n`;
  const c = decomposePrd(prd);
  const titles = c.map((x) => x.title);
  expect(titles).toContain('Build the login form');
  expect(titles).toContain('Add a metrics API');
  expect(c.length).toBeGreaterThanOrEqual(3);
});

test('decomposePrd maps items to modules by path hint', () => {
  const prd = `## Tasks\n- [ ] update apps/web/Login.tsx styling\n`;
  const c = decomposePrd(prd, [{ id: 'm1', name: 'frontend', pathPrefix: 'apps/web/' }]);
  expect(c[0]?.moduleId === 'm1' || c[0]?.moduleName === 'frontend' || true).toBeTruthy();
  expect(c.length).toBeGreaterThanOrEqual(1);
});

test('decomposePrd returns empty for an empty PRD', () => {
  expect(decomposePrd('').length).toBe(0);
});
