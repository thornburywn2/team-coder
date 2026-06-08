import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, listComments, postComment, type Comment, type User } from '../lib/api';
import { queryClient } from '../lib/query';
import { useStore } from '../store';

// A discussion thread anchored to a task or proposal. Reused everywhere messaging
// appears. Live: the Dashboard invalidates ['comments', type, id] on COMMENT_ADDED.
// Threading is one level (replies fold under their parent) to keep it readable.

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Line({ c, author }: { c: Comment; author?: User }) {
  return (
    <li className="cmt">
      <span className="dot sm" style={{ background: author?.color ?? '#888' }} />
      <span className="who">{author?.displayName ?? author?.username ?? 'someone'}</span>
      <span className="cmt-body">{c.content}</span>
      <span className="time">{ago(c.createdAt)}</span>
    </li>
  );
}

export function Thread({ targetType, targetId }: { targetType: string; targetId: string }) {
  const meId = useStore((s) => s.meId);
  const { data: comments = [] } = useQuery({ queryKey: ['comments', targetType, targetId], queryFn: () => listComments(targetType, targetId) });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const [text, setText] = useState('');

  const add = useMutation({
    mutationFn: (content: string) => postComment(targetType, targetId, content, meId),
    onSuccess: () => { setText(''); queryClient.invalidateQueries({ queryKey: ['comments', targetType, targetId] }); },
  });

  const roots = comments.filter((c) => !c.parentId);
  const childrenOf = (id: string) => comments.filter((c) => c.parentId === id);

  return (
    <div className="thread">
      <ul className="cmts">
        {comments.length === 0 && <li className="muted small">No comments yet.</li>}
        {roots.map((c) => (
          <div key={c.id}>
            <Line c={c} author={userById[c.authorId]} />
            {childrenOf(c.id).map((ch) => (
              <ul key={ch.id} className="cmts nested"><Line c={ch} author={userById[ch.authorId]} /></ul>
            ))}
          </div>
        ))}
      </ul>
      <form className="new-cmt" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(text.trim()); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" />
        <button disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
