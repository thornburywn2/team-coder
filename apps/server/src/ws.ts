import { createBunWebSocket } from 'hono/bun';
import type { ServerWebSocket } from 'bun';
import type { WsClientFilter, WsMessage } from '@team-coder/shared';
import { subscribe } from './state';
import { resolveProjectByToken } from './auth';

// WebSocket layer (Bun-native via hono/bun). Per-connection flow:
//   server -> HELLO
//   client -> AUTH { token }   (the project token; must arrive within the window)
//   client -> SUBSCRIBE { filter }   (optional; narrows the stream)
//   server -> deltas for that project matching the filter
// The factory runs once per connection, so per-conn state lives in this closure.

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const AUTH_WINDOW_MS = 5000;

function matches(msg: WsMessage, filter: WsClientFilter, projectId: string): boolean {
  // project isolation: drop deltas tagged for a different project. Untagged
  // messages (HELLO, deletes) pass through.
  if (msg.meta?.projectId && msg.meta.projectId !== projectId) return false;
  if (filter.eventTypes?.length && !filter.eventTypes.includes(msg.type)) return false;
  if (filter.developerIds?.length) {
    const dev = msg.meta?.developerId;
    if (!dev || !filter.developerIds.includes(dev)) return false;
  }
  return true;
}

export function wsRoute() {
  return upgradeWebSocket(() => {
    let authed = false;
    let projectId = '';
    let filter: WsClientFilter = {};
    let unsub: (() => void) | undefined;
    let authTimer: ReturnType<typeof setTimeout> | undefined;

    return {
      onOpen(_evt, ws) {
        ws.send(JSON.stringify({ type: 'HELLO', meta: { ts: Date.now() } } satisfies WsMessage));
        authTimer = setTimeout(() => {
          if (!authed) ws.close(4001, 'auth timeout');
        }, AUTH_WINDOW_MS);
      },

      async onMessage(evt, ws) {
        let msg: WsMessage;
        try {
          msg = JSON.parse(String(evt.data)) as WsMessage;
        } catch {
          return;
        }

        if (msg.type === 'AUTH') {
          const token = (msg.payload as { token?: string } | undefined)?.token;
          const project = await resolveProjectByToken(token);
          if (project) {
            authed = true;
            projectId = project.id;
            if (authTimer) clearTimeout(authTimer);
            // subscribe only after a successful handshake; bind to this project
            unsub = subscribe((out) => {
              if (matches(out, filter, projectId)) ws.send(JSON.stringify(out));
            });
          } else {
            ws.close(4003, 'bad token');
          }
          return;
        }

        if (!authed) return; // ignore everything else until authed

        if (msg.type === 'SUBSCRIBE') {
          filter = (msg.payload as WsClientFilter | undefined) ?? {};
        } else if (msg.type === 'PING') {
          ws.send(JSON.stringify({ type: 'HELLO', meta: { ts: Date.now() } } satisfies WsMessage));
        }
      },

      onClose() {
        unsub?.();
        if (authTimer) clearTimeout(authTimer);
      },
    };
  });
}

export { websocket };
