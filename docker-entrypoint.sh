#!/usr/bin/env sh
# Container start: apply migrations (idempotent), ensure the default project +
# coders exist (idempotent seed), then serve. Postgres readiness is guaranteed by
# the compose healthcheck (app depends_on db: service_healthy).
set -e
cd /app/apps/server

echo "[entrypoint] applying migrations…"
bun run src/db/migrate.ts

echo "[entrypoint] seeding (idempotent)…"
bun run src/db/seed.ts

echo "[entrypoint] starting Team Coder on :${PORT:-6300}"
exec bun run src/index.ts
