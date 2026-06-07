import { useQuery } from '@tanstack/react-query';
import { api, type User } from '../lib/api';
import { useStore } from '../store';

// Swim lanes — one per coder. Status dot + current file/prompt come live from
// presence (updated via WebSocket).

const STATUS_LABEL: Record<string, string> = {
  active: 'active',
  thinking: 'thinking',
  idle: 'idle',
  offline: 'offline',
};

export function Board() {
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const presence = useStore((s) => s.presence);
  const meId = useStore((s) => s.meId);

  return (
    <section className="panel board">
      <h2>Who's working on what</h2>
      <div className="lanes">
        {users.map((u) => {
          const p = presence[u.id];
          const status = p?.status ?? 'offline';
          return (
            <div key={u.id} className={`lane status-${status}`} style={{ borderLeftColor: u.color ?? '#888' }}>
              <div className="lane-head">
                <span className={`dot dot-${status}`} style={{ background: u.color ?? '#888' }} />
                <strong>{u.displayName ?? u.username}</strong>
                {u.id === meId && <span className="you">you</span>}
                <span className="status-label">{STATUS_LABEL[status]}</span>
              </div>
              <div className="lane-body">
                {p?.currentFile ? (
                  <code className="file">{p.currentFile}</code>
                ) : (
                  <span className="muted">—</span>
                )}
                {p?.currentPrompt && <p className="prompt">“{p.currentPrompt}”</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
