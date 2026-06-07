import { publish } from './state';

// Live activity feed — an in-memory ring buffer of recent, high-signal events
// derived from hooks + claims. Ephemeral by design (hackathon scale); the DB
// activity_events table is reserved for durable domain audit in later phases.

export interface FeedItem {
  id: string;
  ts: number;
  developerId?: string;
  developer?: string;
  color?: string;
  kind: 'session_start' | 'prompt' | 'edit' | 'stop' | 'subagent' | 'claim' | 'done';
  detail?: string;
  file?: string;
}

const RING: FeedItem[] = [];
const CAPACITY = 100;
let seq = 0;

export function pushFeed(item: Omit<FeedItem, 'id' | 'ts'> & { ts?: number }): FeedItem {
  const full: FeedItem = { id: String(++seq), ts: item.ts ?? Date.now(), ...item };
  RING.push(full);
  if (RING.length > CAPACITY) RING.shift();
  publish({
    type: 'ACTIVITY_EVENT',
    payload: full,
    meta: { developerId: full.developerId, ts: full.ts },
  });
  return full;
}

/** Most-recent-first snapshot for hydration. */
export function recentFeed(): FeedItem[] {
  return [...RING].reverse();
}
