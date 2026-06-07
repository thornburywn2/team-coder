import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { StreamableHTTPTransport } from '@hono/mcp';
import { devAuth, type Developer } from '../auth';
import { createMcpServer } from '../mcp/server';
import { touchMcp } from '../connections';
import { db, schema } from '../db';

// MCP endpoint (Streamable HTTP). Each coder's agent connects with its personal
// Bearer token; the server is created per request bound to that developer so all
// reads/writes are correctly attributed. Humans steer in the portal; agents pull
// live state here.

export const mcpRoutes = new Hono<{ Variables: { developer: Developer } }>();

mcpRoutes.use('*', devAuth);

mcpRoutes.all('/', async (c) => {
  const dev = c.get('developer');
  // record liveness + light up presence so the agent shows as connected/active
  touchMcp(dev.id, dev.projectId);
  void db
    .update(schema.userPresence)
    .set({ status: 'active', lastSeen: new Date() })
    .where(eq(schema.userPresence.userId, dev.id))
    .catch(() => {});
  const server = createMcpServer(dev);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const res = await transport.handleRequest(c);
  return res ?? c.body(null, 204);
});
