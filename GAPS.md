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

## 3. Coordination is advisory, not enforced
- 🔴 **Work-locks & collisions don't prevent anything.** `acquire_file` is opt-in,
  MCP-only, and not auto-acquired from hooks — an agent that skips it won't
  coordinate, and nothing stops a second writer. "Hold until released" only works if
  every agent is told to call it.
- 🟡 **Locks are in-memory** → lost on restart; no audit of who held what.
- 🟡 **No conflict resolution** when two coders do edit the same file — only a
  warning after the fact.

## 4. Realtime & scale
- 🟡 **Single-process, in-memory pub/sub.** WebSockets, presence, collisions, and
  locks won't survive horizontal scaling (no Redis/broker) and reset on redeploy
  (durable data survives; live state doesn't).
- 🟡 **Polling-heavy frontend** (summary 5s, agents/locks 4–5s, etc.). Many clients ×
  many widgets = avoidable server load; much of it could be WS-pushed.
- 🟡 **No pagination** on most lists (tasks/proposals/comments capped at 100–200);
  fine for a hackathon, breaks on a long/large project.

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

## 6. Testing & CI
- 🔴 **No CI** (`.github/workflows` absent) — nothing runs the 19 verify scripts on
  push/PR.
- 🔴 **No unit tests and no coverage measurement.** The verify suite is
  integration-only (needs a live server + seeded DB), mostly happy-path; the global
  80% coverage target is neither met nor measured. No frontend component tests, no
  load tests.

## 7. Metrics accuracy (Report)
- 🟡 **Approximations presented as fact.** Burndown completion = task `updatedAt` (any
  edit moves it); token trend bucketed by session `lastSeenAt`; active-minutes =
  `lastSeen − started` per session (can overcount idle time). Good enough to glance
  at, not to grade by.
- 🟡 **Contribution % is blendable/gameable** and has **no time-range filter** (always
  all-time); per-coder language/layer isn't in the markdown export.

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

## 10. Agent-integration coverage
- 🟡 **Uneven across tools.** Only Claude Code has hooks (full live presence/edits);
  Claude Desktop / Code Puppy are MCP-only → no live edit presence. Documented, but a
  coverage gap.
- 🟡 **Subagents aren't distinguished.** Multiple subagents under one coder collapse
  into one session; `agent_id` is captured but not surfaced.
- 🟡 **MCP tool list is cached at connect** — server tool changes require every agent
  to reconnect (operational friction during the event).

## 11. Data model / housekeeping
- 🟢 **Dead schema**: `activity_events` is unused (feed moved to `feed_items`).
- 🟢 **Hard deletes** (tasks/proposals/patterns) with no soft-delete/audit trail.
- 🟢 **Reuse kit** has no search or versioning; patterns are free-text.

---

### Suggested focus order for tomorrow
1. **Trust the data** (§2 token capture, §5 attribution email UI, §7 metric accuracy) —
   the reporting goal depends on it.
2. **Make it safe to put on the work network** (§1 auth/rate-limit, §8 TLS).
3. **Make coordination actually coordinate** (§3 auto-acquire locks from hooks).
4. **Lock in quality** (§6 CI + the verify suite + a coverage baseline).
