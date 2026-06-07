import { Hono } from 'hono';
import { apiRoutes } from './routes/api';
import { hookRoutes } from './routes/hooks';
import { wsRoute, websocket } from './ws';
import { startDbListener } from './db/listener';
import { refreshOwnership } from './ownership';

// ── Team Coder server (Bun runtime) ──────────────────────────────────────────
// Mounts: /health, /api (REST, team-token gated), /ws (WebSocket fan-out).
// Realtime spine: Postgres LISTEN/NOTIFY -> in-process bus -> WebSocket.
// Later phases add /hooks (ingest) and /mcp (MCP server).

const app = new Hono();

app.get('/', (c) => c.text('Team Coder server — see /health'));

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'team-coder-server',
    runtime: `bun ${Bun.version}`,
    ts: Date.now(),
  }),
);

app.route('/api', apiRoutes);
app.route('/hooks', hookRoutes);
app.get('/ws', wsRoute());

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

console.log(`[team-coder] server listening on http://localhost:${port}`);

// Bun serves this default export; `websocket` wires the WS handler.
export default {
  port,
  fetch: app.fetch,
  websocket,
};
