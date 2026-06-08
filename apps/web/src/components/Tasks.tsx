import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type Task, type User } from '../lib/api';
import { queryClient } from '../lib/query';
import { useStore } from '../store';
import { Thread } from './Thread';

// Task list with soft claim/done. Claiming never blocks — it just makes
// ownership visible. Overall progress = done / total.

export function Tasks() {
  const meId = useStore((s) => s.meId);
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const [title, setTitle] = useState('');
  const [openThread, setOpenThread] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tasks'] });

  const create = useMutation({
    mutationFn: (t: string) => api<Task>('/tasks', { method: 'POST', body: JSON.stringify({ title: t, reporterId: meId }) }),
    onSuccess: () => { setTitle(''); invalidate(); },
  });
  const claim = useMutation({
    mutationFn: (id: string) => api<Task>(`/tasks/${id}/claim`, { method: 'POST', body: JSON.stringify({ userId: meId }) }),
    onSuccess: invalidate,
  });
  const done = useMutation({
    mutationFn: (id: string) => api<Task>(`/tasks/${id}/done`, { method: 'POST', body: JSON.stringify({ userId: meId }) }),
    onSuccess: invalidate,
  });

  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  return (
    <section className="panel tasks">
      <h2>
        Tasks <span className="progress">{doneCount}/{tasks.length} · {pct}%</span>
      </h2>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>

      <form
        className="new-task"
        onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(title.trim()); }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task…" />
        <button disabled={!title.trim()}>Add</button>
      </form>

      <ul>
        {tasks.map((t) => {
          const owner = t.assigneeId ? userById[t.assigneeId] : undefined;
          const open = openThread === t.id;
          const tip = [
            t.description || t.title,
            `status: ${t.status.replace('_', ' ')} · priority: ${t.priority} · source: ${t.source}`,
            owner ? `assignee: ${owner.displayName ?? owner.username}` : 'unassigned',
            t.tags?.length ? `tags: ${t.tags.join(', ')}` : '',
            `updated ${new Date(t.updatedAt).toLocaleString()}`,
          ].filter(Boolean).join('\n');
          return (
            <li key={t.id} className={`task task-${t.status}`}>
              <div className="task-row" title={tip}>
                <span className={`badge ${t.status}`}>{t.status.replace('_', ' ')}</span>
                {t.source === 'prd' && <span className="goal-tag" title="from the project goal (PRD)">🎯</span>}
                {t.source === 'proposal' && <span className="goal-tag" title="from an adopted proposal">💡</span>}
                {t.priority !== 'medium' && <span className={`prio prio-${t.priority}`} title={`${t.priority} priority`}>{t.priority}</span>}
                <span className="task-title">{t.title}</span>
                {t.tags?.map((tag) => <span key={tag} className="task-tag">{tag}</span>)}
                {owner && (
                  <span className="owner">
                    <span className="dot sm" style={{ background: owner.color ?? '#888' }} />
                    {owner.displayName ?? owner.username}
                  </span>
                )}
                <span className="task-actions">
                  <button onClick={() => setOpenThread(open ? null : t.id)}>💬</button>
                  {t.status !== 'done' && (
                    <>
                      <button onClick={() => claim.mutate(t.id)}>Claim</button>
                      <button onClick={() => done.mutate(t.id)}>Done</button>
                    </>
                  )}
                </span>
              </div>
              {open && <Thread targetType="task" targetId={t.id} />}
            </li>
          );
        })}
        {tasks.length === 0 && <li className="muted">No tasks yet — add one.</li>}
      </ul>
    </section>
  );
}
