import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';

// Two-tier auth:
//  - TEAM_TOKEN: one shared passphrase humans use for the web portal (/api, /ws).
//  - per-dev agent token: each coder's Bearer for /hooks + /mcp, resolved to a
//    user so activity can be attributed (the trunk-model identity key).

export const TEAM_TOKEN = process.env.TEAM_TOKEN ?? 'change-me-team-token';

function bearer(header: string | undefined): string | undefined {
  return header?.replace(/^Bearer\s+/i, '').trim() || undefined;
}

/** Gate human portal routes with the shared team token. */
export const teamAuth = createMiddleware(async (c, next) => {
  const token = c.req.header('x-team-token') ?? bearer(c.req.header('authorization'));
  if (token !== TEAM_TOKEN) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

export interface Developer {
  id: string;
  username: string;
}

/** Resolve a per-dev agent token to a developer; used by /hooks and /mcp (P3/P4). */
export const devAuth = createMiddleware<{ Variables: { developer: Developer } }>(
  async (c, next) => {
    const token = bearer(c.req.header('authorization'));
    if (!token) return c.json({ error: 'missing agent token' }, 401);

    const [dev] = await db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.agentToken, token));

    if (!dev) return c.json({ error: 'unknown developer token' }, 401);
    c.set('developer', dev);
    await next();
  },
);
