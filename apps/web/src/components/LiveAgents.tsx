import { useQuery } from '@tanstack/react-query';
import { listAgents } from '../lib/api';

// Compact "who's coding right now" widget for the board (full detail in Agents tab).

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

export function LiveAgents() {
  const { data: agents = [] } = useQuery({ queryKey: ['agents'], queryFn: listAgents, refetchInterval: 4000 });
  const live = agents.filter((a) => a.status !== 'away');

  return (
    <section className="panel widget live-agents">
      <h2>🤖 Live agents <span className="small muted">{agents.filter((a) => a.status === 'active').length} active</span></h2>
      {live.length === 0 ? (
        <p className="muted small">No agents active right now.</p>
      ) : (
        <ul>
          {live.map((a) => (
            <li key={a.sessionId}>
              <span className={`dot sm dot-${a.status === 'active' ? 'active' : 'idle'}`} style={{ background: a.color ?? '#888' }} />
              <span className="who">{a.developerName}</span>
              {a.currentFile && <code className="file">{a.currentFile.split('/').pop()}</code>}
              <span className="time">{ago(a.lastSeenAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
