import { and, gte, isNotNull, lt } from 'drizzle-orm';
import { db, schema } from './db';
import { pushFeed } from './feed';

// Idle alerts: an agent that was working and then goes quiet is surfaced once, as
// a feed event (durable + live), so the team notices a stalled/abandoned agent.
// Fires on the transition into idle (5–30 min quiet); re-arms if the agent returns.

const IDLE_AFTER_MS = 5 * 60_000; // quiet longer than this → idle
const STALE_AFTER_MS = 30 * 60_000; // older than this → assume done, don't alert
const alerted = new Set<string>(); // session ids already alerted this idle spell

export async function checkIdle(): Promise<void> {
  const now = Date.now();
  const idleSince = new Date(now - IDLE_AFTER_MS);
  const staleSince = new Date(now - STALE_AFTER_MS);

  const [idleRows, activeRows] = await Promise.all([
    db
      .select({ sessionId: schema.sessions.sessionId, projectId: schema.sessions.projectId, developerId: schema.sessions.developerId, lastSeenAt: schema.sessions.lastSeenAt })
      .from(schema.sessions)
      .where(and(isNotNull(schema.sessions.developerId), lt(schema.sessions.lastSeenAt, idleSince), gte(schema.sessions.lastSeenAt, staleSince))),
    db.select({ sessionId: schema.sessions.sessionId }).from(schema.sessions).where(gte(schema.sessions.lastSeenAt, idleSince)),
  ]);

  // re-arm sessions that came back to life
  for (const a of activeRows) alerted.delete(a.sessionId);

  const fresh = idleRows.filter((r) => r.projectId && r.developerId && !alerted.has(r.sessionId));
  if (!fresh.length) return;

  // resolve coder name/color for the projects involved
  const projectIds = [...new Set(fresh.map((r) => r.projectId as string))];
  const users = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username, color: schema.users.color, projectId: schema.users.projectId })
    .from(schema.users)
    .where(isNotNull(schema.users.projectId));
  const userOf = new Map(users.map((u) => [u.id, u]));

  for (const r of fresh) {
    if (!projectIds.includes(r.projectId as string)) continue;
    alerted.add(r.sessionId);
    const u = userOf.get(r.developerId as string);
    const mins = Math.round((now - new Date(r.lastSeenAt).getTime()) / 60_000);
    pushFeed(r.projectId as string, {
      developerId: r.developerId ?? undefined,
      developer: u?.displayName ?? u?.username ?? undefined,
      color: u?.color ?? undefined,
      kind: 'idle',
      detail: `agent went idle — ${mins}m quiet`,
    });
  }
}
