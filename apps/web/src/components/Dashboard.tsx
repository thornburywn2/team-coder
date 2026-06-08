import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WsMessage } from '@team-coder/shared';
import { api, type CollisionWarning, type FeedItem, type ModuleOwnership, type PresenceRow, type ProjectInfo } from '../lib/api';
import { queryClient } from '../lib/query';
import { connectSocket, onMessage } from '../lib/socket';
import { useStore } from '../store';
import { Board } from './Board';
import { ProjectHeader } from './ProjectHeader';
import { Collisions } from './Collisions';
import { Kpis } from './Kpis';
import { Ownership } from './Ownership';
import { Feed } from './Feed';
import { Notes } from './Notes';
import { Tasks } from './Tasks';
import { Blockers } from './Blockers';
import { LiveAgents } from './LiveAgents';
import { ProposalsWidget } from './ProposalsWidget';
import { Awards } from './Awards';
import { RepoStatus } from './RepoStatus';
import { Burndown } from './Burndown';
import { MyWork } from './MyWork';
import { StaleTasks } from './StaleTasks';
import { Report } from './Report';
import { Proposals } from './Proposals';
import { Patterns } from './Patterns';
import { Connect } from './Connect';

export function Dashboard() {
  const { token, connected, setConnected, hydratePresence, applyPresence, hydrateFeed, pushFeed, setOwnership, hydrateCollisions, pushCollision, logout } =
    useStore();
  const [view, setView] = useState<'board' | 'proposals' | 'patterns' | 'report' | 'connect'>('board');
  const { data: project } = useQuery({ queryKey: ['project'], queryFn: () => api<ProjectInfo>('/projects/current') });

  useEffect(() => {
    if (!token) return;

    // hydrate live state once
    void api<PresenceRow[]>('/presence').then(hydratePresence).catch(() => {});
    void api<FeedItem[]>('/feed').then(hydrateFeed).catch(() => {});
    void api<CollisionWarning[]>('/collisions').then(hydrateCollisions).catch(() => {});

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
        case 'COLLISION_WARNING':
          pushCollision(msg.payload as CollisionWarning);
          break;
        case 'TASK_CREATED':
        case 'TASK_UPDATED':
        case 'TASK_DELETED':
          void queryClient.invalidateQueries({ queryKey: ['tasks'] });
          void queryClient.invalidateQueries({ queryKey: ['summary'] });
          void queryClient.invalidateQueries({ queryKey: ['burndown'] });
          break;
        case 'NOTE_ADDED':
          void queryClient.invalidateQueries({ queryKey: ['notes'] });
          break;
        case 'PATTERN_ADDED':
          void queryClient.invalidateQueries({ queryKey: ['patterns'] });
          break;
        case 'REPO_UPDATED':
          void queryClient.invalidateQueries({ queryKey: ['repo-status'] });
          void queryClient.invalidateQueries({ queryKey: ['summary'] });
          void queryClient.invalidateQueries({ queryKey: ['report'] });
          break;
        case 'PROPOSAL_UPDATED':
        case 'VOTE_CAST':
          void queryClient.invalidateQueries({ queryKey: ['proposals'] });
          break;
        case 'COMMENT_ADDED': {
          const c = msg.payload as { targetType?: string; targetId?: string };
          if (c?.targetType && c?.targetId) void queryClient.invalidateQueries({ queryKey: ['comments', c.targetType, c.targetId] });
          if (c?.targetType === 'proposal') void queryClient.invalidateQueries({ queryKey: ['proposals'] });
          break;
        }
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
        {project && <span className="project-chip">{project.name}</span>}
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'live' : 'connecting…'}</span>
        <nav className="view-tabs">
          <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>Board</button>
          <button className={view === 'proposals' ? 'active' : ''} onClick={() => setView('proposals')}>Proposals</button>
          <button className={view === 'patterns' ? 'active' : ''} onClick={() => setView('patterns')}>Reuse kit</button>
          <button className={view === 'report' ? 'active' : ''} onClick={() => setView('report')}>Report</button>
          <button className={view === 'connect' ? 'active' : ''} onClick={() => setView('connect')}>Connect agent</button>
        </nav>
        <button className="logout" onClick={logout}>sign out</button>
      </header>
      {view === 'board' ? (
        <div className="board-view">
          <div className="board-top">
            <Collisions />
            <ProjectHeader />
            <Kpis />
          </div>
          <div className="board-grid">
            {/* Elevated: the most important work + what needs the engineer's attention */}
            <div className="w12 section-label" title="The important items, elevated: your priority work, what's blocked, and what's gone quiet">⭐ Needs your attention</div>
            <div className="w4"><MyWork /></div>
            <div className="w4"><Blockers /></div>
            <div className="w4"><StaleTasks /></div>

            {/* The work: who's on what, the full backlog, decisions, context */}
            <div className="w12 section-label" title="Live team activity, the full backlog, and decisions in flight">📋 The work</div>
            <div className="w8"><Board /></div>
            <div className="w4"><LiveAgents /></div>
            <div className="w8"><Tasks /></div>
            <div className="w4 col-stack">
              <Ownership />
              <RepoStatus />
            </div>
            <div className="w6"><ProposalsWidget onOpenTab={() => setView('proposals')} /></div>
            <div className="w6"><Notes /></div>
            <div className="w6"><Feed /></div>
            <div className="w6"><Awards /></div>

            {/* Trends: larger charts live at the bottom */}
            <div className="w12 section-label" title="Progress over time — larger charts live here">📈 Trends</div>
            <div className="w12"><Burndown /></div>
          </div>
        </div>
      ) : view === 'proposals' ? (
        <Proposals />
      ) : view === 'patterns' ? (
        <Patterns />
      ) : view === 'report' ? (
        <Report />
      ) : (
        <Connect />
      )}
    </div>
  );
}
