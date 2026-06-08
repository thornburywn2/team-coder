import { useQuery } from '@tanstack/react-query';
import { getAwards, listAgents, type Agent } from '../lib/api';

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
  const { data: awards = [] } = useQuery({ queryKey: ['awards'], queryFn: getAwards, refetchInterval: 15000 });

  // group by coder
  const byCoder = new Map<string, { name: string; color: string | null; agents: Agent[] }>();
  for (const a of agents) {
    const key = a.developerId ?? a.developerName;
    if (!byCoder.has(key)) byCoder.set(key, { name: a.developerName, color: a.color, agents: [] });
    byCoder.get(key)!.agents.push(a);
  }
  const groups = [...byCoder.values()].sort((x, y) => y.agents.length - x.agents.length);
  const activeAgents = agents.filter((a) => a.status === 'active').length;
  const idle = agents.filter((a) => a.status !== 'active');

  return (
    <div className="agents-view">
      <div className="proposals-head">
        <h2>Agents <span className="small muted">who's running what right now ({activeAgents} active / {agents.length} total)</span></h2>
      </div>

      {awards.length > 0 && (
        <section className="panel awards">
          <h2>🏆 Team awards <span className="small muted">everyone's strength — it's a team event</span></h2>
          <div className="award-grid">
            {awards.map((a) => (
              <div key={a.developerId} className="award-card" style={{ borderTopColor: a.color ?? '#888' }}>
                <div className="award-emoji">{a.award.emoji}</div>
                <div className="award-title">{a.award.title}</div>
                <div className="award-who"><span className="dot sm" style={{ background: a.color ?? '#888' }} />{a.name}</div>
                <div className="award-reason small muted">{a.award.reason}</div>
                <div className="award-stats small muted">
                  {a.tasksDone} tasks · {a.tools} tools{a.topLayer ? ` · ${a.topLayer}` : ''}{a.topLanguage ? ` · ${a.topLanguage}` : ''}
                  {a.activeAgents > 0 && <span className="award-live"> · 🟢 {a.activeAgents} live</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {idle.length > 0 && (
        <section className="panel idle-alerts">
          <h2>😴 Idle agents <span className="small muted">were active, now quiet — may be stalled or done</span></h2>
          <ul>
            {idle.map((a) => (
              <li key={a.sessionId}>
                <span className="dot sm" style={{ background: a.color ?? '#888' }} />
                <strong>{a.developerName}</strong>
                <span className="muted small">{a.currentFile ? `last on ${a.currentFile}` : `${a.sessionId.slice(0, 12)}`}</span>
                <span className={`agent-status`}>{a.status}</span>
                <span className="time">{ago(a.lastSeenAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
