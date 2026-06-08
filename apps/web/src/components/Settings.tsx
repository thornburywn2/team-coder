import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { addMember, archiveProject, editMember, getTeam, patchProject, removeMember, rotateMemberToken, rotateTeamToken, type ProjectInfo, type TeamMember, api } from '../lib/api';
import { queryClient } from '../lib/query';
import { copyText } from '../lib/clipboard';

// Project + team management (lives in the Connect tab so we keep the board to 3
// tabs). Rename the project, point it at a repo, toggle git-poll, rotate tokens,
// and add/edit/remove coders + fix their git emails for attribution.

export function Settings() {
  const { data: project } = useQuery({ queryKey: ['project'], queryFn: () => api<ProjectInfo>('/projects/current') });
  const { data: team = [] } = useQuery({ queryKey: ['team'], queryFn: getTeam });
  const invalidate = () => { queryClient.invalidateQueries({ queryKey: ['team'] }); queryClient.invalidateQueries({ queryKey: ['users'] }); queryClient.invalidateQueries({ queryKey: ['project'] }); };

  return (
    <section className="panel settings">
      <h2>⚙️ Settings</h2>
      {project && <ProjectSettings project={project} onChange={invalidate} />}
      <TeamSettings team={team} onChange={invalidate} />
    </section>
  );
}

function ProjectSettings({ project, onChange }: { project: ProjectInfo; onChange: () => void }) {
  const [name, setName] = useState(project.name);
  const [repo, setRepo] = useState(project.githubRepoUrl ?? '');
  const [rotated, setRotated] = useState<string | null>(null);
  useEffect(() => { setName(project.name); setRepo(project.githubRepoUrl ?? ''); }, [project.name, project.githubRepoUrl]);
  const save = useMutation({ mutationFn: () => patchProject({ name, githubRepoUrl: repo || null }), onSuccess: onChange });
  const rotate = useMutation({ mutationFn: rotateTeamToken, onSuccess: (r) => setRotated(r.token) });
  const archive = useMutation({ mutationFn: archiveProject, onSuccess: onChange });

  return (
    <div className="settings-block">
      <h3>Project</h3>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} aria-label="project name" /></label>
      <label>Repo URL <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/org/repo.git" aria-label="repository URL" /></label>
      <div className="settings-actions">
        <button onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
        <button onClick={() => rotate.mutate()} disabled={rotate.isPending} title="Invalidate the current team token and issue a new one">Rotate team token</button>
        <button className="danger" onClick={() => { if (confirm('Archive this project? It will be hidden from active lists (data is kept).')) archive.mutate(); }}>Archive</button>
      </div>
      {rotated && (
        <p className="settings-note">New team token (share it; the old one no longer works): <code>{rotated}</code> <button className="link-btn" onClick={() => copyText(rotated)}>copy</button></p>
      )}
    </div>
  );
}

function TeamSettings({ team, onChange }: { team: TeamMember[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const add = useMutation({ mutationFn: () => addMember(name.trim()), onSuccess: (u) => { setCreated({ name: u.displayName ?? u.username, token: u.agentToken }); setName(''); onChange(); } });

  return (
    <div className="settings-block">
      <h3>Team</h3>
      <ul className="settings-team">
        {team.map((m) => <MemberRow key={m.id} m={m} onChange={onChange} />)}
      </ul>
      <div className="settings-actions">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New coder name" aria-label="new coder name" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) add.mutate(); }} />
        <button onClick={() => add.mutate()} disabled={!name.trim() || add.isPending}>Add coder</button>
      </div>
      {created && (
        <p className="settings-note">{created.name}'s agent token: <code>{created.token}</code> <button className="link-btn" onClick={() => copyText(created.token)}>copy</button></p>
      )}
    </div>
  );
}

function MemberRow({ m, onChange }: { m: TeamMember; onChange: () => void }) {
  const [email, setEmail] = useState(m.email ?? '');
  const [gitEmails, setGitEmails] = useState((m.gitEmails ?? []).join(', '));
  const [token, setToken] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => editMember(m.id, { email: email || null, gitEmails: gitEmails.split(',').map((s) => s.trim()).filter(Boolean) }), onSuccess: onChange });
  const rotate = useMutation({ mutationFn: () => rotateMemberToken(m.id), onSuccess: (r) => setToken(r.agentToken) });
  const remove = useMutation({ mutationFn: () => removeMember(m.id), onSuccess: onChange });

  return (
    <li className="settings-member">
      <span className="who"><span className="dot sm" style={{ background: m.color ?? '#888' }} />{m.displayName ?? m.username}</span>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="login email" aria-label={`${m.username} login email`} />
      <input value={gitEmails} onChange={(e) => setGitEmails(e.target.value)} placeholder="git emails (comma-sep)" aria-label={`${m.username} git emails`} />
      <button className="link-btn" onClick={() => save.mutate()} disabled={save.isPending}>save</button>
      <button className="link-btn" onClick={() => rotate.mutate()} title="Issue a new agent token (revokes the old one)">rotate</button>
      <button className="link-btn danger" onClick={() => { if (confirm(`Remove ${m.displayName ?? m.username}?`)) remove.mutate(); }}>remove</button>
      {token && <span className="settings-note">new token: <code>{token}</code> <button className="link-btn" onClick={() => copyText(token)}>copy</button></span>}
    </li>
  );
}
