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
  const edit = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => { invalidate(); queryClient.invalidateQueries({ queryKey: ['summary'] }); queryClient.invalidateQueries({ queryKey: ['burndown'] }); },
  });
  const PRIOS = ['low', 'medium', 'high', 'urgent'] as const;
  const STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'] as const;

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
                <select className={`task-status badge ${t.status}`} value={t.status} aria-label="task status" onChange={(e) => edit.mutate({ id: t.id, patch: { status: e.target.value } })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                {t.source === 'prd' && <span className="goal-tag" title="from the project goal (PRD)">🎯</span>}
                {t.source === 'proposal' && <span className="goal-tag" title="from an adopted proposal">💡</span>}
                <select className={`task-prio prio-${t.priority}`} value={t.priority} aria-label="task priority" onChange={(e) => edit.mutate({ id: t.id, patch: { priority: e.target.value } })}>
                  {PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <span className="task-title">{t.title}</span>
                {t.tags?.map((tag) => <span key={tag} className="task-tag">{tag}</span>)}
                {owner && (
                  <span className="owner">
                    <span className="dot sm" style={{ background: owner.color ?? '#888' }} />
                    {owner.displayName ?? owner.username}
                  </span>
                )}
                <span className="task-actions">
                  <input type="date" className="task-due" aria-label="due date" title="Due date" value={t.dueDate ? t.dueDate.slice(0, 10) : ''} onChange={(e) => edit.mutate({ id: t.id, patch: { dueDate: e.target.value || null } })} />
                  <button onClick={() => setOpenThread(open ? null : t.id)} aria-label="discuss">💬</button>
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
