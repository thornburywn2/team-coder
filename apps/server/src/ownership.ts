import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { db, schema } from './db';
import { publish } from './state';

// Auto-inferred module ownership. No manual locking: ownership is *derived* from
// each coder's recent Write/Edit activity (rolling window), mapped to the
// deepest matching module path_prefix. Recomputed on a poll + on demand, and
// broadcast — never persisted as a lock, so fast movers are never gated.
//
// (Blend with a polled product-repo git-who history is added in git-poll.ts when
// PRODUCT_REPO_URL is configured; live hook activity is the primary signal.)

export interface ModuleOwnership {
  moduleId: string;
  name: string;
  pathPrefix: string;
  ownerId: string | null;
  ownerName: string | null;
  inferred: boolean; // true if owner came from live activity (vs. seed fallback)
  contributors: { developerId: string; name: string; edits: number }[];
}

function norm(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

export async function computeOwnership(windowMinutes = 30): Promise<ModuleOwnership[]> {
  const since = new Date(Date.now() - windowMinutes * 60_000);

  const [events, gitChanges, mods, users] = await Promise.all([
    db
      .select({
        developerId: schema.hookEvents.developerId,
        filePath: schema.hookEvents.filePath,
      })
      .from(schema.hookEvents)
      .where(
        and(
          gte(schema.hookEvents.ts, since),
          isNotNull(schema.hookEvents.filePath),
          isNotNull(schema.hookEvents.developerId),
        ),
      ),
    // git commits in the window are tool-agnostic ground truth; blend them in
    db
      .select({ developerId: schema.gitFileChanges.developerId, moduleId: schema.gitFileChanges.moduleId })
      .from(schema.gitFileChanges)
      .innerJoin(schema.gitCommits, eq(schema.gitFileChanges.sha, schema.gitCommits.sha))
      .where(and(gte(schema.gitCommits.committedAt, since), isNotNull(schema.gitFileChanges.developerId))),
    db.select().from(schema.modules),
    db
      .select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username })
      .from(schema.users),
  ]);

  const nameOf = new Map(users.map((u) => [u.id, u.displayName ?? u.username]));

  // longest-prefix wins so nested modules attribute correctly
  const sortedMods = [...mods].sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);

  return mods.map((m) => {
    const counts = new Map<string, number>();
    for (const e of events) {
      if (!e.filePath || !e.developerId) continue;
      const file = norm(e.filePath);
      // attribute the file to its deepest matching module only
      const deepest = sortedMods.find((mm) => file.startsWith(mm.pathPrefix));
      if (deepest?.id !== m.id) continue;
      counts.set(e.developerId, (counts.get(e.developerId) ?? 0) + 1);
    }
    // blend git contributions (already mapped to a module at poll time)
    for (const g of gitChanges) {
      if (g.moduleId === m.id && g.developerId) {
        counts.set(g.developerId, (counts.get(g.developerId) ?? 0) + 1);
      }
    }

    const contributors = [...counts.entries()]
      .map(([developerId, edits]) => ({ developerId, name: nameOf.get(developerId) ?? '?', edits }))
      .sort((a, b) => b.edits - a.edits);

    const live = contributors[0];
    return {
      moduleId: m.id,
      name: m.name,
      pathPrefix: m.pathPrefix,
      ownerId: live?.developerId ?? m.ownerId ?? null,
      ownerName: live?.name ?? (m.ownerId ? (nameOf.get(m.ownerId) ?? null) : null),
      inferred: !!live,
      contributors,
    };
  });
}

/** Recompute and broadcast ownership to all connected clients. */
export async function refreshOwnership(): Promise<void> {
  const ownership = await computeOwnership();
  publish({ type: 'OWNERSHIP_UPDATE', payload: ownership });
}
