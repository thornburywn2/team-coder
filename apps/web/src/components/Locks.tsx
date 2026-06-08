import { useQuery } from '@tanstack/react-query';
import { getLocks } from '../lib/api';

// Active work-locks — who's holding which file right now. Agents acquire a file
// before editing and others hold until release, so two agents don't collide. This
// makes the holds visible to humans too.

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

export function Locks() {
  const { data: locks = [] } = useQuery({ queryKey: ['locks'], queryFn: getLocks, refetchInterval: 5000 });

  return (
    <section className="panel widget locks" title="Files currently held by an agent — others hold until released (auto-expires after 15 min)">
      <h2>🔒 Active work-locks <span className="small muted">{locks.length}</span></h2>
      {locks.length === 0 ? (
        <p className="muted small">No files locked — areas are free.</p>
      ) : (
        <ul>
          {locks.map((l) => (
            <li key={l.file} title={`${l.file}\nheld by ${l.holderName} for ${ago(l.ts)}`}>
              <span className="lock-icon">🔒</span>
              <code className="lock-file">{l.file}</code>
              <span className="who">{l.holderName}</span>
              <span className="time">{ago(l.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
