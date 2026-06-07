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
}

export interface Note {
  id: string;
  projectId: string;
  authorId: string | null;
  content: string;
  pinned: boolean;
  createdAt: string;
}

// Create a project (open — no token yet). Mints a fresh team token + seeds coders.
export async function createProject(name: string, githubRepoUrl?: string): Promise<CreatedProject> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, githubRepoUrl: githubRepoUrl || undefined }),
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
  assigneeId: string | null;
  moduleId: string | null;
  filePaths: string[];
  createdAt: string;
  updatedAt: string;
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

export interface Report {
  generatedAt: string;
  coders: CoderStat[];
  modules: ModuleStat[];
  timeline: { t: string; perCoder: Record<string, number> }[];
  totals: { commits: number; linesAdded: number; tasksCompleted: number; activeMinutes: number };
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
