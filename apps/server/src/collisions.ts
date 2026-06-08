import { publish } from './state';

// Live concurrent-edit warnings. When two coders touch the SAME file within a
// window, we surface an ADVISORY warning (never a lock — fast movers are never
// blocked). State is in-memory + TTL'd: warnings auto-expire, and we de-dupe so a
// hot file doesn't spam. Project-scoped via meta.projectId on the broadcast.

export interface CollisionWarning {
  file: string;
  developers: { id: string; name: string }[];
  ts: number;
}

export const COLLISION_WINDOW_MS = 10 * 60_000; // "recent" edits that count as contention
const TTL_MS = COLLISION_WINDOW_MS; // how long a warning stays active for hydration
const DEDUP_MS = 45_000; // don't re-warn the same file more than once per window

const active = new Map<string, CollisionWarning[]>(); // projectId -> warnings
const lastWarned = new Map<string, number>(); // `${projectId}:${file}` -> ts

/** Record + broadcast an advisory collision on `file` between `developers`. */
export function recordCollision(projectId: string, file: string, developers: { id: string; name: string }[]): void {
  const key = `${projectId}:${file}`;
  const now = Date.now();
  if (now - (lastWarned.get(key) ?? 0) < DEDUP_MS) return; // soft de-dupe
  lastWarned.set(key, now);

  const warning: CollisionWarning = { file, developers, ts: now };
  const list = (active.get(projectId) ?? []).filter((w) => w.file !== file && now - w.ts < TTL_MS);
  list.push(warning);
  active.set(projectId, list);
  publish({ type: 'COLLISION_WARNING', payload: warning, meta: { projectId, ts: now } });
}

/** Active (non-expired) warnings for a project, most-recent-first. */
export function recentCollisions(projectId: string): CollisionWarning[] {
  const now = Date.now();
  const list = (active.get(projectId) ?? []).filter((w) => now - w.ts < TTL_MS);
  active.set(projectId, list);
  return [...list].reverse();
}
