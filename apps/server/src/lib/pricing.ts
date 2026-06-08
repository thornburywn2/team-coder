// Token → cost estimate. Rates are USD per million tokens; matched by substring on
// the model name so new dated model ids still resolve. Override via TOKEN_RATES_JSON
// (a JSON map of {matchSubstring: {input, output, cacheRead}}). Estimates only.

export interface Rate { input: number; output: number; cacheRead: number }

const BUILTIN: { match: string; rate: Rate }[] = [
  { match: 'opus', rate: { input: 15, output: 75, cacheRead: 1.5 } },
  { match: 'sonnet', rate: { input: 3, output: 15, cacheRead: 0.3 } },
  { match: 'haiku', rate: { input: 0.8, output: 4, cacheRead: 0.08 } },
];
const DEFAULT_RATE: Rate = { input: 3, output: 15, cacheRead: 0.3 }; // assume Sonnet

function overrides(): { match: string; rate: Rate }[] {
  try {
    const raw = process.env.TOKEN_RATES_JSON;
    if (!raw) return [];
    return Object.entries(JSON.parse(raw) as Record<string, Rate>).map(([match, rate]) => ({ match: match.toLowerCase(), rate }));
  } catch {
    return [];
  }
}

export function rateFor(model?: string | null): Rate {
  if (!model) return DEFAULT_RATE;
  const m = model.toLowerCase();
  return [...overrides(), ...BUILTIN].find((r) => m.includes(r.match))?.rate ?? DEFAULT_RATE;
}

export function estimateCost(args: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; model?: string | null }): number {
  const r = rateFor(args.model);
  return (args.inputTokens * r.input + args.outputTokens * r.output + (args.cacheReadTokens ?? 0) * r.cacheRead) / 1_000_000;
}
