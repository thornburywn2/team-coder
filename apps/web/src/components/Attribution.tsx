import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getAttribution, mapAttribution } from '../lib/api';
import { queryClient } from '../lib/query';

// Attribution health — git commits are matched to coders by author email. If a
// coder's git email differs from their login email, their work goes unattributed.
// This panel surfaces unmapped commit authors and lets you map each to a coder
// (which remembers the email AND backfills existing commits retroactively).

export function Attribution() {
  const { data } = useQuery({ queryKey: ['attribution'], queryFn: getAttribution, refetchInterval: 15000 });
  const [pick, setPick] = useState<Record<string, string>>({});
  const map = useMutation({
    mutationFn: ({ developerId, email }: { developerId: string; email: string }) => mapAttribution(developerId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attribution'] });
      queryClient.invalidateQueries({ queryKey: ['report'] });
      queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
  });
  if (!data) return null;

  return (
    <section className="panel attribution" title="Make sure every commit is credited to the right coder">
      <h2>🔗 Attribution <span className="small muted">git email → coder</span></h2>

      {data.unattributed.length > 0 ? (
        <>
          <p className="small muted">These commit authors aren't mapped to a coder — pick who they are to credit (and backfill) their commits:</p>
          <ul className="attr-unmapped">
            {data.unattributed.map((u) => (
              <li key={u.authorEmail}>
                <span className="attr-author"><code>{u.authorEmail}</code>{u.authorName && <span className="muted small"> ({u.authorName})</span>} · {u.commits} commit{u.commits === 1 ? '' : 's'}</span>
                <span className="attr-actions">
                  <select value={pick[u.authorEmail] ?? ''} onChange={(e) => setPick((p) => ({ ...p, [u.authorEmail]: e.target.value }))}>
                    <option value="">map to…</option>
                    {data.coders.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="link-btn" disabled={!pick[u.authorEmail] || map.isPending} onClick={() => map.mutate({ developerId: pick[u.authorEmail]!, email: u.authorEmail })}>map</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="small muted">✓ Every commit is attributed to a coder.</p>
      )}

      <div className="attr-coders small">
        {data.coders.map((c) => (
          <div key={c.id} className="attr-coder" title={`login: ${c.email ?? '—'}\ngit emails: ${[c.email, ...c.gitEmails].filter(Boolean).join(', ') || '—'}`}>
            <span className="dot sm" style={{ background: c.color ?? '#888' }} />{c.name}
            <span className="muted"> — {[c.email, ...c.gitEmails].filter(Boolean).join(', ') || 'no git email'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
