# Single self-contained app image: builds the React/Vite web assets and runs the
# Bun/Hono server, which serves web + API + WS + MCP on ONE port (single-origin).
# Portable by design — everything is env-driven, the web is origin-relative, so the
# same image works behind any host/port. Paired with docker-compose.yml (db + app).

# ── build: install deps + compile the web bundle ─────────────────────────────
FROM oven/bun:1.3.5 AS build
WORKDIR /app

# manifests first for cached installs
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile

# source + static build
COPY . .
RUN bun run --filter '@team-coder/web' build

# ── runtime: Bun + git (for the optional product-repo git-poll) ──────────────
FROM oven/bun:1.3.5-slim AS runtime
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app
# drop dev dependencies (drizzle-kit, @types, …) from the runtime image — the
# server runs straight from source via Bun and needs only runtime deps.
RUN cd /app && bun install --frozen-lockfile --production || true
RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production \
    PORT=6300
# cwd = apps/server so the server's default WEB_DIST ('../web/dist') resolves and
# migrate/seed/index run with the right relative paths.
WORKDIR /app/apps/server
EXPOSE 6300

ENTRYPOINT ["/app/docker-entrypoint.sh"]
