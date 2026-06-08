import { useQuery } from '@tanstack/react-query';
import { getTokenTrend } from '../lib/api';
import { fmtTokens } from './Kpis';

// Token usage over time — daily spend, so the team can watch the trend and drive
// it down. Lightweight inline SVG area chart (no chart lib).

const W = 320, H = 110, PADL = 6, PADR = 6, PADT = 10, PADB = 18;
const PW = W - PADL - PADR, PH = H - PADT - PADB;

export function TokenTrend() {
  const { data } = useQuery({ queryKey: ['usage-trend'], queryFn: getTokenTrend, refetchInterval: 15000 });
  const series = data?.series ?? [];

  return (
    <section className="panel widget token-trend" title="Total tokens used per day across the team — watch it and keep it lean">
      <h2>🪙 Token trend <span className="small muted">per day{data ? ` · ${fmtTokens(data.total)} total` : ''}</span></h2>
      {series.length < 2 ? (
        <p className="muted small">Not enough history yet — appears as token usage accrues across days.</p>
      ) : (
        (() => {
          const maxY = Math.max(1, ...series.map((p) => p.tokens));
          const n = series.length;
          const pts = series.map((p, i) => `${PADL + (i / (n - 1)) * PW},${PADT + (1 - p.tokens / maxY) * PH}`).join(' ');
          const area = `M ${PADL},${PADT + PH} L ${pts.split(' ').join(' L ')} L ${PADL + PW},${PADT + PH} Z`;
          return (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} className="bd-svg" preserveAspectRatio="none" role="img" aria-label="token usage per day">
                <line x1={PADL} y1={PADT + PH} x2={PADL + PW} y2={PADT + PH} stroke="var(--border)" strokeWidth="1" />
                <path d={area} fill="var(--accent)" opacity="0.14" />
                <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" />
                {series.map((p, i) => (
                  <circle key={p.date} cx={PADL + (i / (n - 1)) * PW} cy={PADT + (1 - p.tokens / maxY) * PH} r="6" fill="transparent">
                    <title>{`${p.date}: ${p.tokens.toLocaleString()} tokens`}</title>
                  </circle>
                ))}
              </svg>
              <div className="bd-axis small muted"><span>{series[0]!.date.slice(5)}</span><span>{series[series.length - 1]!.date.slice(5)}</span></div>
            </>
          );
        })()
      )}
    </section>
  );
}
