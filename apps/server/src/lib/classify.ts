// Classify a file path into a programming language and an architectural layer
// (frontend / backend / database / infra / docs / other). Used by the contribution
// report to answer "who works in what language" and "where in the stack". Pure +
// heuristic — order matters (specific layers like database/infra are checked before
// the broad frontend/backend buckets).

const LANG_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', rb: 'Ruby',
  php: 'PHP', cs: 'C#', cpp: 'C++', cc: 'C++', c: 'C', h: 'C', hpp: 'C++',
  swift: 'Swift', scala: 'Scala', ex: 'Elixir', exs: 'Elixir',
  css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS',
  html: 'HTML', vue: 'Vue', svelte: 'Svelte',
  sql: 'SQL', prisma: 'Prisma', graphql: 'GraphQL', gql: 'GraphQL',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  yml: 'YAML', yaml: 'YAML', toml: 'TOML', json: 'JSON', xml: 'XML',
  md: 'Markdown', mdx: 'Markdown', txt: 'Text', tf: 'Terraform',
};

export function languageOf(file: string): string {
  if (/(^|\/)dockerfile/i.test(file)) return 'Docker';
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return LANG_BY_EXT[ext] ?? (ext && ext.length <= 5 ? ext.toUpperCase() : 'Other');
}

export type Layer = 'frontend' | 'backend' | 'database' | 'infra' | 'docs' | 'other';

export function layerOf(file: string): Layer {
  const f = file.toLowerCase();
  if (/(^|\/)(migrations?|drizzle)(\/|$)/.test(f) || f.endsWith('.sql') || /(^|\/)(db|database)(\/|\.)/.test(f) || /schema\.(ts|js|prisma)$/.test(f) || f.endsWith('.prisma')) return 'database';
  if (/(^|\/)dockerfile/i.test(f) || /docker-compose/.test(f) || f.endsWith('.tf') || /(^|\/)(\.github|k8s|kubernetes|terraform|infra|deploy|ops|helm|ansible)(\/|$)/.test(f) || /\.(ya?ml|toml)$/.test(f) || (f.endsWith('.sh') && !f.includes('/test'))) return 'infra';
  if (/\.(mdx?|txt|rst)$/.test(f) || /(^|\/)docs?(\/|$)/.test(f)) return 'docs';
  if (/(^|\/)(apps?\/web|client|frontend|web|ui|www)(\/|$)/.test(f) || /\.(tsx|jsx|css|scss|sass|less|html|vue|svelte)$/.test(f) || /(^|\/)components?(\/|$)/.test(f)) return 'frontend';
  if (/(^|\/)(apps?\/server|server|backend|api|services?|workers?|cmd)(\/|$)/.test(f) || /(^|\/)(routes?|controllers?|handlers?|models?)(\/|$)/.test(f) || /\.(ts|js|py|rs|go|java|kt|rb|php|cs|ex|exs|scala)$/.test(f)) return 'backend';
  return 'other';
}
