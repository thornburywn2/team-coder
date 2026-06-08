import { eq } from 'drizzle-orm';
import { db, schema } from './db';

// Helpers so verify scripts run inside their OWN throwaway project and delete it
// at the end — no debris on the shared default board. Deleting a project cascades
// to all its rows (project_id FKs are ON DELETE CASCADE).

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;

export interface TestProject {
  id: string;
  token: string;
  coders: { id: string; username: string; displayName: string | null; agentToken: string }[];
  /** agent (Bearer) token for a seeded coder, by username (alice/bob/carol/dave/erin) */
  agentToken: (username: string) => string;
}

/** Create an isolated project (with seeded coders + modules) for a test run. */
export async function createTestProject(name: string): Promise<TestProject> {
  const res = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`createTestProject -> ${res.status}`);
  const p = (await res.json()) as { id: string; token: string; coders: TestProject['coders'] };
  return {
    id: p.id,
    token: p.token,
    coders: p.coders,
    agentToken: (username) => {
      const c = p.coders.find((u) => u.username === username);
      if (!c) throw new Error(`no seeded coder "${username}"`);
      return c.agentToken;
    },
  };
}

/** Delete a test project and everything under it (cascade). Best-effort. */
export async function deleteProject(id: string): Promise<void> {
  await db.delete(schema.projects).where(eq(schema.projects.id, id)).catch(() => {});
}

/** Delete throwaway test projects by their team tokens (cascade). Best-effort. */
export async function deleteProjectsByToken(...tokens: (string | undefined)[]): Promise<void> {
  for (const t of tokens) {
    if (t) await db.delete(schema.projects).where(eq(schema.projects.token, t)).catch(() => {});
  }
}
