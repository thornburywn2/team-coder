import { useQuery } from '@tanstack/react-query';
import { getUsage } from '../lib/api';
import { fmtTokens } from './Kpis';

// Token usage per coder — track + minimize spend. Aggregated from session rollups
// (hooks / report_usage / the usage endpoint). Hover a bar for the in/out split.

export function TokenUsage() {
  const { data } = useQuery({ queryKey: ['usage'], queryFn: getUsage, refetchInterval: 10000 });
  const coders = (data?.coders ?? []).filter((c) => c.total > 0);
  const max = Math.max(1, ...coders.map((c) => c.total));

  return (
    <section className="panel widget token-usage" title="Token usage per person — the goal is to track it and drive it down over time">
      <h2>🪙 Token usage <span className="small muted">{data ? fmtTokens(data.total) + ' total' : ''}</span></h2>
      {coders.length === 0 ? (
        <p className="muted small">No token usage reported yet. Agents report via hooks or the report_usage MCP tool.</p>
      ) : (
        <ul>
          {coders.map((c) => (
            <li key={c.developerId} title={`${c.name}: ${c.tokensIn.toLocaleString()} in / ${c.tokensOut.toLocaleString()} out (${c.total.toLocaleString()} total)`}>
              <span className="tu-name"><span className="dot sm" style={{ background: c.color ?? '#888' }} />{c.name}</span>
              <div className="bar tu-bar"><div style={{ width: `${(c.total / max) * 100}%`, background: c.color ?? '#888' }} /></div>
              <span className="tu-val">{fmtTokens(c.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
