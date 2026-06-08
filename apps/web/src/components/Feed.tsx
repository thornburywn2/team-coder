import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type User } from '../lib/api';
import { useStore } from '../store';

// Live activity feed — streams ACTIVITY_EVENT over the WebSocket, hydrated from
// /api/feed on load. A "for me" toggle filters to notifications relevant to you
// (your own activity + items that mention you), so it doubles as a notifications view.

const KIND_ICON: Record<string, string> = {
  session_start: '🟢',
  prompt: '💬',
  edit: '✏️',
  subagent: '🤖',
  stop: '⏸️',
  claim: '🙋',
  done: '✅',
  created: '📝',
  blocked: '🚧',
  decision: '📐',
  pattern: '🧩',
  proposal: '💡',
  vote: '🗳️',
  comment: '💬',
  idle: '😴',
};

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function Feed() {
  const feed = useStore((s) => s.feed);
  const meId = useStore((s) => s.meId);
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const me = users.find((u) => u.id === meId);
  const meName = me?.displayName ?? me?.username;
  const [mine, setMine] = useState(false);

  const relevant = (f: { developerId?: string | null; detail?: string }) =>
    (!!meId && f.developerId === meId) || (!!meName && !!f.detail && f.detail.toLowerCase().includes(meName.toLowerCase()));
  const items = mine ? feed.filter(relevant) : feed;

  return (
    <section className="panel feed">
      <h2>Activity
        <label className="feed-toggle small" title="Show only activity involving you (notifications)">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> for me
        </label>
      </h2>
      <ul aria-live="polite">
        {items.length === 0 && <li className="muted">{mine ? 'Nothing for you yet.' : 'No activity yet — start coding.'}</li>}
        {items.map((f) => (
          <li key={f.id} className={meId && f.developerId === meId ? 'feed-mine' : ''}>
            <span className="icon" aria-hidden="true">{KIND_ICON[f.kind] ?? '•'}</span>
            <span className="dot sm" style={{ background: f.color ?? '#888' }} />
            <span className="who">{f.developer ?? 'someone'}</span>
            <span className="detail">{f.detail}</span>
            <span className="time">{ago(f.ts)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
