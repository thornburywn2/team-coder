import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db, schema } from './db';

// Two-tier auth, project-aware:
//  - team token: each PROJECT has its own token. Humans use it for the web portal
//    (/api, /ws). The token resolves to the project, which scopes every read.
//  - per-dev agent token: each coder's Bearer for /hooks + /mcp, resolved to a
//    user (and that user's project) so activity is attributed and isolated.
//
// Backward compat: the legacy default token (change-me-team-token) is seeded as
// the Default Project's token, so an existing single-project portal keeps working.

export const TEAM_TOKEN = process.env.TEAM_TOKEN ?? 'change-me-team-token';

// The project an authenticated request is scoped to. Set by teamAuth/devAuth and
// read by every route to filter queries — the isolation boundary.
export interface Project {
  id: string;
  name: string;
  githubRepoUrl: string | null;
  prd: string | null;
}

export interface Developer {
  id: string;
  username: string;
  displayName: string | null;
  color: string | null;
  projectId: string;
}

function bearer(header: string | undefined): string | undefined {
  return header?.replace(/^Bearer\s+/i, '').trim() || undefined;
}

/** Resolve a team token to its project (or null). Used by teamAuth + the WS layer. */
export async function resolveProjectByToken(token: string | undefined): Promise<Project | null> {
  if (!token) return null;
  const [p] = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      githubRepoUrl: schema.projects.githubRepoUrl,
      prd: schema.projects.prd,
    })
    .from(schema.projects)
    .where(eq(schema.projects.token, token));
  return p ?? null;
}

/** Gate human portal routes; resolve the token to its project and stash it. */
export const teamAuth = createMiddleware<{ Variables: { project: Project } }>(
  async (c, next) => {
    const token = c.req.header('x-team-token') ?? bearer(c.req.header('authorization'));
    const project = await resolveProjectByToken(token);
    if (!project) return c.json({ error: 'unauthorized' }, 401);
    c.set('project', project);
    await next();
  },
);

/** Resolve a per-dev agent token to a developer + their project (/hooks, /mcp). */
export const devAuth = createMiddleware<{ Variables: { developer: Developer; project: Project } }>(
  async (c, next) => {
    const token = bearer(c.req.header('authorization'));
    if (!token) return c.json({ error: 'missing agent token' }, 401);

    const [row] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        color: schema.users.color,
        projectId: schema.users.projectId,
        projName: schema.projects.name,
        projRepo: schema.projects.githubRepoUrl,
        projPrd: schema.projects.prd,
      })
      .from(schema.users)
      .leftJoin(schema.projects, eq(schema.users.projectId, schema.projects.id))
      .where(eq(schema.users.agentToken, token));

    if (!row) return c.json({ error: 'unknown developer token' }, 401);
    if (!row.projectId) return c.json({ error: 'developer not assigned to a project' }, 401);

    c.set('developer', {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      color: row.color,
      projectId: row.projectId,
    });
    c.set('project', {
      id: row.projectId,
      name: row.projName ?? '',
      githubRepoUrl: row.projRepo ?? null,
      prd: row.projPrd ?? null,
    });
    await next();
  },
);
