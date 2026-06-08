# Deploying Team Coder

The whole stack (Postgres + the app) runs from one image + compose file. The Bun
server serves the web UI, REST API, WebSocket, and MCP endpoint on a **single
port**, so there's nothing else to wire up.

## One-command deploy

```bash
cp .env.example .env        # then edit TEAM_TOKEN (and ports if needed)
docker compose up -d --build
```

That builds the app image, starts Postgres, runs migrations + an idempotent seed,
and serves the portal on `http://<host>:${APP_PORT:-6300}`.

- **Portal / login:** open the host on `APP_PORT`, enter `TEAM_TOKEN`, pick a coder.
- **Connect an agent:** Connect tab shows the per-coder MCP command + hooks config
  (pointed at whatever origin you opened — works behind a LAN IP, VPN, or tunnel).
- **Update:** `docker compose up -d --build` again (migrations are idempotent;
  data persists in the `team_coder_pgdata` volume).
- **Logs / stop:** `bun run stack:logs` / `bun run stack:down` (data kept).

## Configuration (`.env`)

| Var | Default | Purpose |
|-----|---------|---------|
| `TEAM_TOKEN` | `change-me-team-token` | shared human portal token (**change it**) |
| `APP_PORT` | `6300` | host port for the portal |
| `POSTGRES_PORT` | `5436` | host port for Postgres (change if taken) |
| `POSTGRES_USER/PASSWORD/DB` | `teamcoder` | database credentials |
| `ENABLE_GIT_POLL` | _(off)_ | set `1` to poll each project's GitHub repo for git contribution stats |

Everything is env-driven and the web is origin-relative, so the same image is
portable across hosts/ports with no rebuild.

## Local development (no app container)

Run Bun on the host against a Postgres-only container:

```bash
bun install
bun run db:up                       # Postgres on :5436 (docker-compose.dev.yml)
cd apps/server && bun run db:migrate && bun run db:seed
bun run dev                         # web :6301 (proxies API/WS to server :6300)
```
