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

async function toMessage(n: Notification): Promise<WsMessage | null> {
  switch (n.table) {
    case 'tasks': {
      if (n.op === 'DELETE') return { type: 'TASK_DELETED', payload: { id: n.id } };
      const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, n.id));
      if (!row) return null;
      return { type: n.op === 'INSERT' ? 'TASK_CREATED' : 'TASK_UPDATED', payload: row };
    }
    case 'activity_events': {
      const [row] = await db
        .select()
        .from(schema.activityEvents)
        .where(eq(schema.activityEvents.id, n.id));
      return row ? { type: 'ACTIVITY_EVENT', payload: row } : null;
    }
    case 'user_presence': {
      if (n.op === 'DELETE') {
        return { type: 'PRESENCE_UPDATE', payload: { userId: n.id }, meta: { developerId: n.id } };
      }
      const [row] = await db
        .select()
        .from(schema.userPresence)
        .where(eq(schema.userPresence.userId, n.id));
      return row ? { type: 'PRESENCE_UPDATE', payload: row, meta: { developerId: row.userId } } : null;
    }
    case 'proposals': {
      if (n.op === 'DELETE') return { type: 'PROPOSAL_UPDATED', payload: { id: n.id } };
      const [row] = await db.select().from(schema.proposals).where(eq(schema.proposals.id, n.id));
      return row ? { type: 'PROPOSAL_UPDATED', payload: row } : null;
    }
    default:
      return null; // votes/comments/modules handled in later phases
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
