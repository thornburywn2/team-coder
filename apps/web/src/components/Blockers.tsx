import { useQuery } from '@tanstack/react-query';
import { api, type Task, type User } from '../lib/api';

// Blockers widget — what's stuck right now. The most coordination-critical view:
// surface blocked work so the team can unblock it fast.

export function Blockers() {
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const blocked = tasks.filter((t) => t.status === 'blocked');

  return (
    <section className="panel widget blockers">
      <h2>🚧 Blockers <span className="small muted">{blocked.length}</span></h2>
      {blocked.length === 0 ? (
        <p className="muted small">Nothing blocked — nice. 🎉</p>
      ) : (
        <ul>
          {blocked.map((t) => {
            const u = t.assigneeId ? byId[t.assigneeId] : undefined;
            return (
              <li key={t.id} title={`${t.description || t.title}\nblocked · ${u ? (u.displayName ?? u.username) : 'unassigned'}\nopen the task thread for the blocker reason`}>
                <span className="task-title">{t.title}</span>
                {u && <span className="owner"><span className="dot sm" style={{ background: u.color ?? '#888' }} />{u.displayName ?? u.username}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
