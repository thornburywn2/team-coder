import type { Context } from 'hono';

// Bounded list pagination via ?limit & ?offset. Defaults are generous so existing
// callers (which pass nothing) still get everything they had, but a query can never
// pull an unbounded result set — the cap protects the DB/server on large projects.

export function page(c: Context, def = 500, max = 1000): { limit: number; offset: number } {
  const l = Number(c.req.query('limit'));
  const o = Number(c.req.query('offset'));
  const limit = Number.isFinite(l) && l > 0 ? Math.min(l, max) : def;
  const offset = Number.isFinite(o) && o > 0 ? o : 0;
  return { limit, offset };
}
