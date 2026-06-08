import { Hono } from 'hono';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import type { Project } from '../auth';
import { pushFeed } from '../feed';
import { page } from '../lib/paginate';

// The reuse-kit: a shared library of reusable code patterns the team publishes so
// nobody rebuilds the same thing twice. Patterns also arrive here automatically
// when a proposal carrying a reference implementation is adopted. Project-scoped;
// the code_patterns trigger broadcasts PATTERN_ADDED so the kit updates live.

export const patternRoutes = new Hono<{ Variables: { project: Project } }>();

// list the reuse kit; optional ?q= full-text-ish search over title/description/tags
patternRoutes.get('/', async (c) => {
  const pid = c.get('project').id;
  const q = c.req.query('q')?.trim();
  const { limit, offset } = page(c, 200);
  const search = q
    ? or(ilike(schema.codePatterns.title, `%${q}%`), ilike(schema.codePatterns.description, `%${q}%`), sql`${schema.codePatterns.tags}::text ilike ${`%${q}%`}`)
    : undefined;
  return c.json(
    await db
      .select()
      .from(schema.codePatterns)
      .where(and(eq(schema.codePatterns.projectId, pid), search))
      .orderBy(desc(schema.codePatterns.createdAt))
      .limit(limit)
      .offset(offset),
  );
});

patternRoutes.post('/', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string; code?: string; description?: string; language?: string; tags?: string[]; authorId?: string;
  };
  if (!body.title?.trim()) return c.json({ error: 'title required' }, 400);
  if (!body.code?.trim()) return c.json({ error: 'code required' }, 400);
  // versioning: re-publishing a same-title pattern records a new version (history kept)
  const [{ v } = { v: 0 }] = await db
    .select({ v: sql<number>`coalesce(max(${schema.codePatterns.version}),0)` })
    .from(schema.codePatterns)
    .where(and(eq(schema.codePatterns.projectId, project.id), eq(schema.codePatterns.title, body.title.trim())));
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
      version: Number(v) + 1,
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
