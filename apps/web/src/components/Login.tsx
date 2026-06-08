import { useState } from 'react';
import { useStore } from '../store';
import { createProject, type CreatedProject, type User } from '../lib/api';
import { copyText } from '../lib/clipboard';

// Gate flow:
//   token  → enter a project's team token (validated by fetching /api/users)
//   create → make a brand-new project (mints a token + seeds coders)
//   created→ show the new project's token once (copy it!) then enter
//   pick   → choose which coder you are
// Matches the two-tier auth model; each project is isolated by its own token.

type Mode = 'token' | 'create' | 'created' | 'pick';

export function Login() {
  const setAuth = useStore((s) => s.setAuth);
  const [mode, setMode] = useState<Mode>('token');
  const [token, setToken] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Validate a token by loading the project's coders, then go pick one.
  async function enter(tk: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users', { headers: { 'x-team-token': tk } });
      if (!res.ok) throw new Error('Invalid team token');
      localStorage.setItem('tc_token', tk); // so api() works for the picker
      setToken(tk);
      setUsers((await res.json()) as User[]);
      setMode('pick');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1>Team Coder</h1>
        {mode === 'token' && (
          <TokenStep
            loading={loading}
            error={error}
            onSubmit={enter}
            onCreate={() => { setError(null); setMode('create'); }}
          />
        )}
        {mode === 'create' && (
          <CreateStep
            loading={loading}
            error={error}
            onBack={() => { setError(null); setMode('token'); }}
            onCreate={async (name, repo, members) => {
              setLoading(true);
              setError(null);
              try {
                const proj = await createProject(name, repo, members);
                setCreated(proj);
                setMode('created');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Create failed');
              } finally {
                setLoading(false);
              }
            }}
          />
        )}
        {mode === 'created' && created && (
          <CreatedStep project={created} loading={loading} onEnter={() => enter(created.token)} />
        )}
        {mode === 'pick' && (
          <PickStep users={users} onPick={(id) => setAuth(token, id)} />
        )}
      </div>
    </div>
  );
}

function TokenStep({ loading, error, onSubmit, onCreate }: { loading: boolean; error: string | null; onSubmit: (t: string) => void; onCreate: () => void }) {
  const [value, setValue] = useState('');
  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}>
        <label>Team token</label>
        <input autoFocus type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="your project's team token" />
        <button disabled={loading || !value}>{loading ? 'Checking…' : 'Continue'}</button>
        {error && <p className="error">{error}</p>}
      </form>
      <button className="link-btn" onClick={onCreate}>+ Create a new project</button>
    </>
  );
}

function CreateStep({ loading, error, onBack, onCreate }: { loading: boolean; error: string | null; onBack: () => void; onCreate: (name: string, repo: string, members: string[]) => void }) {
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  const [members, setMembers] = useState('');
  const parsed = members.split(/[\n,]/).map((m) => m.trim()).filter(Boolean);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && parsed.length) onCreate(name.trim(), repo.trim(), parsed); }}>
      <label>Project name</label>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hackathon Q3" />
      <label>Team members <span className="small muted">one per line or comma-separated (becomes the roster)</span></label>
      <textarea value={members} onChange={(e) => setMembers(e.target.value)} rows={4} placeholder={'Ada Lovelace\nGrace Hopper\nAlan Turing'} />
      <label>GitHub repo URL <span className="small muted">(optional — for git contribution tracking)</span></label>
      <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/org/repo.git" />
      <button disabled={loading || !name.trim() || !parsed.length}>{loading ? 'Creating…' : `Create project (${parsed.length} member${parsed.length === 1 ? '' : 's'})`}</button>
      {error && <p className="error">{error}</p>}
      <button type="button" className="link-btn" onClick={onBack}>← Back</button>
    </form>
  );
}

function CreatedStep({ project, loading, onEnter }: { project: CreatedProject; loading: boolean; onEnter: () => void }) {
  const [copied, setCopied] = useState('');
  const copy = async (label: string, text: string) => { if (await copyText(text)) { setCopied(label); setTimeout(() => setCopied(''), 1500); } };
  return (
    <div className="created">
      <p>Created <strong>{project.name}</strong> 🎉</p>
      <label>Team token <span className="small muted">— share with your team to log in. Won't be shown again.</span></label>
      <div className="codeblock">
        <pre>{project.token}</pre>
        <button onClick={() => copy('team', project.token)}>{copied === 'team' ? 'copied ✓' : 'copy'}</button>
      </div>
      {project.coders && project.coders.length > 0 && (
        <>
          <label>Per-coder agent tokens <span className="small muted">— give each teammate theirs (also in the Connect tab)</span></label>
          <ul className="created-coders">
            {project.coders.map((c) => (
              <li key={c.id}>
                <span className="who">{c.displayName ?? c.username}</span>
                <code>{c.agentToken}</code>
                <button className="link-btn" onClick={() => copy(c.id, c.agentToken)}>{copied === c.id ? 'copied ✓' : 'copy'}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button disabled={loading} onClick={onEnter}>{loading ? 'Entering…' : 'Enter project →'}</button>
    </div>
  );
}

function PickStep({ users, onPick }: { users: User[]; onPick: (id: string) => void }) {
  return (
    <div className="picker">
      <label>Who are you?</label>
      <div className="picker-list">
        {users.map((u) => (
          <button key={u.id} className="coder-pick" style={{ borderColor: u.color ?? '#888' }} onClick={() => onPick(u.id)}>
            <span className="dot" style={{ background: u.color ?? '#888' }} />
            {u.displayName ?? u.username}
          </button>
        ))}
      </div>
    </div>
  );
}
