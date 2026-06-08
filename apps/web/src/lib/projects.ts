// Remembered projects for the in-app switcher: maps a team token → project name so
// you can hop between projects without re-typing tokens. Stored locally only.

export interface KnownProject { token: string; name: string }

const KEY = 'tc_known_projects';

export function knownProjects(): KnownProject[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as KnownProject[]; } catch { return []; }
}

export function rememberProject(token: string, name: string): void {
  if (!token || !name) return;
  const list = knownProjects().filter((p) => p.token !== token);
  list.unshift({ token, name });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
}

// Switch the active project: set the token, drop the per-project identity, reload.
export function switchProject(token: string): void {
  localStorage.setItem('tc_token', token);
  localStorage.removeItem('tc_me'); // identity is per-project; re-pick a coder
  location.reload();
}
