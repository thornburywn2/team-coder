# Code Puppy → Team Coder

[Code Puppy](https://github.com/mpfaffenberger/code_puppy) is MCP-native and
supports `AGENTS.md`, so it connects to Team Coder over **MCP** with no special
glue. Git attribution is automatic if the project repo is configured.

## Add the MCP server

Point Code Puppy at the portal's Streamable HTTP MCP endpoint:

- **URL:** `<origin>/mcp`
- **Header:** `Authorization: Bearer <your-agent-token>`

Use whichever MCP-server config mechanism Code Puppy exposes (its MCP config /
`/mcp` command), with the URL + Authorization header above. Values come from the
portal's **Connect** tab.

## Make it coordinate

Add a short note to your product repo's `AGENTS.md` so Code Puppy uses the portal
as its source of truth, e.g.:

```md
## Team coordination
Before starting work, call the team-coder MCP tools: `get_project_goal`,
`get_my_tasks`, and `get_module_context` for the area you're touching. Claim work
with `claim_task`, report progress with `update_task_progress`, and raise
direction changes with `create_proposal`. Don't rebuild — check
`get_shared_patterns` first.
```

## Confirm

Have it call `whoami` then `list_tasks`. MCP calls light up your presence, so
Code Puppy shows as connected/active on the board even without hooks.
