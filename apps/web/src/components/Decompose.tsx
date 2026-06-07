import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { bulkCreateTasks, decompose, type DecomposeCandidate } from '../lib/api';
import { queryClient } from '../lib/query';
import { useStore } from '../store';

// Review panel for PRD → tasks. The server proposes candidates (deterministic
// markdown parse); the human curates here (toggle / rename) before committing.
// Nothing is written until "Add selected" — decomposition is always reviewable.

interface Row extends DecomposeCandidate {
  selected: boolean;
}

export function Decompose({ prd, onClose }: { prd: string; onClose: () => void }) {
  const meId = useStore((s) => s.meId);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    decompose(prd)
      .then((r) => { if (live) setRows(r.candidates.map((c) => ({ ...c, selected: true }))); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'decompose failed'); });
    return () => { live = false; };
  }, [prd]);

  const commit = useMutation({
    mutationFn: () => bulkCreateTasks((rows ?? []).filter((r) => r.selected && r.title.trim()), meId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      onClose();
    },
  });

  const selectedCount = rows?.filter((r) => r.selected && r.title.trim()).length ?? 0;
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="decompose panel">
      <div className="dc-head">
        <h3>Tasks from your PRD <span className="small muted">review before adding</span></h3>
        <button className="link-btn" onClick={onClose}>✕ close</button>
      </div>

      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">Reading your PRD…</p>}
      {rows && rows.length === 0 && <p className="muted">No tasks found — try adding checklist items or a Requirements/Features section.</p>}

      {rows && rows.length > 0 && (
        <>
          <div className="dc-toolbar">
            <button className="link-btn" onClick={() => setRows((rs) => rs!.map((r) => ({ ...r, selected: true })))}>select all</button>
            <button className="link-btn" onClick={() => setRows((rs) => rs!.map((r) => ({ ...r, selected: false })))}>none</button>
          </div>
          <ul className="dc-list">
            {rows.map((r, i) => (
              <li key={i} className={r.selected ? '' : 'off'}>
                <input type="checkbox" checked={r.selected} onChange={(e) => setRow(i, { selected: e.target.checked })} />
                <input className="dc-title" value={r.title} onChange={(e) => setRow(i, { title: e.target.value })} />
                {r.moduleName && <span className="dc-mod">{r.moduleName}</span>}
              </li>
            ))}
          </ul>
          <button className="dc-commit" disabled={!selectedCount || commit.isPending} onClick={() => commit.mutate()}>
            {commit.isPending ? 'Adding…' : `Add ${selectedCount} task${selectedCount === 1 ? '' : 's'} to the board`}
          </button>
          {commit.isError && <p className="error">Could not add tasks.</p>}
        </>
      )}
    </div>
  );
}
