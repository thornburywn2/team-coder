import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, createPattern, deletePattern, listPatterns, type Pattern, type User } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { queryClient } from '../lib/query';
import { useStore } from '../store';

// The reuse-kit: a browsable library of reusable code patterns. Coders pull from
// it before rebuilding; adopted proposals auto-publish here. Live via PATTERN_ADDED.

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="copy-btn" onClick={async () => { const ok = await copyText(text); setCopied(ok); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? 'copied ✓' : 'copy'}
    </button>
  );
}

function NewPattern({ meId }: { meId: string | null }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('');
  const [tags, setTags] = useState('');
  const [code, setCode] = useState('');
  const create = useMutation({
    mutationFn: () => createPattern({ title: title.trim(), code, language: language.trim() || undefined, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }, meId),
    onSuccess: () => { setTitle(''); setLanguage(''); setTags(''); setCode(''); setOpen(false); queryClient.invalidateQueries({ queryKey: ['patterns'] }); },
  });
  if (!open) return <button className="gen-btn" onClick={() => setOpen(true)}>+ Publish a pattern</button>;
  return (
    <form className="new-pattern panel" onSubmit={(e) => { e.preventDefault(); if (title.trim() && code.trim()) create.mutate(); }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Pattern title (what it does / when to use)" />
      <div className="np-row">
        <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="language (e.g. ts)" />
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma separated" />
      </div>
      <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={8} placeholder="paste the reusable code…" />
      <div className="prd-actions">
        <button className="primary" disabled={!title.trim() || !code.trim() || create.isPending}>{create.isPending ? 'Publishing…' : 'Publish'}</button>
        <button type="button" className="link-btn" onClick={() => setOpen(false)}>cancel</button>
      </div>
    </form>
  );
}

function Card({ p, author }: { p: Pattern; author?: User }) {
  const del = useMutation({ mutationFn: () => deletePattern(p.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['patterns'] }) });
  return (
    <section className="panel pattern">
      <div className="pat-head">
        <strong className="pat-title">{p.title}</strong>
        {p.language && <span className="pat-lang">{p.language}</span>}
        {author && <span className="owner"><span className="dot sm" style={{ background: author.color ?? '#888' }} />{author.displayName ?? author.username}</span>}
        <button className="link-btn pat-del" onClick={() => del.mutate()}>delete</button>
      </div>
      {p.description && <p className="pat-desc">{p.description}</p>}
      {p.tags?.length > 0 && <div className="pat-tags">{p.tags.map((t) => <span key={t} className="task-tag">{t}</span>)}</div>}
      <div className="codeblock">
        <pre>{p.codeSnippet}</pre>
        <CopyButton text={p.codeSnippet} />
      </div>
    </section>
  );
}

export function Patterns() {
  const meId = useStore((s) => s.meId);
  const { data: patterns = [] } = useQuery({ queryKey: ['patterns'], queryFn: listPatterns });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const [filter, setFilter] = useState('');

  const allTags = useMemo(() => [...new Set(patterns.flatMap((p) => p.tags ?? []))].sort(), [patterns]);
  const shown = filter ? patterns.filter((p) => p.tags?.includes(filter)) : patterns;

  return (
    <div className="patterns-view">
      <div className="proposals-head">
        <h2>Reuse kit <span className="small muted">shared code patterns — pull before you rebuild</span></h2>
        <NewPattern meId={meId} />
      </div>
      {allTags.length > 0 && (
        <div className="pat-filter">
          <button className={`tag-pill ${filter === '' ? 'on' : ''}`} onClick={() => setFilter('')}>all</button>
          {allTags.map((t) => <button key={t} className={`tag-pill ${filter === t ? 'on' : ''}`} onClick={() => setFilter(t)}>{t}</button>)}
        </div>
      )}
      {shown.length === 0 && <p className="muted">No patterns yet — publish one, or adopt a proposal that carries a reference implementation.</p>}
      {shown.map((p) => <Card key={p.id} p={p} author={p.authorId ? userById[p.authorId] : undefined} />)}
    </div>
  );
}
