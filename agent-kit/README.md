# Agent Kit — connect any tool to Team Coder

> New here? Start with **[../GETTING-STARTED.md](../GETTING-STARTED.md)** — the
> 2-minute path once the appliance is deployed. You do **not** need to clone the
> appliance; you can pull just the MCP config:
> `curl -fsSL https://raw.githubusercontent.com/thornburywn2/team-coder/main/agent-kit/mcp.json -o .mcp.json`

Team Coder is **client-agnostic**. Whatever you drive your AI with — Claude Code,
Claude Desktop, Code Puppy, an internal tool, or just a browser — you can plug
into the same coordination portal. Pick your client below:

| Client | Guide | Lanes it uses |
|--------|-------|---------------|
| Claude Code | [claude-code.md](./claude-code.md) | hooks + MCP + git |
| Claude Desktop | [claude-desktop.md](./claude-desktop.md) | MCP + git |
| Code Puppy | [code-puppy.md](./code-puppy.md) | MCP + git |
| Internal / custom tools | [internal-tools.md](./internal-tools.md) | MCP and/or hooks + git |
| Web only (no agent) | [web.md](./web.md) | — |

## The three things every client needs

1. **Portal origin** — where the portal is served, e.g. `http://10.0.0.1:6300`
   (LAN/VPN IP or tunnel host). Everything hangs off this one origin.
2. **Your agent token** — your personal `Bearer` token. Get it from the portal:
   log in → **Connect** tab → it shows your token + ready-to-paste commands.
3. **Your developer id** — your username (e.g. `alice`), used by hooks for
   attribution.

> The **Connect tab auto-generates the exact MCP command and hooks config for
> *you*** (correct origin + token pre-filled). Start there; the per-client docs
> explain the rest.

## The three ingestion lanes (how the portal "sees" your work)

- **MCP** (`<origin>/mcp`, Bearer token) — *universal*. Any MCP client gets the
  full tool surface (read tasks/ownership/goal/proposals/patterns; claim/update/
  create tasks; propose, vote, comment; publish patterns). MCP calls also light up
  your presence, so MCP-only clients still appear live on the board.
- **Hooks** (`<origin>/hooks/event`, Bearer token + `X-Developer-Id`) — *richest*,
  Claude Code only. Streams session/prompt/edit activity → live board, feed,
  auto-ownership, and concurrent-edit warnings.
- **Git poll** — *tool-agnostic ground truth*. If the project has a GitHub repo
  configured, the portal periodically reads `git log` and attributes commits to
  coders by author email/name. Works for everyone who commits, no setup.

You don't need all three — MCP alone makes you a full participant; hooks add the
richest live signal; git is automatic.
