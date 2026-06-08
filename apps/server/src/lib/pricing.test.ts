import { test, expect } from 'bun:test';
import { rateFor, estimateCost } from './pricing';

test('rateFor matches by model substring', () => {
  expect(rateFor('claude-opus-4-8').output).toBe(75);
  expect(rateFor('claude-sonnet-4-6').output).toBe(15);
  expect(rateFor('claude-haiku-4-5').output).toBe(4);
});

test('rateFor falls back to the default for unknown/empty', () => {
  expect(rateFor(null).output).toBe(15); // sonnet default
  expect(rateFor('gpt-something').input).toBe(3);
});

test('estimateCost computes per-Mtok cost', () => {
  // 1M input + 1M output on opus = $15 + $75 = $90
  expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'claude-opus-4-8' })).toBeCloseTo(90, 5);
  // cache reads are cheaper
  expect(estimateCost({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, model: 'claude-opus-4-8' })).toBeCloseTo(1.5, 5);
  expect(estimateCost({ inputTokens: 0, outputTokens: 0 })).toBe(0);
});
