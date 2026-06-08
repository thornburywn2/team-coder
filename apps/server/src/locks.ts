import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db, schema } from './db';

// Cooperative work-locks, persisted in Postgres so they survive restarts. When a
// coder/agent works in an area (a file) it ACQUIRES a soft lock; another that tries
// the same file sees it's held and HOLDS until release (or the TTL expires). Locks
// are auto-acquired by the PreToolUse hook and released on Stop, so coordination is
// automatic — not opt-in. Advisory by design (humans steer); a stale lock auto-frees.

export interface Lock { file: string; holderId: string; holderName: string; ts: number }

export const LOCK_TTL_MS = 15 * 60_000;
const cutoff = () => new Date(Date.now() - LOCK_TTL_MS);
const toLock = (r: { file: string; holderId: string; holderName: string; acquiredAt: Date | null }): Lock => ({ file: r.file, holderId: r.holderId, holderName: r.holderName, ts: (r.acquiredAt ?? new Date()).getTime() });

/** Take (or refresh) the lock. Re-acquiring your own lock just refreshes it. A
 *  different holder fails unless the existing lock is stale (past TTL). */
export async function acquire(projectId: string, file: string, holderId: string, holderName: string): Promise<{ acquired: boolean; lock: Lock }> {
  const [held] = await db.select().from(schema.workLocks).where(and(eq(schema.workLocks.projectId, projectId), eq(schema.workLocks.file, file)));
  if (held && held.holderId !== holderId && held.acquiredAt && held.acquiredAt > cutoff()) {
    return { acquired: false, lock: toLock(held) };
  }
  const now = new Date();
  await db
    .insert(schema.workLocks)
    .values({ projectId, file, holderId, holderName, acquiredAt: now })
    .onConflictDoUpdate({ target: [schema.workLocks.projectId, schema.workLocks.file], set: { holderId, holderName, acquiredAt: now } });
  return { acquired: true, lock: { file, holderId, holderName, ts: now.getTime() } };
}

/** Release your lock (no-op if you don't hold it). */
export async function release(projectId: string, file: string, holderId: string): Promise<boolean> {
  const r = await db.delete(schema.workLocks).where(and(eq(schema.workLocks.projectId, projectId), eq(schema.workLocks.file, file), eq(schema.workLocks.holderId, holderId))).returning({ file: schema.workLocks.file });
  return r.length > 0;
}

/** Release every lock held by a coder (called on Stop). */
export async function releaseAll(projectId: string, holderId: string): Promise<void> {
  await db.delete(schema.workLocks).where(and(eq(schema.workLocks.projectId, projectId), eq(schema.workLocks.holderId, holderId)));
}

/** Who holds this file right now (or null), ignoring stale locks. */
export async function check(projectId: string, file: string): Promise<Lock | null> {
  const [held] = await db.select().from(schema.workLocks).where(and(eq(schema.workLocks.projectId, projectId), eq(schema.workLocks.file, file), gt(schema.workLocks.acquiredAt, cutoff())));
  return held ? toLock(held) : null;
}

/** All active (non-expired) locks for a project, newest first. Prunes stale ones. */
export async function activeLocks(projectId: string): Promise<Lock[]> {
  await db.delete(schema.workLocks).where(and(eq(schema.workLocks.projectId, projectId), lt(schema.workLocks.acquiredAt, cutoff())));
  const rows = await db.select().from(schema.workLocks).where(eq(schema.workLocks.projectId, projectId)).orderBy(sql`${schema.workLocks.acquiredAt} desc`);
  return rows.map(toLock);
}
