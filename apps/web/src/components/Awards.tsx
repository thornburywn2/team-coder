import { useQuery } from '@tanstack/react-query';
import { getAwards } from '../lib/api';

// Team awards on the board — everyone's strength, celebrated (it's a team event).
// Each card's title tooltip explains why they earned it.

export function Awards() {
  const { data: awards = [] } = useQuery({ queryKey: ['awards'], queryFn: getAwards, refetchInterval: 15000 });
  if (awards.length === 0) return null;
  return (
    <section className="panel widget awards" title="Positive awards — each person's standout strength over the project">
      <h2>🏆 Team awards <span className="small muted">everyone's strength</span></h2>
      <div className="award-grid">
        {awards.map((a) => (
          <div key={a.developerId} className="award-card" style={{ borderTopColor: a.color ?? '#888' }}
            title={`${a.name}: ${a.award.title} — ${a.award.reason}. ${a.tasksDone} tasks · ${a.tools} tool calls${a.topLayer ? ` · mostly ${a.topLayer}` : ''}${a.topLanguage ? ` · ${a.topLanguage}` : ''}`}>
            <div className="award-emoji">{a.award.emoji}</div>
            <div className="award-title">{a.award.title}</div>
            <div className="award-who"><span className="dot sm" style={{ background: a.color ?? '#888' }} />{a.name}</div>
            <div className="award-reason small muted">{a.award.reason}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
