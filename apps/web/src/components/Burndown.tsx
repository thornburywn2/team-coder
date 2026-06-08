import { useQuery } from '@tanstack/react-query';
import { getBurndown, type BurndownPoint } from '../lib/api';

// Burndown / progress chart — cumulative scope vs. completed over the project, so
// the team sees momentum toward the goal. Pure inline SVG (no chart lib).

const W = 320, H = 120, PADL = 6, PADR = 6, PADT = 10, PADB = 18;
const PW = W - PADL - PADR, PH = H - PADT - PADB;

function line(series: BurndownPoint[], val: (p: BurndownPoint) => number, maxY: number): string {
  const n = series.length;
  return series.map((p, i) => `${PADL + (n === 1 ? PW : (i / (n - 1)) * PW)},${PADT + (1 - val(p) / maxY) * PH}`).join(' ');
}
const shortDate = (d: string) => d.slice(5); // MM-DD

export function Burndown() {
  const { data } = useQuery({ queryKey: ['burndown'], queryFn: getBurndown, refetchInterval: 10000 });
  const series = data?.series ?? [];

  return (
    <section className="panel widget burndown">
      <h2>📉 Burndown <span className="small muted">scope vs. completed</span>
        {data && <span className="bd-head">{data.done}/{data.total} done · {data.total - data.done} remaining</span>}
      </h2>
      {series.length < 2 ? (
        <p className="muted small">Not enough history yet — chart appears as tasks are created and completed over days.</p>
      ) : (
        (() => {
          const maxY = Math.max(1, ...series.map((p) => p.scope));
          const donePts = line(series, (p) => p.done, maxY);
          const areaPath = `M ${PADL},${PADT + PH} L ${donePts.split(' ').join(' L ')} L ${PADL + PW},${PADT + PH} Z`;
          return (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} className="bd-svg" preserveAspectRatio="none" role="img" aria-label="burndown chart">
                <line x1={PADL} y1={PADT + PH} x2={PADL + PW} y2={PADT + PH} stroke="var(--border)" strokeWidth="1" />
                <path d={areaPath} fill="var(--green)" opacity="0.14" />
                <polyline points={line(series, (p) => p.scope, maxY)} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 3" />
                <polyline points={donePts} fill="none" stroke="var(--green)" strokeWidth="2" />
                {series.map((p, i) => {
                  const n = series.length;
                  const x = PADL + (n === 1 ? PW : (i / (n - 1)) * PW);
                  const y = PADT + (1 - p.done / maxY) * PH;
                  return (
                    <circle key={p.date} cx={x} cy={y} r="6" fill="transparent">
                      <title>{`${p.date}\nscope: ${p.scope} · done: ${p.done} · remaining: ${p.remaining}`}</title>
                    </circle>
                  );
                })}
              </svg>
              <div className="bd-axis small muted"><span>{shortDate(series[0]!.date)}</span><span>{shortDate(series[series.length - 1]!.date)}</span></div>
              <div className="bd-legend small muted">
                <span><span className="bd-key bd-scope" /> scope</span>
                <span><span className="bd-key bd-done" /> completed</span>
              </div>
            </>
          );
        })()
      )}
    </section>
  );
}
