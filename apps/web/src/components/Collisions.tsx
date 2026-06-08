import { useStore } from '../store';

// Advisory concurrent-edit banner. Shows when two coders touched the same file
// recently — soft and non-blocking (it never stops anyone), just makes contention
// visible so the team can coordinate. Warnings auto-expire (filtered by TTL here).

const TTL_MS = 10 * 60_000;

export function Collisions() {
  const collisions = useStore((s) => s.collisions);
  const active = collisions.filter((c) => Date.now() - c.ts < TTL_MS);
  if (active.length === 0) return null;

  return (
    <section className="panel collisions">
      {active.map((c) => (
        <div key={c.file} className="collision">
          <span className="collision-icon">⚠️</span>
          <span className="collision-who">{c.developers.map((d) => d.name).join(' & ')}</span>
          <span className="collision-text">are both editing</span>
          <code className="collision-file">{c.file}</code>
        </div>
      ))}
    </section>
  );
}
