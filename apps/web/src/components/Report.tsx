import { useQuery } from '@tanstack/react-query';
import { api, type Report as ReportData } from '../lib/api';
import { downloadFile, reportToMarkdown } from '../lib/report-export';

// Post-hackathon contribution report. Multiple fairness lenses (blended headline),
// module breakdown by LOC, activity timeline. Exportable (JSON/Markdown/print).

export function Report() {
  const { data: report, isLoading } = useQuery({ queryKey: ['report'], queryFn: () => api<ReportData>('/report') });

  if (isLoading || !report) {
    return (
      <section className="panel">
        <h2>Contribution report</h2>
        <p className="muted">Crunching contributions…</p>
      </section>
    );
  }

  const maxBucket = Math.max(1, ...report.timeline.map((b) => Object.values(b.perCoder).reduce((a, n) => a + n, 0)));

  return (
    <div className="report">
      <section className="panel">
        <h2>
          Contribution report
          <span className="report-actions">
            <button onClick={() => downloadFile('team-coder-report.json', JSON.stringify(report, null, 2), 'application/json')}>JSON</button>
            <button onClick={() => downloadFile('team-coder-report.md', reportToMarkdown(report), 'text/markdown')}>Markdown</button>
            <button onClick={() => window.print()}>Print / PDF</button>
          </span>
        </h2>
        <div className="totals">
          <Stat label="commits" value={report.totals.commits} />
          <Stat label="lines added" value={report.totals.linesAdded} />
          <Stat label="tasks done" value={report.totals.tasksCompleted} />
          <Stat label="active min" value={report.totals.activeMinutes} />
        </div>
      </section>

      <section className="panel">
        <h2>Who built what <span className="muted small">blended across commits · lines · tasks · edits</span></h2>
        <div className="contrib">
          {report.coders.map((c) => (
            <div key={c.id} className="contrib-row">
              <div className="contrib-head">
                <span className="dot sm" style={{ background: c.color ?? '#888' }} />
                <strong>{c.name}</strong>
                <span className="blended">{c.pct.blended}%</span>
              </div>
              <div className="bar"><div style={{ width: `${c.pct.blended}%`, background: c.color ?? '#888' }} /></div>
              <div className="sub">
                <span>{c.commits} commits</span>
                <span>+{c.linesAdded}/-{c.linesRemoved}</span>
                <span>{c.filesTouched} files</span>
                <span>{c.edits} edits</span>
                <span>{c.tasksCompleted} tasks</span>
                <span>{c.modulesOwned} modules</span>
                <span>{c.activeMinutes}m active</span>
                {c.decisions > 0 && <span>{c.decisions} ADRs</span>}
                {c.patterns > 0 && <span>{c.patterns} patterns</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Module breakdown <span className="muted small">by lines committed</span></h2>
        <div className="modules-report">
          {report.modules.map((m) => (
            <div key={m.pathPrefix} className="mod-row">
              <div className="mod-head">
                <code>{m.pathPrefix}</code>
                <span className="muted">{m.totalLines} lines</span>
              </div>
              <div className="stacked">
                {m.contributors.length === 0 && <div className="empty-seg" />}
                {m.contributors.map((c) => (
                  <div key={c.id} className="seg" style={{ width: `${c.pct}%`, background: c.color ?? '#888' }} title={`${c.name}: ${c.lines} lines (${c.pct}%)`} />
                ))}
              </div>
              <div className="mod-legend">
                {m.contributors.map((c) => (
                  <span key={c.id}><span className="dot sm" style={{ background: c.color ?? '#888' }} />{c.name} {c.pct}%</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {report.timeline.length > 0 && (
        <section className="panel">
          <h2>Activity timeline <span className="muted small">events per hour</span></h2>
          <div className="timeline">
            {report.timeline.map((b) => {
              const total = Object.values(b.perCoder).reduce((a, n) => a + n, 0);
              return <div key={b.t} className="tl-bar" style={{ height: `${Math.max(4, (total / maxBucket) * 100)}%` }} title={`${b.t}: ${total} events`} />;
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value.toLocaleString()}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
