import { Hono } from 'hono';
import { basename } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { HookEventSchema, type HookEventPayload } from '@team-coder/shared';
import { db, schema } from '../db';
import { devAuth, type Developer } from '../auth';
import { scrubSecrets } from '../lib/scrub';
import { pushFeed, type FeedItem } from '../feed';
import { touchHook } from '../connections';

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
      payload: { ...ev, prompt: scrubbedPrompt }, // store scrubbed copy
      agentId: ev.agent_transcript_path ?? null,
    }),
    db
      .insert(schema.sessions)
      .values({ sessionId: ev.session_id, projectId: dev.projectId, developerId: dev.id, project })
      .onConflictDoUpdate({
        target: schema.sessions.sessionId,
        set: {
          lastSeenAt: new Date(),
          promptCount: sql`${schema.sessions.promptCount} + ${isPrompt ? 1 : 0}`,
          toolCount: sql`${schema.sessions.toolCount} + ${isTool ? 1 : 0}`,
        },
      }),
    db.update(schema.userPresence).set(presence).where(eq(schema.userPresence.userId, dev.id)),
  ]);

  const feed = feedFor(dev, ev, file, scrubbedPrompt);
  if (feed) pushFeed(dev.projectId, feed);
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
