export {}; // module marker for top-level await

// #36 acceptance check: proposals (design-evolution channel) + messaging
// (anchored comment threads). Proves create/vote/status, vote upsert + tallies,
// comments on proposals AND tasks, live WS deltas (PROPOSAL_UPDATED / VOTE_CAST /
// COMMENT_ADDED), and project isolation. Requires the server running + db:seed.

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 6300}`;
const WS_URL = process.env.WS_URL ?? `ws://localhost:${process.env.PORT ?? 6300}/ws`;
import { deleteProjectsByToken } from './test-utils';

const TOKEN_A = process.env.TEAM_TOKEN ?? 'change-me-team-token';
const cleanup: string[] = [];

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) ok = false;
};
const hdr = (t: string) => ({ 'x-team-token': t, 'content-type': 'application/json' });
async function jget<T>(t: string, p: string): Promise<T> {
  const r = await fetch(`${BASE}${p}`, { headers: hdr(t) });
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
  return r.json() as Promise<T>;
}
async function jpost(t: string, p: string, body: unknown) {
  return fetch(`${BASE}${p}`, { method: 'POST', headers: hdr(t), body: JSON.stringify(body) });
}

interface Proposal { id: string; status: string; tally: { approve: number; reject: number; abstain: number }; commentCount: number; }

try {
  // isolated project B + its coders
  const projB = (await (await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Proposals ${Math.floor(performance.now())}` }) })).json()) as { token: string };
  const T = projB.token;
  cleanup.push(T);
  const usersB = await jget<Array<{ id: string }>>(T, '/api/users');
  const [v0, v1] = usersB;

  // open a socket scoped to B and collect message types
  const got = new Set<string>();
  const proposalId = await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let pid = '';
    ws.onerror = () => reject(new Error('socket error'));
    ws.onmessage = async (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string };
      if (msg.type === 'HELLO') {
        ws.send(JSON.stringify({ type: 'AUTH', payload: { token: T } }));
        ws.send(JSON.stringify({ type: 'SUBSCRIBE', payload: { eventTypes: ['PROPOSAL_UPDATED', 'VOTE_CAST', 'COMMENT_ADDED'] } }));
        setTimeout(async () => {
          const p = (await (await jpost(T, '/api/proposals', { title: 'Adopt the new router', description: 'faster', experimentBranch: 'exp/router', authorId: v0?.id })).json()) as { id: string };
          pid = p.id;
          await jpost(T, `/api/proposals/${pid}/vote`, { voterId: v0?.id, vote: 'approve' });
          await jpost(T, `/api/proposals/${pid}/vote`, { voterId: v1?.id, vote: 'reject' });
          await jpost(T, `/api/proposals/${pid}/vote`, { voterId: v0?.id, vote: 'reject' }); // re-vote (upsert)
          await jpost(T, '/api/comments', { targetType: 'proposal', targetId: pid, content: 'I disagree — slower in our benchmarks', authorId: v1?.id });
          setTimeout(() => { ws.close(); resolve(pid); }, 1000);
        }, 400);
        return;
      }
      got.add(msg.type);
    };
  });

  check(got.has('PROPOSAL_UPDATED'), 'PROPOSAL_UPDATED delivered live on create');
  check(got.has('VOTE_CAST'), 'VOTE_CAST delivered live on vote');
  check(got.has('COMMENT_ADDED'), 'COMMENT_ADDED delivered live on comment');

  // tallies reflect the upsert: v0 re-voted approve→reject, so reject=2, approve=0
  const list = await jget<Proposal[]>(T, '/api/proposals');
  const prop = list.find((p) => p.id === proposalId)!;
  check(!!prop, 'proposal listed for project B');
  check(prop.tally.approve === 0 && prop.tally.reject === 2, `vote upsert tally correct (approve=${prop.tally.approve}, reject=${prop.tally.reject})`);
  check(prop.commentCount === 1, `commentCount = 1 (got ${prop.commentCount})`);

  // comment thread on the proposal is readable
  const thread = await jget<Array<{ content: string }>>(T, `/api/comments?targetType=proposal&targetId=${proposalId}`);
  check(thread.length === 1 && thread[0]!.content.includes('disagree'), 'proposal thread returns the comment');

  // messaging also works anchored to a task (separate thread)
  const task = (await (await jpost(T, '/api/tasks', { title: 'task to discuss' })).json()) as { id: string };
  await jpost(T, '/api/comments', { targetType: 'task', targetId: task.id, content: 'how should we split this?', authorId: v0?.id });
  const taskThread = await jget<Array<{ content: string }>>(T, `/api/comments?targetType=task&targetId=${task.id}`);
  check(taskThread.length === 1, 'task discussion thread works');

  // status transition
  await jpost(T, `/api/proposals/${proposalId}/status`, { status: 'accepted', actorId: v0?.id });
  const after = (await jget<Proposal[]>(T, '/api/proposals')).find((p) => p.id === proposalId)!;
  check(after.status === 'accepted', `status moved to accepted (got ${after.status})`);

  // isolation: the default project never sees B's proposal
  const listA = await jget<Proposal[]>(TOKEN_A, '/api/proposals');
  check(!listA.some((p) => p.id === proposalId), 'proposal did NOT leak into the default project');

  // validation
  check((await jpost(T, `/api/proposals/${proposalId}/vote`, { voterId: v0?.id, vote: 'maybe' })).status === 400, 'invalid vote → 400');
  check((await jpost(T, `/api/proposals/${proposalId}/vote`, { voterId: '00000000-0000-0000-0000-000000000000', vote: 'approve' })).status === 400, 'unknown voter → 400 (not a 500 FK error)');
  check((await jpost(T, '/api/comments', { targetType: 'task', targetId: task.id, authorId: v0?.id })).status === 400, 'empty comment → 400');
} catch (err) {
  console.error('❌', err instanceof Error ? err.message : err);
  ok = false;
} finally {
  await deleteProjectsByToken(...cleanup);
}

console.log(ok ? '\n[verify-proposals] ✅ proposals + messaging live & isolated' : '\n[verify-proposals] ❌ failed');
process.exit(ok ? 0 : 1);
