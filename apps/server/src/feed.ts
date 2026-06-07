import { publish } from './state';

// Live activity feed — an in-memory ring buffer of recent, high-signal events
// derived from hooks + claims. Ephemeral by design (hackathon scale); the DB
// activity_events table is reserved for durable domain audit in later phases.
//
// Partitioned by project: each project gets its own ring so feeds never bleed
// across projects, and every emitted message is tagged with its projectId so the
// WebSocket layer only fans it out to that project's sockets.

export interface FeedItem {
  id: string;
  ts: number;
  projectId: string;
  developerId?: string;
  developer?: string;
  color?: string;
  kind: 'session_start' | 'prompt' | 'edit' | 'stop' | 'subagent' | 'claim' | 'done' | 'blocked' | 'decision' | 'pattern' | 'created';
  detail?: string;
  file?: string;
}

const RINGS = new Map<string, FeedItem[]>();
const CAPACITY = 100;
let seq = 0;

export function pushFeed(
  projectId: string,
  item: Omit<FeedItem, 'id' | 'ts' | 'projectId'> & { ts?: number },
): FeedItem {
  const full: FeedItem = { id: String(++seq), ts: item.ts ?? Date.now(), projectId, ...item };
  let ring = RINGS.get(projectId);
  if (!ring) {
    ring = [];
    RINGS.set(projectId, ring);
  }
  ring.push(full);
  if (ring.length > CAPACITY) ring.shift();
  publish({
    type: 'ACTIVITY_EVENT',
    payload: full,
    meta: { developerId: full.developerId, projectId, ts: full.ts },
  });
  return full;
}

/** Most-recent-first snapshot for hydration, scoped to one project. */
export function recentFeed(projectId: string): FeedItem[] {
  return [...(RINGS.get(projectId) ?? [])].reverse();
}
