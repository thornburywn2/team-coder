#!/usr/bin/env bun
// Team Coder — automatic token capture for Claude Code.
//
// Runs as a Stop/SubagentStop *command* hook. Claude Code passes the hook JSON on
// stdin (incl. `transcript_path` + `session_id`). We read the local transcript,
// sum the per-turn token usage, and report the cumulative totals to the portal with
// mode:"set" (idempotent — re-running on each Stop just overwrites, never double-
// counts). No agent cooperation required; tokens "just work".
//
// Setup: copy this to your product repo's `.claude/hooks/report-tokens.ts` and set
// TEAM_CODER_URL + TEAM_CODER_TOKEN in your shell profile (same as the http hooks).

import { readFileSync } from 'node:fs';

try {
  const ev = JSON.parse(await Bun.stdin.text() || '{}') as { transcript_path?: string; session_id?: string };
  const url = process.env.TEAM_CODER_URL;
  const token = process.env.TEAM_CODER_TOKEN;
  if (!ev.transcript_path || !ev.session_id || !url || !token) process.exit(0);

  let input = 0, output = 0, cacheRead = 0, cacheCreation = 0;
  let model: string | null = null;
  for (const line of readFileSync(ev.transcript_path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as { message?: { model?: string; usage?: Record<string, number> } };
      const u = o.message?.usage;
      if (u) {
        input += u.input_tokens ?? 0;
        output += u.output_tokens ?? 0;
        cacheRead += u.cache_read_input_tokens ?? 0;
        cacheCreation += u.cache_creation_input_tokens ?? 0;
      }
      if (o.message?.model) model = o.message.model;
    } catch { /* skip non-JSON lines */ }
  }

  await fetch(`${url}/hooks/usage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ session_id: ev.session_id, input_tokens: input, output_tokens: output, cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreation, model, mode: 'set' }),
  });
} catch {
  // never block the agent on telemetry
}
process.exit(0);
