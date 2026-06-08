import { useQuery } from '@tanstack/react-query';
import { listAgents, type Agent } from '../lib/api';

// Live agent roster — who's running what right now. A coder can drive several
// agents at once (multiple sessions), so this groups sessions under each coder and
// shows per-agent stats. Polled (sessions update on every hook event).

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function Agents() {
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: listAgents, refetchInterval: 3000 });

  // group by coder
  const byCoder = new Map<string, { name: string; color: string | null; agents: Agent[] }>();
  for (const a of agents) {
    const key = a.developerId ?? a.developerName;
    if (!byCoder.has(key)) byCoder.set(key, { name: a.developerName, color: a.color, agents: [] });
    byCoder.get(key)!.agents.push(a);
  }
  const groups = [...byCoder.values()].sort((x, y) => y.agents.length - x.agents.length);
  const activeAgents = agents.filter((a) => a.status === 'active').length;

  return (
    <div className="agents-view">
      <div className="proposals-head">
        <h2>Agents <span className="small muted">who's running what right now ({activeAgents} active / {agents.length} total)</span></h2>
      </div>
      {groups.length === 0 && <p className="muted">No agents seen in the last 15 minutes. Connect one from the Connect tab.</p>}
      {groups.map((g) => (
        <section className="panel coder-agents" key={g.name}>
          <div className="ca-head">
            <span className="dot" style={{ background: g.color ?? '#888' }} />
            <strong>{g.name}</strong>
            <span className="small muted">{g.agents.length} agent{g.agents.length === 1 ? '' : 's'}</span>
          </div>
          <ul className="agent-list">
            {g.agents.map((a) => (
              <li key={a.sessionId} className={`agent status-${a.status}`}>
                <span className={`dot sm dot-${a.status === 'active' ? 'active' : 'idle'}`} style={{ background: a.status === 'active' ? 'var(--green)' : 'var(--gray)' }} />
                <span className="agent-id" title={a.sessionId}>{a.sessionId.slice(0, 12)}</span>
                <span className="agent-status">{a.status}</span>
                <span className="agent-stats">
                  {a.prompts} prompts · {a.tools} tools · {a.filesTouched} files · {a.activeMinutes}m
                </span>
                {a.currentFile && <code className="agent-file">{a.currentFile}</code>}
                <span className="time">{ago(a.lastSeenAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
