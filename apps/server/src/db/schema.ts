import {
  pgEnum,
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  bigserial,
  boolean,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Enums (mirror packages/shared/src/enums.ts — schema is the DB source of truth) ──
export const taskStatus = pgEnum('task_status', [
  'todo', 'in_progress', 'in_review', 'done', 'blocked',
]);
export const taskSource = pgEnum('task_source', ['manual', 'prd', 'proposal']);
export const taskPriority = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);
export const proposalStatus = pgEnum('proposal_status', [
  'draft', 'open', 'accepted', 'rejected', 'withdrawn',
]);
export const adrStatus = pgEnum('adr_status', [
  'proposed', 'accepted', 'deprecated', 'superseded',
]);
export const voteValue = pgEnum('vote_value', ['approve', 'reject', 'abstain']);
export const entityType = pgEnum('entity_type', [
  'task', 'proposal', 'adr', 'code_pattern', 'comment', 'module',
]);
export const eventAction = pgEnum('event_action', [
  'created', 'updated', 'deleted', 'status_changed', 'commented', 'voted', 'claimed', 'completed',
]);
export const presenceStatus = pgEnum('presence_status', [
  'active', 'thinking', 'idle', 'offline',
]);

// ── Projects (isolation root — one project = one GitHub repo) ──────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name', { length: 120 }).notNull(),
  token: varchar('token', { length: 128 }).notNull().unique(),
  githubRepoUrl: text('github_repo_url'), // the project's product repo (git-poll source)
  prd: text('prd'), // project end-goal / PRD (markdown)
  gitPollEnabled: boolean('git_poll_enabled').notNull().default(true), // per-project poll toggle
  archivedAt: timestamp('archived_at', { withTimezone: true }), // soft-archive
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Nullable project_id FK — added additively; backfilled to a default project so
// existing single-project data keeps working. New writes always set it.
const pid = () => uuid('project_id').references(() => projects.id, { onDelete: 'cascade' });

// Anyone on a project can post a note to it.
export const projectNotes = pgTable('project_notes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ projectIdx: index('idx_notes_project').on(t.projectId, t.createdAt) }));

// ── Users & presence ─────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  username: varchar('username', { length: 50 }).notNull(),
  displayName: varchar('display_name', { length: 100 }),
  color: varchar('color', { length: 20 }), // swim-lane color
  email: varchar('email', { length: 255 }),
  // additional git author emails for this coder (work laptop, etc.) so commits
  // attribute correctly even when the git email differs from the login email.
  gitEmails: text('git_emails').array().notNull().default(sql`'{}'::text[]`),
  agentToken: varchar('agent_token', { length: 128 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqUsername: uniqueIndex('uq_users_project_username').on(t.projectId, t.username),
  projectIdx: index('idx_users_project').on(t.projectId),
}));

export const userPresence = pgTable('user_presence', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  projectId: pid(),
  status: presenceStatus('status').notNull().default('offline'),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  sessionId: varchar('session_id', { length: 255 }),
  currentTaskId: uuid('current_task_id'),
  currentFile: text('current_file'),
  currentPrompt: text('current_prompt'),
});

// ── Modules (path_prefix ownership) ──────────────────────────────────────────
export const modules = pgTable('modules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  name: varchar('name', { length: 100 }).notNull(),
  pathPrefix: varchar('path_prefix', { length: 255 }).notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqPrefix: uniqueIndex('uq_modules_project_prefix').on(t.projectId, t.pathPrefix),
}));

// ── Tasks ────────────────────────────────────────────────────────────────────
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  status: taskStatus('status').notNull().default('todo'),
  source: taskSource('source').notNull().default('manual'), // 'prd' = derived from the project goal
  priority: taskPriority('priority').notNull().default('medium'),
  tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  dueDate: timestamp('due_date', { withTimezone: true }),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
  filePaths: jsonb('file_paths').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index('idx_tasks_project').on(t.projectId),
  statusIdx: index('idx_tasks_status').on(t.status),
}));

// ── Proposals + votes ────────────────────────────────────────────────────────
export const proposals = pgTable('proposals', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  status: proposalStatus('status').notNull().default('open'),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  experimentBranch: varchar('experiment_branch', { length: 255 }),
  // optional reference implementation proven on the experiment branch — on adoption
  // it's published to the shared pattern library (prove-then-inherit / reuse-kit).
  codeSnippet: text('code_snippet'),
  language: varchar('language', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const votes = pgTable('votes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  proposalId: uuid('proposal_id').notNull().references(() => proposals.id, { onDelete: 'cascade' }),
  voterId: uuid('voter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  vote: voteValue('vote').notNull(),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  oneVote: uniqueIndex('uq_votes_proposal_voter').on(t.proposalId, t.voterId),
}));

// ── ADRs ─────────────────────────────────────────────────────────────────────
export const adrs = pgTable('adrs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  sequenceNum: bigserial('sequence_num', { mode: 'number' }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  context: text('context').notNull(),
  decision: text('decision').notNull(),
  consequences: text('consequences'),
  status: adrStatus('status').notNull().default('proposed'),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  // optional client-supplied key to make writes idempotent on retry. NULLs are
  // distinct in a unique index, so unkeyed rows never collide.
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqIdem: uniqueIndex('uq_adrs_project_idem').on(t.projectId, t.idempotencyKey),
}));

// ── Shared code patterns ─────────────────────────────────────────────────────
export const codePatterns = pgTable('code_patterns', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  codeSnippet: text('code_snippet').notNull(),
  language: varchar('language', { length: 50 }),
  tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  idempotencyKey: varchar('idempotency_key', { length: 128 }), // see adrs.idempotencyKey
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uqIdem: uniqueIndex('uq_patterns_project_idem').on(t.projectId, t.idempotencyKey),
}));

// ── Threaded, polymorphic comments ───────────────────────────────────────────
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetType: entityType('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  parentId: uuid('parent_id'),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  targetIdx: index('idx_comments_target').on(t.targetType, t.targetId),
}));

// ── Immutable activity feed / audit log ──────────────────────────────────────
export const activityEvents = pgTable('activity_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: eventAction('action').notNull(),
  targetType: entityType('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index('idx_activity_project').on(t.projectId, t.createdAt),
}));

// ── Observability: raw hook events + session rollups ─────────────────────────
export const hookEvents = pgTable('hook_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: pid(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  sessionId: text('session_id').notNull(),
  developerId: text('developer_id'),
  project: text('project'),
  cwd: text('cwd'),
  eventName: text('event_name').notNull(),
  toolName: text('tool_name'),
  filePath: text('file_path'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  agentId: text('agent_id'),
}, (t) => ({
  projectIdx: index('idx_hook_events_project').on(t.projectId, t.ts),
  devIdx: index('idx_hook_events_dev').on(t.developerId, t.ts),
}));

// ── Git contributions (tool-agnostic ground truth from the polled product repo) ──
export const gitCommits = pgTable('git_commits', {
  sha: text('sha').primaryKey(),
  projectId: pid(),
  developerId: uuid('developer_id').references(() => users.id, { onDelete: 'set null' }),
  authorName: text('author_name'),
  authorEmail: text('author_email'),
  message: text('message'),
  committedAt: timestamp('committed_at', { withTimezone: true }),
  additions: integer('additions').notNull().default(0),
  deletions: integer('deletions').notNull().default(0),
}, (t) => ({
  projectIdx: index('idx_git_commits_project').on(t.projectId),
}));

export const gitFileChanges = pgTable('git_file_changes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  sha: text('sha').notNull().references(() => gitCommits.sha, { onDelete: 'cascade' }),
  developerId: uuid('developer_id').references(() => users.id, { onDelete: 'set null' }),
  filePath: text('file_path').notNull(),
  moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
  additions: integer('additions').notNull().default(0),
  deletions: integer('deletions').notNull().default(0),
}, (t) => ({
  projectIdx: index('idx_gfc_project').on(t.projectId),
  modIdx: index('idx_gfc_module').on(t.moduleId),
}));

// Cooperative work-locks (persisted so they survive a restart). One row per held
// file per project; auto-acquired by the PreToolUse hook and via MCP acquire_file.
export const workLocks = pgTable('work_locks', {
  projectId: pid(),
  file: text('file').notNull(),
  holderId: uuid('holder_id').notNull(),
  holderName: text('holder_name').notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex('uq_work_locks_project_file').on(t.projectId, t.file),
}));

export const sessions = pgTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  projectId: pid(),
  developerId: text('developer_id'),
  project: text('project'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  promptCount: integer('prompt_count').notNull().default(0),
  toolCount: integer('tool_count').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  model: text('model'), // primary model for the session (for per-model + cost breakdown)
});

// Durable activity feed — every high-signal event, kept for the whole project so a
// multi-day hackathon's history survives restarts/redeploys and stays reportable.
// (The live WebSocket still broadcasts immediately; this is the persistent record.)
export const feedItems = pgTable('feed_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  projectId: pid(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  developerId: uuid('developer_id'),
  developer: varchar('developer', { length: 100 }),
  color: varchar('color', { length: 20 }),
  kind: varchar('kind', { length: 30 }).notNull(),
  detail: text('detail'),
  file: text('file'),
}, (t) => ({
  projectIdx: index('idx_feed_project').on(t.projectId, t.ts),
}));
