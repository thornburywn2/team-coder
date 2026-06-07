import postgres from 'postgres';
import { DATABASE_URL } from './db';
import { TEAM_TOKEN } from './auth';

// P2 acceptance check: connect a WebSocket, authenticate, subscribe, then INSERT
// a task on a separate DB connection and assert the TASK_CREATED delta arrives
// over the socket. Proves LISTEN/NOTIFY -> bus -> WebSocket end-to-end.
// Requires the server to be running.

const WS_URL = process.env.WS_URL ?? `ws://localhost:${process.env.PORT ?? 6300}/ws`;
const writer = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

function run(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let handshakeDone = false;
    let probeId: string | null = null;

    const timeout = setTimeout(() => {
      console.error('[verify-ws] ❌ timeout (no TASK_CREATED in 8s)');
      ws.close();
      resolve(false);
    }, 8000);

    const finish = async (ok: boolean) => {
      clearTimeout(timeout);
      if (probeId) await writer`DELETE FROM tasks WHERE id = ${probeId}`.catch(() => {});
      ws.close();
      resolve(ok);
    };

    ws.onopen = () => console.log('[verify-ws] socket open');

    ws.onmessage = (e) => {
      let msg: { type: string; payload?: { id?: string } };
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }

      if (msg.type === 'HELLO' && !handshakeDone) {
        handshakeDone = true;
        ws.send(JSON.stringify({ type: 'AUTH', payload: { token: TEAM_TOKEN } }));
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { eventTypes: ['TASK_CREATED'] } }));
        // give the server a beat to register the subscription, then write
        setTimeout(async () => {
          const [row] = await writer<{ id: string }[]>`
            INSERT INTO tasks (title) VALUES ('ws probe') RETURNING id
          `;
          probeId = row!.id;
          console.log('[verify-ws] inserted task', probeId);
        }, 400);
        return;
      }

      if (msg.type === 'TASK_CREATED' && probeId) {
        console.log('[verify-ws] received TASK_CREATED', msg.payload?.id);
        void finish(msg.payload?.id === probeId);
      }
    };

    ws.onerror = (err) => {
      console.error('[verify-ws] ❌ socket error:', (err as ErrorEvent).message ?? err);
      void finish(false);
    };
  });
}

const ok = await run();
console.log(ok ? '[verify-ws] ✅ realtime round-trip OK' : '[verify-ws] ❌ failed');
await writer.end();
process.exit(ok ? 0 : 1);
