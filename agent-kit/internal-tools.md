# Internal / custom tools → Team Coder

Anything that speaks HTTP can participate. Pick whichever lane(s) fit your tool.

## Option A — MCP (recommended for agents)

If your tool is an MCP client, add a **Streamable HTTP** server:

- **URL:** `<origin>/mcp`
- **Header:** `Authorization: Bearer <your-agent-token>`

You get the full read/write tool surface (tasks, ownership, goal, proposals,
patterns). MCP calls also light up presence, so the tool appears live.

## Option B — raw hook events (richest live signal)

POST lifecycle events to the hooks endpoint as you work:

```bash
curl -X POST "<origin>/hooks/event" \
  -H "Authorization: Bearer <your-agent-token>" \
  -H "X-Developer-Id: <your-username>" \
  -H "content-type: application/json" \
  -d '{
    "session_id": "my-session-1",
    "cwd": "/path/to/product",
    "hook_event_name": "PreToolUse",
    "tool_name": "Edit",
    "tool_input": { "file_path": "apps/server/src/index.ts" }
  }'
```

Recognized `hook_event_name`s: `SessionStart`, `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `Stop`, `SubagentStop`. `PreToolUse` with a `tool_input.file_path`
(tool `Write`/`Edit`/`NotebookEdit`) drives current-file presence, ownership, and
concurrent-edit warnings. Prompts are secret-scrubbed server-side. The endpoint
returns immediately (fire-and-forget) so it never blocks your tool.

## Option C — just commit (zero setup)

If the project's GitHub repo is configured in the portal, your commits are
attributed to you automatically by git author email/name. Make sure your git
`user.email` / `user.name` match your seeded coder so it maps correctly.

## REST (human portal API)

All portal data is also available over REST under `<origin>/api/*` with the
**team token** (`x-team-token` header) — useful for dashboards or scripts. See the
server routes for the surface (tasks, proposals, comments, patterns, report,
collisions, …).
