import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ProjectInfo, type Task } from '../lib/api';

// Project header on the board — the "what are we building" banner. Shows the
// project name, its repo, the PRD/goal (collapsible), and overall progress so
// everyone shares one source of truth for the project they're connected to.

function repoLabel(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, '');
}

export function ProjectHeader() {
  const { data: project } = useQuery({ queryKey: ['project'], queryFn: () => api<ProjectInfo>('/projects/current') });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
  const [showPrd, setShowPrd] = useState(false);

  if (!project) return null;

  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <section className="panel project-header">
      <div className="ph-top">
        <div className="ph-id">
          <h2 className="ph-name">{project.name}</h2>
          {project.githubRepoUrl && (
            <a className="ph-repo" href={project.githubRepoUrl} target="_blank" rel="noreferrer">
              {repoLabel(project.githubRepoUrl)} ↗
            </a>
          )}
        </div>
        <div className="ph-progress">
          <span className="ph-pct">{pct}%</span>
          <span className="small muted">{done}/{tasks.length} tasks done</span>
        </div>
      </div>
      <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
      {project.prd && (
        <div className="ph-prd">
          <button className="link-btn" onClick={() => setShowPrd((v) => !v)}>
            {showPrd ? '▾ Hide project goal' : '▸ Show project goal (PRD)'}
          </button>
          {showPrd && <pre className="prd-body">{project.prd}</pre>}
        </div>
      )}
    </section>
  );
}
