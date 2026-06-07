import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import type { Project } from '../auth';
import { pushFeed } from '../feed';

// Task list + soft, non-blocking claim/done. Claims never gate work — they just
// make ownership visible. The actor is identified by the userId in the body
// (the portal knows which coder you are after login). Every query is scoped to
// the request's project (set by teamAuth on the parent router).

export const taskRoutes = new Hono<{ Variables: { project: Project } }>();

taskRoutes.get('/', async (c) => {
  const project = c.get('project');
  return c.json(
    await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, project.id))
      .orderBy(desc(schema.tasks.createdAt)),
  );
});

taskRoutes.post('/', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    description?: string;
    moduleId?: string;
    reporterId?: string;
  };
  if (!body.title?.trim()) return c.json({ error: 'title required' }, 400);
  const [row] = await db
    .insert(schema.tasks)
    .values({
      projectId: project.id,
      title: body.title.trim(),
      description: body.description ?? null,
      moduleId: body.moduleId ?? null,
      reporterId: body.reporterId ?? null,
    })
    .returning();
  return c.json(row, 201);
});

async function actor(projectId: string, userId: string | undefined) {
  if (!userId) return null;
  const [u] = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username, color: schema.users.color })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.projectId, projectId)));
  return u ?? null;
}

taskRoutes.post('/:id/claim', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const { userId } = (await c.req.json().catch(() => ({}))) as { userId?: string };
  const [row] = await db
    .update(schema.tasks)
    .set({ assigneeId: userId ?? null, status: 'in_progress', updatedAt: new Date() })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.projectId, project.id)))
    .returning();
  if (!row) return c.json({ error: 'task not found' }, 404);
  const u = await actor(project.id, userId);
  pushFeed(project.id, {
    developerId: u?.id,
    developer: u?.displayName ?? u?.username,
    color: u?.color ?? undefined,
    kind: 'claim',
    detail: `claimed "${row.title}"`,
  });
  return c.json(row);
});

taskRoutes.post('/:id/done', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const { userId } = (await c.req.json().catch(() => ({}))) as { userId?: string };
  const [row] = await db
    .update(schema.tasks)
    .set({ status: 'done', updatedAt: new Date() })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.projectId, project.id)))
    .returning();
  if (!row) return c.json({ error: 'task not found' }, 404);
  const u = await actor(project.id, userId);
  pushFeed(project.id, {
    developerId: u?.id,
    developer: u?.displayName ?? u?.username,
    color: u?.color ?? undefined,
    kind: 'done',
    detail: `completed "${row.title}"`,
  });
  return c.json(row);
});
