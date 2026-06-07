import { useEffect, useState } from 'react';
import type { WsMessage } from '@team-coder/shared';
import { api, type FeedItem, type ModuleOwnership, type PresenceRow } from '../lib/api';
import { queryClient } from '../lib/query';
import { connectSocket, onMessage } from '../lib/socket';
import { useStore } from '../store';
import { Board } from './Board';
import { Ownership } from './Ownership';
import { Feed } from './Feed';
import { Tasks } from './Tasks';
import { Report } from './Report';

export function Dashboard() {
  const { token, connected, setConnected, hydratePresence, applyPresence, hydrateFeed, pushFeed, setOwnership, logout } =
    useStore();
  const [view, setView] = useState<'board' | 'report'>('board');

  useEffect(() => {
    if (!token) return;

    // hydrate live state once
    void api<PresenceRow[]>('/presence').then(hydratePresence).catch(() => {});
    void api<FeedItem[]>('/feed').then(hydrateFeed).catch(() => {});

    // wire the socket dispatcher
    const off = onMessage((msg: WsMessage) => {
      switch (msg.type) {
        case 'PRESENCE_UPDATE':
          applyPresence(msg.payload as PresenceRow);
          break;
        case 'ACTIVITY_EVENT':
          pushFeed(msg.payload as FeedItem);
          break;
        case 'OWNERSHIP_UPDATE':
          setOwnership(msg.payload as ModuleOwnership[]);
          break;
        case 'TASK_CREATED':
        case 'TASK_UPDATED':
        case 'TASK_DELETED':
          void queryClient.invalidateQueries({ queryKey: ['tasks'] });
          break;
        default:
          break;
      }
    });
    connectSocket(token, setConnected);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="app">
      <header>
        <h1>Team Coder</h1>
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'live' : 'connecting…'}</span>
        <nav className="view-tabs">
          <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>Board</button>
          <button className={view === 'report' ? 'active' : ''} onClick={() => setView('report')}>Report</button>
        </nav>
        <button className="logout" onClick={logout}>sign out</button>
      </header>
      {view === 'board' ? (
        <main>
          <div className="col-main">
            <Board />
            <Tasks />
          </div>
          <div className="col-side">
            <Ownership />
            <Feed />
          </div>
        </main>
      ) : (
        <Report />
      )}
    </div>
  );
}
