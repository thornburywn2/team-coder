import { WebSocket as ReconnectingWebSocket } from 'partysocket';
import type { WsMessage } from '@team-coder/shared';

// Single reconnecting WebSocket. Handshake: wait for HELLO, then AUTH + SUBSCRIBE.
// Messages fan out to registered listeners (the dashboard dispatcher).

type Listener = (msg: WsMessage) => void;
const listeners = new Set<Listener>();
let ws: ReconnectingWebSocket | null = null;

export function onMessage(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function connectSocket(token: string, onStatus: (connected: boolean) => void): void {
  if (ws) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new ReconnectingWebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('close', () => onStatus(false));
  ws.addEventListener('message', (e: MessageEvent) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(String(e.data)) as WsMessage;
    } catch {
      return;
    }
    if (msg.type === 'HELLO') {
      ws?.send(JSON.stringify({ type: 'AUTH', payload: { token } }));
      ws?.send(JSON.stringify({ type: 'SUBSCRIBE', payload: {} }));
      onStatus(true);
      return;
    }
    listeners.forEach((l) => l(msg));
  });
}

export function disconnectSocket(): void {
  ws?.close();
  ws = null;
  listeners.clear();
}
