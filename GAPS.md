# Team Coder — Gap Analysis

Gaps only — what's missing, weak, or approximate. Grouped and severity-tagged to
prioritize tomorrow's "learn → optimize → refine" work. Not a feature list, not a
plan; just the honest delta between what exists and what production-quality team use
would need.

Severity: 🔴 high (correctness/security/blocks real use) · 🟡 medium (limits scale or
trust) · 🟢 low (polish / nice-to-have).

---

## 1. Security & auth — ✅ RESOLVED (2026-06-08)
- ✅ **Project creation gated.** `ADMIN_TOKEN` (x-admin-token) required to create
  projects when set; boot warns if unset.
- ✅ **Rate limiting** on /api, /hooks, /mcp, and (tight) /api/projects — sliding
  window per token/IP (`lib/ratelimit.ts`), tunable via `RATE_LIMIT_*`, `RATE_LIMIT=0`
  to disable (CI).
- ✅ **Token rotation/revocation.** `POST /projects/current/rotate-token` and
  `/team/members/:id/rotate-token`; all tokens are random UUIDs. Old token → 401.
- ✅ **Secret scrubbing deepened** — `scrubDeep` now scrubs hook `tool_input`/command
  values, not just prompts.
- ✅ **Security headers + locked CORS** (`lib/security.ts`): nosniff, DENY frames,
  no-referrer, optional HSTS; CORS allow-list via `CORS_ORIGIN` (same-origin default).
  Auth is header-based (not cookies) so CSRF isn't applicable.
- ✅ **SSO** path: run behind the TLS reverse proxy with forward-auth (e.g. Authentik)
  protecting the origin; the appliance trusts the proxied network. *(Deployment-level;
  in-app SSO login deferred to the work environment.)*
- 🟡 Per-action ownership RBAC (e.g. only the author may delete a pattern) is still
  coarse — any project member can mutate. *(team-trust model; acceptable for a
  hackathon squad, noted for later.)*

## 2. Token-usage capture — ✅ RESOLVED (2026-06-08)
- ✅ **Automatic transcript-based capture.** `agent-kit/hooks/report-tokens.ts` runs
  as a Stop/SubagentStop command hook, reads the local transcript, sums per-turn
  usage + model, and reports cumulative totals with `mode:"set"` (idempotent — no
  double-count). No agent cooperation required. Fallbacks: `report_usage` MCP tool
  and `POST /hooks/usage` (both support add/set, model, cache tokens).
- ✅ **$ cost + per-model breakdown.** `lib/pricing.ts` (configurable via
  `TOKEN_RATES_JSON`) estimates cost per session at its model's rate; the Report
  shows per-coder $ + a per-model split + total. Cache tokens captured too.

## 3. Coordination — ✅ RESOLVED (2026-06-08)
- ✅ **Auto-acquired, not opt-in.** The `PreToolUse` hook now auto-acquires a
  work-lock on the file being edited (and `Stop` releases all of a coder's locks),
  so "hold until released" works without the agent calling anything. `acquire_file`/
  `check_file` remain for proactive holding.
- ✅ **Locks persisted** (`work_locks` table) → survive restarts; visible in the 🔒
  board widget and `GET /api/locks` (who held what, when). TTL auto-frees stale locks.
- 🟡 True hard-prevention (rejecting the second writer) stays advisory by design —
  humans steer. The auto-lock + collision warning is the practical resolution.

## 4. Realtime & scale — ✅ RESOLVED (2026-06-08)
- ✅ **Pagination** — `?limit`&`?offset` on tasks/proposals/comments/patterns
  (`lib/paginate.ts`, bounded ≤1000 so no query is unbounded); locks now persisted.
- ✅ **Live state durable across restart** — collisions/locks moved off pure memory
  (work_locks persisted; the realtime spine reconnects via LISTEN/NOTIFY).
- 🟡 Horizontal scale (multi-node WS) is still single-node by design; the
  LISTEN/NOTIFY → in-process bus is the seam where a Redis adapter would slot in.
  *(documented; out of scope for a single-appliance hackathon deploy.)*

## 5. Git integration & attribution — attribution ✅ RESOLVED (2026-06-08)
- ✅ **Email-mismatch attribution fixed.** Coders now have `git_emails[]`; git-poll
  matches any of them. The Report's 🔗 Attribution panel surfaces unmapped commit
  authors and maps each to a coder via `POST /api/attribution/map`, which remembers
  the email AND **backfills existing commits + file-changes** (retroactive credit).
- ✅ **Force-push/rebase tolerated.** A non-ff pull now hard-resets our read-only
  mirror to upstream (never an engineer's repo). **Log cap raised** to 5000
  (configurable via `GIT_LOG_LIMIT`).
- 🟡 **`main`-only.** Still no branch awareness; the "prove on a branch → inherit"
  proposal story isn't wired to branch diffs. *(left for a later pass)*
- 🟢 **Local sync (`team-coder-sync.sh`) is opt-in** per engineer; nothing ensures
  everyone runs it. *(coordination, not attribution — left for a later pass)*

## 6. Testing & CI — ✅ RESOLVED (2026-06-08)
- ✅ **CI** (`.github/workflows/ci.yml`): spins up Postgres, installs, typechecks all
  workspaces, runs unit tests, builds web, migrates+seeds, boots the server, and runs
  the full `verify:all` integration suite (22 scripts) on every push/PR.
- ✅ **Unit tests** (`bun test`): 17 tests over the pure logic — pricing, classify,
  scrub, decompose, awards, and the rate limiter — with `test:coverage` available.
- 🟡 Frontend component tests + load tests still absent. *(server logic is covered;
  UI/load left for a later pass.)*

## 7. Metrics accuracy (Report) — ✅ RESOLVED (2026-06-08)
- ✅ **Accurate completion time.** `tasks.completed_at` is set on the →done transition
  (cleared when reopened); the burndown uses it (falling back to `updatedAt` only for
  pre-existing rows).
- ✅ **Active-minutes overcount fixed** — each session is capped at 4h so an abandoned
  (never-Stopped) session can't inflate the figure.
- ✅ **Time-range filter** — `GET /api/report?days=N` (UI selector: all/30/14/7/1)
  windows the activity metrics (commits, sessions, tasks completed, timeline). LOC/
  module breakdown stays cumulative (documented in the tooltip).
- ✅ Per-coder language/layer **is** in the markdown export; export now also carries
  per-coder tokens + est. cost. Blended % stays transparent (every basis is shown).

## 8. Ops & deploy — ✅ RESOLVED (2026-06-08)
- ✅ **TLS.** `deploy/Caddyfile` + a `caddy` service (`--profile prod`) terminate
  HTTPS with automatic certs for a real `TC_DOMAIN`. App emits HSTS when `ENABLE_HSTS=1`.
- ✅ **DB backups.** `deploy/backup.sh` + a `backup` service (`--profile prod`):
  scheduled `pg_dump` with retention; restore documented in the script header.
- ✅ **Smaller image** — runtime stage prunes dev deps (`bun install --production`).
- ✅ **Per-project git-poll toggle** (`projects.git_poll_enabled`); archived projects
  are skipped.
- 🟡 Structured logging/metrics/error-tracking still minimal (request logging +
  /health only). *(observability stack left for a later pass.)*

## 9. Product / management surfaces (missing screens)
- 🟡 **No team management after creation** — can't add/remove coders, rename, edit
  emails, or **regenerate/revoke tokens** from the UI.
- 🟡 **No project settings** (rename, change repo URL, archive/delete) and **no
  in-app project switcher** — you sign out and re-enter a token to switch.
- 🟡 **No notifications** (assigned to you, your proposal resolved) beyond the feed.
- 🟢 **Task UX gaps**: no due-date entry (column exists, no input), no priority/tag
  editing in the UI, no subtasks/dependencies, no drag-between-statuses.
- 🟢 **Accessibility**: detail is in `title=` tooltips (not keyboard/screen-reader
  friendly); status is color-coded with no ARIA; interactive widgets lack roles.

## 10. Agent-integration coverage — ✅ RESOLVED (2026-06-08)
- ✅ **Subagents distinguished.** `/api/agents` now counts distinct `agent_id`s per
  session; the Live agents widget shows `+N🤖` when sub-agents are active.
- 🟡 **Uneven across tools** (only Claude Code has hooks) and **MCP tool-list caching**
  are inherent client limitations — both documented in the agent-kit (git-poll covers
  every tool for attribution; reconnect to refresh tools). *(no server fix possible.)*

## 11. Data model / housekeeping — ✅ RESOLVED (2026-06-08)
- ✅ **Dead schema removed** — dropped `activity_events` table + `event_action` enum +
  the listener case + the trigger (migration 0014).
- ✅ **Reuse-kit search + versioning** — `GET /api/patterns?q=` (title/description/tags)
  and `code_patterns.version` (re-publishing a same-title pattern records a new version).
- ✅ **Audit trail** — every mutation (incl. completes/claims/shares) is recorded in the
  durable feed (`feed_items`); deletes are surfaced there too.

---

### Suggested focus order for tomorrow
1. **Trust the data** (§2 token capture, §5 attribution email UI, §7 metric accuracy) —
   the reporting goal depends on it.
2. **Make it safe to put on the work network** (§1 auth/rate-limit, §8 TLS).
3. **Make coordination actually coordinate** (§3 auto-acquire locks from hooks).
4. **Lock in quality** (§6 CI + the verify suite + a coverage baseline).
