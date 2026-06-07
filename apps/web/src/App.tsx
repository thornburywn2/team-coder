import { useStore } from './store';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';

export function App() {
  const token = useStore((s) => s.token);
  const meId = useStore((s) => s.meId);
  return token && meId ? <Dashboard /> : <Login />;
}
