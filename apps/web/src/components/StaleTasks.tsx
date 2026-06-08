import { useQuery } from '@tanstack/react-query';
import { api, type Task, type User } from '../lib/api';

// Stale / at-risk tasks — work that's in progress (or in review) but hasn't moved
// in a while. Surfaces quietly-stuck work before it becomes a blocker.

const STALE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days without an update = stale
const ACTIVE = new Set(['in_progress', 'in_review']);

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function StaleTasks() {
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));

  const stale = tasks
    .filter((t) => ACTIVE.has(t.status) && Date.now() - new Date(t.updatedAt).getTime() > STALE_MS)
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

  return (
    <section className="panel widget stale-tasks">
      <h2>🕰️ Stale tasks <span className="small muted">{stale.length} · no update 2d+</span></h2>
      {stale.length === 0 ? (
        <p className="muted small">All active work is moving. 👍</p>
      ) : (
        <ul>
          {stale.map((t) => {
            const u = t.assigneeId ? byId[t.assigneeId] : undefined;
            return (
              <li key={t.id}>
                <span className={`badge ${t.status}`}>{t.status.replace('_', ' ')}</span>
                <span className="task-title">{t.title}</span>
                {u && <span className="owner"><span className="dot sm" style={{ background: u.color ?? '#888' }} />{u.displayName ?? u.username}</span>}
                <span className="time">{ageDays(t.updatedAt)}d</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
