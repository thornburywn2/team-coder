import { create } from 'zustand';
import type { CollisionWarning, FeedItem, ModuleOwnership, PresenceRow } from './lib/api';

// Ephemeral live state (presence + feed + connection), updated by the WebSocket.
// Auth identity (token + which coder you are) is persisted to localStorage.

interface Store {
  token: string | null;
  meId: string | null;
  connected: boolean;
  presence: Record<string, PresenceRow>;
  feed: FeedItem[];
  ownership: ModuleOwnership[];
  collisions: CollisionWarning[];

  setAuth: (token: string, meId: string) => void;
  logout: () => void;
  setConnected: (b: boolean) => void;
  hydratePresence: (rows: PresenceRow[]) => void;
  applyPresence: (row: PresenceRow) => void;
  hydrateFeed: (items: FeedItem[]) => void;
  pushFeed: (item: FeedItem) => void;
  setOwnership: (o: ModuleOwnership[]) => void;
  hydrateCollisions: (c: CollisionWarning[]) => void;
  pushCollision: (c: CollisionWarning) => void;
}

export const useStore = create<Store>((set) => ({
  token: localStorage.getItem('tc_token'),
  meId: localStorage.getItem('tc_me'),
  connected: false,
  presence: {},
  feed: [],
  ownership: [],
  collisions: [],

  setAuth: (token, meId) => {
    localStorage.setItem('tc_token', token);
    localStorage.setItem('tc_me', meId);
    set({ token, meId });
  },
  logout: () => {
    localStorage.removeItem('tc_token');
    localStorage.removeItem('tc_me');
    set({ token: null, meId: null, connected: false, presence: {}, feed: [], ownership: [], collisions: [] });
  },
  setConnected: (connected) => set({ connected }),
  hydratePresence: (rows) =>
    set({ presence: Object.fromEntries(rows.map((r) => [r.userId, r])) }),
  applyPresence: (row) =>
    set((s) => ({ presence: { ...s.presence, [row.userId]: { ...s.presence[row.userId], ...row } } })),
  hydrateFeed: (items) => set({ feed: items }),
  pushFeed: (item) => set((s) => ({ feed: [item, ...s.feed].slice(0, 100) })),
  setOwnership: (ownership) => set({ ownership }),
  hydrateCollisions: (collisions) => set({ collisions }),
  // newest first, one entry per file (latest wins), keep a small recent set
  pushCollision: (c) =>
    set((s) => ({ collisions: [c, ...s.collisions.filter((w) => w.file !== c.file)].slice(0, 20) })),
}));
