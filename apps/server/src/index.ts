import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { apiRoutes } from './routes/api';
import { publicProjectRoutes } from './routes/projects';
import { hookRoutes } from './routes/hooks';
import { mcpRoutes } from './routes/mcp';
import { wsRoute, websocket } from './ws';
import { startDbListener } from './db/listener';
import { refreshOwnership } from './ownership';
import { pollGitAll } from './git-poll';
import { checkIdle } from './idle';

// ── Team Coder server (Bun runtime) ──────────────────────────────────────────
// Mounts: /health, /api (REST, team-token gated), /ws (WebSocket fan-out).
// Realtime spine: Postgres LISTEN/NOTIFY -> in-process bus -> WebSocket.
// Later phases add /hooks (ingest) and /mcp (MCP server).

// In production / single-origin mode the server also serves the built web app,
// so one port (bound to all interfaces) handles the SPA + API + WS + MCP — ideal
// for LAN/VPN access and the container. WEB_DIST is relative to cwd (apps/server).
const WEB_DIST = process.env.WEB_DIST ?? '../web/dist';
const serveWeb = existsSync(resolve(WEB_DIST));

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'team-coder-server',
    runtime: `bun ${Bun.version}`,
    ts: Date.now(),
  }),
);

// Project creation is open (no token yet) and must be matched before the
// team-token-gated /api router, so register it first.
app.route('/api/projects', publicProjectRoutes);
app.route('/api', apiRoutes);
app.route('/hooks', hookRoutes);
app.route('/mcp', mcpRoutes);
app.get('/ws', wsRoute());

if (serveWeb) {
  // single-origin: serve built assets, with SPA fallback to index.html.
  // Registered after the API routes so those always win.
  app.use('*', serveStatic({ root: WEB_DIST }));
  app.get('*', serveStatic({ path: 'index.html', root: WEB_DIST }));
} else {
  app.get('/', (c) => c.text('Team Coder server — see /health. (Web is served here in production; in dev use the Vite server.)'));
}

const port = Number(process.env.PORT ?? 6300);

// Start the realtime DB listener. Non-fatal if the DB is down so /health still
// answers and the process stays up.
startDbListener().catch((err) =>
  console.error('[listener] failed to start (is the DB up?):', err?.message ?? err),
);

// Recompute + broadcast auto-inferred ownership every 30s (and once at boot).
const OWNERSHIP_POLL_MS = 30_000;
const tick = () => refreshOwnership().catch((err) => console.error('[ownership] refresh failed:', err?.message ?? err));
setInterval(tick, OWNERSHIP_POLL_MS);
tick();

// Poll the product repo (if configured) for git ground-truth; refresh ownership
// when new commits land. No-op when PRODUCT_REPO_URL/PATH is unset.
const GIT_POLL_MS = Number(process.env.PRODUCT_REPO_POLL_SECONDS ?? 300) * 1000;
const gitTick = () =>
  pollGitAll()
    .then((results) => { if (results.some((r) => r.newCommits > 0)) refreshOwnership(); })
    .catch((err) => console.error('[git-poll] failed:', err?.message ?? err));
setInterval(gitTick, GIT_POLL_MS);
gitTick();

// Detect agents that went quiet and emit an idle alert (feed event). Every 60s.
const idleTick = () => checkIdle().catch((err) => console.error('[idle] check failed:', err?.message ?? err));
setInterval(idleTick, 60_000);
idleTick();

console.log(`[team-coder] server listening on http://0.0.0.0:${port}`);
if (serveWeb) console.log(`[team-coder] serving web app (single-origin) from ${resolve(WEB_DIST)}`);

// Bun serves this default export; `websocket` wires the WS handler.
export default {
  port,
  fetch: app.fetch,
  websocket,
};
