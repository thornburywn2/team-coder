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

## Track token usage (so we can minimize it)

The team tracks token spend per person to see where effort goes and improve. Report
it either way:
- **Agent:** call the `report_usage` MCP tool with `input_tokens` / `output_tokens`
  (cumulative or incremental) per task or session.
- **Hook:** include `input_tokens` / `output_tokens` (or a `usage` object) in your
  Stop hook payload, or POST them to `<origin>/hooks/usage` with your Bearer token.

It rolls up to your session → per-coder + team totals on the board's 🪙 Token usage
widget and the Report.
