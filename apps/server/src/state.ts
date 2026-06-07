import { EventEmitter } from 'node:events';
import type { WsMessage } from '@team-coder/shared';

// In-process pub/sub bus — the single fan-out point. The DB listener publishes
// state deltas here; every connected WebSocket subscribes. At hackathon-team
// scale this is all the fan-out we need (no Redis). One process = one source of
// truth. (Add Redis pub/sub only if the portal is ever scaled to many instances.)

const emitter = new EventEmitter();
emitter.setMaxListeners(100); // headroom for many concurrent sockets

const CHANNEL = 'msg';

export function publish(msg: WsMessage): void {
  emitter.emit(CHANNEL, msg);
}

/** Subscribe to all broadcast messages. Returns an unsubscribe fn. */
export function subscribe(fn: (msg: WsMessage) => void): () => void {
  emitter.on(CHANNEL, fn);
  return () => emitter.off(CHANNEL, fn);
}
