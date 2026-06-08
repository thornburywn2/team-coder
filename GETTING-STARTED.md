# Getting Started — connect to Team Coder

The appliance is already deployed. You **don't need to clone or run anything** —
you just point your AI tool at the running server. Takes ~2 minutes.

## What you need (ask whoever deployed it)

1. **Portal URL** — e.g. `http://10.0.0.1:6300`
2. **Team token** — the shared passphrase for your project
3. **Your agent token** — your personal token (you'll grab it from the portal below)

---

## Step 1 — open the portal & find your token

1. Open the **Portal URL** in a browser.
2. Enter the **Team token**, then pick your name from the roster.
3. Go to the **Connect** tab. It shows **your agent token** and a copy-paste
   command pre-filled with the right URL + token. (Copy works over plain HTTP too.)

> Tip: keep the Connect tab open — it has everything below filled in for *you*.

## Step 2 — connect your agent (pick your tool)

### Claude Code — option A: one command (easiest)
Run inside your **product repo** (copy the exact line from the Connect tab):
```bash
claude mcp add --transport http team-coder <PORTAL_URL>/mcp \
  --header "Authorization: Bearer <YOUR_AGENT_TOKEN>"
```

### Claude Code — option B: pull just the MCP config (no appliance clone)
Grab the tiny config template and save it as `.mcp.json` in your **product repo**:
```bash
curl -fsSL https://raw.githubusercontent.com/thornburywn2/team-coder/main/agent-kit/mcp.json -o .mcp.json
```
Then add these to your shell profile (so the config resolves):
```bash
export TEAM_CODER_URL=<PORTAL_URL>          # e.g. http://10.0.0.1:6300
export TEAM_CODER_TOKEN=<YOUR_AGENT_TOKEN>
```
Restart Claude Code so it picks up `.mcp.json`.

### Other tools
- **Claude Desktop / Code Puppy / custom MCP clients:** add an HTTP MCP server at
  `<PORTAL_URL>/mcp` with header `Authorization: Bearer <YOUR_AGENT_TOKEN>`.
  See [`agent-kit/`](./agent-kit/) for per-tool guides.

## Step 3 — confirm

Ask your agent to run **`whoami`**, then **`get_project_goal`** and
**`get_my_tasks`**. If it answers, you're connected — your activity now shows live
on the board. Claim work with `claim_task`, report progress with
`update_task_progress`, and check `get_shared_patterns` before building something
from scratch.

## (Optional) Step 4 — richest live signal (Claude Code hooks)

Hooks stream your session/edit activity for live presence, ownership, and
concurrent-edit warnings. Copy [`agent-kit/settings.json`](./agent-kit/settings.json)
into your product repo's `.claude/settings.json` (the Connect tab renders it filled
in), commit it, and you're done. Everything still works without this — it just adds
detail.

---

**Trouble?** If the portal won't load, confirm the URL/port with the deployer
(and that you're on the same network/VPN). If your agent can't see the tools after
connecting, **reconnect the MCP server** — clients cache the tool list at connect.
