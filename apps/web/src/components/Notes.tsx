import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type Note, type User } from '../lib/api';
import { queryClient } from '../lib/query';
import { useStore } from '../store';

// Shared project notes — a lightweight scratchpad anyone on the project can post
// to (ideas, reminders, links). New notes arrive live via the NOTE_ADDED ws msg
// (the Dashboard dispatcher invalidates ['notes']).

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Notes() {
  const meId = useStore((s) => s.meId);
  const { data: notes = [] } = useQuery({ queryKey: ['notes'], queryFn: () => api<Note[]>('/notes') });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const [content, setContent] = useState('');

  const add = useMutation({
    mutationFn: (text: string) => api<Note>('/notes', { method: 'POST', body: JSON.stringify({ content: text, authorId: meId }) }),
    onSuccess: () => { setContent(''); queryClient.invalidateQueries({ queryKey: ['notes'] }); },
  });

  return (
    <section className="panel notes">
      <h2>Notes</h2>
      <form
        className="new-note"
        onSubmit={(e) => { e.preventDefault(); if (content.trim()) add.mutate(content.trim()); }}
      >
        <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Share a note with the team…" />
        <button disabled={!content.trim()}>Post</button>
      </form>
      <ul>
        {notes.length === 0 && <li className="muted">No notes yet — post the first.</li>}
        {notes.map((n) => {
          const author = n.authorId ? userById[n.authorId] : undefined;
          return (
            <li key={n.id}>
              <div className="note-head">
                <span className="dot sm" style={{ background: author?.color ?? '#888' }} />
                <span className="who">{author?.displayName ?? author?.username ?? 'someone'}</span>
                <span className="time">{ago(n.createdAt)}</span>
              </div>
              <p className="note-body">{n.content}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
