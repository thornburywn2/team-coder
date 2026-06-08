import { createMiddleware } from 'hono/factory';

// Lightweight in-memory sliding-window rate limiter. Keyed by Bearer/team token
// when present, else client IP. Single-node (matches the rest of the live state);
// a multi-node deploy would back this with Redis. Disable with RATE_LIMIT=0.

interface Bucket { hits: number[]; }
const buckets = new Map<string, Bucket>();

function clientKey(c: { req: { header: (n: string) => string | undefined } }): string {
  const auth = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const team = c.req.header('x-team-token');
  return auth || team || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';
}

/**
 * @param max     max requests per window
 * @param windowMs window size in ms
 * @param name    bucket namespace (so different routes don't share counters)
 */
export function rateLimit(opts: { max: number; windowMs: number; name: string }) {
  return createMiddleware(async (c, next) => {
    if (process.env.RATE_LIMIT === '0') return next(); // disabled (e.g. CI/dev)
    const key = `${opts.name}:${clientKey(c)}`;
    const now = Date.now();
    const b = buckets.get(key) ?? { hits: [] };
    b.hits = b.hits.filter((t) => now - t < opts.windowMs);
    if (b.hits.length >= opts.max) {
      const retry = Math.ceil((opts.windowMs - (now - b.hits[0]!)) / 1000);
      c.header('Retry-After', String(retry));
      return c.json({ error: 'rate limit exceeded', retryAfterSeconds: retry }, 429);
    }
    b.hits.push(now);
    buckets.set(key, b);
    return next();
  });
}

// Periodically drop idle buckets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.hits.every((t) => now - t > 600_000)) buckets.delete(k);
  }
}, 600_000).unref?.();
