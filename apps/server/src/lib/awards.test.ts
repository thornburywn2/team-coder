import { test, expect } from 'bun:test';
import { computeAwards } from './awards';
import type { CoderStat } from '../report';

// minimal CoderStat factory (only fields the award logic reads matter)
function coder(over: Partial<CoderStat> & { id: string; name: string }): CoderStat {
  return {
    color: '#888', commits: 0, linesAdded: 0, filesTouched: 0, edits: 0, prompts: 0, toolCalls: 0,
    tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0, activeMinutes: 0, tasksCompleted: 0,
    decisions: 0, patterns: 0, modulesOwned: 0, languages: [], layers: [], topLayer: null,
    pct: { blended: 0 }, ...over,
  } as unknown as CoderStat;
}

test('every coder receives exactly one positive award', () => {
  const coders = [
    coder({ id: 'a', name: 'Alice', tasksCompleted: 20 }),
    coder({ id: 'b', name: 'Bob', linesAdded: 5000 }),
    coder({ id: 'c', name: 'Carol', decisions: 9 }),
  ];
  const awards = computeAwards(coders);
  expect(awards.size).toBe(3);
  for (const c of coders) {
    const a = awards.get(c.id);
    expect(a?.title).toBeTruthy();
    expect(a?.emoji).toBeTruthy();
  }
});

test('the category leader earns its superlative (decisions → The Architect)', () => {
  const coders = [
    coder({ id: 'a', name: 'Alice', decisions: 1 }),
    coder({ id: 'c', name: 'Carol', decisions: 12 }),
  ];
  const awards = computeAwards(coders);
  expect(awards.get('c')?.title).toBe('The Architect');
});
