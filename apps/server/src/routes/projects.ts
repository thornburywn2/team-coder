import { Hono } from 'hono';
import { db, schema } from '../db';

// Project lifecycle. Creating a project is OPEN (no token — you don't have one
// yet): it mints a fresh team token and seeds a starter set of coders + modules
// scoped to the new project, so it's immediately usable (login → pick coder →
// connect). Each project is fully isolated: its own token, its own everything.

export const publicProjectRoutes = new Hono();

// Color palette cycled across the team roster (swim-lane colors).
const COLORS = ['#e6194B', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'];

// Fallback roster when the creator doesn't name their team (dev/demo only).
const STARTER_NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'];

const STARTER_MODULES = [
  { name: 'frontend', pathPrefix: 'apps/web/' },
  { name: 'backend', pathPrefix: 'apps/server/' },
  { name: 'shared', pathPrefix: 'packages/shared/' },
];

// Turn the creator's typed team-member names into seed-able coder rows (unique
// usernames + per-project-unique agent tokens). SSO will replace this later.
function rosterFrom(names: string[], projectId: string) {
  const seenU = new Set<string>();
  return names.map((raw, i) => {
    const displayName = raw.trim().slice(0, 100);
    let username = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `coder-${i + 1}`;
    while (seenU.has(username)) username = `${username}-${i}`;
    seenU.add(username);
    return { projectId, username, displayName, color: COLORS[i % COLORS.length]!, agentToken: `dev-${crypto.randomUUID()}` };
  });
}

publicProjectRoutes.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; githubRepoUrl?: string; members?: string[] };
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name required' }, 400);

  // team members chosen at creation time (deduped, non-empty); falls back to the
  // demo roster only if none were given.
  const memberNames = (Array.isArray(body.members) ? body.members : [])
    .map((m) => (typeof m === 'string' ? m.trim() : ''))
    .filter(Boolean)
    .slice(0, 50);
  const names = memberNames.length ? memberNames : STARTER_NAMES;

  const token = `tc-${crypto.randomUUID()}`;
  const [proj] = await db
    .insert(schema.projects)
    .values({ name, token, githubRepoUrl: body.githubRepoUrl?.trim() || null })
    .returning({ id: schema.projects.id, name: schema.projects.name, token: schema.projects.token, githubRepoUrl: schema.projects.githubRepoUrl });
  const projectId = proj!.id;

  const inserted = await db
    .insert(schema.users)
    .values(rosterFrom(names, projectId))
    .returning({ id: schema.users.id, username: schema.users.username, displayName: schema.users.displayName, agentToken: schema.users.agentToken });

  await db
    .insert(schema.userPresence)
    .values(inserted.map((u) => ({ userId: u.id, projectId, status: 'offline' as const })))
    .onConflictDoNothing({ target: schema.userPresence.userId });

  await db
    .insert(schema.modules)
    .values(STARTER_MODULES.map((m) => ({ ...m, projectId })))
    .onConflictDoNothing({ target: [schema.modules.projectId, schema.modules.pathPrefix] });

  // return the token + per-coder agent tokens once — the creator needs them to log
  // in and to connect each teammate's agent (also shown later in the Connect screen).
  return c.json({ ...proj, coders: inserted }, 201);
});
