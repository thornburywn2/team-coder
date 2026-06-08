import { useQuery } from '@tanstack/react-query';
import { api, type Proposal } from '../lib/api';

// Open proposals needing a decision — nudges the team to vote without leaving the
// board. Full voting/discussion lives in the Proposals tab.

export function OpenProposals({ onOpen }: { onOpen: () => void }) {
  const { data: proposals = [] } = useQuery({ queryKey: ['proposals'], queryFn: () => api<Proposal[]>('/proposals') });
  const open = proposals.filter((p) => p.status === 'open');

  return (
    <section className="panel widget open-proposals">
      <h2>🗳️ Needs a vote <span className="small muted">{open.length}</span></h2>
      {open.length === 0 ? (
        <p className="muted small">No open proposals.</p>
      ) : (
        <ul>
          {open.map((p) => (
            <li key={p.id} onClick={onOpen} role="button">
              <span className="prop-title">{p.title}</span>
              <span className="tally small muted">👍{p.tally.approve} 👎{p.tally.reject} 🤷{p.tally.abstain}</span>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && <button className="link-btn" onClick={onOpen}>open Proposals →</button>}
    </section>
  );
}
