import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { computeOwnership } from './ownership';
import { languageOf, layerOf } from './lib/classify';

// Contribution report — aggregates every signal we capture (git LOC, hook edits,
// sessions, tasks, decisions, patterns) into a per-coder breakdown with multiple
// fairness lenses, a module breakdown, and an activity timeline. LOC alone is
// gameable, so the headline "blended" % averages all available bases.

export interface CoderStat {
  id: string;
  name: string;
  color: string | null;
  commits: number;
  linesAdded: number;
  linesRemoved: number;
  filesTouched: number;
  edits: number;
  prompts: number;
  toolCalls: number;
  activeMinutes: number;
  tasksCompleted: number;
  decisions: number;
  patterns: number;
  modulesOwned: number;
  pct: { lines: number; commits: number; tasks: number; edits: number; blended: number };
}

export interface ModuleStat {
  name: string;
  pathPrefix: string;
  totalLines: number;
  contributors: { id: string; name: string; color: string | null; lines: number; pct: number }[];
}

export interface TimelineBucket {
  t: string;
  perCoder: Record<string, number>;
}

export interface Breakdown {
  name: string;
  value: number;
  pct: number;
}

export interface Report {
  generatedAt: string;
  coders: CoderStat[];
  modules: ModuleStat[];
  timeline: TimelineBucket[];
  languages: Breakdown[]; // what the team writes in
  layers: Breakdown[]; // where in the stack: frontend/backend/database/infra/docs
  analysisBasis: 'lines' | 'edits'; // git LOC if available, else live hook edits
  totals: { commits: number; linesAdded: number; tasksCompleted: number; activeMinutes: number };
}

const num = (v: unknown): number => Number(v ?? 0);

export async function buildReport(projectId: string, generatedAt: string): Promise<Report> {
  const [users, gitAgg, filesAgg, modLinesAgg, editAgg, sessAgg, taskAgg, adrAgg, patAgg, timelineAgg, ownership, extra1, extra2] =
    await Promise.all([
      db.select({ id: schema.users.id, name: schema.users.displayName, username: schema.users.username, color: schema.users.color }).from(schema.users).where(eq(schema.users.projectId, projectId)),
      db
        .select({ dev: schema.gitCommits.developerId, commits: sql<number>`count(distinct ${schema.gitCommits.sha})`, added: sql<number>`coalesce(sum(${schema.gitCommits.additions}),0)`, removed: sql<number>`coalesce(sum(${schema.gitCommits.deletions}),0)` })
        .from(schema.gitCommits).where(and(eq(schema.gitCommits.projectId, projectId), isNotNull(schema.gitCommits.developerId))).groupBy(schema.gitCommits.developerId),
      db
        .select({ dev: schema.gitFileChanges.developerId, files: sql<number>`count(distinct ${schema.gitFileChanges.filePath})` })
        .from(schema.gitFileChanges).where(and(eq(schema.gitFileChanges.projectId, projectId), isNotNull(schema.gitFileChanges.developerId))).groupBy(schema.gitFileChanges.developerId),
      db
        .select({ moduleId: schema.gitFileChanges.moduleId, dev: schema.gitFileChanges.developerId, lines: sql<number>`coalesce(sum(${schema.gitFileChanges.additions}),0)` })
        .from(schema.gitFileChanges).where(and(eq(schema.gitFileChanges.projectId, projectId), isNotNull(schema.gitFileChanges.moduleId), isNotNull(schema.gitFileChanges.developerId))).groupBy(schema.gitFileChanges.moduleId, schema.gitFileChanges.developerId),
      db
        .select({ dev: schema.hookEvents.developerId, n: count() })
        .from(schema.hookEvents).where(and(eq(schema.hookEvents.projectId, projectId), isNotNull(schema.hookEvents.developerId), inArray(schema.hookEvents.toolName, ['Write', 'Edit', 'NotebookEdit']))).groupBy(schema.hookEvents.developerId),
      db
        .select({ dev: schema.sessions.developerId, minutes: sql<number>`coalesce(sum(extract(epoch from (${schema.sessions.lastSeenAt} - ${schema.sessions.startedAt})))/60,0)`, tools: sql<number>`coalesce(sum(${schema.sessions.toolCount}),0)`, prompts: sql<number>`coalesce(sum(${schema.sessions.promptCount}),0)` })
        .from(schema.sessions).where(and(eq(schema.sessions.projectId, projectId), isNotNull(schema.sessions.developerId))).groupBy(schema.sessions.developerId),
      db
        .select({ dev: schema.tasks.assigneeId, n: count() })
        .from(schema.tasks).where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.status, 'done'), isNotNull(schema.tasks.assigneeId))).groupBy(schema.tasks.assigneeId),
      db.select({ dev: schema.adrs.authorId, n: count() }).from(schema.adrs).where(and(eq(schema.adrs.projectId, projectId), isNotNull(schema.adrs.authorId))).groupBy(schema.adrs.authorId),
      db.select({ dev: schema.codePatterns.authorId, n: count() }).from(schema.codePatterns).where(and(eq(schema.codePatterns.projectId, projectId), isNotNull(schema.codePatterns.authorId))).groupBy(schema.codePatterns.authorId),
      db
        .select({ bucket: sql<string>`to_char(date_trunc('hour', ${schema.hookEvents.ts}), 'YYYY-MM-DD"T"HH24:00')`, dev: schema.hookEvents.developerId, n: count() })
        .from(schema.hookEvents).where(and(eq(schema.hookEvents.projectId, projectId), isNotNull(schema.hookEvents.developerId))).groupBy(sql`1`, schema.hookEvents.developerId).orderBy(sql`1`),
      computeOwnership(projectId, 60 * 24 * 14), // 2-week window: "owned" for the whole event
      // raw file paths for language/layer analysis: git LOC (authoritative) +
      // hook edits (fallback so the breakdown is non-empty before git is configured)
      db
        .select({ filePath: schema.gitFileChanges.filePath, lines: sql<number>`coalesce(sum(${schema.gitFileChanges.additions}),0)` })
        .from(schema.gitFileChanges).where(eq(schema.gitFileChanges.projectId, projectId)).groupBy(schema.gitFileChanges.filePath),
      db
        .select({ filePath: schema.hookEvents.filePath, n: count() })
        .from(schema.hookEvents).where(and(eq(schema.hookEvents.projectId, projectId), isNotNull(schema.hookEvents.filePath))).groupBy(schema.hookEvents.filePath),
    ]);
  const [gitFilesAgg, hookFilesAgg] = [extra1, extra2];

  const byDev = <T extends { dev: string | null }>(rows: T[]) => new Map(rows.filter((r) => r.dev).map((r) => [r.dev as string, r]));
  const git = byDev(gitAgg);
  const files = byDev(filesAgg);
  const edits = byDev(editAgg);
  const sess = byDev(sessAgg);
  const tasksDone = byDev(taskAgg);
  const adrs = byDev(adrAgg);
  const pats = byDev(patAgg);
  const ownedCount = new Map<string, number>();
  for (const m of ownership) if (m.ownerId) ownedCount.set(m.ownerId, (ownedCount.get(m.ownerId) ?? 0) + 1);

  const coders: CoderStat[] = users.map((u) => ({
    id: u.id,
    name: u.name ?? u.username,
    color: u.color,
    commits: num(git.get(u.id)?.commits),
    linesAdded: num(git.get(u.id)?.added),
    linesRemoved: num(git.get(u.id)?.removed),
    filesTouched: num(files.get(u.id)?.files),
    edits: num(edits.get(u.id)?.n),
    prompts: num(sess.get(u.id)?.prompts),
    toolCalls: num(sess.get(u.id)?.tools),
    activeMinutes: Math.round(num(sess.get(u.id)?.minutes)),
    tasksCompleted: num(tasksDone.get(u.id)?.n),
    decisions: num(adrs.get(u.id)?.n),
    patterns: num(pats.get(u.id)?.n),
    modulesOwned: ownedCount.get(u.id) ?? 0,
    pct: { lines: 0, commits: 0, tasks: 0, edits: 0, blended: 0 },
  }));

  // contribution % across multiple bases (each base normalized across the team)
  const sum = (sel: (c: CoderStat) => number) => coders.reduce((a, c) => a + sel(c), 0);
  const totLines = sum((c) => c.linesAdded);
  const totCommits = sum((c) => c.commits);
  const totTasks = sum((c) => c.tasksCompleted);
  const totEdits = sum((c) => c.edits);
  const pctOf = (v: number, tot: number) => (tot > 0 ? Math.round((v / tot) * 1000) / 10 : 0);

  for (const c of coders) {
    c.pct.lines = pctOf(c.linesAdded, totLines);
    c.pct.commits = pctOf(c.commits, totCommits);
    c.pct.tasks = pctOf(c.tasksCompleted, totTasks);
    c.pct.edits = pctOf(c.edits, totEdits);
    const bases = [
      totLines > 0 ? c.pct.lines : null,
      totCommits > 0 ? c.pct.commits : null,
      totTasks > 0 ? c.pct.tasks : null,
      totEdits > 0 ? c.pct.edits : null,
    ].filter((x): x is number => x !== null);
    c.pct.blended = bases.length ? Math.round((bases.reduce((a, b) => a + b, 0) / bases.length) * 10) / 10 : 0;
  }
  coders.sort((a, b) => b.pct.blended - a.pct.blended);

  // module breakdown (by git LOC)
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.username]));
  const colorOf = new Map(users.map((u) => [u.id, u.color]));
  const modules: ModuleStat[] = ownership.map((m) => {
    const rows = modLinesAgg.filter((r) => r.moduleId === m.moduleId && r.dev);
    const total = rows.reduce((a, r) => a + num(r.lines), 0);
    const contributors = rows
      .map((r) => ({ id: r.dev as string, name: nameOf.get(r.dev as string) ?? '?', color: colorOf.get(r.dev as string) ?? null, lines: num(r.lines), pct: pctOf(num(r.lines), total) }))
      .sort((a, b) => b.lines - a.lines);
    return { name: m.name, pathPrefix: m.pathPrefix, totalLines: total, contributors };
  });

  // timeline buckets
  const bucketSet = [...new Set(timelineAgg.map((r) => r.bucket))].sort();
  const timeline: TimelineBucket[] = bucketSet.map((t) => {
    const perCoder: Record<string, number> = {};
    for (const r of timelineAgg) {
      if (r.bucket === t && r.dev) perCoder[nameOf.get(r.dev) ?? '?'] = num(r.n);
    }
    return { t, perCoder };
  });

  // language + layer breakdown — git LOC if we have any, else live hook edits
  const useGit = gitFilesAgg.length > 0;
  const analysisBasis: 'lines' | 'edits' = useGit ? 'lines' : 'edits';
  const files2 = useGit
    ? gitFilesAgg.map((r) => ({ file: r.filePath, w: num(r.lines) }))
    : hookFilesAgg.filter((r) => r.filePath).map((r) => ({ file: r.filePath as string, w: num(r.n) }));
  const tally = (key: (f: string) => string): Breakdown[] => {
    const m = new Map<string, number>();
    for (const { file, w } of files2) m.set(key(file), (m.get(key(file)) ?? 0) + w);
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    return [...m.entries()]
      .map(([name, value]) => ({ name, value, pct: pctOf(value, total) }))
      .sort((a, b) => b.value - a.value);
  };

  return {
    generatedAt,
    coders,
    modules,
    timeline,
    languages: tally(languageOf),
    layers: tally(layerOf),
    analysisBasis,
    totals: { commits: totCommits, linesAdded: totLines, tasksCompleted: totTasks, activeMinutes: sum((c) => c.activeMinutes) },
  };
}
