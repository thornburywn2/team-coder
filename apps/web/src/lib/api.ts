// Thin REST helper. The shared team token rides on every request (x-team-token).

export function getToken(): string {
  return localStorage.getItem('tc_token') ?? '';
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'x-team-token': getToken(),
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  color: string | null;
}

export interface ProjectInfo {
  id: string;
  name: string;
  githubRepoUrl: string | null;
  prd: string | null;
}

// returned once by POST /api/projects — the token is shown to the creator
export interface CreatedProject {
  id: string;
  name: string;
  token: string;
  githubRepoUrl: string | null;
  coders?: { id: string; username: string; displayName: string | null; agentToken: string }[];
}

export interface Note {
  id: string;
  projectId: string;
  authorId: string | null;
  content: string;
  pinned: boolean;
  createdAt: string;
}

// Create a project (open — no token yet). Mints a fresh team token + seeds the
// roster from `members` (the names entered at creation; SSO will replace this).
export async function createProject(name: string, githubRepoUrl?: string, members?: string[]): Promise<CreatedProject> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, githubRepoUrl: githubRepoUrl || undefined, members }),
  });
  if (!res.ok) throw new Error(`Could not create project (${res.status})`);
  return res.json() as Promise<CreatedProject>;
}

export interface PresenceRow {
  userId: string;
  status: 'active' | 'thinking' | 'idle' | 'offline';
  lastSeen: string;
  sessionId: string | null;
  currentTaskId: string | null;
  currentFile: string | null;
  currentPrompt: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
  source: 'manual' | 'prd' | 'proposal';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  tags: string[];
  dueDate: string | null;
  assigneeId: string | null;
  moduleId: string | null;
  filePaths: string[];
  createdAt: string;
  updatedAt: string;
}

// A proposed task from PRD decomposition (preview — not yet persisted).
export interface DecomposeCandidate {
  title: string;
  description?: string;
  moduleId?: string;
  moduleName?: string;
}

// Save the project goal/PRD.
export function updatePrd(prd: string): Promise<ProjectInfo> {
  return api<ProjectInfo>('/projects/current/prd', { method: 'PUT', body: JSON.stringify({ prd }) });
}

// Preview tasks decomposed from a PRD (uses the saved one if `prd` omitted).
export function decompose(prd?: string): Promise<{ candidates: DecomposeCandidate[] }> {
  return api('/projects/current/decompose', { method: 'POST', body: JSON.stringify({ prd }) });
}

// Commit selected candidate tasks to the board (marked source='prd').
export function bulkCreateTasks(tasks: DecomposeCandidate[], reporterId?: string | null) {
  return api<{ created: number }>('/tasks/bulk', { method: 'POST', body: JSON.stringify({ tasks, reporterId }) });
}

export interface ConnectionStatus {
  userId: string;
  lastMcp: number;
  lastHook: number;
}

export interface ConnectInfo {
  id: string;
  username: string;
  displayName: string | null;
  agentToken: string | null;
  connection: ConnectionStatus;
}

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
  tokensIn: number;
  tokensOut: number;
  activeMinutes: number;
  tasksCompleted: number;
  decisions: number;
  patterns: number;
  modulesOwned: number;
  pct: { lines: number; commits: number; tasks: number; edits: number; blended: number };
  languages: Breakdown[];
  layers: Breakdown[];
}

export interface ModuleStat {
  name: string;
  pathPrefix: string;
  totalLines: number;
  contributors: { id: string; name: string; color: string | null; lines: number; pct: number }[];
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
  timeline: { t: string; perCoder: Record<string, number> }[];
  timelineUnit: 'hour' | 'day';
  languages: Breakdown[];
  layers: Breakdown[];
  analysisBasis: 'lines' | 'edits';
  totals: { commits: number; linesAdded: number; tasksCompleted: number; activeMinutes: number; tokensIn: number; tokensOut: number };
}

export interface Agent {
  sessionId: string;
  developerId: string | null;
  developerName: string;
  color: string | null;
  startedAt: string;
  lastSeenAt: string;
  prompts: number;
  tools: number;
  activeMinutes: number;
  filesTouched: number;
  currentFile: string | null;
  status: 'active' | 'idle' | 'away';
}

export function listAgents() {
  return api<Agent[]>('/agents');
}

export interface AwardEntry {
  developerId: string;
  name: string;
  color: string | null;
  award: { title: string; emoji: string; reason: string };
  tasksDone: number;
  prompts: number;
  tools: number;
  linesAdded: number;
  filesTouched: number;
  activeMinutes: number;
  topLanguage: string | null;
  topLayer: string | null;
  activeAgents: number;
}

// Team awards (positive "leaderboard" — everyone gets one, reflecting a strength).
export function getAwards() {
  return api<AwardEntry[]>('/leaderboard');
}

// ── Messaging + proposals ────────────────────────────────────────────────────
export type VoteValue = 'approve' | 'reject' | 'abstain';
export type ProposalStatus = 'draft' | 'open' | 'accepted' | 'rejected' | 'withdrawn';

export interface Proposal {
  id: string;
  title: string;
  description: string | null;
  status: ProposalStatus;
  authorId: string | null;
  experimentBranch: string | null;
  codeSnippet: string | null;
  language: string | null;
  createdAt: string;
  updatedAt: string;
  tally: { approve: number; reject: number; abstain: number };
  votes: { voterId: string; vote: VoteValue }[];
  commentCount: number;
}

export interface Pattern {
  id: string;
  title: string;
  description: string | null;
  codeSnippet: string;
  language: string | null;
  tags: string[];
  authorId: string | null;
  createdAt: string;
}

export function listPatterns() {
  return api<Pattern[]>('/patterns');
}
export function createPattern(p: { title: string; code: string; description?: string; language?: string; tags?: string[] }, authorId?: string | null) {
  return api<Pattern>('/patterns', { method: 'POST', body: JSON.stringify({ ...p, authorId }) });
}
export function deletePattern(id: string) {
  return api(`/patterns/${id}`, { method: 'DELETE' });
}

export interface Decision {
  id: string;
  seq: number;
  title: string;
  context: string;
  decision: string;
  status: string;
  authorId: string | null;
  createdAt: string;
}

export interface Comment {
  id: string;
  authorId: string;
  targetType: string;
  targetId: string;
  parentId: string | null;
  content: string;
  createdAt: string;
}

export function createProposal(p: { title: string; description?: string; experimentBranch?: string; codeSnippet?: string; language?: string }, authorId?: string | null) {
  return api<Proposal>('/proposals', { method: 'POST', body: JSON.stringify({ ...p, authorId }) });
}
export function voteProposal(id: string, vote: VoteValue, voterId: string | null) {
  return api(`/proposals/${id}/vote`, { method: 'POST', body: JSON.stringify({ vote, voterId }) });
}
export function setProposalStatus(id: string, status: ProposalStatus, actorId: string | null) {
  return api<Proposal & { adopted?: { tasks: number; adr: boolean; pattern: boolean } }>(`/proposals/${id}/status`, { method: 'POST', body: JSON.stringify({ status, actorId }) });
}
export function listComments(targetType: string, targetId: string) {
  return api<Comment[]>(`/comments?targetType=${targetType}&targetId=${targetId}`);
}
export function postComment(targetType: string, targetId: string, content: string, authorId: string | null, parentId?: string) {
  return api<Comment>('/comments', { method: 'POST', body: JSON.stringify({ targetType, targetId, content, authorId, parentId }) });
}

export interface ModuleOwnership {
  moduleId: string;
  name: string;
  pathPrefix: string;
  ownerId: string | null;
  ownerName: string | null;
  inferred: boolean;
  contributors: { developerId: string; name: string; edits: number }[];
}

export interface Summary {
  tasks: { total: number; done: number; blocked: number; inProgress: number };
  activeCoders: number;
  liveAgents: number;
  liveSessions: number;
  openProposals: number;
  commits: number;
  linesAdded: number;
  tokens: number;
}

export function getSummary() {
  return api<Summary>('/summary');
}

export interface RepoStatus {
  repoUrl: string | null;
  commitCount: number;
  latest: { sha: string; committedAt: string | null; authorName: string | null; message: string | null } | null;
}
export function getRepoStatus() {
  return api<RepoStatus>('/repo/status');
}

export interface Usage {
  coders: { developerId: string; name: string; color: string | null; tokensIn: number; tokensOut: number; total: number }[];
  total: number;
}
export function getUsage() {
  return api<Usage>('/usage');
}

export interface BurndownPoint { date: string; scope: number; done: number; remaining: number }
export interface Burndown { series: BurndownPoint[]; total: number; done: number }
export function getBurndown() {
  return api<Burndown>('/burndown');
}

export interface TokenTrend { series: { date: string; tokens: number }[]; total: number }
export function getTokenTrend() {
  return api<TokenTrend>('/usage/trend');
}

export interface Lock { file: string; holderId: string; holderName: string; ts: number }
export function getLocks() {
  return api<Lock[]>('/locks');
}

export interface CollisionWarning {
  file: string;
  developers: { id: string; name: string }[];
  ts: number;
}

export interface FeedItem {
  id: string;
  ts: number;
  developerId?: string;
  developer?: string;
  color?: string;
  kind: string;
  detail?: string;
  file?: string;
}
