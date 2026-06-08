import { desc, eq } from 'drizzle-orm';
import { publish } from './state';
import { db, schema } from './db';

// Live activity feed — high-signal events from hooks + claims + proposals etc.
// DURABLE: every item is persisted (feed_items) so a multi-day project's history
// survives restarts/redeploys and the whole timeframe is captured. The WebSocket
// still broadcasts immediately for the live view; the DB is the record of truth.

export interface FeedItem {
  id: string;
  ts: number;
  projectId: string;
  developerId?: string;
  developer?: string;
  color?: string;
  kind: 'session_start' | 'prompt' | 'edit' | 'stop' | 'subagent' | 'claim' | 'done' | 'blocked' | 'decision' | 'pattern' | 'created' | 'proposal' | 'vote' | 'comment' | 'idle';
  detail?: string;
  file?: string;
}

export function pushFeed(
  projectId: string,
  item: Omit<FeedItem, 'id' | 'ts' | 'projectId'> & { ts?: number },
): FeedItem {
  const full: FeedItem = { id: crypto.randomUUID(), ts: item.ts ?? Date.now(), projectId, ...item };
  // persist (fire-and-forget — never block the hot path); broadcast live
  void db
    .insert(schema.feedItems)
    .values({
      id: full.id,
      projectId,
      ts: new Date(full.ts),
      developerId: full.developerId ?? null,
      developer: full.developer ?? null,
      color: full.color ?? null,
      kind: full.kind,
      detail: full.detail ?? null,
      file: full.file ?? null,
    })
    .catch((err) => console.error('[feed] persist failed:', err));
  publish({
    type: 'ACTIVITY_EVENT',
    payload: full,
    meta: { developerId: full.developerId, projectId, ts: full.ts },
  });
  return full;
}

/** Most-recent-first feed for hydration, scoped to one project (durable read). */
export async function recentFeed(projectId: string, limit = 200): Promise<FeedItem[]> {
  const rows = await db
    .select()
    .from(schema.feedItems)
    .where(eq(schema.feedItems.projectId, projectId))
    .orderBy(desc(schema.feedItems.ts))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    ts: new Date(r.ts).getTime(),
    projectId,
    developerId: r.developerId ?? undefined,
    developer: r.developer ?? undefined,
    color: r.color ?? undefined,
    kind: r.kind as FeedItem['kind'],
    detail: r.detail ?? undefined,
    file: r.file ?? undefined,
  }));
}
