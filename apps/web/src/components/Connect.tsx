import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ConnectInfo, type ConnectionStatus, type User } from '../lib/api';
import { useStore } from '../store';

// "Connect your agent" — shows the coder their token + exact copy-paste setup for
// the MCP server and hooks (pointed at whatever host the portal is served from),
// plus a LIVE indicator that flips when their agent first talks to the server.

const FRESH_MS = 60_000;
const fresh = (ts: number) => ts > 0 && Date.now() - ts < FRESH_MS;
const ago = (ts: number) => {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="codeblock">
      <pre>{text}</pre>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'copied ✓' : 'copy'}
      </button>
    </div>
  );
}

export function Connect() {
  const meId = useStore((s) => s.meId)!;
  const origin = window.location.origin;

  const { data: me } = useQuery({ queryKey: ['connect', meId], queryFn: () => api<ConnectInfo>(`/connect/${meId}`), refetchInterval: 3000 });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const { data: conns = [] } = useQuery({ queryKey: ['connections'], queryFn: () => api<ConnectionStatus[]>('/connections'), refetchInterval: 3000 });

  const token = me?.agentToken ?? '<your-agent-token>';
  const devId = me?.username ?? 'me';

  const mcpCmd = `claude mcp add --transport http team-coder ${origin}/mcp \\
  --header "Authorization: Bearer ${token}"`;

  const hooksJson = JSON.stringify(
    {
      hooks: Object.fromEntries(
        ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'SubagentStop'].map((ev) => [
          ev,
          [
            {
              ...(ev === 'PreToolUse' ? { matcher: 'Write|Edit|NotebookEdit' } : {}),
              hooks: [{ type: 'http', url: `${origin}/hooks/event`, timeout: 5, headers: { Authorization: `Bearer ${token}`, 'X-Developer-Id': devId } }],
            },
          ],
        ]),
      ),
    },
    null,
    2,
  );

  const mcpOn = fresh(me?.connection.lastMcp ?? 0);
  const hooksOn = fresh(me?.connection.lastHook ?? 0);
  const connected = mcpOn || hooksOn;
  const connById = new Map(conns.map((c) => [c.userId, c]));

  return (
    <div className="connect">
      <section className={`panel status-banner ${connected ? 'ok' : 'wait'}`}>
        <div className="status-big">
          <span className={`dot ${connected ? 'dot-active' : 'dot-idle'}`} style={{ background: connected ? 'var(--green)' : 'var(--amber)' }} />
          {connected ? 'Your agent is connected' : 'Waiting for your agent…'}
        </div>
        <div className="lanes-status">
          <span>MCP: {mcpOn ? `connected ✓ (${ago(me!.connection.lastMcp)})` : 'not detected'}</span>
          <span>Hooks: {hooksOn ? `streaming ✓ (${ago(me!.connection.lastHook)})` : 'not detected'}</span>
        </div>
        <p className="muted small">Connected after your agent's first MCP call or hook — start working, or ask it to run <code>get_my_tasks</code>.</p>
      </section>

      <section className="panel">
        <h2>You are <strong>{me?.displayName ?? devId}</strong></h2>
        <label className="muted small">Your agent token</label>
        <CodeBlock text={token} />
      </section>

      <section className="panel">
        <h2>1 · Connect the MCP server <span className="muted small">Claude Code / Code Puppy / any MCP client</span></h2>
        <p className="muted small">Run this inside your product repo. It registers the Team Coder tools (claim tasks, ownership, decisions, patterns).</p>
        <CodeBlock text={mcpCmd} />
        <p className="muted small">Claude Desktop / Code Puppy: add the same URL + Authorization header in their MCP config.</p>
      </section>

      <section className="panel">
        <h2>2 · Stream activity via hooks <span className="muted small">live board + feed</span></h2>
        <p className="muted small">Add to your product repo's <code>.claude/settings.json</code>, then commit + push so the team shares it.</p>
        <CodeBlock text={hooksJson} />
      </section>

      <section className="panel">
        <h2>Team connection status</h2>
        <ul className="conn-list">
          {users.map((u) => {
            const c = connById.get(u.id);
            const m = fresh(c?.lastMcp ?? 0);
            const h = fresh(c?.lastHook ?? 0);
            return (
              <li key={u.id}>
                <span className="dot sm" style={{ background: u.color ?? '#888' }} />
                <span className="who">{u.displayName ?? u.username}</span>
                <span className={`tag ${m ? 'on' : 'off'}`}>MCP</span>
                <span className={`tag ${h ? 'on' : 'off'}`}>hooks</span>
                <span className="time">{c && (c.lastMcp || c.lastHook) ? ago(Math.max(c.lastMcp, c.lastHook)) : '—'}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
