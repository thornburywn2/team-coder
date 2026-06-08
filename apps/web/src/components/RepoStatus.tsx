import { useQuery } from '@tanstack/react-query';
import { getRepoStatus } from '../lib/api';

// Repo status widget — the team's current HEAD as Team Coder sees it. Updates live
// on REPO_UPDATED (the Dashboard invalidates ['repo-status']); a green dot means
// the portal's mirror is tracking the repo (engineers fast-forward via sync.sh).

function repoLabel(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, '');
}
function ago(iso: string | null) {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}

export function RepoStatus() {
  const { data: r } = useQuery({ queryKey: ['repo-status'], queryFn: getRepoStatus, refetchInterval: 15000 });

  return (
    <section className="panel widget repo-status">
      <h2>⎇ Repo</h2>
      {!r?.repoUrl ? (
        <p className="muted small">No repo linked. Set one when creating the project to track commits.</p>
      ) : (
        <>
          <div className="repo-head">
            <span className="dot dot-active" style={{ background: 'var(--green)' }} />
            <a href={r.repoUrl} target="_blank" rel="noreferrer" className="repo-name">{repoLabel(r.repoUrl)} ↗</a>
            <span className="repo-count small muted">{r.commitCount} commits</span>
          </div>
          {r.latest ? (
            <div className="repo-latest">
              <code className="repo-sha">{r.latest.sha.slice(0, 7)}</code>
              <span className="repo-msg">{r.latest.message ?? '(no message)'}</span>
              <div className="small muted">{r.latest.authorName ?? 'someone'} · {ago(r.latest.committedAt)} · <span className="repo-synced">in sync ✓</span></div>
            </div>
          ) : (
            <p className="muted small">No commits ingested yet (poll runs server-side).</p>
          )}
        </>
      )}
    </section>
  );
}
