import { useEffect, useState } from 'react';

// P0 scaffold UI: confirms the web app runs and can reach the Bun server's
// /health through the Vite proxy. Replaced by the live board in P3.
export function App() {
  const [health, setHealth] = useState<string>('checking…');

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then((d) => setHealth(`ok — ${d.runtime}`))
      .catch(() => setHealth('server unreachable (start the Bun server)'));
  }, []);

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '4rem auto',
        padding: '0 1rem',
        lineHeight: 1.5,
      }}
    >
      <h1>Team Coder</h1>
      <p style={{ color: '#666' }}>
        Coordination portal for a team of vibe coders. P0 scaffold is live.
      </p>
      <p>
        Server health: <strong>{health}</strong>
      </p>
    </main>
  );
}
