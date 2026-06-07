import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { teamAuth } from '../auth';
import { getConnection, getConnections } from '../connections';
import { recentFeed } from '../feed';
import { computeOwnership } from '../ownership';
import { buildReport } from '../report';
import { taskRoutes } from './tasks';

// Human portal REST. Read endpoints for initial hydration; the WebSocket keeps
// the client hot after load. All gated by the shared team token.

export const apiRoutes = new Hono();

apiRoutes.use('*', teamAuth);

// live activity feed (in-memory ring buffer, most-recent-first)
apiRoutes.get('/feed', (c) => c.json(recentFeed()));

apiRoutes.get('/presence', async (c) => c.json(await db.select().from(schema.userPresence)));

// auto-inferred module ownership (live, computed on demand)
apiRoutes.get('/modules/ownership', async (c) => c.json(await computeOwnership()));

// contribution report (who built what — for during + after the hackathon)
apiRoutes.get('/report', async (c) => c.json(await buildReport(new Date().toISOString())));

apiRoutes.get('/users', async (c) =>
  c.json(
    await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        color: schema.users.color,
      })
      .from(schema.users),
  ),
);

// team-wide agent connection liveness (per coder: last MCP + hook activity)
apiRoutes.get('/connections', (c) => c.json(getConnections()));

// per-coder connect info: agent token + live connection status. Used by the
// "Connect your agent" screen to render copy-paste setup + a live indicator.
apiRoutes.get('/connect/:userId', async (c) => {
  const userId = c.req.param('userId');
  const [u] = await db
    .select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, agentToken: schema.users.agentToken })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!u) return c.json({ error: 'unknown coder' }, 404);
  return c.json({ ...u, connection: getConnection(userId) });
});

// tasks: list / create / claim / done
apiRoutes.route('/tasks', taskRoutes);
