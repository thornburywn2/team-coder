import { useQuery } from '@tanstack/react-query';
import { getSummary } from '../lib/api';

// compact token formatting (e.g. 12.3k, 1.2M)
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// At-a-glance KPI strip across the top of the board — the numbers everyone wants
// without hunting: progress, who's live, what's stuck, momentum.

export function Kpis() {
  const { data: s } = useQuery({ queryKey: ['summary'], queryFn: getSummary, refetchInterval: 5000 });
  if (!s) return null;
  const pct = s.tasks.total ? Math.round((s.tasks.done / s.tasks.total) * 100) : 0;
  const cards = [
    { label: 'progress', value: `${pct}%`, sub: `${s.tasks.done}/${s.tasks.total} done`, tone: 'green', tip: `${s.tasks.done} of ${s.tasks.total} tasks complete (${pct}%)` },
    { label: 'in progress', value: s.tasks.inProgress, sub: 'tasks', tone: 'amber', tip: `${s.tasks.inProgress} tasks currently being worked on` },
    { label: 'blocked', value: s.tasks.blocked, sub: 'need help', tone: s.tasks.blocked > 0 ? 'red' : 'gray', tip: s.tasks.blocked ? `${s.tasks.blocked} blocked task(s) — see the Blockers widget` : 'Nothing blocked' },
    { label: 'coders active', value: s.activeCoders, sub: 'right now', tone: 'accent', tip: 'Coders whose presence is active right now' },
    { label: 'agents live', value: s.liveAgents, sub: `${s.liveSessions} sessions`, tone: 'accent', tip: `${s.liveAgents} coder(s) with an agent active in the last 5 min (${s.liveSessions} session(s))` },
    { label: 'open proposals', value: s.openProposals, sub: 'to decide', tone: s.openProposals > 0 ? 'amber' : 'gray', tip: `${s.openProposals} proposal(s) awaiting a decision — vote in "Needs a vote"` },
    { label: 'commits', value: s.commits, sub: `+${s.linesAdded.toLocaleString()} lines`, tone: 'accent', tip: `${s.commits} commits ingested from the repo, +${s.linesAdded.toLocaleString()} lines added` },
  ];
  return (
    <div className="kpis">
      {cards.map((c) => (
        <div key={c.label} className={`kpi kpi-${c.tone}`} title={c.tip}>
          <span className="kpi-value">{c.value}</span>
          <span className="kpi-label">{c.label}</span>
          <span className="kpi-sub">{c.sub}</span>
        </div>
      ))}
    </div>
  );
}
