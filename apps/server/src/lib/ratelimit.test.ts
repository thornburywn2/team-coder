import { test, expect, beforeEach } from 'bun:test';
import { rateLimit } from './ratelimit';

// the middleware is typed for Hono internals; call it through a loose signature
type Call = (c: unknown, next: unknown) => Promise<unknown>;

// Drive the middleware directly with a fake Hono context.
function ctx(token: string) {
  let status = 200;
  return {
    c: {
      req: { header: (n: string) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), method: 'GET' },
      header: () => {},
      json: (_body: unknown, s?: number) => { status = s ?? 200; return { status }; },
    },
    getStatus: () => status,
  };
}

beforeEach(() => { process.env.RATE_LIMIT = '1'; });

test('allows up to max then 429s within the window', async () => {
  const rl = rateLimit({ max: 2, windowMs: 10_000, name: `t-${Math.random()}` }) as unknown as Call;
  const next = async () => 'OK';
  const { c } = ctx('tokenA');
  expect(await rl(c, next)).toBe('OK');
  expect(await rl(c, next)).toBe('OK');
  const blocked = (await rl(c, next)) as { status: number };
  expect(blocked.status).toBe(429);
});

test('different tokens have independent buckets', async () => {
  const rl = rateLimit({ max: 1, windowMs: 10_000, name: `t-${Math.random()}` }) as unknown as Call;
  const next = async () => 'OK';
  expect(await rl(ctx('x').c, next)).toBe('OK');
  expect(await rl(ctx('y').c, next)).toBe('OK'); // separate key
});

test('disabled when RATE_LIMIT=0', async () => {
  process.env.RATE_LIMIT = '0';
  const rl = rateLimit({ max: 1, windowMs: 10_000, name: `t-${Math.random()}` }) as unknown as Call;
  const next = async () => 'OK';
  const { c } = ctx('z');
  expect(await rl(c, next)).toBe('OK');
  expect(await rl(c, next)).toBe('OK'); // not limited
});
