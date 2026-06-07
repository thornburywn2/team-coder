import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ModuleOwnership } from '../lib/api';
import { useStore } from '../store';

// Auto-inferred module ownership map. Hydrated from /api/modules/ownership, then
// kept live by OWNERSHIP_UPDATE broadcasts. Ownership is derived, not claimed.

export function Ownership() {
  const ownership = useStore((s) => s.ownership);
  const setOwnership = useStore((s) => s.setOwnership);
  const { data } = useQuery({
    queryKey: ['ownership'],
    queryFn: () => api<ModuleOwnership[]>('/modules/ownership'),
  });

  useEffect(() => {
    if (data) setOwnership(data);
  }, [data, setOwnership]);

  const rows = ownership.length ? ownership : (data ?? []);

  return (
    <section className="panel ownership">
      <h2>Module ownership <span className="muted small">auto-inferred</span></h2>
      <ul>
        {rows.map((m) => (
          <li key={m.moduleId}>
            <code className="prefix">{m.pathPrefix}</code>
            {m.ownerName ? (
              <span className="owner">
                <span className="dot sm" />
                {m.ownerName}
                {m.inferred && <span className="live-tag">live</span>}
              </span>
            ) : (
              <span className="muted">unowned</span>
            )}
            {m.contributors.length > 1 && (
              <span className="contribs">+{m.contributors.length - 1}</span>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="muted">No modules configured.</li>}
      </ul>
    </section>
  );
}
