import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type Task } from '../lib/api';
import { queryClient } from '../lib/query';
import { useStore } from '../store';

// "My work" — a personal focus panel for the logged-in coder: the tasks assigned
// to you that aren't done, highest-priority first, with a one-click done.

const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export function MyWork() {
  const meId = useStore((s) => s.meId);
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['summary'] });
    queryClient.invalidateQueries({ queryKey: ['burndown'] });
  };
  const done = useMutation({ mutationFn: (id: string) => api<Task>(`/tasks/${id}/done`, { method: 'POST', body: JSON.stringify({ userId: meId }) }), onSuccess: invalidate });

  const mine = tasks
    .filter((t) => t.assigneeId === meId && t.status !== 'done')
    .sort((a, b) => (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9));
  const myDone = tasks.filter((t) => t.assigneeId === meId && t.status === 'done').length;

  return (
    <section className="panel widget my-work">
      <h2>🙋 My work <span className="small muted">{mine.length} open · {myDone} done</span></h2>
      {mine.length === 0 ? (
        <p className="muted small">Nothing assigned to you. Claim a task from the board.</p>
      ) : (
        <ul>
          {mine.map((t) => (
            <li key={t.id} className={`task-${t.status}`} title={`${t.description || t.title}\nstatus: ${t.status.replace('_', ' ')} · priority: ${t.priority}${t.tags?.length ? `\ntags: ${t.tags.join(', ')}` : ''}`}>
              <span className={`badge ${t.status}`}>{t.status.replace('_', ' ')}</span>
              {t.priority !== 'medium' && <span className={`prio prio-${t.priority}`}>{t.priority}</span>}
              <span className="task-title">{t.title}</span>
              <button className="link-btn" onClick={() => done.mutate(t.id)}>done</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
