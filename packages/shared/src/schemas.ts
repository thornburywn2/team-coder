import { z } from 'zod';
import {
  TASK_STATUS,
  PROPOSAL_STATUS,
  ADR_STATUS,
  VOTE_VALUE,
  ENTITY_TYPE,
  HOOK_EVENT,
} from './enums';

// ── Core entities (lightweight; the DB layer in P1 is the source of truth for
//    columns/defaults — these validate API + MCP boundaries) ──────────────────

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  status: z.enum(TASK_STATUS),
  assigneeId: z.string().uuid().nullable().optional(),
  reporterId: z.string().uuid().nullable().optional(),
  moduleId: z.string().uuid().nullable().optional(),
  filePaths: z.array(z.string()).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const ProposalSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  status: z.enum(PROPOSAL_STATUS),
  authorId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime().optional(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const VoteSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  voterId: z.string().uuid(),
  vote: z.enum(VOTE_VALUE),
  comment: z.string().nullable().optional(),
});
export type Vote = z.infer<typeof VoteSchema>;

export const AdrSchema = z.object({
  id: z.string().uuid(),
  sequenceNum: z.number().int().positive(),
  title: z.string().min(1).max(255),
  context: z.string(),
  decision: z.string(),
  consequences: z.string().nullable().optional(),
  status: z.enum(ADR_STATUS),
});
export type Adr = z.infer<typeof AdrSchema>;

export const CodePatternSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  codeSnippet: z.string(),
  language: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
});
export type CodePattern = z.infer<typeof CodePatternSchema>;

export const CommentSchema = z.object({
  id: z.string().uuid(),
  authorId: z.string().uuid(),
  targetType: z.enum(ENTITY_TYPE),
  targetId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  content: z.string().min(1),
});
export type Comment = z.infer<typeof CommentSchema>;

// ── Claude Code hook ingestion payload (POST /hooks/event) ───────────────────
// Identity is carried out-of-band in the X-Developer-Id header (trunk model:
// per-coder attribution, no worktrees). This validates the JSON body.

export const HookEventSchema = z.object({
  hook_event_name: z.enum(HOOK_EVENT),
  session_id: z.string(),
  cwd: z.string().optional(),
  transcript_path: z.string().optional(),
  permission_mode: z.string().optional(),
  tool_name: z.string().optional(),
  // tool_input varies by tool; we only deeply use file_path (Write/Edit) and
  // command (Bash) downstream, so keep it permissive here.
  tool_input: z.record(z.string(), z.unknown()).optional(),
  tool_use_id: z.string().optional(),
  // UserPromptSubmit carries the raw prompt — scrubbed for secrets server-side
  // before persistence.
  prompt: z.string().optional(),
  last_assistant_message: z.string().optional(),
  agent_transcript_path: z.string().optional(),
});
export type HookEventPayload = z.infer<typeof HookEventSchema>;
