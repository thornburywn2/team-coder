import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { teamAuth, type Project } from '../auth';
import { getConnection, getConnections } from '../connections';
import { recentFeed } from '../feed';
import { computeOwnership } from '../ownership';
import { buildReport } from '../report';
import { taskRoutes } from './tasks';

// Human portal REST. Read endpoints for initial hydration; the WebSocket keeps
// the client hot after load. All gated by a project's team token, which teamAuth
// resolves to a project — so every read here is scoped to that project.

export const apiRoutes = new Hono<{ Variables: { project: Project } }>();

apiRoutes.use('*', teamAuth);

// the project this token belongs to (name / repo / PRD) — for the board header
apiRoutes.get('/projects/current', (c) => c.json(c.get('project')));

// live activity feed (in-memory ring buffer, most-recent-first), this project only
apiRoutes.get('/feed', (c) => c.json(recentFeed(c.get('project').id)));

apiRoutes.get('/presence', async (c) =>
  c.json(await db.select().from(schema.userPresence).where(eq(schema.userPresence.projectId, c.get('project').id))),
);

// auto-inferred module ownership (live, computed on demand)
apiRoutes.get('/modules/ownership', async (c) => c.json(await computeOwnership(c.get('project').id)));

// contribution report (who built what — for during + after the hackathon)
apiRoutes.get('/report', async (c) => c.json(await buildReport(c.get('project').id, new Date().toISOString())));

apiRoutes.get('/users', async (c) =>
  c.json(
    await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        color: schema.users.color,
      })
      .from(schema.users)
      .where(eq(schema.users.projectId, c.get('project').id)),
  ),
);

// team-wide agent connection liveness (per coder: last MCP + hook activity)
apiRoutes.get('/connections', (c) => c.json(getConnections(c.get('project').id)));

// per-coder connect info: agent token + live connection status. Used by the
// "Connect your agent" screen to render copy-paste setup + a live indicator.
apiRoutes.get('/connect/:userId', async (c) => {
  const userId = c.req.param('userId');
  const [u] = await db
    .select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, agentToken: schema.users.agentToken })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.projectId, c.get('project').id)));
  if (!u) return c.json({ error: 'unknown coder' }, 404);
  return c.json({ ...u, connection: getConnection(userId) });
});

// project notes — anyone on the project can post; the project_notes trigger
// emits NOTE_ADDED over the WebSocket so the panel updates live for everyone.
apiRoutes.get('/notes', async (c) =>
  c.json(
    await db
      .select()
      .from(schema.projectNotes)
      .where(eq(schema.projectNotes.projectId, c.get('project').id))
      .orderBy(desc(schema.projectNotes.createdAt))
      .limit(100),
  ),
);

apiRoutes.post('/notes', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as { content?: string; authorId?: string };
  if (!body.content?.trim()) return c.json({ error: 'content required' }, 400);
  const [row] = await db
    .insert(schema.projectNotes)
    .values({ projectId: project.id, authorId: body.authorId ?? null, content: body.content.trim() })
    .returning();
  return c.json(row, 201);
});

// tasks: list / create / claim / done (taskRoutes reads the project from context)
apiRoutes.route('/tasks', taskRoutes);
