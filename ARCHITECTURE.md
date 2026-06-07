# Team Coder — Architecture

> Commit this before writing feature code. Every AI session reads it first.
> It is the anchor that stops five agents from inventing five incompatible
> designs. Keep it current; keep it short.

## What this is

A coordination portal for a 5-person hackathon team where each coder drives AI
coding agents (Claude Code) on **one shared product**. The product is secondary;
Team Coder is the **coordination layer** that makes the human+agent team legible
to itself.

Three co-equal goals:
1. **Prevent edit collisions** — live same-file warnings, advisory, never blocking.
2. **Live shared visibility** — who's on what, overall progress, activity feed.
3. **Collective design evolution** — propose via experiment branches, prove, inherit.

## Stack (locked)

| Layer | Choice |
|-------|--------|
| Runtime (server) | **Bun** |
| API framework | **Hono** |
| Realtime | **WebSocket** via `createBunWebSocket` from `hono/bun` |
| Fan-out | **Postgres `LISTEN/NOTIFY`** → EventEmitter → WS broadcast (no Redis) |
| DB | **PostgreSQL 16** (docker, port 5434) |
| ORM | **Drizzle** (`drizzle-orm/postgres-js` + `postgres` driver) |
| Agent context | **MCP server** in the same Bun process (Streamable HTTP, `@hono/mcp`) |
| Frontend | **React 18 + Vite** |
| Client state | **TanStack Query** (server) + **Zustand** (presence) + **partysocket** (reconnect) |
| Validation | **Zod**, shared in `packages/shared` |
| Monorepo | **Bun workspaces** |

## Repo layout

```
team-coder/
├── apps/
│   ├── server/        Bun + Hono: /hooks /api /ws /mcp
│   └── web/           React + Vite portal
├── packages/
│   └── shared/        Zod schemas, enums, WS envelope (imported by both)
├── docker-compose.yml Postgres 16 on 5434
├── ARCHITECTURE.md    ← you are here
└── AGENTS.md          (P8) short agent briefing; CLAUDE.md is a thin wrapper
```

## Ports

| Service | Port |
|---------|------|
| Server (Hono/Bun) | 6300 |
| Web (Vite) | 6301 |
| Postgres (docker) | 5436 |

## How coordination works

- **Identity (trunk model):** Everyone commits to trunk with small fast commits —
  **no worktrees**. Each coder exports a `DEVELOPER_ID`; their Claude Code hooks
  POST it via an `X-Developer-Id` header. That header is the attribution key.
- **Two-tier auth:** humans enter a shared `TEAM_TOKEN` to load the portal; each
  coder's agent uses a **personal Bearer token** for `/hooks` and `/mcp` so
  ownership can be attributed per coder.
- **Ownership is auto-inferred**, never manually locked: live hook `Write/Edit`
  `file_path` activity (rolling 30 min, primary) blended with a **polled local
  clone** of the product repo (`git log` / `git-who`, ~5 min). Files map to the
  deepest matching `modules.path_prefix`.
- **Collision = live same-file warning:** when two coders edit the same path
  within a window, the portal flags it (advisory, TTL, never blocks).
- **Agents auto-pull live state via MCP:** read tools (`get_my_tasks`,
  `get_module_context`, `get_shared_patterns`, …) + write tools (`claim_task`,
  `update_task_progress`, `complete_task`, `post_decision`, …). Humans steer by
  giving feedback in the portal; agents follow by reading MCP.

## Team shape (2-2-1)

2 frontend · 2 backend · **1 Integrator** who owns merges, keeps this file +
the spec current, drives deploy, and holds the demo narrative.

## Module boundaries

Define the `path_prefix → owner` map here at kickoff and keep it updated. Vertical
slices (owner takes a feature front-to-back) minimize cross-file conflicts.

| Module | path_prefix | Owner |
|--------|-------------|-------|
| _TBD at kickoff_ | | |

## Conventions

- TypeScript strict. Zod-validate every external input (API, hooks, MCP).
- Small PRs, feature-flag partial work, push every 1–2 hours.
- Secrets via env only. `UserPromptSubmit` prompts are secret-scrubbed before storage.
- The portal is **observational** — it never gates commits or merges. A Team Coder
  outage degrades gracefully to a normal git workflow.

## Build order

P0 scaffold (this) → P1 DB+triggers → P2 Hono spine+WS → **P3 MVP** (hooks+board+
feed+claim) → **P4** (MCP+ownership). M1+M2 are the committed core; proposals,
inheritance, reuse kit, collision warning, deploy are stretch (M3/M4).
