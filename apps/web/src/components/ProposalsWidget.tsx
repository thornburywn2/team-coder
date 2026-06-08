import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, getBranches, setProposalStatus, voteProposal, type BranchInfo, type Proposal, type ProposalStatus, type User, type VoteValue } from '../lib/api';
import { queryClient } from '../lib/query';
import { useStore } from '../store';
import { Thread } from './Thread';
import { NewProposal } from './Proposals';

// Open proposals you can act on WITHOUT leaving the board: thumbs up/down/abstain
// and discuss inline. Full create/manage/decisions still live in the Proposals tab.

const VOTES: { v: VoteValue; icon: string; title: string }[] = [
  { v: 'approve', icon: '👍', title: 'Approve' },
  { v: 'reject', icon: '👎', title: 'Reject' },
  { v: 'abstain', icon: '🤷', title: 'Abstain' },
];

function Row({ p, users, meId, branches }: { p: Proposal; users: User[]; meId: string | null; branches: BranchInfo[] }) {
  const [open, setOpen] = useState(false);
  const author = users.find((u) => u.id === p.authorId);
  const branch = p.experimentBranch ? branches.find((b) => b.name === p.experimentBranch) : undefined;
  const myVote = p.votes.find((x) => x.voterId === meId)?.vote;
  const vote = useMutation({ mutationFn: (v: VoteValue) => voteProposal(p.id, v, meId), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proposals'] }) });
  const status = useMutation({
    mutationFn: (s: ProposalStatus) => setProposalStatus(p.id, s, meId),
    onSuccess: (res) => {
      if (res.adopted) {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['decisions'] });
        queryClient.invalidateQueries({ queryKey: ['patterns'] });
        queryClient.invalidateQueries({ queryKey: ['summary'] });
      }
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });
  return (
    <li className="pw-row">
      <div className="pw-line" title={p.description ?? p.title}>
        <span className="pw-title">{p.title}</span>
        {author && <span className="pw-author small muted">{author.displayName ?? author.username}</span>}
      </div>
      {p.experimentBranch && (
        <div className="pw-branch small muted" title="Experiment branch — prove it here, then inherit on accept">
          ⎇ {p.experimentBranch}
          {branch ? <span className="pw-branch-stat"> · +{branch.ahead}/-{branch.behind} vs main{branch.ahead > 0 ? ' ✓ proven' : ''}</span> : <span className="pw-branch-stat"> · not in repo yet</span>}
        </div>
      )}
      <div className="pw-actions">
        {VOTES.map(({ v, icon, title }) => (
          <button key={v} className={`vote-btn ${myVote === v ? 'mine' : ''}`} title={`${title} — ${p.tally[v]} so far`} disabled={vote.isPending} onClick={() => vote.mutate(v)}>
            {icon} <span className="tally">{p.tally[v]}</span>
          </button>
        ))}
        <button className="link-btn pw-discuss" title="Discuss inline" onClick={() => setOpen((o) => !o)}>💬 {p.commentCount}{open ? ' ▾' : ' ▸'}</button>
      </div>
      <div className="pw-status">
        <button className="link-btn" title="Accept → auto-creates tasks + an ADR (+ publishes its code to the reuse kit)" disabled={status.isPending} onClick={() => status.mutate('accepted')}>✓ accept</button>
        <button className="link-btn" disabled={status.isPending} onClick={() => status.mutate('rejected')}>✕ reject</button>
        <button className="link-btn" disabled={status.isPending} onClick={() => status.mutate('withdrawn')}>withdraw</button>
        {status.data?.adopted && <span className="small adopted-note">✓ adopted — {status.data.adopted.tasks} tasks{status.data.adopted.pattern ? ' + pattern' : ''}</span>}
      </div>
      {open && <Thread targetType="proposal" targetId={p.id} />}
    </li>
  );
}

export function ProposalsWidget() {
  const meId = useStore((s) => s.meId);
  const { data: proposals = [] } = useQuery({ queryKey: ['proposals'], queryFn: () => api<Proposal[]>('/proposals') });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const open = proposals.filter((p) => p.status === 'open');
  // branch proof status — only fetched when a proposal actually names an experiment branch
  const { data: branches = [] } = useQuery({ queryKey: ['branches'], queryFn: getBranches, enabled: open.some((p) => !!p.experimentBranch), refetchInterval: 30000 });

  return (
    <section className="panel widget proposals-widget" title="Vote and discuss open proposals inline — no page change">
      <h2>🗳️ Proposals <span className="small muted">{open.length} open · vote &amp; discuss inline</span></h2>
      <NewProposal meId={meId} />
      {open.length === 0 ? (
        <p className="muted small">No open proposals — raise one above.</p>
      ) : (
        <ul className="pw-list">
          {open.map((p) => <Row key={p.id} p={p} users={users} meId={meId} branches={branches} />)}
        </ul>
      )}
    </section>
  );
}
