import { Hono } from 'hono';
import { db, schema } from '../db';
import { teamAuth } from '../auth';
import { recentFeed } from '../feed';
import { taskRoutes } from './tasks';

// Human portal REST. Read endpoints for initial hydration; the WebSocket keeps
// the client hot after load. All gated by the shared team token.

export const apiRoutes = new Hono();

apiRoutes.use('*', teamAuth);

// live activity feed (in-memory ring buffer, most-recent-first)
apiRoutes.get('/feed', (c) => c.json(recentFeed()));

apiRoutes.get('/presence', async (c) => c.json(await db.select().from(schema.userPresence)));

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

// tasks: list / create / claim / done
apiRoutes.route('/tasks', taskRoutes);
