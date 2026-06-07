import { useState } from 'react';
import { useStore } from '../store';
import type { User } from '../lib/api';

// Two-step gate: enter the shared team token (validated by fetching /api/users),
// then pick which coder you are. Matches the two-tier auth model.

export function Login() {
  const setAuth = useStore((s) => s.setAuth);
  const [token, setToken] = useState('');
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function checkToken(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/users', { headers: { 'x-team-token': token } });
      if (!res.ok) throw new Error('Invalid team token');
      localStorage.setItem('tc_token', token); // so api() works for the picker
      setUsers((await res.json()) as User[]);
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
        {!users ? (
          <form onSubmit={checkToken}>
            <label>Team token</label>
            <input
              autoFocus
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="shared team passphrase"
            />
            <button disabled={loading || !token}>{loading ? 'Checking…' : 'Continue'}</button>
            {error && <p className="error">{error}</p>}
          </form>
        ) : (
          <div className="picker">
            <label>Who are you?</label>
            <div className="picker-list">
              {users.map((u) => (
                <button
                  key={u.id}
                  className="coder-pick"
                  style={{ borderColor: u.color ?? '#888' }}
                  onClick={() => setAuth(token, u.id)}
                >
                  <span className="dot" style={{ background: u.color ?? '#888' }} />
                  {u.displayName ?? u.username}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
