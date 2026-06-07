import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { and, desc, eq, ilike, ne, or } from 'drizzle-orm';
import { TASK_STATUS } from '@team-coder/shared';
import { db, schema } from '../db';
import type { Developer } from '../auth';
import { computeOwnership } from '../ownership';
import { pushFeed } from '../feed';

// Per-request MCP server bound to the authenticated coder. Read tools give the
// agent live project state; write tools let the agent report progress / claim
// work / contribute decisions+patterns. Every write hits Postgres, whose triggers
// broadcast the change to the human portal — so agent actions show up live.
// All responses are field-filtered to keep the agent's token budget small.

function text(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

const TASK_FIELDS = {
  id: schema.tasks.id,
  title: schema.tasks.title,
  status: schema.tasks.status,
  moduleId: schema.tasks.moduleId,
  assigneeId: schema.tasks.assigneeId,
};

export function createMcpServer(dev: Developer): McpServer {
  const server = new McpServer({ name: 'team-coder', version: '1.0.0' });
  const me = dev.displayName ?? dev.username;

  // ── READ ───────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_my_tasks',
    { description: 'Tasks currently assigned to you that are not done.', inputSchema: {} },
    async () => {
      const rows = await db
        .select(TASK_FIELDS)
        .from(schema.tasks)
        .where(and(eq(schema.tasks.assigneeId, dev.id), ne(schema.tasks.status, 'done')));
      return text(rows);
    },
  );

  server.registerTool(
    'get_module_context',
    {
      description: 'Owner + active tasks for a module (by name or path prefix). Check before starting work.',
      inputSchema: { module: z.string().describe('module name or path prefix, e.g. "backend" or "apps/server/"') },
    },
    async ({ module }) => {
      const ownership = await computeOwnership();
      const mod = ownership.find((m) => m.name === module || m.pathPrefix === module || m.pathPrefix.startsWith(module));
      if (!mod) return text({ error: `no module matching "${module}"` });
      const tasks = await db
        .select(TASK_FIELDS)
        .from(schema.tasks)
        .where(and(eq(schema.tasks.moduleId, mod.moduleId), ne(schema.tasks.status, 'done')));
      return text({ module: mod.name, pathPrefix: mod.pathPrefix, owner: mod.ownerName, inferred: mod.inferred, contributors: mod.contributors, activeTasks: tasks });
    },
  );

  server.registerTool(
    'get_shared_patterns',
    { description: 'Reusable code patterns the team has published. Use one before writing from scratch.', inputSchema: { tag: z.string().optional() } },
    async ({ tag }) => {
      const rows = await db
        .select({ id: schema.codePatterns.id, title: schema.codePatterns.title, description: schema.codePatterns.description, language: schema.codePatterns.language, tags: schema.codePatterns.tags, code: schema.codePatterns.codeSnippet })
        .from(schema.codePatterns)
        .orderBy(desc(schema.codePatterns.createdAt))
        .limit(25);
      const filtered = tag ? rows.filter((r) => r.tags?.includes(tag)) : rows;
      return text(filtered);
    },
  );

  server.registerTool(
    'get_team_decisions',
    { description: 'Recent architecture decisions (ADRs). Do not relitigate a settled decision.', inputSchema: {} },
    async () => {
      const rows = await db
        .select({ id: schema.adrs.id, seq: schema.adrs.sequenceNum, title: schema.adrs.title, decision: schema.adrs.decision, status: schema.adrs.status })
        .from(schema.adrs)
        .orderBy(desc(schema.adrs.createdAt))
        .limit(20);
      return text(rows);
    },
  );

  server.registerTool(
    'search_tasks',
    { description: 'Search tasks by text and/or status.', inputSchema: { query: z.string().optional(), status: z.enum(TASK_STATUS).optional() } },
    async ({ query, status }) => {
      const conds = [];
      if (query) conds.push(ilike(schema.tasks.title, `%${query}%`));
      if (status) conds.push(eq(schema.tasks.status, status));
      const rows = await db
        .select(TASK_FIELDS)
        .from(schema.tasks)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.tasks.createdAt))
        .limit(25);
      return text(rows);
    },
  );

  // ── WRITE ──────────────────────────────────────────────────────────────────
  const feedBase = { developerId: dev.id, developer: me, color: dev.color ?? undefined };

  server.registerTool(
    'create_task',
    {
      description: 'Create a new task on the board — e.g. work you discovered or are breaking down. Optionally tie it to a module (by name or path prefix).',
      inputSchema: { title: z.string(), description: z.string().optional(), module: z.string().optional() },
    },
    async ({ title, description, module }) => {
      let moduleId: string | null = null;
      if (module) {
        const [m] = await db
          .select({ id: schema.modules.id })
          .from(schema.modules)
          .where(or(eq(schema.modules.name, module), eq(schema.modules.pathPrefix, module)));
        moduleId = m?.id ?? null;
      }
      const [row] = await db
        .insert(schema.tasks)
        .values({ title, description: description ?? null, moduleId, reporterId: dev.id })
        .returning(TASK_FIELDS);
      pushFeed({ ...feedBase, kind: 'created', detail: `created "${row!.title}"` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'edit_task',
    {
      description: "Edit a task's title and/or description (rename or reword).",
      inputSchema: { task_id: z.string(), title: z.string().optional(), description: z.string().optional() },
    },
    async ({ task_id, title, description }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (title !== undefined) patch['title'] = title;
      if (description !== undefined) patch['description'] = description;
      const [row] = await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, task_id)).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      pushFeed({ ...feedBase, kind: 'created', detail: `edited "${row.title}"` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'claim_task',
    { description: 'Claim a task for yourself (soft, non-blocking). Marks it in_progress.', inputSchema: { task_id: z.string() } },
    async ({ task_id }) => {
      const [row] = await db.update(schema.tasks).set({ assigneeId: dev.id, status: 'in_progress', updatedAt: new Date() }).where(eq(schema.tasks.id, task_id)).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      pushFeed({ ...feedBase, kind: 'claim', detail: `claimed "${row.title}"` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'update_task_progress',
    { description: 'Update a task status and optionally add a progress note.', inputSchema: { task_id: z.string(), status: z.enum(TASK_STATUS), note: z.string().optional() } },
    async ({ task_id, status, note }) => {
      const [row] = await db.update(schema.tasks).set({ status, updatedAt: new Date() }).where(eq(schema.tasks.id, task_id)).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      pushFeed({ ...feedBase, kind: status === 'done' ? 'done' : 'claim', detail: `${status.replace('_', ' ')}: "${row.title}"${note ? ` — ${note}` : ''}` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'complete_task',
    { description: 'Mark a task done with a short summary of what you did.', inputSchema: { task_id: z.string(), summary: z.string().optional() } },
    async ({ task_id, summary }) => {
      const [row] = await db.update(schema.tasks).set({ status: 'done', updatedAt: new Date() }).where(eq(schema.tasks.id, task_id)).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      pushFeed({ ...feedBase, kind: 'done', detail: `completed "${row.title}"${summary ? ` — ${summary}` : ''}` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'flag_blocker',
    { description: 'Flag a task as blocked with a reason so the team sees it.', inputSchema: { task_id: z.string(), reason: z.string() } },
    async ({ task_id, reason }) => {
      const [row] = await db.update(schema.tasks).set({ status: 'blocked', updatedAt: new Date() }).where(eq(schema.tasks.id, task_id)).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      pushFeed({ ...feedBase, kind: 'blocked', detail: `blocked "${row.title}": ${reason}` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'post_decision',
    { description: 'Record an architecture decision (ADR) so the team does not relitigate it.', inputSchema: { title: z.string(), context: z.string(), decision: z.string(), consequences: z.string().optional() } },
    async ({ title, context, decision, consequences }) => {
      const [row] = await db.insert(schema.adrs).values({ title, context, decision, consequences: consequences ?? null, status: 'accepted', authorId: dev.id }).returning({ id: schema.adrs.id, seq: schema.adrs.sequenceNum });
      pushFeed({ ...feedBase, kind: 'decision', detail: `decision: ${title}` });
      return text({ ok: true, adr: row });
    },
  );

  server.registerTool(
    'add_shared_pattern',
    { description: 'Publish a reusable code pattern so teammates do not rebuild it.', inputSchema: { title: z.string(), code: z.string(), description: z.string().optional(), language: z.string().optional(), tags: z.array(z.string()).optional() } },
    async ({ title, code, description, language, tags }) => {
      const [row] = await db.insert(schema.codePatterns).values({ title, codeSnippet: code, description: description ?? null, language: language ?? null, tags: tags ?? [], authorId: dev.id }).returning({ id: schema.codePatterns.id });
      pushFeed({ ...feedBase, kind: 'pattern', detail: `shared pattern: ${title}` });
      return text({ ok: true, pattern: row });
    },
  );

  // ── RESOURCES (host auto-loads; lightweight snapshots) ───────────────────────
  server.registerResource(
    'project-state',
    'project://state',
    { description: 'Live project snapshot: open task count, blockers, recent decisions, module owners.', mimeType: 'application/json' },
    async (uri) => {
      const [tasks, ownership, decisions] = await Promise.all([
        db.select(TASK_FIELDS).from(schema.tasks).where(ne(schema.tasks.status, 'done')),
        computeOwnership(),
        db.select({ title: schema.adrs.title, decision: schema.adrs.decision }).from(schema.adrs).orderBy(desc(schema.adrs.createdAt)).limit(5),
      ]);
      const data = {
        openTasks: tasks.length,
        blockers: tasks.filter((t) => t.status === 'blocked'),
        modules: ownership.map((m) => ({ module: m.name, owner: m.ownerName })),
        recentDecisions: decisions,
      };
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data) }] };
    },
  );

  server.registerResource(
    'my-context',
    'project://my-context',
    { description: 'Your personalized context: your open tasks and the modules you own.', mimeType: 'application/json' },
    async (uri) => {
      const [myTasks, ownership] = await Promise.all([
        db.select(TASK_FIELDS).from(schema.tasks).where(and(eq(schema.tasks.assigneeId, dev.id), ne(schema.tasks.status, 'done'))),
        computeOwnership(),
      ]);
      const data = {
        me: me,
        myTasks,
        myModules: ownership.filter((m) => m.ownerId === dev.id).map((m) => m.pathPrefix),
      };
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data) }] };
    },
  );

  return server;
}
