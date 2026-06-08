import { test, expect } from 'bun:test';
import { scrubSecrets, scrubDeep } from './scrub';

test('scrubSecrets redacts common credential shapes', () => {
  expect(scrubSecrets('my key is AKIAABCDEFGHIJKLMNOP here')).toContain('[REDACTED]');
  expect(scrubSecrets('token=supersecretvalue123')).toContain('[REDACTED]');
  expect(scrubSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toContain('[REDACTED]');
  expect(scrubSecrets('postgres://user:hunter2pass@host/db')).toContain('[REDACTED]');
});

test('scrubSecrets leaves benign text alone', () => {
  expect(scrubSecrets('refactor the login button')).toBe('refactor the login button');
});

test('scrubDeep recurses into objects/arrays (e.g. tool_input)', () => {
  const input = { tool_input: { command: 'export API_KEY=sk-abcdefghijklmnop1234', files: ['a.ts'] }, n: 3 };
  const out = scrubDeep(input);
  expect(out.tool_input.command).toContain('[REDACTED]');
  expect(out.tool_input.files).toEqual(['a.ts']);
  expect(out.n).toBe(3);
});
