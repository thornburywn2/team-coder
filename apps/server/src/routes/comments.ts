import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { ENTITY_TYPE } from '@team-coder/shared';
import { db, schema } from '../db';
import type { Project } from '../auth';
import { pushFeed } from '../feed';

// Messaging: anchored discussion threads (NOT general chat). A comment always
// targets a task or proposal (polymorphic targetType/targetId), optionally
// replying to a parent. Project-scoped; the comments trigger broadcasts
// COMMENT_ADDED so threads update live for everyone.

export const commentRoutes = new Hono<{ Variables: { project: Project } }>();

// GET /api/comments?targetType=task&targetId=<uuid> — a target's thread, oldest first
commentRoutes.get('/', async (c) => {
  const pid = c.get('project').id;
  const targetType = c.req.query('targetType');
  const targetId = c.req.query('targetId');
  if (!targetType || !targetId) return c.json({ error: 'targetType and targetId required' }, 400);
  const rows = await db
    .select()
    .from(schema.comments)
    .where(and(eq(schema.comments.projectId, pid), eq(schema.comments.targetType, targetType as never), eq(schema.comments.targetId, targetId)))
    .orderBy(asc(schema.comments.createdAt));
  return c.json(rows);
});

commentRoutes.post('/', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as { targetType?: string; targetId?: string; parentId?: string; content?: string; authorId?: string };
  if (!body.targetType || !ENTITY_TYPE.includes(body.targetType as never)) return c.json({ error: 'invalid targetType' }, 400);
  if (!body.targetId) return c.json({ error: 'targetId required' }, 400);
  if (!body.content?.trim()) return c.json({ error: 'content required' }, 400);
  if (!body.authorId) return c.json({ error: 'authorId required' }, 400);
  // validate author belongs to this project (avoids a FK 500 on a stale id)
  const [author] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, body.authorId), eq(schema.users.projectId, project.id)));
  if (!author) return c.json({ error: 'unknown author — please log in again' }, 400);
  const [row] = await db
    .insert(schema.comments)
    .values({ projectId: project.id, authorId: body.authorId, targetType: body.targetType as never, targetId: body.targetId, parentId: body.parentId ?? null, content: body.content.trim() })
    .returning();

  const [u] = await db.select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username, color: schema.users.color }).from(schema.users).where(eq(schema.users.id, body.authorId));
  pushFeed(project.id, { developerId: u?.id, developer: u?.displayName ?? u?.username, color: u?.color ?? undefined, kind: 'comment', detail: `commented on a ${body.targetType}` });
  return c.json(row, 201);
});
