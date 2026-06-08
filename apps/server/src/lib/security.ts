import { createMiddleware } from 'hono/factory';

// Security headers + CORS. Auth is via custom headers (x-team-token / Bearer), not
// cookies, so CSRF isn't applicable — but we still lock CORS so a browser on
// another origin can't read responses. Set CORS_ORIGIN to a comma-separated allow
// list (default: same-origin only — no CORS headers emitted, so cross-origin XHR
// is blocked by the browser).

const allowList = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-XSS-Protection', '0');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // HSTS only meaningful over HTTPS (behind the TLS proxy); harmless otherwise.
  if (process.env.ENABLE_HSTS === '1') c.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
});

export const cors = createMiddleware(async (c, next) => {
  const origin = c.req.header('origin');
  if (origin && allowList.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Headers', 'content-type, authorization, x-team-token');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  return next();
});
