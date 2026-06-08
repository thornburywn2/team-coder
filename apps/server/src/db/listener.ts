import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import type { WsMessage } from '@team-coder/shared';
import { DATABASE_URL, db, schema } from './index';
import { publish } from '../state';

// Dedicated LISTEN connection. On each id-only notification it fetches the full
// row and publishes a typed WsMessage onto the in-process bus, which the
// WebSocket layer fans out to subscribed clients.

interface Notification {
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  id: string;
}

// Deletes only carry an id (the row is already gone), so they can't be tagged
// with a projectId — they broadcast to everyone and clients harmlessly ignore an
// unknown id. Every non-delete message is tagged from its row for project scoping.
async function toMessage(n: Notification): Promise<WsMessage | null> {
  switch (n.table) {
    case 'tasks': {
      if (n.op === 'DELETE') return { type: 'TASK_DELETED', payload: { id: n.id } };
      const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, n.id));
      if (!row) return null;
      return { type: n.op === 'INSERT' ? 'TASK_CREATED' : 'TASK_UPDATED', payload: row, meta: { projectId: row.projectId ?? undefined } };
    }
    case 'user_presence': {
      if (n.op === 'DELETE') {
        return { type: 'PRESENCE_UPDATE', payload: { userId: n.id }, meta: { developerId: n.id } };
      }
      const [row] = await db
        .select()
        .from(schema.userPresence)
        .where(eq(schema.userPresence.userId, n.id));
      return row ? { type: 'PRESENCE_UPDATE', payload: row, meta: { developerId: row.userId, projectId: row.projectId ?? undefined } } : null;
    }
    case 'proposals': {
      if (n.op === 'DELETE') return { type: 'PROPOSAL_UPDATED', payload: { id: n.id } };
      const [row] = await db.select().from(schema.proposals).where(eq(schema.proposals.id, n.id));
      return row ? { type: 'PROPOSAL_UPDATED', payload: row, meta: { projectId: row.projectId ?? undefined } } : null;
    }
    case 'project_notes': {
      if (n.op === 'DELETE') return null;
      const [row] = await db.select().from(schema.projectNotes).where(eq(schema.projectNotes.id, n.id));
      return row ? { type: 'NOTE_ADDED', payload: row, meta: { projectId: row.projectId ?? undefined } } : null;
    }
    case 'comments': {
      if (n.op === 'DELETE') return null;
      const [row] = await db.select().from(schema.comments).where(eq(schema.comments.id, n.id));
      return row ? { type: 'COMMENT_ADDED', payload: row, meta: { projectId: row.projectId ?? undefined } } : null;
    }
    case 'votes': {
      if (n.op === 'DELETE') return null;
      // votes change a proposal's tally — nudge clients to refetch that proposal
      const [row] = await db.select().from(schema.votes).where(eq(schema.votes.id, n.id));
      return row ? { type: 'VOTE_CAST', payload: { proposalId: row.proposalId }, meta: { projectId: row.projectId ?? undefined } } : null;
    }
    case 'code_patterns': {
      if (n.op === 'DELETE') return null;
      const [row] = await db.select().from(schema.codePatterns).where(eq(schema.codePatterns.id, n.id));
      return row ? { type: 'PATTERN_ADDED', payload: row, meta: { projectId: row.projectId ?? undefined } } : null;
    }
    default:
      return null; // modules handled in later phases
  }
}

/** Start the realtime listener. Returns the postgres client (call .end() to stop). */
export async function startDbListener() {
  const client = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  await client.listen('db_notifications', (raw) => {
    void (async () => {
      try {
        const msg = await toMessage(JSON.parse(raw) as Notification);
        if (msg) publish(msg);
      } catch (err) {
        console.error('[listener] failed to handle notification:', err);
      }
    })();
  });
  console.log('[listener] subscribed to db_notifications');
  return client;
}
