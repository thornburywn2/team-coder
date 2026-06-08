import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import type { Project } from '../auth';
import { pushFeed } from '../feed';

// The reuse-kit: a shared library of reusable code patterns the team publishes so
// nobody rebuilds the same thing twice. Patterns also arrive here automatically
// when a proposal carrying a reference implementation is adopted. Project-scoped;
// the code_patterns trigger broadcasts PATTERN_ADDED so the kit updates live.

export const patternRoutes = new Hono<{ Variables: { project: Project } }>();

patternRoutes.get('/', async (c) =>
  c.json(
    await db
      .select()
      .from(schema.codePatterns)
      .where(eq(schema.codePatterns.projectId, c.get('project').id))
      .orderBy(desc(schema.codePatterns.createdAt))
      .limit(200),
  ),
);

patternRoutes.post('/', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string; code?: string; description?: string; language?: string; tags?: string[]; authorId?: string;
  };
  if (!body.title?.trim()) return c.json({ error: 'title required' }, 400);
  if (!body.code?.trim()) return c.json({ error: 'code required' }, 400);
  const [row] = await db
    .insert(schema.codePatterns)
    .values({
      projectId: project.id,
      title: body.title.trim(),
      codeSnippet: body.code,
      description: body.description?.trim() || null,
      language: body.language?.trim() || null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      authorId: body.authorId ?? null,
    })
    .returning();
  if (body.authorId) {
    const [u] = await db.select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username, color: schema.users.color }).from(schema.users).where(and(eq(schema.users.id, body.authorId), eq(schema.users.projectId, project.id)));
    pushFeed(project.id, { developerId: u?.id, developer: u?.displayName ?? u?.username, color: u?.color ?? undefined, kind: 'pattern', detail: `shared pattern: ${row!.title}` });
  }
  return c.json(row, 201);
});

patternRoutes.delete('/:id', async (c) => {
  const project = c.get('project');
  const [row] = await db
    .delete(schema.codePatterns)
    .where(and(eq(schema.codePatterns.id, c.req.param('id')), eq(schema.codePatterns.projectId, project.id)))
    .returning({ id: schema.codePatterns.id });
  if (!row) return c.json({ error: 'pattern not found' }, 404);
  return c.json({ ok: true });
});
