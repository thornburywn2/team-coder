// The single WebSocket message envelope spoken between the Hono server and the
// React portal. Server broadcasts state deltas; client may send AUTH + filter
// subscription. Defined once here so both ends stay in lockstep.

export const WS_SERVER_MSG = [
  'HELLO', // sent on connect (server -> client)
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_DELETED',
  'PRESENCE_UPDATE',
  'ACTIVITY_EVENT',
  'OWNERSHIP_UPDATE',
  'COLLISION_WARNING',
  'PROPOSAL_UPDATED', // a proposal was created / changed status
  'VOTE_CAST', // a vote landed on a proposal (payload: { proposalId })
  'COMMENT_ADDED', // a comment was posted on a task or proposal
  'NOTE_ADDED', // a project note was posted (project_notes insert)
] as const;
export type WsServerMsgType = (typeof WS_SERVER_MSG)[number];

export const WS_CLIENT_MSG = [
  'AUTH', // { token } — must arrive within the auth window or the socket closes
  'SUBSCRIBE', // { filter } — narrow which events this client receives
  'PING',
] as const;
export type WsClientMsgType = (typeof WS_CLIENT_MSG)[number];

export interface WsMessage<T = unknown> {
  type: WsServerMsgType | WsClientMsgType;
  payload?: T;
  meta?: {
    developerId?: string;
    projectId?: string; // isolation tag — sockets only receive their project's deltas
    ts?: number;
  };
}

export interface WsClientFilter {
  developerIds?: string[];
  eventTypes?: string[];
}
