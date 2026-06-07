import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, updatePrd, type ProjectInfo, type Task } from '../lib/api';
import { queryClient } from '../lib/query';
import { Decompose } from './Decompose';

// Project header on the board — the "what are we building" banner. Shows name,
// repo, overall progress AND progress vs the stated goal (PRD-derived tasks),
// plus PRD ingestion (edit/save) and one-click task generation from the PRD.

function repoLabel(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, '');
}

function pctOf(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

export function ProjectHeader() {
  const { data: project } = useQuery({ queryKey: ['project'], queryFn: () => api<ProjectInfo>('/projects/current') });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
  const [showPrd, setShowPrd] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [decomposing, setDecomposing] = useState(false);

  const save = useMutation({
    mutationFn: (prd: string) => updatePrd(prd),
    onSuccess: () => { setEditing(false); queryClient.invalidateQueries({ queryKey: ['project'] }); },
  });

  if (!project) return null;

  const overall = pctOf(tasks.filter((t) => t.status === 'done').length, tasks.length);
  const goal = tasks.filter((t) => t.source === 'prd');
  const goalPct = pctOf(goal.filter((t) => t.status === 'done').length, goal.length);
  const startEdit = () => { setDraft(project.prd ?? ''); setEditing(true); setShowPrd(true); };

  return (
    <section className="panel project-header">
      <div className="ph-top">
        <div className="ph-id">
          <h2 className="ph-name">{project.name}</h2>
          {project.githubRepoUrl && (
            <a className="ph-repo" href={project.githubRepoUrl} target="_blank" rel="noreferrer">{repoLabel(project.githubRepoUrl)} ↗</a>
          )}
        </div>
        <div className="ph-progress">
          <span className="ph-pct">{overall}%</span>
          <span className="small muted">{tasks.filter((t) => t.status === 'done').length}/{tasks.length} tasks</span>
          {goal.length > 0 && <span className="ph-goal small">🎯 goal {goalPct}% ({goal.filter((t) => t.status === 'done').length}/{goal.length})</span>}
        </div>
      </div>
      <div className="progress-bar"><div style={{ width: `${overall}%` }} /></div>

      <div className="ph-prd">
        {editing ? (
          <div className="prd-edit">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} placeholder="Paste your PRD / project goal as markdown. Use checklists (- [ ] …) or a Requirements/Features section for the cleanest task breakdown." />
            <div className="prd-actions">
              <button className="primary" disabled={save.isPending} onClick={() => save.mutate(draft)}>{save.isPending ? 'Saving…' : 'Save goal'}</button>
              <button className="link-btn" onClick={() => setEditing(false)}>cancel</button>
            </div>
          </div>
        ) : project.prd ? (
          <div className="prd-controls">
            <button className="link-btn" onClick={() => setShowPrd((v) => !v)}>{showPrd ? '▾ Hide goal' : '▸ Show goal (PRD)'}</button>
            <button className="link-btn" onClick={startEdit}>edit</button>
            <button className="gen-btn" onClick={() => setDecomposing(true)}>✨ Generate tasks from PRD</button>
            {showPrd && <pre className="prd-body">{project.prd}</pre>}
          </div>
        ) : (
          <div className="prd-empty">
            <span className="muted small">No project goal yet.</span>
            <button className="link-btn" onClick={startEdit}>+ Add goal (PRD)</button>
          </div>
        )}
      </div>

      {decomposing && project.prd && <Decompose prd={project.prd} onClose={() => setDecomposing(false)} />}
    </section>
  );
}
