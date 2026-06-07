# Team Coder

Coordination portal for a team of vibe coders (any size) driving AI agents on one
shared hackathon product. Live status · auto-inferred ownership · scoped
messaging · collective design · an MCP server that feeds each coder's agent live
project truth.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the design (read it first).

## Stack

Bun · Hono · PostgreSQL · WebSocket · MCP · React + Vite · Drizzle · Zod.
Bun workspaces monorepo (`apps/server`, `apps/web`, `packages/shared`).

## Quick start

Prereqs: [Bun](https://bun.sh) ≥ 1.3 and Docker.

```bash
# 1. install workspace deps
bun install

# 2. start Postgres (docker, port 5436)
bun run db:up

# 3. configure env
cp .env.example .env   # adjust TEAM_TOKEN etc.

# 4. run server (6300) + web (6301) together
bun run dev
```

Then open http://localhost:6301 — the page reports the Bun server's health.

| Command | What |
|---------|------|
| `bun run dev` | server + web in parallel |
| `bun run dev:server` | Bun/Hono server only (6300) |
| `bun run dev:web` | Vite web only (6301) |
| `bun run db:up` / `db:down` | Postgres container |
| `bun run typecheck` | typecheck all workspaces |

## Status

P0 scaffold complete (monorepo, server health check, web shell, Postgres compose,
shared schemas). Next: P1 DB schema + `LISTEN/NOTIFY` triggers.
