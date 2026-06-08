import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, createProposal, setProposalStatus, voteProposal, type Decision, type Proposal, type ProposalStatus, type User, type VoteValue } from '../lib/api';
import { queryClient } from '../lib/query';
import { useStore } from '../store';
import { Thread } from './Thread';

// Proposals = the collective design-evolution channel. Anyone raises an idea /
// direction change (optionally tied to an experiment branch), the team votes, and
// discussion lives in the proposal's thread. Live via PROPOSAL_UPDATED/VOTE_CAST.

const VOTES: { v: VoteValue; label: string }[] = [
  { v: 'approve', label: '👍 Approve' },
  { v: 'reject', label: '👎 Reject' },
  { v: 'abstain', label: '🤷 Abstain' },
];
const NEXT: { s: ProposalStatus; label: string }[] = [
  { s: 'accepted', label: 'Accept' },
  { s: 'rejected', label: 'Reject' },
  { s: 'withdrawn', label: 'Withdraw' },
];

function NewProposal({ meId }: { meId: string | null }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [branch, setBranch] = useState('');
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('');
  const create = useMutation({
    mutationFn: () => createProposal({ title: title.trim(), description: description.trim() || undefined, experimentBranch: branch.trim() || undefined, codeSnippet: code.trim() || undefined, language: language.trim() || undefined }, meId),
    onSuccess: () => { setTitle(''); setDescription(''); setBranch(''); setCode(''); setLanguage(''); setOpen(false); queryClient.invalidateQueries({ queryKey: ['proposals'] }); },
  });
  if (!open) return <button className="gen-btn" onClick={() => setOpen(true)}>+ New proposal</button>;
  return (
    <form className="new-proposal panel" onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(); }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Proposal title (the idea / change)" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Why? What changes? Use a checklist for adoption tasks. (optional)" />
      <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="experiment branch (optional, e.g. exp/new-router)" />
      <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={4} placeholder="reference implementation — published to the reuse kit on adoption (optional)" />
      {code.trim() && <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="language for the snippet (e.g. ts)" />}
      <div className="prd-actions">
        <button className="primary" disabled={!title.trim() || create.isPending}>{create.isPending ? 'Posting…' : 'Post proposal'}</button>
        <button type="button" className="link-btn" onClick={() => setOpen(false)}>cancel</button>
      </div>
    </form>
  );
}

function Card({ p, users, meId }: { p: Proposal; users: User[]; meId: string | null }) {
  const [showThread, setShowThread] = useState(false);
  const [adopted, setAdopted] = useState<{ tasks: number; pattern: boolean } | null>(null);
  const author = users.find((u) => u.id === p.authorId);
  const myVote = p.votes.find((v) => v.voterId === meId)?.vote;
  const vote = useMutation({ mutationFn: (v: VoteValue) => voteProposal(p.id, v, meId), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['proposals'] }) });
  const status = useMutation({
    mutationFn: (s: ProposalStatus) => setProposalStatus(p.id, s, meId),
    onSuccess: (res) => {
      if (res.adopted) {
        setAdopted({ tasks: res.adopted.tasks, pattern: res.adopted.pattern });
        queryClient.invalidateQueries({ queryKey: ['decisions'] });
        if (res.adopted.pattern) queryClient.invalidateQueries({ queryKey: ['patterns'] });
      }
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return (
    <section className="panel proposal">
      <div className="prop-head">
        <span className={`badge prop-${p.status}`}>{p.status}</span>
        <strong className="prop-title">{p.title}</strong>
        {author && <span className="owner"><span className="dot sm" style={{ background: author.color ?? '#888' }} />{author.displayName ?? author.username}</span>}
      </div>
      {p.description && <p className="prop-desc">{p.description}</p>}
      {p.experimentBranch && <code className="prop-branch">⎇ {p.experimentBranch}</code>}
      {p.codeSnippet && <pre className="prop-code">{p.codeSnippet}</pre>}
      <div className="prop-votes">
        {VOTES.map(({ v, label }) => (
          <button key={v} className={`vote-btn ${myVote === v ? 'mine' : ''}`} disabled={vote.isPending} onClick={() => vote.mutate(v)}>
            {label} <span className="tally">{p.tally[v]}</span>
          </button>
        ))}
      </div>
      {adopted !== null && <p className="adopted-note">✓ Adopted — created {adopted.tasks} task{adopted.tasks === 1 ? '' : 's'}{adopted.pattern ? ' + published a reuse-kit pattern' : ''}.</p>}
      <div className="prop-actions">
        <button className="link-btn" onClick={() => setShowThread((s) => !s)}>💬 {p.commentCount} {showThread ? '▾' : '▸'}</button>
        {p.status === 'open' && (
          <span className="status-actions">
            {NEXT.map(({ s, label }) => <button key={s} className="link-btn" disabled={status.isPending} onClick={() => status.mutate(s)}>{label}</button>)}
          </span>
        )}
      </div>
      {showThread && <Thread targetType="proposal" targetId={p.id} />}
    </section>
  );
}

function Decisions() {
  const { data: decisions = [] } = useQuery({ queryKey: ['decisions'], queryFn: () => api<Decision[]>('/decisions') });
  if (decisions.length === 0) return null;
  return (
    <section className="panel decisions">
      <h2>Decisions of record <span className="small muted">ADRs — don't relitigate</span></h2>
      <ul>
        {decisions.map((d) => (
          <li key={d.id}><span className="adr-seq">ADR-{d.seq}</span> <strong>{d.title}</strong></li>
        ))}
      </ul>
    </section>
  );
}

export function Proposals() {
  const meId = useStore((s) => s.meId);
  const { data: proposals = [] } = useQuery({ queryKey: ['proposals'], queryFn: () => api<Proposal[]>('/proposals') });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });

  return (
    <div className="proposals-view">
      <div className="proposals-head">
        <h2>Proposals <span className="small muted">ideas & design changes — vote and discuss</span></h2>
        <NewProposal meId={meId} />
      </div>
      {proposals.length === 0 && <p className="muted">No proposals yet — raise the first idea.</p>}
      {proposals.map((p) => <Card key={p.id} p={p} users={users} meId={meId} />)}
      <Decisions />
    </div>
  );
}
