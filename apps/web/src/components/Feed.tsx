import { useStore } from '../store';

// Live activity feed — streams ACTIVITY_EVENT over the WebSocket, hydrated from
// /api/feed on load.

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
};

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function Feed() {
  const feed = useStore((s) => s.feed);
  return (
    <section className="panel feed">
      <h2>Activity</h2>
      <ul>
        {feed.length === 0 && <li className="muted">No activity yet — start coding.</li>}
        {feed.map((f) => (
          <li key={f.id}>
            <span className="icon">{KIND_ICON[f.kind] ?? '•'}</span>
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
