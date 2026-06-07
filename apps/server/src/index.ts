import { Hono } from 'hono';

// ── Team Coder server (Bun runtime) ──────────────────────────────────────────
// P0 scaffold: boots a Hono app with a health check so the foundation runs.
// Later phases mount: /hooks (ingest), /api (REST), /ws (WebSocket via
// createBunWebSocket from 'hono/bun'), and /mcp (MCP server).

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

const port = Number(process.env.PORT ?? 6300);

console.log(`[team-coder] server listening on http://localhost:${port}`);

// Bun picks up this default export and serves it.
export default {
  port,
  fetch: app.fetch,
};
