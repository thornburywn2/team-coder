// Cooperative work locks. When a coder/agent is about to work in an area (a file),
// it can ACQUIRE a soft lock; another agent that tries to acquire the same file
// sees it's held and HOLDS until it's released (or the lock's TTL expires). This is
// opt-in and advisory — humans steer, and a stale lock auto-frees so nobody is ever
// permanently stuck. In-memory + per-project (liveness, not durable state).

export interface Lock {
  file: string;
  holderId: string;
  holderName: string;
  ts: number; // last acquired/refreshed
}

export const LOCK_TTL_MS = 15 * 60_000; // a lock auto-expires if not refreshed

const locks = new Map<string, Map<string, Lock>>(); // projectId -> file -> lock

function bucket(projectId: string): Map<string, Lock> {
  let b = locks.get(projectId);
  if (!b) { b = new Map(); locks.set(projectId, b); }
  return b;
}
function live(l: Lock | undefined, now: number): Lock | undefined {
  return l && now - l.ts < LOCK_TTL_MS ? l : undefined;
}

/** Try to take the lock. Re-acquiring your own lock just refreshes it. */
export function acquire(projectId: string, file: string, holderId: string, holderName: string): { acquired: boolean; lock: Lock } {
  const b = bucket(projectId);
  const now = Date.now();
  const cur = live(b.get(file), now);
  if (cur && cur.holderId !== holderId) return { acquired: false, lock: cur }; // held by someone else
  const lock: Lock = { file, holderId, holderName, ts: now };
  b.set(file, lock);
  return { acquired: true, lock };
}

/** Release your lock (no-op if you don't hold it). */
export function release(projectId: string, file: string, holderId: string): boolean {
  const cur = bucket(projectId).get(file);
  if (cur && cur.holderId === holderId) { bucket(projectId).delete(file); return true; }
  return false;
}

/** Who holds this file right now (or null). */
export function check(projectId: string, file: string): Lock | null {
  return live(bucket(projectId).get(file), Date.now()) ?? null;
}

/** All active (non-expired) locks for a project, newest first. */
export function activeLocks(projectId: string): Lock[] {
  const now = Date.now();
  const b = bucket(projectId);
  for (const [f, l] of b) if (!live(l, now)) b.delete(f); // prune expired
  return [...b.values()].sort((a, b2) => b2.ts - a.ts);
}
