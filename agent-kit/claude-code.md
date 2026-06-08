# Claude Code → Team Coder

Claude Code uses **all three lanes** — the richest integration. ~2 minutes.

## 1. Connect the MCP server

Run inside your product repo (gets you the coordination tools):

```bash
claude mcp add --transport http team-coder <origin>/mcp \
  --header "Authorization: Bearer <your-agent-token>"
```

Replace `<origin>` and `<your-agent-token>` — or just copy the pre-filled command
from the portal's **Connect** tab. Then in a session, ask your agent to run
`whoami` or `get_my_tasks` to confirm.

> MCP clients cache the tool list at connect time. If tools look stale/missing,
> reconnect (re-run the command or restart the client).

## 2. Stream activity via hooks

Copy [`settings.json`](./settings.json) into your **product repo's**
`.claude/settings.json` and commit it, so the whole team streams activity. It
reads three env vars from your shell profile:

```bash
export TEAM_CODER_URL=<origin>            # e.g. http://10.0.0.1:6300
export TEAM_CODER_TOKEN=<your-agent-token>
export DEVELOPER_ID=<your-username>        # e.g. alice
```

The Connect tab also renders this exact JSON with your values filled in. Hooks
power the live board, activity feed, auto-inferred module ownership, and
concurrent-edit warnings.

## 3. Git (automatic)

Just commit and push as normal. If the project's GitHub repo is configured in the
portal, your commits are attributed to you by your git author email/name — no
setup needed.

## What you can do over MCP

Reads: `whoami`, `get_my_tasks`, `list_tasks`, `list_team`, `get_task`,
`search_tasks`, `get_module_context`, `get_project_goal`, `get_proposals`,
`get_team_decisions`, `get_shared_patterns`, `get_comments`.
Writes: `create_task`, `claim_task`, `assign_task`, `edit_task`,
`update_task_progress`, `complete_task`, `flag_blocker`, `post_comment`,
`create_proposal`, `vote_proposal`, `post_decision`, `add_shared_pattern`,
`report_usage`, `acquire_file`, `release_file`, `check_file`.

## Don't collide — hold until released

Before editing a file in a shared area, take a soft lock so two agents don't work
the same file at once:
1. Call **`acquire_file(file_path)`**. If `acquired: true`, go ahead.
2. If `acquired: false` (it returns `held_by`), **hold**: wait and retry
   `acquire_file` every ~30s until it succeeds (the holder will release, or the
   lock auto-expires after 15 min).
3. Call **`release_file(file_path)`** as soon as you're done so a waiting teammate
   can proceed. Use `check_file` to peek without taking the lock.

Add this to your `AGENTS.md`/system prompt so the agent does it automatically.

## Track token usage (automatic)

Token spend is captured **automatically** — no agent cooperation needed. Copy
[`hooks/report-tokens.ts`](./hooks/report-tokens.ts) into your product repo's
`.claude/hooks/report-tokens.ts` (the provided `settings.json` already wires it to
the `Stop`/`SubagentStop` hooks). On each stop it reads the local transcript, sums
the per-turn token usage + model, and reports the **cumulative** totals to the
portal with `mode:"set"` (idempotent — never double-counts).

Alternatives if you're not on Claude Code: call the `report_usage` MCP tool, or
POST `input_tokens`/`output_tokens`/`model` to `<origin>/hooks/usage`.

It rolls up per coder → the Report's 🪙 Token usage (with estimated $ and a
per-model breakdown). Cost rates are configurable via `TOKEN_RATES_JSON`.

> **Attribution:** commits are credited by git author email. If your git email
> differs from your login email, your commits show as *unattributed* in the
> Report's 🔗 Attribution panel — map them there once and existing commits are
> backfilled. After that they auto-attribute.
