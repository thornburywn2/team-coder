import { assignModule, type Candidate, type ModuleHint } from './decompose';

// OPTIONAL LLM-assisted PRD → tasks, behind an env flag. The deterministic parser
// (decompose.ts) stays the default and the always-available fallback — this is a
// best-effort enhancer. It calls any OpenAI-compatible chat endpoint (e.g. Ollama
// at /v1/chat/completions). On ANY problem (disabled, unreachable, bad output) it
// returns null so the caller falls back to deterministic. Module mapping reuses
// the same deterministic name/prefix matcher so results stay consistent.

export function llmEnabled(): boolean {
  return process.env.DECOMPOSE_LLM === '1' || process.env.DECOMPOSE_LLM === 'true';
}

const URL = process.env.DECOMPOSE_LLM_URL ?? 'http://localhost:11434/v1/chat/completions';
const MODEL = process.env.DECOMPOSE_LLM_MODEL ?? 'llama3.2';
const TIMEOUT_MS = Number(process.env.DECOMPOSE_LLM_TIMEOUT_MS ?? 30_000);

const PROMPT = (prd: string) =>
  `You are a senior engineer breaking a PRD into a concrete, actionable task list for a team.\n` +
  `Return ONLY a JSON array. Each item: {"title": string (<=120 chars, imperative), "description"?: string}.\n` +
  `Produce 3-15 distinct, implementation-ready tasks. No prose, no markdown, JSON array only.\n\n` +
  `PRD:\n${prd}`;

// pull the first JSON array out of a model response (handles ```json fences / stray text)
function extractArray(textOut: string): unknown[] | null {
  const start = textOut.indexOf('[');
  const end = textOut.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(textOut.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function decomposePrdLlm(prd: string, modules: ModuleHint[] = []): Promise<Candidate[] | null> {
  if (!llmEnabled() || !prd.trim()) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(process.env.DECOMPOSE_LLM_KEY ? { authorization: `Bearer ${process.env.DECOMPOSE_LLM_KEY}` } : {}) },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: PROMPT(prd) }],
        temperature: 0.2,
        stream: false,
      }),
      signal: ac.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const arr = extractArray(content);
    if (!arr?.length) return null;

    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const item of arr) {
      const title = typeof item === 'object' && item ? String((item as Record<string, unknown>)['title'] ?? '').trim() : '';
      if (title.length < 2) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const descRaw = typeof item === 'object' && item ? (item as Record<string, unknown>)['description'] : undefined;
      const description = typeof descRaw === 'string' && descRaw.trim() ? descRaw.trim() : undefined;
      candidates.push(assignModule({ title: title.slice(0, 200), description }, modules));
    }
    return candidates.length ? candidates.slice(0, 100) : null;
  } catch {
    return null; // unreachable / aborted / malformed — caller falls back
  } finally {
    clearTimeout(timer);
  }
}
