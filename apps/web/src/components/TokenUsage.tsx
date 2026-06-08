import { useQuery } from '@tanstack/react-query';
import { getUsage } from '../lib/api';
import { fmtTokens } from './Kpis';

// Token usage per coder + estimated $ + per-model breakdown — track + minimize
// spend. Aggregated from session rollups (hooks / report_usage). Cost is an
// estimate from configurable per-model rates.

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`);

export function TokenUsage() {
  const { data } = useQuery({ queryKey: ['usage'], queryFn: getUsage, refetchInterval: 10000 });
  const coders = (data?.coders ?? []).filter((c) => c.total > 0);
  const models = data?.models ?? [];
  const max = Math.max(1, ...coders.map((c) => c.total));

  return (
    <section className="panel widget token-usage" title="Token usage + estimated cost per person — the goal is to track it and drive it down over time">
      <h2>🪙 Token usage <span className="small muted">{data ? `${fmtTokens(data.total)} · ${usd(data.totalCostUsd)} est.` : ''}</span></h2>
      {coders.length === 0 ? (
        <p className="muted small">No token usage reported yet. Agents report via the transcript hook or the report_usage MCP tool.</p>
      ) : (
        <>
          <ul>
            {coders.map((c) => (
              <li key={c.developerId} title={`${c.name}: ${c.tokensIn.toLocaleString()} in / ${c.tokensOut.toLocaleString()} out (${c.total.toLocaleString()} total) · ${usd(c.costUsd)} est.`}>
                <span className="tu-name"><span className="dot sm" style={{ background: c.color ?? '#888' }} />{c.name}</span>
                <div className="bar tu-bar"><div style={{ width: `${(c.total / max) * 100}%`, background: c.color ?? '#888' }} /></div>
                <span className="tu-val">{fmtTokens(c.total)}</span>
                <span className="tu-cost small muted">{usd(c.costUsd)}</span>
              </li>
            ))}
          </ul>
          {models.length > 0 && (
            <div className="tu-models small muted" title="Per-model token split + estimated cost">
              {models.map((m) => (
                <span key={m.model} className="tu-model">{m.model}: {fmtTokens(m.total)} · {usd(m.costUsd)}</span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
