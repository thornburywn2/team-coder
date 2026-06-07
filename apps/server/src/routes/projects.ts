import { Hono } from 'hono';
import { db, schema } from '../db';

// Project lifecycle. Creating a project is OPEN (no token — you don't have one
// yet): it mints a fresh team token and seeds a starter set of coders + modules
// scoped to the new project, so it's immediately usable (login → pick coder →
// connect). Each project is fully isolated: its own token, its own everything.

export const publicProjectRoutes = new Hono();

// Starter coders/modules mirror the dev seed, but with per-project-unique agent
// tokens (agent_token is globally unique, so they must not collide across projects).
const STARTER_CODERS = [
  { username: 'alice', displayName: 'Alice', email: 'alice@teamcoder.dev', color: '#e6194B' },
  { username: 'bob', displayName: 'Bob', email: 'bob@teamcoder.dev', color: '#3cb44b' },
  { username: 'carol', displayName: 'Carol', email: 'carol@teamcoder.dev', color: '#4363d8' },
  { username: 'dave', displayName: 'Dave', email: 'dave@teamcoder.dev', color: '#f58231' },
  { username: 'erin', displayName: 'Erin', email: 'erin@teamcoder.dev', color: '#911eb4' },
];

const STARTER_MODULES = [
  { name: 'frontend', pathPrefix: 'apps/web/' },
  { name: 'backend', pathPrefix: 'apps/server/' },
  { name: 'shared', pathPrefix: 'packages/shared/' },
];

publicProjectRoutes.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; githubRepoUrl?: string };
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name required' }, 400);

  const token = `tc-${crypto.randomUUID()}`;
  const [proj] = await db
    .insert(schema.projects)
    .values({ name, token, githubRepoUrl: body.githubRepoUrl?.trim() || null })
    .returning({ id: schema.projects.id, name: schema.projects.name, token: schema.projects.token, githubRepoUrl: schema.projects.githubRepoUrl });
  const projectId = proj!.id;

  const inserted = await db
    .insert(schema.users)
    .values(STARTER_CODERS.map((u) => ({ ...u, projectId, agentToken: `dev-${crypto.randomUUID()}` })))
    .returning({ id: schema.users.id });

  await db
    .insert(schema.userPresence)
    .values(inserted.map((u) => ({ userId: u.id, projectId, status: 'offline' as const })))
    .onConflictDoNothing({ target: schema.userPresence.userId });

  await db
    .insert(schema.modules)
    .values(STARTER_MODULES.map((m) => ({ ...m, projectId })))
    .onConflictDoNothing({ target: [schema.modules.projectId, schema.modules.pathPrefix] });

  // return the token once — the creator needs it to log in and to connect agents
  return c.json(proj, 201);
});
