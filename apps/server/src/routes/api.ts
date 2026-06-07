import { Hono } from 'hono';
import { desc } from 'drizzle-orm';
import { db, schema } from '../db';
import { teamAuth } from '../auth';

// Human portal REST. Read endpoints for initial hydration; the WebSocket keeps
// the client hot after load. All gated by the shared team token.

export const apiRoutes = new Hono();

apiRoutes.use('*', teamAuth);

apiRoutes.get('/tasks', async (c) =>
  c.json(await db.select().from(schema.tasks).orderBy(desc(schema.tasks.createdAt))),
);

apiRoutes.get('/feed', async (c) =>
  c.json(
    await db
      .select()
      .from(schema.activityEvents)
      .orderBy(desc(schema.activityEvents.createdAt))
      .limit(50),
  ),
);

apiRoutes.get('/presence', async (c) =>
  c.json(await db.select().from(schema.userPresence)),
);

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
