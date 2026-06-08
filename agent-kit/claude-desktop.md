# Claude Desktop → Team Coder

Claude Desktop connects over **MCP** (it doesn't have Claude Code's hook system,
so no hook lane — but MCP makes you a full participant, and MCP calls light up
your presence so you still appear live on the board). Git attribution is
automatic if the project repo is configured.

## Add the MCP server

In Claude Desktop's MCP configuration, add a **Streamable HTTP** server:

- **URL:** `<origin>/mcp`  (e.g. `http://10.0.0.1:6300/mcp`)
- **Header:** `Authorization: Bearer <your-agent-token>`

Example config entry:

```json
{
  "mcpServers": {
    "team-coder": {
      "transport": "http",
      "url": "<origin>/mcp",
      "headers": { "Authorization": "Bearer <your-agent-token>" }
    }
  }
}
```

Get `<origin>` + `<your-agent-token>` from the portal's **Connect** tab. Restart
Desktop after editing the config so it picks up the server.

## Confirm

Ask the agent to run `whoami`, then `get_my_tasks` or `get_project_goal`. Claiming
or updating a task here shows up live on everyone's board.

> Tip: have the agent read `get_project_goal` and `get_module_context` before
> starting, and `claim_task` what it picks up — that's how the team stays
> coordinated without hooks.
