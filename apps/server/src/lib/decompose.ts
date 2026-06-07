// Deterministic PRD → task decomposition. No LLM dependency on purpose: the
// portal must run anywhere (the work environment may have no model access), and a
// structured parser is predictable + testable. It reads the markdown structure a
// human PRD already has and proposes tasks for review — it never writes directly.
//
// Strategy, in priority order (first that yields tasks wins):
//   1. checklist items  - [ ] / - [x]   (explicit, strongest signal)
//   2. list items under a task-ish heading (Requirements/Features/Scope/…)
//   3. every sub-heading (## …) becomes a task, its body the description
//   4. fallback: any bullet/numbered line
// Each task is mapped to a module when its text mentions a module name/prefix.

export interface ModuleHint {
  id: string;
  name: string;
  pathPrefix: string;
}

export interface Candidate {
  title: string;
  description?: string;
  moduleId?: string;
  moduleName?: string;
}

const TASK_SECTION = /requirement|feature|scope|deliverable|task|user stor|milestone|epic|to-?do|goal/i;
const CHECKLIST = /^\s*[-*+]\s*\[[ xX]\]\s+(.+)$/;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/;
const HEADING = /^(#{1,6})\s+(.+)$/;

function cleanTitle(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/[*_`~]/g, '') // markdown emphasis
    .replace(/^\s*[-*+]\s+/, '') // stray leading bullet
    .replace(/:\s*$/, '')
    .trim();
}

// Split a long item into a ≤200-char title + the remainder as description.
function splitTitle(text: string, extra?: string): Candidate {
  const t = cleanTitle(text);
  const title = t.length > 200 ? `${t.slice(0, 197)}…` : t;
  const overflow = t.length > 200 ? t : undefined;
  const description = [overflow, extra?.trim()].filter(Boolean).join('\n\n') || undefined;
  return { title, description };
}

function checklistTasks(lines: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const l of lines) {
    const m = l.match(CHECKLIST);
    if (m) out.push(splitTitle(m[1]!));
  }
  return out;
}

// List items beneath any heading whose text looks task-ish, until the next heading.
function sectionTasks(lines: string[]): Candidate[] {
  const out: Candidate[] = [];
  let active = false;
  let pending: Candidate | null = null;
  const flush = () => { if (pending) { out.push(pending); pending = null; } };

  for (const raw of lines) {
    const h = raw.match(HEADING);
    if (h) { flush(); active = TASK_SECTION.test(h[2]!); continue; }
    if (!active) continue;
    const b = raw.match(BULLET);
    if (!b) continue;
    const indent = b[1]!.length;
    if (indent >= 2 && pending) {
      // nested child → fold into the parent's description
      pending.description = [pending.description, `• ${cleanTitle(b[2]!)}`].filter(Boolean).join('\n');
    } else {
      flush();
      pending = splitTitle(b[2]!);
    }
  }
  flush();
  return out;
}

// Each sub-heading (## or deeper) becomes a task; the lines until the next heading
// become its description.
function headingTasks(lines: string[]): Candidate[] {
  const out: Candidate[] = [];
  let current: { title: string; body: string[] } | null = null;
  const flush = () => {
    if (current) out.push(splitTitle(current.title, current.body.join(' ').trim()));
    current = null;
  };
  for (const raw of lines) {
    const h = raw.match(HEADING);
    if (h) {
      if (h[1]!.length >= 2) { flush(); current = { title: h[2]!, body: [] }; }
      else { flush(); } // the top-level title (#) is the PRD name, not a task
    } else if (current && raw.trim()) {
      current.body.push(raw.trim());
    }
  }
  flush();
  return out;
}

function bulletFallback(lines: string[]): Candidate[] {
  return lines
    .map((l) => l.match(BULLET)?.[2])
    .filter((x): x is string => !!x)
    .map((t) => splitTitle(t));
}

function assignModule(c: Candidate, modules: ModuleHint[]): Candidate {
  const hay = `${c.title} ${c.description ?? ''}`.toLowerCase();
  // longest prefix/name first so the most specific module wins
  const sorted = [...modules].sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);
  for (const m of sorted) {
    const prefix = m.pathPrefix.replace(/\/+$/, '').toLowerCase();
    if ((prefix && hay.includes(prefix)) || new RegExp(`\\b${m.name.toLowerCase()}\\b`).test(hay)) {
      return { ...c, moduleId: m.id, moduleName: m.name };
    }
  }
  return c;
}

/** Decompose a PRD into candidate tasks (deduped, module-mapped, capped). */
export function decomposePrd(prd: string, modules: ModuleHint[] = []): Candidate[] {
  const lines = prd.replace(/\r\n/g, '\n').split('\n');
  let tasks = checklistTasks(lines);
  if (!tasks.length) tasks = sectionTasks(lines);
  if (!tasks.length) tasks = headingTasks(lines);
  if (!tasks.length) tasks = bulletFallback(lines);

  const seen = new Set<string>();
  return tasks
    .filter((t) => t.title.length > 1)
    .filter((t) => { const k = t.title.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true); })
    .slice(0, 100)
    .map((t) => assignModule(t, modules));
}
