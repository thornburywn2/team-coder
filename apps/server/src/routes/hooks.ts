import { Hono } from 'hono';
import { basename } from 'node:path';
import { and, eq, gte, isNotNull, ne, sql } from 'drizzle-orm';
import { HookEventSchema, type HookEventPayload } from '@team-coder/shared';
import { db, schema } from '../db';
import { devAuth, type Developer } from '../auth';
import { scrubSecrets, scrubDeep } from '../lib/scrub';
import { pushFeed, type FeedItem } from '../feed';
import { touchHook } from '../connections';
import { COLLISION_WINDOW_MS, recordCollision } from '../collisions';
import { acquire as acquireLock, releaseAll as releaseLocks } from '../locks';

// Claude Code hook ingestion. Each coder's agent POSTs lifecycle events here with
// their personal Bearer token (devAuth -> developer). We persist the raw event,
// roll up the session, derive live presence, and emit a feed item — then return
// 200 immediately so the agent is never blocked.

export const hookRoutes = new Hono<{ Variables: { developer: Developer } }>();
hookRoutes.use('*', devAuth);

hookRoutes.post('/event', async (c) => {
  const dev = c.get('developer');
  const body = await c.req.json().catch(() => null);
  const parsed = HookEventSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid hook payload' }, 400);

  touchHook(dev.id, dev.projectId); // record hook-lane liveness for the indicator

  // Fire-and-forget: kick off the writes and return immediately so the agent is
  // never blocked (hard <50ms target). The inserts run concurrently inside ingest.
  void ingest(dev, parsed.data).catch((err) => console.error('[hooks] ingest failed:', err));
  return c.json({ ok: true });
});

// Report token usage for attribution (any client: a Stop hook, a wrapper, or the
// MCP report_usage tool). Rolled up onto the session (→ per-coder + team totals).
// Report token usage. mode 'add' (default) increments; mode 'set' overwrites the
// session's totals — use 'set' with the transcript-derived cumulative so repeated
// Stop hooks stay idempotent (no double-counting). Optional model + cache tokens
// power the per-model + cost breakdown.
hookRoutes.post('/usage', async (c) => {
  const dev = c.get('developer');
  const body = (await c.req.json().catch(() => ({}))) as {
    session_id?: string; input_tokens?: number; output_tokens?: number; cache_read_tokens?: number; cache_creation_tokens?: number; model?: string; mode?: 'add' | 'set';
  };
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const tIn = n(body.input_tokens), tOut = n(body.output_tokens), tCacheR = n(body.cache_read_tokens), tCacheC = n(body.cache_creation_tokens);
  const model = body.model?.trim() || null;
  const sid = body.session_id?.trim() || `usage-${dev.id}`;
  const set = body.mode === 'set';
  touchHook(dev.id, dev.projectId);
  await db
    .insert(schema.sessions)
    .values({ sessionId: sid, projectId: dev.projectId, developerId: dev.id, project: null, inputTokens: tIn, outputTokens: tOut, cacheReadTokens: tCacheR, cacheCreationTokens: tCacheC, model })
    .onConflictDoUpdate({
      target: schema.sessions.sessionId,
      set: set
        ? { lastSeenAt: new Date(), inputTokens: tIn, outputTokens: tOut, cacheReadTokens: tCacheR, cacheCreationTokens: tCacheC, model: model ?? sql`${schema.sessions.model}` }
        : { lastSeenAt: new Date(), inputTokens: sql`${schema.sessions.inputTokens} + ${tIn}`, outputTokens: sql`${schema.sessions.outputTokens} + ${tOut}`, cacheReadTokens: sql`${schema.sessions.cacheReadTokens} + ${tCacheR}`, cacheCreationTokens: sql`${schema.sessions.cacheCreationTokens} + ${tCacheC}`, model: model ?? sql`${schema.sessions.model}` },
    });
  return c.json({ ok: true });
});

function fileFromTool(ev: HookEventPayload): string | undefined {
  if (ev.tool_name === 'Write' || ev.tool_name === 'Edit' || ev.tool_name === 'NotebookEdit') {
    const fp = ev.tool_input?.['file_path'];
    return typeof fp === 'string' ? fp : undefined;
  }
  return undefined;
}

function truncate(s: string, n = 140): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function ingest(dev: Developer, ev: HookEventPayload): Promise<void> {
  const file = fileFromTool(ev);
  const scrubbedPrompt = ev.prompt ? scrubSecrets(ev.prompt) : undefined;
  const project = ev.cwd ? basename(ev.cwd) : null;
  const isPrompt = ev.hook_event_name === 'UserPromptSubmit';
  const isTool = ev.hook_event_name === 'PreToolUse' || ev.hook_event_name === 'PostToolUse';
  const status = ev.hook_event_name === 'Stop' ? 'idle' : 'active';
  const tIn = ev.input_tokens ?? ev.usage?.input_tokens ?? 0;
  const tOut = ev.output_tokens ?? ev.usage?.output_tokens ?? 0;
  const tCacheR = ev.cache_read_tokens ?? ev.usage?.cache_read_tokens ?? 0;
  const tCacheC = ev.cache_creation_tokens ?? ev.usage?.cache_creation_tokens ?? 0;
  const model = ev.model ?? null;

  // presence patch — only set fields the event actually informs
  const presence: Record<string, unknown> = {
    status,
    lastSeen: new Date(),
    sessionId: ev.session_id,
  };
  if (file) presence['currentFile'] = file;
  if (scrubbedPrompt) presence['currentPrompt'] = truncate(scrubbedPrompt);

  await Promise.all([
    db.insert(schema.hookEvents).values({
      projectId: dev.projectId,
      sessionId: ev.session_id,
      developerId: dev.id,
      project,
      cwd: ev.cwd ?? null,
      eventName: ev.hook_event_name,
      toolName: ev.tool_name ?? null,
      filePath: file ?? null,
      payload: scrubDeep({ ...ev, prompt: scrubbedPrompt }), // scrub prompt + tool_input/command secrets
      agentId: ev.agent_transcript_path ?? null,
    }),
    db
      .insert(schema.sessions)
      // count this first event too (defaults are 0; the upsert path increments later)
      .values({ sessionId: ev.session_id, projectId: dev.projectId, developerId: dev.id, project, promptCount: isPrompt ? 1 : 0, toolCount: isTool ? 1 : 0, inputTokens: tIn, outputTokens: tOut, cacheReadTokens: tCacheR, cacheCreationTokens: tCacheC, model })
      .onConflictDoUpdate({
        target: schema.sessions.sessionId,
        set: {
          lastSeenAt: new Date(),
          promptCount: sql`${schema.sessions.promptCount} + ${isPrompt ? 1 : 0}`,
          toolCount: sql`${schema.sessions.toolCount} + ${isTool ? 1 : 0}`,
          inputTokens: sql`${schema.sessions.inputTokens} + ${tIn}`,
          outputTokens: sql`${schema.sessions.outputTokens} + ${tOut}`,
          cacheReadTokens: sql`${schema.sessions.cacheReadTokens} + ${tCacheR}`,
          cacheCreationTokens: sql`${schema.sessions.cacheCreationTokens} + ${tCacheC}`,
          model: model ?? sql`${schema.sessions.model}`,
        },
      }),
    db.update(schema.userPresence).set(presence).where(eq(schema.userPresence.userId, dev.id)),
  ]);

  const feed = feedFor(dev, ev, file, scrubbedPrompt);
  if (feed) pushFeed(dev.projectId, feed);

  // advisory concurrent-edit detection: another coder touched this same file recently?
  if (file && ev.hook_event_name === 'PreToolUse') await detectCollision(dev, file);

  // automatic work-locks: acquire on edit (refreshes the hold), release all on Stop.
  // Makes "hold until released" work without the agent opting in.
  if (file && ev.hook_event_name === 'PreToolUse') {
    await acquireLock(dev.projectId, file, dev.id, dev.displayName ?? dev.username).catch(() => {});
  }
  if (ev.hook_event_name === 'Stop') await releaseLocks(dev.projectId, dev.id).catch(() => {});
}

async function detectCollision(dev: Developer, file: string): Promise<void> {
  const since = new Date(Date.now() - COLLISION_WINDOW_MS);
  const rows = await db
    .selectDistinct({ developerId: schema.hookEvents.developerId })
    .from(schema.hookEvents)
    .where(and(
      eq(schema.hookEvents.projectId, dev.projectId),
      eq(schema.hookEvents.filePath, file),
      gte(schema.hookEvents.ts, since),
      isNotNull(schema.hookEvents.developerId),
      ne(schema.hookEvents.developerId, dev.id),
    ));
  if (!rows.length) return;

  const otherIds = rows.map((r) => r.developerId!).filter(Boolean);
  const people = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.projectId, dev.projectId));
  const nameOf = (id: string) => { const u = people.find((p) => p.id === id); return u ? (u.displayName ?? u.username) : '?'; };
  const developers = [dev.id, ...otherIds].map((id) => ({ id, name: nameOf(id) }));
  recordCollision(dev.projectId, file, developers);
}

function feedFor(
  dev: Developer,
  ev: HookEventPayload,
  file: string | undefined,
  prompt: string | undefined,
): (Omit<FeedItem, 'id' | 'ts' | 'projectId'>) | null {
  const base = { developerId: dev.id, developer: dev.displayName ?? dev.username, color: dev.color ?? undefined };
  switch (ev.hook_event_name) {
    case 'SessionStart':
      return { ...base, kind: 'session_start', detail: 'started a session' };
    case 'UserPromptSubmit':
      return { ...base, kind: 'prompt', detail: prompt ? truncate(prompt) : 'submitted a prompt' };
    case 'PreToolUse':
      return file ? { ...base, kind: 'edit', file, detail: `editing ${file}` } : null;
    case 'SubagentStop':
      return {
        ...base,
        kind: 'subagent',
        detail: ev.last_assistant_message ? truncate(ev.last_assistant_message) : 'subagent finished',
      };
    case 'Stop':
      return { ...base, kind: 'stop', detail: 'paused' };
    default:
      return null; // PostToolUse and non-file tool calls are skipped (noise)
  }
}
