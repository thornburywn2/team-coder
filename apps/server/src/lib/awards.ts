import type { CoderStat } from '../report';

// Team awards — a positive, celebratory take on "the leaderboard". EVERYONE gets
// an award that reflects a genuine strength; nothing negative, no losers. Top
// contributors earn distinct superlatives (their best category); everyone else is
// celebrated for where they focus (their dominant layer/language). It's a team
// event — we surface each person's strength.

export interface Award {
  title: string;
  emoji: string;
  reason: string;
}

// Superlatives in prestige order; each goes to the (still-unawarded) team leader.
const CATEGORIES: { value: (c: CoderStat) => number; title: string; emoji: string; reason: (n: number) => string }[] = [
  { value: (c) => c.tasksCompleted, title: 'The Closer', emoji: '✅', reason: (n) => `shipped ${n} task${n === 1 ? '' : 's'}` },
  { value: (c) => c.linesAdded, title: 'Heavy Lifter', emoji: '🏋️', reason: (n) => `+${n.toLocaleString()} lines` },
  { value: (c) => c.toolCalls, title: 'Master Builder', emoji: '⚙️', reason: (n) => `${n.toLocaleString()} tool calls` },
  { value: (c) => c.decisions, title: 'The Architect', emoji: '📐', reason: (n) => `${n} decision${n === 1 ? '' : 's'} recorded` },
  { value: (c) => c.patterns, title: 'The Mentor', emoji: '🧩', reason: (n) => `shared ${n} reusable pattern${n === 1 ? '' : 's'}` },
  { value: (c) => c.prompts, title: 'Deep Thinker', emoji: '💭', reason: (n) => `${n.toLocaleString()} prompts` },
  { value: (c) => c.activeMinutes, title: 'The Marathoner', emoji: '🏃', reason: (n) => `${n.toLocaleString()} min in the zone` },
  { value: (c) => c.filesTouched, title: 'Renaissance Coder', emoji: '🎨', reason: (n) => `touched ${n} files` },
  { value: (c) => c.modulesOwned, title: 'The Anchor', emoji: '🧭', reason: (n) => `owns ${n} module${n === 1 ? '' : 's'}` },
];

const LAYER_AWARD: Record<string, [string, string]> = {
  frontend: ['Frontend Champion', '🎨'],
  backend: ['Backend Backbone', '🔧'],
  database: ['Data Wizard', '🗄️'],
  infra: ['Infra Hero', '🛠️'],
  docs: ['Documentarian', '📚'],
  other: ['Generalist', '🌈'],
};

/** Assign every coder exactly one positive award reflecting a real strength. */
export function computeAwards(coders: CoderStat[]): Map<string, Award> {
  const out = new Map<string, Award>();

  // 1. distinct superlatives → each category's top (still-unawarded) contributor
  for (const cat of CATEGORIES) {
    let best: CoderStat | null = null;
    let bestV = 0;
    for (const c of coders) {
      if (out.has(c.id)) continue;
      const v = cat.value(c);
      if (v > bestV) { best = c; bestV = v; }
    }
    if (best && bestV > 0) out.set(best.id, { title: cat.title, emoji: cat.emoji, reason: cat.reason(bestV) });
  }

  // 2. everyone else → celebrated for where they focus (dominant layer, else language)
  for (const c of coders) {
    if (out.has(c.id)) continue;
    const layer = c.layers[0];
    if (layer && LAYER_AWARD[layer.name]) {
      const [title, emoji] = LAYER_AWARD[layer.name]!;
      out.set(c.id, { title, emoji, reason: `${layer.pct}% of their work in ${layer.name}` });
      continue;
    }
    const lang = c.languages[0];
    if (lang) {
      out.set(c.id, { title: `${lang.name} Specialist`, emoji: '🦄', reason: `${lang.pct}% ${lang.name}` });
      continue;
    }
    out.set(c.id, { title: 'Team Player', emoji: '🌟', reason: 'here for the team' });
  }
  return out;
}
