// Tracks, per coder, when we last heard from their agent over each lane (MCP and
// hooks). Powers the "is my agent connected?" indicator. In-memory is fine — it's
// liveness, not durable state.

interface Conn {
  lastMcp: number;
  lastHook: number;
}

const conns = new Map<string, Conn>();

function get(userId: string): Conn {
  let c = conns.get(userId);
  if (!c) {
    c = { lastMcp: 0, lastHook: 0 };
    conns.set(userId, c);
  }
  return c;
}

export function touchMcp(userId: string): void {
  get(userId).lastMcp = Date.now();
}

export function touchHook(userId: string): void {
  get(userId).lastHook = Date.now();
}

export interface ConnectionStatus {
  userId: string;
  lastMcp: number;
  lastHook: number;
}

export function getConnections(): ConnectionStatus[] {
  return [...conns.entries()].map(([userId, c]) => ({ userId, lastMcp: c.lastMcp, lastHook: c.lastHook }));
}

export function getConnection(userId: string): ConnectionStatus {
  const c = get(userId);
  return { userId, lastMcp: c.lastMcp, lastHook: c.lastHook };
}
