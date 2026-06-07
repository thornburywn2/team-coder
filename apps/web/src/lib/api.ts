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
