import { useQuery } from '@tanstack/react-query';
import { getSummary } from '../lib/api';

// At-a-glance KPI strip across the top of the board — the numbers everyone wants
// without hunting: progress, who's live, what's stuck, momentum.

export function Kpis() {
  const { data: s } = useQuery({ queryKey: ['summary'], queryFn: getSummary, refetchInterval: 5000 });
  if (!s) return null;
  const pct = s.tasks.total ? Math.round((s.tasks.done / s.tasks.total) * 100) : 0;
  const cards = [
    { label: 'progress', value: `${pct}%`, sub: `${s.tasks.done}/${s.tasks.total} done`, tone: 'green' },
    { label: 'in progress', value: s.tasks.inProgress, sub: 'tasks', tone: 'amber' },
    { label: 'blocked', value: s.tasks.blocked, sub: 'need help', tone: s.tasks.blocked > 0 ? 'red' : 'gray' },
    { label: 'coders active', value: s.activeCoders, sub: 'right now', tone: 'accent' },
    { label: 'agents live', value: s.liveAgents, sub: `${s.liveSessions} sessions`, tone: 'accent' },
    { label: 'open proposals', value: s.openProposals, sub: 'to decide', tone: s.openProposals > 0 ? 'amber' : 'gray' },
    { label: 'commits', value: s.commits, sub: `+${s.linesAdded.toLocaleString()} lines`, tone: 'accent' },
  ];
  return (
    <div className="kpis">
      {cards.map((c) => (
        <div key={c.label} className={`kpi kpi-${c.tone}`}>
          <span className="kpi-value">{c.value}</span>
          <span className="kpi-label">{c.label}</span>
          <span className="kpi-sub">{c.sub}</span>
        </div>
      ))}
    </div>
  );
}
