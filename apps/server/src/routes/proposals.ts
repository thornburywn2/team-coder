import { Hono } from 'hono';
import { and, count, desc, eq } from 'drizzle-orm';
import { PROPOSAL_STATUS, VOTE_VALUE } from '@team-coder/shared';
import { db, schema } from '../db';
import type { Project } from '../auth';
import { pushFeed } from '../feed';
import { decomposePrd } from '../lib/decompose';

// Design-evolution channel: proposals (ideas / direction changes, optionally tied
// to an experiment branch — "prove then inherit") that the team votes on and
// discusses (comments live on the proposal). Status moves open → accepted /
// rejected / withdrawn. Everything is project-scoped + broadcast live via triggers.

export const proposalRoutes = new Hono<{ Variables: { project: Project } }>();

async function actorName(projectId: string, userId: string | undefined) {
  if (!userId) return null;
  const [u] = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username, color: schema.users.color })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.projectId, projectId)));
  return u ?? null;
}

// list proposals with vote tallies + comment counts (author resolved client-side)
proposalRoutes.get('/', async (c) => {
  const pid = c.get('project').id;
  const [rows, votes, commentCounts] = await Promise.all([
    db.select().from(schema.proposals).where(eq(schema.proposals.projectId, pid)).orderBy(desc(schema.proposals.createdAt)),
    db.select({ proposalId: schema.votes.proposalId, voterId: schema.votes.voterId, vote: schema.votes.vote }).from(schema.votes).where(eq(schema.votes.projectId, pid)),
    db.select({ targetId: schema.comments.targetId, n: count() }).from(schema.comments).where(and(eq(schema.comments.projectId, pid), eq(schema.comments.targetType, 'proposal'))).groupBy(schema.comments.targetId),
  ]);
  const countOf = new Map(commentCounts.map((r) => [r.targetId, Number(r.n)]));
  return c.json(
    rows.map((p) => {
      const mine = votes.filter((v) => v.proposalId === p.id);
      const tally = { approve: 0, reject: 0, abstain: 0 };
      for (const v of mine) tally[v.vote] += 1;
      return { ...p, tally, votes: mine.map((v) => ({ voterId: v.voterId, vote: v.vote })), commentCount: countOf.get(p.id) ?? 0 };
    }),
  );
});

proposalRoutes.post('/', async (c) => {
  const project = c.get('project');
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; description?: string; experimentBranch?: string; authorId?: string; codeSnippet?: string; language?: string };
  if (!body.title?.trim()) return c.json({ error: 'title required' }, 400);
  const [row] = await db
    .insert(schema.proposals)
    .values({ projectId: project.id, title: body.title.trim(), description: body.description?.trim() || null, experimentBranch: body.experimentBranch?.trim() || null, codeSnippet: body.codeSnippet?.trim() || null, language: body.language?.trim() || null, authorId: body.authorId ?? null, status: 'open' })
    .returning();
  const u = await actorName(project.id, body.authorId);
  pushFeed(project.id, { developerId: u?.id, developer: u?.displayName ?? u?.username, color: u?.color ?? undefined, kind: 'proposal', detail: `proposed "${row!.title}"` });
  return c.json(row, 201);
});

// cast / change a vote (one per voter per proposal — upsert)
proposalRoutes.post('/:id/vote', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { voterId?: string; vote?: string; comment?: string };
  if (!body.voterId) return c.json({ error: 'voterId required' }, 400);
  if (!body.vote || !VOTE_VALUE.includes(body.vote as never)) return c.json({ error: 'invalid vote' }, 400);
  const [prop] = await db.select({ id: schema.proposals.id, title: schema.proposals.title }).from(schema.proposals).where(and(eq(schema.proposals.id, id), eq(schema.proposals.projectId, project.id)));
  if (!prop) return c.json({ error: 'proposal not found' }, 404);
  // validate the voter belongs to this project (avoids a FK 500 on a stale id)
  const voter = await actorName(project.id, body.voterId);
  if (!voter) return c.json({ error: 'unknown voter — please log in again' }, 400);
  await db
    .insert(schema.votes)
    .values({ projectId: project.id, proposalId: id, voterId: body.voterId, vote: body.vote as never, comment: body.comment?.trim() || null })
    .onConflictDoUpdate({ target: [schema.votes.proposalId, schema.votes.voterId], set: { vote: body.vote as never, comment: body.comment?.trim() || null } });
  pushFeed(project.id, { developerId: voter.id, developer: voter.displayName ?? voter.username, color: voter.color ?? undefined, kind: 'vote', detail: `voted ${body.vote} on "${prop.title}"` });
  return c.json({ ok: true });
});

// Adopt ("inherit") a proposal: turn the accepted decision into actionable work.
// Implementation steps are derived from the proposal description with the same
// decomposer used for PRDs (structured description → tasks; prose → one "Adopt"
// task), and the decision is recorded as an ADR so it isn't relitigated.
async function adopt(projectId: string, proposal: { id: string; title: string; description: string | null; codeSnippet: string | null; language: string | null }, actorId: string | undefined) {
  const mods = await db
    .select({ id: schema.modules.id, name: schema.modules.name, pathPrefix: schema.modules.pathPrefix })
    .from(schema.modules)
    .where(eq(schema.modules.projectId, projectId));
  const candidates = proposal.description ? decomposePrd(proposal.description, mods) : [];
  const values = candidates.length
    ? candidates.map((t) => ({ projectId, title: t.title, description: t.description ?? `From proposal: ${proposal.title}`, moduleId: t.moduleId ?? null, reporterId: actorId ?? null, source: 'proposal' as const }))
    : [{ projectId, title: `Adopt: ${proposal.title}`, description: proposal.description ?? null, reporterId: actorId ?? null, source: 'proposal' as const }];
  const tasks = await db.insert(schema.tasks).values(values).returning({ id: schema.tasks.id });

  await db.insert(schema.adrs).values({
    projectId,
    title: proposal.title,
    context: `Adopted from proposal "${proposal.title}".`,
    decision: proposal.description ?? `Adopt: ${proposal.title}`,
    status: 'accepted',
    authorId: actorId ?? null,
  });

  // prove-then-inherit: if the proposal carried a reference implementation,
  // publish it to the shared pattern library so the team can reuse it.
  let pattern = false;
  if (proposal.codeSnippet?.trim()) {
    await db.insert(schema.codePatterns).values({
      projectId,
      title: proposal.title,
      description: `Adopted from proposal "${proposal.title}".`,
      codeSnippet: proposal.codeSnippet,
      language: proposal.language ?? null,
      tags: ['adopted'],
      authorId: actorId ?? null,
    });
    pattern = true;
  }
  return { tasks: tasks.length, adr: true, pattern };
}

// move a proposal's status (accept / reject / withdraw). Accepting triggers
// adoption (auto-create tasks + record an ADR) — once, on the transition.
proposalRoutes.post('/:id/status', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as { status?: string; actorId?: string };
  if (!body.status || !PROPOSAL_STATUS.includes(body.status as never)) return c.json({ error: 'invalid status' }, 400);

  const [prev] = await db
    .select({ id: schema.proposals.id, title: schema.proposals.title, description: schema.proposals.description, status: schema.proposals.status, codeSnippet: schema.proposals.codeSnippet, language: schema.proposals.language })
    .from(schema.proposals)
    .where(and(eq(schema.proposals.id, id), eq(schema.proposals.projectId, project.id)));
  if (!prev) return c.json({ error: 'proposal not found' }, 404);

  const [row] = await db
    .update(schema.proposals)
    .set({ status: body.status as never, updatedAt: new Date() })
    .where(and(eq(schema.proposals.id, id), eq(schema.proposals.projectId, project.id)))
    .returning();

  const u = await actorName(project.id, body.actorId);
  const base = { developerId: u?.id, developer: u?.displayName ?? u?.username, color: u?.color ?? undefined };

  // adopt only on the transition into 'accepted' (idempotent — never twice)
  let adopted: { tasks: number; adr: boolean; pattern: boolean } | undefined;
  if (body.status === 'accepted' && prev.status !== 'accepted') {
    adopted = await adopt(project.id, prev, body.actorId);
    pushFeed(project.id, { ...base, kind: 'proposal', detail: `adopted "${row!.title}" → ${adopted.tasks} task${adopted.tasks === 1 ? '' : 's'}` });
  } else {
    pushFeed(project.id, { ...base, kind: 'proposal', detail: `${body.status} proposal "${row!.title}"` });
  }
  return c.json({ ...row, adopted });
});
