// Shared enums — the single vocabulary the portal, the API, and the MCP server
// all speak. Mirror these in the Postgres schema (P1) as native enum types.

export const TASK_STATUS = ['todo', 'in_progress', 'in_review', 'done', 'blocked'] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

// How a task entered the board: hand-added ('manual') vs derived from the project
// PRD via decomposition ('prd'). Lets the board measure progress vs the stated goal.
export const TASK_SOURCE = ['manual', 'prd'] as const;
export type TaskSource = (typeof TASK_SOURCE)[number];

export const PROPOSAL_STATUS = ['draft', 'open', 'accepted', 'rejected', 'withdrawn'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUS)[number];

export const ADR_STATUS = ['proposed', 'accepted', 'deprecated', 'superseded'] as const;
export type AdrStatus = (typeof ADR_STATUS)[number];

export const VOTE_VALUE = ['approve', 'reject', 'abstain'] as const;
export type VoteValue = (typeof VOTE_VALUE)[number];

// Polymorphic comment / activity targets.
export const ENTITY_TYPE = ['task', 'proposal', 'adr', 'code_pattern', 'comment', 'module'] as const;
export type EntityType = (typeof ENTITY_TYPE)[number];

export const EVENT_ACTION = [
  'created', 'updated', 'deleted', 'status_changed', 'commented', 'voted', 'claimed', 'completed',
] as const;
export type EventAction = (typeof EVENT_ACTION)[number];

// Derived live presence for a coder, computed from hook event recency.
export const PRESENCE_STATUS = ['active', 'thinking', 'idle', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUS)[number];

// Claude Code hook events we ingest (subset that carries coordination signal).
export const HOOK_EVENT = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
] as const;
export type HookEvent = (typeof HOOK_EVENT)[number];
