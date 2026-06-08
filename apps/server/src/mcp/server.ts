import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { and, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { TASK_PRIORITY, TASK_STATUS, VOTE_VALUE } from '@team-coder/shared';
import { db, schema } from '../db';
import type { Developer } from '../auth';
import { computeOwnership } from '../ownership';
import { pushFeed } from '../feed';
import { acquire as acquireLock, release as releaseLock, check as checkLock } from '../locks';

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
  priority: schema.tasks.priority,
  tags: schema.tasks.tags,
  dueDate: schema.tasks.dueDate,
  moduleId: schema.tasks.moduleId,
  assigneeId: schema.tasks.assigneeId,
};

// Optional task-metadata edits shared by create_task + edit_task.
const META_INPUT = {
  priority: z.enum(TASK_PRIORITY).optional(),
  tags: z.array(z.string()).optional(),
  due_date: z.string().describe('ISO date/time, or empty string to clear').optional(),
};
function metaPatch(m: { priority?: string; tags?: string[]; due_date?: string }): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (m.priority) patch['priority'] = m.priority;
  if (m.tags) patch['tags'] = m.tags;
  if (m.due_date !== undefined) patch['dueDate'] = m.due_date ? new Date(m.due_date) : null;
  return patch;
}

export function createMcpServer(dev: Developer): McpServer {
  const server = new McpServer({ name: 'team-coder', version: '1.0.0' });
  const me = dev.displayName ?? dev.username;
  const pid = dev.projectId; // every query/write is scoped to the coder's project
  // task lives in this project — guards every id-addressed write against cross-project access
  const inProject = (extra?: SQL) => and(eq(schema.tasks.projectId, pid), extra);

  // ── READ ───────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_my_tasks',
    { description: 'Tasks currently assigned to you that are not done.', inputSchema: {} },
    async () => {
      const rows = await db
        .select(TASK_FIELDS)
        .from(schema.tasks)
        .where(and(eq(schema.tasks.projectId, pid), eq(schema.tasks.assigneeId, dev.id), ne(schema.tasks.status, 'done')));
      return text(rows);
    },
  );

  server.registerTool(
    'whoami',
    { description: 'Who you are on this project — your developer id + name. Use it to recognize your own tasks/assignments.', inputSchema: {} },
    async () => {
      const [proj] = await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, pid));
      return text({ developerId: dev.id, username: dev.username, name: me, projectId: pid, project: proj?.name ?? null });
    },
  );

  server.registerTool(
    'get_task',
    {
      description: 'Full detail for one task: status, priority, tags, due date, assignee + reporter names, module, and the whole discussion thread (progress notes, blocker reasons, completion summary).',
      inputSchema: { task_id: z.string() },
    },
    async ({ task_id }) => {
      const [t] = await db.select().from(schema.tasks).where(inProject(eq(schema.tasks.id, task_id)));
      if (!t) return text({ error: 'task not found' });
      const people = await db.select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username }).from(schema.users).where(eq(schema.users.projectId, pid));
      const nameOf = (id: string | null) => { const u = people.find((p) => p.id === id); return u ? (u.displayName ?? u.username) : null; };
      const [mod] = t.moduleId ? await db.select({ name: schema.modules.name }).from(schema.modules).where(eq(schema.modules.id, t.moduleId)) : [];
      const thread = await db
        .select({ authorId: schema.comments.authorId, content: schema.comments.content, createdAt: schema.comments.createdAt })
        .from(schema.comments)
        .where(and(eq(schema.comments.projectId, pid), eq(schema.comments.targetType, 'task'), eq(schema.comments.targetId, task_id)))
        .orderBy(schema.comments.createdAt);
      return text({
        id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority, tags: t.tags, dueDate: t.dueDate, source: t.source,
        assignee: nameOf(t.assigneeId), reporter: nameOf(t.reporterId), module: mod?.name ?? null,
        thread: thread.map((c) => ({ author: nameOf(c.authorId), content: c.content, at: c.createdAt })),
      });
    },
  );

  server.registerTool(
    'list_tasks',
    {
      description: 'List the whole team backlog (everyone\'s tasks). Optionally filter by status. Use this to see all work, not just yours.',
      inputSchema: { status: z.enum(TASK_STATUS).optional(), include_done: z.boolean().optional().describe('include done tasks (default false)') },
    },
    async ({ status, include_done }) => {
      const conds = [eq(schema.tasks.projectId, pid)];
      if (status) conds.push(eq(schema.tasks.status, status));
      else if (!include_done) conds.push(ne(schema.tasks.status, 'done'));
      const rows = await db.select(TASK_FIELDS).from(schema.tasks).where(and(...conds)).orderBy(desc(schema.tasks.createdAt)).limit(200);
      return text(rows);
    },
  );

  server.registerTool(
    'list_team',
    { description: 'The team roster — everyone on this project (id, username, display name). Use to find who to assign work to.', inputSchema: {} },
    async () => {
      const rows = await db
        .select({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName })
        .from(schema.users)
        .where(eq(schema.users.projectId, pid));
      return text(rows);
    },
  );

  server.registerTool(
    'get_comments',
    {
      description: 'Read the discussion thread (comments + progress notes) on a task or proposal.',
      inputSchema: { target_type: z.enum(['task', 'proposal']), target_id: z.string() },
    },
    async ({ target_type, target_id }) => {
      const rows = await db
        .select({ id: schema.comments.id, authorId: schema.comments.authorId, content: schema.comments.content, createdAt: schema.comments.createdAt })
        .from(schema.comments)
        .where(and(eq(schema.comments.projectId, pid), eq(schema.comments.targetType, target_type), eq(schema.comments.targetId, target_id)))
        .orderBy(schema.comments.createdAt);
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
      const ownership = await computeOwnership(pid);
      const mod = ownership.find((m) => m.name === module || m.pathPrefix === module || m.pathPrefix.startsWith(module));
      if (!mod) return text({ error: `no module matching "${module}"` });
      const tasks = await db
        .select(TASK_FIELDS)
        .from(schema.tasks)
        .where(inProject(and(eq(schema.tasks.moduleId, mod.moduleId), ne(schema.tasks.status, 'done'))));
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
        .where(eq(schema.codePatterns.projectId, pid))
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
        .where(eq(schema.adrs.projectId, pid))
        .orderBy(desc(schema.adrs.createdAt))
        .limit(20);
      return text(rows);
    },
  );

  server.registerTool(
    'get_project_goal',
    { description: 'The project goal / PRD plus progress against it. Read this first to understand what the team is building.', inputSchema: {} },
    async () => {
      const [proj] = await db
        .select({ name: schema.projects.name, prd: schema.projects.prd })
        .from(schema.projects)
        .where(eq(schema.projects.id, pid));
      const goalTasks = await db
        .select({ status: schema.tasks.status })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.projectId, pid), eq(schema.tasks.source, 'prd')));
      const done = goalTasks.filter((t) => t.status === 'done').length;
      return text({
        project: proj?.name ?? null,
        goal: proj?.prd ?? null,
        goalTasks: { total: goalTasks.length, done, remaining: goalTasks.length - done },
      });
    },
  );

  server.registerTool(
    'search_tasks',
    {
      description: 'Search/filter tasks by text, status, assignee, tag, and/or module, with pagination. Returns { tasks, total, limit, offset }.',
      inputSchema: {
        query: z.string().optional(),
        status: z.enum(TASK_STATUS).optional(),
        assignee: z.string().optional().describe('username/display name, or "me"'),
        tag: z.string().optional(),
        module: z.string().optional().describe('module name or path prefix'),
        limit: z.number().int().optional().describe('default 25, max 100'),
        offset: z.number().int().optional().describe('default 0'),
      },
    },
    async ({ query, status, assignee, tag, module, limit, offset }) => {
      const conds = [eq(schema.tasks.projectId, pid)];
      if (query) conds.push(ilike(schema.tasks.title, `%${query}%`));
      if (status) conds.push(eq(schema.tasks.status, status));
      if (tag) conds.push(sql`${schema.tasks.tags} @> ${JSON.stringify([tag])}::jsonb`);
      if (assignee) {
        let assigneeId = assignee === 'me' ? dev.id : null;
        if (!assigneeId) {
          const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.projectId, pid), or(eq(schema.users.username, assignee), eq(schema.users.displayName, assignee))));
          if (!u) return text({ error: `no coder named "${assignee}"` });
          assigneeId = u.id;
        }
        conds.push(eq(schema.tasks.assigneeId, assigneeId));
      }
      if (module) {
        const [m] = await db.select({ id: schema.modules.id }).from(schema.modules).where(and(eq(schema.modules.projectId, pid), or(eq(schema.modules.name, module), eq(schema.modules.pathPrefix, module))));
        if (!m) return text({ error: `no module matching "${module}"` });
        conds.push(eq(schema.tasks.moduleId, m.id));
      }
      const where = and(...conds);
      const lim = Math.min(Math.max(limit ?? 25, 1), 100);
      const off = Math.max(offset ?? 0, 0);
      const [rows, [tot]] = await Promise.all([
        db.select(TASK_FIELDS).from(schema.tasks).where(where).orderBy(desc(schema.tasks.createdAt)).limit(lim).offset(off),
        db.select({ n: count() }).from(schema.tasks).where(where),
      ]);
      return text({ tasks: rows, total: Number(tot?.n ?? 0), limit: lim, offset: off });
    },
  );

  server.registerTool(
    'get_proposals',
    { description: 'Open design proposals (ideas / direction changes) and their vote tallies. Read before proposing or voting so you do not duplicate.', inputSchema: {} },
    async () => {
      const [props, votes] = await Promise.all([
        db.select({ id: schema.proposals.id, title: schema.proposals.title, description: schema.proposals.description, status: schema.proposals.status, experimentBranch: schema.proposals.experimentBranch }).from(schema.proposals).where(eq(schema.proposals.projectId, pid)).orderBy(desc(schema.proposals.createdAt)).limit(25),
        db.select({ proposalId: schema.votes.proposalId, vote: schema.votes.vote }).from(schema.votes).where(eq(schema.votes.projectId, pid)),
      ]);
      return text(props.map((p) => {
        const tally = { approve: 0, reject: 0, abstain: 0 };
        for (const v of votes) if (v.proposalId === p.id) tally[v.vote] += 1;
        return { ...p, tally };
      }));
    },
  );

  // ── WRITE ──────────────────────────────────────────────────────────────────
  const feedBase = { developerId: dev.id, developer: me, color: dev.color ?? undefined };
  // persist a note/blocker-reason/summary into the task thread so it's readable back
  const noteOnTask = (taskId: string, content: string) =>
    db.insert(schema.comments).values({ projectId: pid, authorId: dev.id, targetType: 'task', targetId: taskId, content });

  server.registerTool(
    'create_proposal',
    {
      description: 'Raise a design proposal / idea for the team to vote on. Optionally tie it to an experiment branch and include a reference implementation (code_snippet) — on adoption it is published to the shared pattern library (prove-then-inherit).',
      inputSchema: { title: z.string(), description: z.string().optional(), experiment_branch: z.string().optional(), code_snippet: z.string().optional(), language: z.string().optional() },
    },
    async ({ title, description, experiment_branch, code_snippet, language }) => {
      const [row] = await db.insert(schema.proposals).values({ projectId: pid, title, description: description ?? null, experimentBranch: experiment_branch ?? null, codeSnippet: code_snippet ?? null, language: language ?? null, authorId: dev.id, status: 'open' }).returning({ id: schema.proposals.id, title: schema.proposals.title });
      pushFeed(pid, { ...feedBase, kind: 'proposal', detail: `proposed "${row!.title}"` });
      return text({ ok: true, proposal: row });
    },
  );

  server.registerTool(
    'vote_proposal',
    { description: 'Vote on a proposal (one vote per person; re-voting updates it).', inputSchema: { proposal_id: z.string(), vote: z.enum(VOTE_VALUE), comment: z.string().optional() } },
    async ({ proposal_id, vote, comment }) => {
      const [prop] = await db.select({ id: schema.proposals.id, title: schema.proposals.title }).from(schema.proposals).where(and(eq(schema.proposals.id, proposal_id), eq(schema.proposals.projectId, pid)));
      if (!prop) return text({ error: 'proposal not found' });
      await db.insert(schema.votes).values({ projectId: pid, proposalId: proposal_id, voterId: dev.id, vote, comment: comment ?? null })
        .onConflictDoUpdate({ target: [schema.votes.proposalId, schema.votes.voterId], set: { vote, comment: comment ?? null } });
      pushFeed(pid, { ...feedBase, kind: 'vote', detail: `voted ${vote} on "${prop.title}"` });
      return text({ ok: true });
    },
  );

  server.registerTool(
    'post_comment',
    {
      description: 'Comment on a task or proposal to discuss it (anchored thread, not chat).',
      inputSchema: { target_type: z.enum(['task', 'proposal']), target_id: z.string(), content: z.string() },
    },
    async ({ target_type, target_id, content }) => {
      const [row] = await db.insert(schema.comments).values({ projectId: pid, authorId: dev.id, targetType: target_type, targetId: target_id, content }).returning({ id: schema.comments.id });
      pushFeed(pid, { ...feedBase, kind: 'comment', detail: `commented on a ${target_type}` });
      return text({ ok: true, comment: row });
    },
  );

  server.registerTool(
    'create_task',
    {
      description: 'Create a new task on the board — e.g. work you discovered or are breaking down. Optionally tie it to a module (by name or path prefix) and set priority/tags/due date.',
      inputSchema: { title: z.string(), description: z.string().optional(), module: z.string().optional(), ...META_INPUT },
    },
    async ({ title, description, module, ...meta }) => {
      let moduleId: string | null = null;
      if (module) {
        const [m] = await db
          .select({ id: schema.modules.id })
          .from(schema.modules)
          .where(and(eq(schema.modules.projectId, pid), or(eq(schema.modules.name, module), eq(schema.modules.pathPrefix, module))));
        moduleId = m?.id ?? null;
      }
      const [row] = await db
        .insert(schema.tasks)
        .values({ projectId: pid, title, description: description ?? null, moduleId, reporterId: dev.id, ...metaPatch(meta) })
        .returning(TASK_FIELDS);
      pushFeed(pid, { ...feedBase, kind: 'created', detail: `created "${row!.title}"` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'edit_task',
    {
      description: "Edit a task: title, description, priority, tags, and/or due date.",
      inputSchema: { task_id: z.string(), title: z.string().optional(), description: z.string().optional(), ...META_INPUT },
    },
    async ({ task_id, title, description, ...meta }) => {
      const patch: Record<string, unknown> = { updatedAt: new Date(), ...metaPatch(meta) };
      if (title !== undefined) patch['title'] = title;
      if (description !== undefined) patch['description'] = description;
      const [row] = await db.update(schema.tasks).set(patch).where(inProject(eq(schema.tasks.id, task_id))).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      pushFeed(pid, { ...feedBase, kind: 'created', detail: `edited "${row.title}"` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'claim_task',
    { description: 'Claim a task for yourself (soft, non-blocking). Marks it in_progress. If a teammate already holds it you still get it, but the response warns you of the contention.', inputSchema: { task_id: z.string() } },
    async ({ task_id }) => {
      // read the prior holder first so we can warn on contention (soft, never blocks)
      const [before] = await db.select({ assigneeId: schema.tasks.assigneeId }).from(schema.tasks).where(inProject(eq(schema.tasks.id, task_id)));
      let warning: string | undefined;
      if (before?.assigneeId && before.assigneeId !== dev.id) {
        const [held] = await db.select({ displayName: schema.users.displayName, username: schema.users.username }).from(schema.users).where(eq(schema.users.id, before.assigneeId));
        warning = `was already claimed by ${held?.displayName ?? held?.username ?? 'a teammate'} — coordinate to avoid duplicate work`;
      }
      const [row] = await db.update(schema.tasks).set({ assigneeId: dev.id, status: 'in_progress', updatedAt: new Date() }).where(inProject(eq(schema.tasks.id, task_id))).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      pushFeed(pid, { ...feedBase, kind: 'claim', detail: `claimed "${row.title}"${warning ? ' (contended)' : ''}` });
      return text({ ok: true, task: row, ...(warning ? { warning } : {}) });
    },
  );

  server.registerTool(
    'assign_task',
    {
      description: 'Assign a task to a specific teammate (by username or display name). Use to carve up and delegate work — unlike claim_task, which is self only.',
      inputSchema: { task_id: z.string(), assignee: z.string().describe('teammate username or display name') },
    },
    async ({ task_id, assignee }) => {
      const [u] = await db
        .select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username })
        .from(schema.users)
        .where(and(eq(schema.users.projectId, pid), or(eq(schema.users.username, assignee), eq(schema.users.displayName, assignee))));
      if (!u) {
        const all = await db.select({ username: schema.users.username }).from(schema.users).where(eq(schema.users.projectId, pid));
        return text({ error: `no coder named "${assignee}"`, available: all.map((a) => a.username) });
      }
      const [row] = await db
        .update(schema.tasks)
        .set({ assigneeId: u.id, updatedAt: new Date() })
        .where(inProject(eq(schema.tasks.id, task_id)))
        .returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      pushFeed(pid, { ...feedBase, kind: 'claim', detail: `assigned "${row.title}" to ${u.displayName ?? u.username}` });
      return text({ ok: true, task: row, assignedTo: u.displayName ?? u.username });
    },
  );

  server.registerTool(
    'update_task_progress',
    { description: 'Update a task status and optionally add a progress note (the note is saved to the task thread so anyone can read it back).', inputSchema: { task_id: z.string(), status: z.enum(TASK_STATUS), note: z.string().optional() } },
    async ({ task_id, status, note }) => {
      const [row] = await db.update(schema.tasks).set({ status, updatedAt: new Date() }).where(inProject(eq(schema.tasks.id, task_id))).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      // persist the note as a durable, readable comment (not just an ephemeral feed item)
      if (note?.trim()) await db.insert(schema.comments).values({ projectId: pid, authorId: dev.id, targetType: 'task', targetId: task_id, content: note.trim() });
      pushFeed(pid, { ...feedBase, kind: status === 'done' ? 'done' : 'claim', detail: `${status.replace('_', ' ')}: "${row.title}"${note ? ` — ${note}` : ''}` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'complete_task',
    { description: 'Mark a task done with a short summary of what you did.', inputSchema: { task_id: z.string(), summary: z.string().optional() } },
    async ({ task_id, summary }) => {
      const [row] = await db.update(schema.tasks).set({ status: 'done', updatedAt: new Date() }).where(inProject(eq(schema.tasks.id, task_id))).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      if (summary?.trim()) await noteOnTask(task_id, `✅ Completed: ${summary.trim()}`);
      pushFeed(pid, { ...feedBase, kind: 'done', detail: `completed "${row.title}"${summary ? ` — ${summary}` : ''}` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'flag_blocker',
    { description: 'Flag a task as blocked with a reason so the team sees it.', inputSchema: { task_id: z.string(), reason: z.string() } },
    async ({ task_id, reason }) => {
      const [row] = await db.update(schema.tasks).set({ status: 'blocked', updatedAt: new Date() }).where(inProject(eq(schema.tasks.id, task_id))).returning(TASK_FIELDS);
      if (!row) return text({ error: 'task not found' });
      await noteOnTask(task_id, `🚧 Blocked: ${reason}`); // persist the reason so teammates can read why
      pushFeed(pid, { ...feedBase, kind: 'blocked', detail: `blocked "${row.title}": ${reason}` });
      return text({ ok: true, task: row });
    },
  );

  server.registerTool(
    'post_decision',
    { description: 'Record an architecture decision (ADR) so the team does not relitigate it. Pass an idempotency_key to make retries safe (a duplicate key returns the existing ADR instead of creating another).', inputSchema: { title: z.string(), context: z.string(), decision: z.string(), consequences: z.string().optional(), idempotency_key: z.string().optional() } },
    async ({ title, context, decision, consequences, idempotency_key }) => {
      const [row] = await db
        .insert(schema.adrs)
        .values({ projectId: pid, title, context, decision, consequences: consequences ?? null, status: 'accepted', authorId: dev.id, idempotencyKey: idempotency_key ?? null })
        .onConflictDoNothing({ target: [schema.adrs.projectId, schema.adrs.idempotencyKey] })
        .returning({ id: schema.adrs.id, seq: schema.adrs.sequenceNum });
      if (!row && idempotency_key) {
        const [existing] = await db.select({ id: schema.adrs.id, seq: schema.adrs.sequenceNum }).from(schema.adrs).where(and(eq(schema.adrs.projectId, pid), eq(schema.adrs.idempotencyKey, idempotency_key)));
        return text({ ok: true, adr: existing, deduped: true });
      }
      pushFeed(pid, { ...feedBase, kind: 'decision', detail: `decision: ${title}` });
      return text({ ok: true, adr: row });
    },
  );

  server.registerTool(
    'add_shared_pattern',
    { description: 'Publish a reusable code pattern so teammates do not rebuild it. Pass an idempotency_key to make retries safe (a duplicate key returns the existing pattern instead of creating another).', inputSchema: { title: z.string(), code: z.string(), description: z.string().optional(), language: z.string().optional(), tags: z.array(z.string()).optional(), idempotency_key: z.string().optional() } },
    async ({ title, code, description, language, tags, idempotency_key }) => {
      const [row] = await db
        .insert(schema.codePatterns)
        .values({ projectId: pid, title, codeSnippet: code, description: description ?? null, language: language ?? null, tags: tags ?? [], authorId: dev.id, idempotencyKey: idempotency_key ?? null })
        .onConflictDoNothing({ target: [schema.codePatterns.projectId, schema.codePatterns.idempotencyKey] })
        .returning({ id: schema.codePatterns.id });
      if (!row && idempotency_key) {
        const [existing] = await db.select({ id: schema.codePatterns.id }).from(schema.codePatterns).where(and(eq(schema.codePatterns.projectId, pid), eq(schema.codePatterns.idempotencyKey, idempotency_key)));
        return text({ ok: true, pattern: existing, deduped: true });
      }
      pushFeed(pid, { ...feedBase, kind: 'pattern', detail: `shared pattern: ${title}` });
      return text({ ok: true, pattern: row });
    },
  );

  server.registerTool(
    'report_usage',
    {
      description: 'Report your token usage so the team can track + minimize spend. Pass input/output (and optionally cache + model) tokens. mode "add" (default) increments; mode "set" overwrites this session\'s totals (use "set" with a cumulative count to stay idempotent).',
      inputSchema: {
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        cache_read_tokens: z.number().int().nonnegative().optional(),
        cache_creation_tokens: z.number().int().nonnegative().optional(),
        model: z.string().optional(),
        session_id: z.string().optional(),
        mode: z.enum(['add', 'set']).optional(),
      },
    },
    async ({ input_tokens, output_tokens, cache_read_tokens = 0, cache_creation_tokens = 0, model, session_id, mode }) => {
      const sid = session_id?.trim() || `usage-${dev.id}`;
      const m = model?.trim() || null;
      const set = mode === 'set';
      await db
        .insert(schema.sessions)
        .values({ sessionId: sid, projectId: pid, developerId: dev.id, project: null, inputTokens: input_tokens, outputTokens: output_tokens, cacheReadTokens: cache_read_tokens, cacheCreationTokens: cache_creation_tokens, model: m })
        .onConflictDoUpdate({
          target: schema.sessions.sessionId,
          set: set
            ? { lastSeenAt: new Date(), inputTokens: input_tokens, outputTokens: output_tokens, cacheReadTokens: cache_read_tokens, cacheCreationTokens: cache_creation_tokens, model: m ?? sql`${schema.sessions.model}` }
            : { lastSeenAt: new Date(), inputTokens: sql`${schema.sessions.inputTokens} + ${input_tokens}`, outputTokens: sql`${schema.sessions.outputTokens} + ${output_tokens}`, cacheReadTokens: sql`${schema.sessions.cacheReadTokens} + ${cache_read_tokens}`, cacheCreationTokens: sql`${schema.sessions.cacheCreationTokens} + ${cache_creation_tokens}`, model: m ?? sql`${schema.sessions.model}` },
        });
      return text({ ok: true });
    },
  );

  server.registerTool(
    'acquire_file',
    {
      description: 'Take a soft work-lock on a file before you edit it, so teammates know it is in use. If another agent already holds it, this returns acquired:false with who holds it — HOLD and retry (poll) until it is released, then proceed. Always release_file when done. Locks auto-expire after 15 min.',
      inputSchema: { file_path: z.string() },
    },
    async ({ file_path }) => {
      const r = acquireLock(pid, file_path, dev.id, me);
      if (r.acquired) return text({ acquired: true, file: file_path });
      return text({ acquired: false, held_by: r.lock.holderName, since: new Date(r.lock.ts).toISOString(), advice: 'hold and retry until released' });
    },
  );

  server.registerTool(
    'release_file',
    { description: 'Release your soft work-lock on a file when you finish editing it, so a waiting teammate can proceed.', inputSchema: { file_path: z.string() } },
    async ({ file_path }) => text({ released: releaseLock(pid, file_path, dev.id) }),
  );

  server.registerTool(
    'check_file',
    { description: 'Check whether a file is currently held by a teammate before you start. Returns who holds it, if anyone.', inputSchema: { file_path: z.string() } },
    async ({ file_path }) => {
      const l = checkLock(pid, file_path);
      return text(l && l.holderId !== dev.id ? { available: false, held_by: l.holderName, since: new Date(l.ts).toISOString() } : { available: true });
    },
  );

  // ── RESOURCES (host auto-loads; lightweight snapshots) ───────────────────────
  server.registerResource(
    'project-state',
    'project://state',
    { description: 'Live project snapshot: open task count, blockers, recent decisions, module owners.', mimeType: 'application/json' },
    async (uri) => {
      const [tasks, ownership, decisions] = await Promise.all([
        db.select(TASK_FIELDS).from(schema.tasks).where(inProject(ne(schema.tasks.status, 'done'))),
        computeOwnership(pid),
        db.select({ title: schema.adrs.title, decision: schema.adrs.decision }).from(schema.adrs).where(eq(schema.adrs.projectId, pid)).orderBy(desc(schema.adrs.createdAt)).limit(5),
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
        db.select(TASK_FIELDS).from(schema.tasks).where(and(eq(schema.tasks.projectId, pid), eq(schema.tasks.assigneeId, dev.id), ne(schema.tasks.status, 'done'))),
        computeOwnership(pid),
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
