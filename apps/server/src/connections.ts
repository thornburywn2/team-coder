// Tracks, per coder, when we last heard from their agent over each lane (MCP and
// hooks). Powers the "is my agent connected?" indicator. In-memory is fine — it's
// liveness, not durable state. Each entry remembers its projectId so the portal
// only ever sees its own project's connections.

interface Conn {
  projectId: string;
  lastMcp: number;
  lastHook: number;
}

const conns = new Map<string, Conn>();

function get(userId: string, projectId: string): Conn {
  let c = conns.get(userId);
  if (!c) {
    c = { projectId, lastMcp: 0, lastHook: 0 };
    conns.set(userId, c);
  } else {
    c.projectId = projectId; // keep authoritative (e.g. after a re-seed)
  }
  return c;
}

export function touchMcp(userId: string, projectId: string): void {
  get(userId, projectId).lastMcp = Date.now();
}

export function touchHook(userId: string, projectId: string): void {
  get(userId, projectId).lastHook = Date.now();
}

export interface ConnectionStatus {
  userId: string;
  lastMcp: number;
  lastHook: number;
}

/** Connection liveness for one project's coders only. */
export function getConnections(projectId: string): ConnectionStatus[] {
  return [...conns.entries()]
    .filter(([, c]) => c.projectId === projectId)
    .map(([userId, c]) => ({ userId, lastMcp: c.lastMcp, lastHook: c.lastHook }));
}

export function getConnection(userId: string): ConnectionStatus {
  const c = conns.get(userId);
  return { userId, lastMcp: c?.lastMcp ?? 0, lastHook: c?.lastHook ?? 0 };
}
