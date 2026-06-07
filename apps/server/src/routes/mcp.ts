import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import { devAuth, type Developer } from '../auth';
import { createMcpServer } from '../mcp/server';

// MCP endpoint (Streamable HTTP). Each coder's agent connects with its personal
// Bearer token; the server is created per request bound to that developer so all
// reads/writes are correctly attributed. Humans steer in the portal; agents pull
// live state here.

export const mcpRoutes = new Hono<{ Variables: { developer: Developer } }>();

mcpRoutes.use('*', devAuth);

mcpRoutes.all('/', async (c) => {
  const server = createMcpServer(c.get('developer'));
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  const res = await transport.handleRequest(c);
  return res ?? c.body(null, 204);
});
