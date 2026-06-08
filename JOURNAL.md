# Team Coder — Project Journal

> Append-only. Newest entries at the top. Format per ~/CLAUDE-MEMORY-SYSTEM.md.

---

## 2026-06-08 (k) — Resolve ALL gap sections (production hardening)

**Scope:** GAPS §1,§3,§4,§5-branch,§6,§7,§8,§9,§10,§11 (every remaining item)
**Outcome:** SUCCESS — all 11 gap sections ✅

- **§1 Security:** rate limiting (lib/ratelimit), security headers + CORS
  (lib/security), ADMIN_TOKEN project-create gate, deep secret scrub, token
  rotation/revocation, boot warnings.
- **§3 Coordination:** work_locks persisted (migration 0012); PreToolUse auto-acquires,
  Stop releases — no opt-in needed.
- **§4 Scale:** ?limit/?offset pagination (lib/paginate); locks durable.
- **§5 Git:** branch awareness (GET /api/repo/branches, ahead/behind) → proposals show
  "✓ proven"; force-push mirror reset; log cap 5000.
- **§6 Testing/CI:** .github/workflows/ci.yml (Postgres → typecheck + unit + build +
  migrate/seed + verify:all); 17 bun:test unit tests.
- **§7 Metrics:** tasks.completed_at (0013), 4h session cap, ?days time-range filter.
- **§8 Ops:** Caddy TLS proxy + pg_dump backups (--profile prod), prod-deps prune,
  per-project poll toggle + archive (0011).
- **§9 Mgmt/UX:** Settings (members/tokens/project) in Connect, project switcher,
  feed "for me" notifications, inline task status/priority/due editing, ARIA pass.
- **§10 Agents:** distinct agent_id → subagent count in Live agents.
- **§11 Data:** dropped dead activity_events (0014); reuse-kit search + version.
- Also hardened db:verify against a busy shared DB (buffer + match own NOTIFY).

Migrations 0010–0014. 22 integration + 17 unit tests green; CI wired.

**Lesson:** working through a written, severity-tagged GAPS.md section-by-section —
committing + re-running the full suite per section — turns "harden everything" from
daunting into a steady, verifiable march. Keep prod-strict defaults (rate limit on)
but let CI/dev disable them via env so functional tests aren't fighting the guardrails.

---

## 2026-06-08 (j) — Trust the data: token capture + attribution

**Scope:** GAPS §2 (token capture) + §5 (attribution) — all severities
**Outcome:** SUCCESS

- **Automatic token capture.** `agent-kit/hooks/report-tokens.ts` (Stop/SubagentStop
  command hook) reads the local transcript, sums per-turn usage + model, reports
  cumulative totals with `mode:set` (idempotent). `/hooks/usage` + `report_usage`
  gain mode/model/cache. sessions +cache+model (migration 0010).
- **Cost + per-model.** `lib/pricing.ts` (configurable `TOKEN_RATES_JSON`); `/api/usage`
  returns per-coder $ + per-model + total; Report + markdown export show it.
- **Attribution fixed.** `users.git_emails[]`; git-poll matches any; 🔗 Attribution
  panel surfaces unmapped authors and maps→backfills existing commits/file-changes.
  Non-ff pull hard-resets the read-only mirror; log cap → 5000 (`GIT_LOG_LIMIT`).
- Board stays work-only; metrics live in the Report. New verify-attribution; full
  suite green (20 scripts). Demo seeds models/cache (Nimbus ≈ $86 est., Opus top).

**Lesson:** make telemetry self-serve and idempotent — capture from the transcript
(client-side, where the data is), report cumulative with set-semantics so retries
don't inflate, and make wrong/missing attribution *fixable in the UI with backfill*
rather than something the user must get right up front.

---

## 2026-06-08 (i) — Work-locks, token trend, board IA, vote 500 fix

**Scope:** apps/server (locks, usage trend, vote/comment hardening), apps/web (widgets, IA, identity revalidation), agent-kit
**Outcome:** SUCCESS

- **Hold-until-released work-locks:** locks.ts (in-memory, per-project, 15-min TTL)
  + MCP `acquire_file`/`release_file`/`check_file` + GET /api/locks + a 🔒 board
  widget. An agent acquires a file before editing; another holds until release.
  Opt-in/advisory, auto-expires. (28 MCP tools.)
- **Token-trend chart** (GET /api/usage/trend) — daily token spend, in 📈 Trends.
- **Board IA:** Notes front-and-center under ⭐ Needs your attention; Trends moved
  up; Locks added.
- **Fixed the vote 500:** it was a FK violation from a STALE logged-in id after a
  demo re-seed. Hardened server (validate voter/author in project → 400) and the
  client now re-validates `meId` against the roster on load (re-prompts if stale).

All 19 verify green.

**Lesson:** Any client-supplied id written to a NOT-NULL FK must be validated
server-side (→400), and the SPA must re-validate its cached identity against the
live roster — otherwise a re-seed/rotation turns into a confusing 500.

---

## 2026-06-08 (h) — Token tracking + board hierarchy + 3 tabs

**Scope:** apps/server (usage capture/aggregate, summary), apps/web (board IA, widgets, inline proposals), agent-kit
**Outcome:** SUCCESS

- **Token usage tracking (per person + aggregate):** sessions.input/output_tokens
  (migration 0009); captured via hooks (input_tokens/output_tokens/usage), POST
  /hooks/usage, and the MCP `report_usage` tool. Aggregated in the report (per
  coder + totals), /api/summary (KPI), and GET /api/usage. UI: tokens KPI, Report
  per-coder, and a 🪙 Token usage board widget. Demo seeded (~4.7M tokens, Bob top).
- **Board information hierarchy:** ⭐ Needs your attention (My work / Blockers /
  Stale) → 📋 The work → 🧩 Reuse kit → 📈 Trends; uniform 460px widget heights with
  internal scroll (no towering); large charts at the bottom; tooltips everywhere.
- **Inline proposals:** vote 👍/👎/🤷, discuss (Thread), create, and accept/reject
  all on the board — no navigation.
- **Tabs 6→3** (Board · Report · Connect): folded Proposals, Reuse kit, and Agents
  onto the board.

All 18 verify green (verify-extras now covers token capture).

**Lesson:** Token tracking has no single reliable source from Claude Code hooks —
expose multiple capture paths (hook payload, REST, MCP tool) that all roll up to one
per-session counter, then aggregate per coder.

---

## 2026-06-08 (g) — 2nd project + live repo sync + widget board

**Scope:** apps/server (git-poll/broadcast, summary, repo-status), apps/web (board redesign + widgets), agent-kit (sync), demo-seed-apollo
**Outcome:** SUCCESS

- **2nd demo project (Apollo)** linked to a real GitHub repo (testtesttest) — proves
  multi-project isolation AND the git lane end-to-end (I pushed a multi-author
  history; Team Coder clones/mirrors/polls/attributes; report built from real LOC).
- **Server git-poll + safe local sync:** `gitPollAndBroadcast()` emits `REPO_UPDATED`
  on new commits; `GET /api/repo/status`; enabled per-project via `ENABLE_GIT_POLL`
  (Nimbus's repo url nulled so it's never polluted). `agent-kit/team-coder-sync.sh`
  keeps each engineer's clone fast-forwarded — never resets/stashes/forces; dirty or
  diverged → fetch + notify only. Verified: pushed a commit → server auto-ingested
  within the interval (15→16), report updated, Nimbus untouched.
- **Board → full-page widget dashboard:** 12-col responsive grid; new widgets —
  KPI strip (`GET /api/summary`), 🚧 Blockers, 🤖 Live agents, 🗳️ Open proposals; Notes
  enlarged. Fixed verify-gitpoll to scope by project (demo carol commits leaked
  into its global query). All 18 verify green.

**Lesson:** "maintain the repo" for a collaboration tool = keep an up-to-date
*mirror* + fast-forward clients; never write to engineers' working copies. And demo
data can expose test scripts that query globally instead of per-project — always
scope test assertions to the test's own project.

---

## 2026-06-08 (f) — Demo data loader (fully-loaded 3-day project)

**Scope:** apps/server/src/db/demo-seed.ts, DEMO.md
**Outcome:** SUCCESS

Added `bun run demo:seed` — populates the Default Project with a realistic ~3-day
project so the whole portal is fully loaded for a demo: 5 coders with distinct
strengths, 36 tasks across every state/source/priority, 5 proposals (votes +
threads, 2 adopted → ADRs + reuse-kit patterns + tasks), 6 patterns, 6 ADRs,
notes, 55 git commits/file-changes over 3 days (git-basis report: languages, stack
layers, **daily** timeline), 350 hook events, agent sessions (live + idle),
live ownership/presence, team awards (one each: Master Builder / Heavy Lifter /
The Closer / The Mentor / The Architect), and a 50+ item feed incl. an idle alert.
Re-runnable (resets the Default Project first). Verified every endpoint renders
rich data. Log in with `change-me-team-token`.

---

## 2026-06-08 (e) — Team awards, idle alerts, Connect token-prefill + Code Puppy

**Scope:** apps/server (awards, idle, leaderboard), apps/web (Agents, Connect), docs
**Outcome:** SUCCESS

- **Team awards** (reframed the leaderboard — user: "everyone should get an award,
  it's a team event, nothing negative"): `lib/awards.ts` gives every coder one
  positive award — distinct superlatives for category leaders, focus-based awards
  (Frontend Champion / Data Wizard / `<Lang>` Specialist / Team Player) for the
  rest. `GET /api/leaderboard` returns awards built from the full report + live
  agent counts; Agents view shows an award card per person.
- **Idle alerts:** `idle.ts` flags agents that went quiet (5–30 min) once per idle
  spell (re-arms on return) as a durable feed event; Agents view "quiet agents"
  panel; 😴 feed icon.
- **Connect token-prefill:** added a ready-to-paste `.mcp.json` with the coder's
  token baked in (no env vars) + a dedicated **Code Puppy** section (MCP-native,
  same config + an AGENTS.md coordination snippet, links the repo).

`verify:extras` extended (everyone-gets-an-award, Grace="Data Wizard"); all 18 green.

**Lesson:** Gamification for a *team* should surface everyone's strength, not rank
winners/losers — assign distinct superlatives to leaders, then celebrate everyone
else's focus area so no one is left without recognition.

---

## 2026-06-08 (d) — Per-coder breakdown + weeks-long durable capture

**Scope:** apps/server (report, feed, schema), apps/web
**Outcome:** SUCCESS

- **Per-coder language + layer breakdown** (was team-level only): report queries
  group file weights by developer; each coder gets `languages[]` + `layers[]`
  (chips in the UI + JSON/Markdown export).
- **Weeks-long capture** (project runs 4–7 days): the activity feed is now durable
  (`feed_items`, migration 0008) so history survives restarts/redeploys and the
  whole timeframe is reportable; `GET /api/feed` reads it (live WS unchanged). The
  report timeline auto-collapses hourly→daily past 2 days (`timelineUnit`) so a
  week-long report is readable. Audited: all report aggregates are all-time, no
  pruning, no windows that drop project data — the only ephemeral state left
  (connections/collisions, both "right now" views) correctly resets.

`verify:extras` extended with per-coder assertions; all 18 verify green.

**Lesson:** For a multi-day, redeploy-prone deployment, anything you must "report
on later" has to be in Postgres, not an in-memory ring — the report was already
DB-backed, but the live feed wasn't, so it was the one capture gap.

---

## 2026-06-08 (c) — Pre-deploy: report analysis, agents, UX fixes, onboarding docs

**Scope:** apps/server (report, agents, projects, hooks), apps/web, agent-kit, docs
**Outcome:** SUCCESS

Round of pre-deploy work driven by demo prep + field feedback:
- **Report language + stack analysis:** `lib/classify.ts` maps file paths → language
  (by extension) and layer (frontend/backend/database/infra/docs); report adds
  Languages + "Where in the stack" breakdowns (git LOC if available, else live hook
  edits, `analysisBasis` reported) + markdown export.
- **Agents view + `GET /api/agents`:** each running session = an agent, grouped per
  coder (a coder can run several at once), with per-agent stats. Fixed a real bug —
  a session's first event wasn't counted in prompt/tool totals.
- **Members at creation:** project creation takes the typed roster (`members[]`)
  instead of hardcoded Alice/Bob (slugified usernames, palette colors, random
  tokens; created screen lists each member's token). SSO later.
- **Clipboard FIX:** copy buttons failed on plain-HTTP/LAN because
  `navigator.clipboard` is secure-context-only; added `lib/clipboard.ts` with an
  `execCommand` fallback (Connect, Patterns, created-project tokens).
- **Docs:** GETTING-STARTED.md (2-min onboard against a deployed appliance, pull
  just `agent-kit/mcp.json` — no clone), DEMO.md walkthrough, agent-kit links.

`verify:extras` (custom members + agents + edit-basis language/layer) + report git-
basis assertions; all 18 verify scripts green.

**Lesson:** Secure-context-only browser APIs (clipboard) silently no-op on LAN HTTP
— always provide a fallback for self-hosted/LAN apps. And test the *first* event of
a counter, not just the increment path.

---

## 2026-06-08 (b) — Optional polish complete

**Scope:** apps/server (mcp, api, schema, decompose)
**Outcome:** SUCCESS — the optional backlog is now also done.

Shipped the three low-priority items: (1) `search_tasks` filters (assignee/tag/
module) + limit/offset pagination returning `{tasks,total,limit,offset}`;
(2) idempotency keys on `post_decision` + `add_shared_pattern` (migration 0007,
nullable key + unique `(project_id,key)`; retry returns the existing row,
`deduped:true`); (3) opt-in LLM-assisted decomposition (`DECOMPOSE_LLM=1`, any
OpenAI-compatible endpoint) with the deterministic parser as default + guaranteed
fallback — `POST /decompose` reports `mode`.

Verified `verify:polish` (10 checks) + confirmed LLM-enabled-but-unreachable falls
back to deterministic in ~17ms (no hang). 17 verify scripts green. **Nothing left
in scope** — only the operational work (deploy at work, onboard the team) remains.

**Lesson:** Postgres treats NULLs as distinct in a unique index, so a nullable
idempotency key needs no partial index — unkeyed rows coexist freely while keyed
ones dedupe.

---

## 2026-06-08 — Multi-project, #36/#42, audit fixes, debris cleanup, containerize, #37/#39, deploy rehearsal

**Scope:** apps/server, apps/web, packages/shared, agent-kit, Docker/compose
**Outcome:** SUCCESS — all planned scope (P0–P11 + #36–#42 + audit) complete; deploy-ready.

### Shipped (in order)
- **Multi-project isolation (#41):** S1 additive schema (`projects`/`project_notes`, nullable `project_id` on all 14 tables, composite uniqueness) → S2 backend (~40 query sites scoped; `teamAuth`/`devAuth` resolve project; per-project feed ring; WS tagged + filtered by `projectId`; open `POST /api/projects` seeds coders/modules; git-poll per project) → S3 frontend (create-project login flow, project header, live Notes panel). Default token stays backward-compatible.
- **#42 PRD ingestion + decomposition:** deterministic markdown→tasks parser (`lib/decompose.ts`, no LLM — portable + testable), `PUT /prd`, `POST /decompose` (preview), `POST /tasks/bulk`; `tasks.source` (manual/prd/proposal) drives "% vs goal"; `get_project_goal` MCP tool.
- **#36 messaging + proposals + inheritance + reuse-kit:** proposals with voting (upsert tallies) + status; anchored comment threads on tasks & proposals; accepted proposal **adopts** → auto-creates tasks (decomposed) + ADR + (if it carries a reference impl) publishes a reuse-kit pattern; `routes/patterns.ts` + Reuse-kit tab; listener emits `PROPOSAL_UPDATED`/`VOTE_CAST`/`COMMENT_ADDED`/`PATTERN_ADDED`.
- **MCP audit feedback:** grew to **24 tools** — `whoami`, `get_task` (full detail + thread), `list_tasks`, `list_team`, `get_comments`; blocker reason + completion summary now persist into the readable thread; `claim_task` soft contention warning; task priority/tags/dueDate.
- **Test debris eliminated:** every verify runs in a throwaway project it deletes (cascade); `db:clean` purged existing junk (41 projects, 44 probe tasks, 92 hooks, 14 commits). Default board left with only real data.
- **#38 containerize:** multi-stage Bun Dockerfile + entrypoint (migrate→seed→serve); `docker-compose.yml` = full stack (db+app), `docker-compose.dev.yml` = Postgres-only; `.env.example`, `DEPLOY.md`, `stack:*` scripts. One command: `docker compose up -d --build`.
- **#37 collision warnings:** advisory (never a lock) same-file concurrent-edit detection from hook ingest → `COLLISION_WARNING` + `/api/collisions` + amber board banner.
- **#39 agent-kit docs:** per-client onboarding (claude-code/desktop, code-puppy, internal-tools, web) + index.

### Decisions
- **No-LLM decomposition** to keep the portal portable (work env may lack model access) and deterministically testable.
- **Soft everything** — claims, ownership, collisions are advisory; never block fast movers.
- **Verification-first** — 16 self-contained verify scripts (`verify:all`) + `db:clean`; nothing merged without a green checkpoint.
- **Single-origin, env-driven** image so the same artifact is portable across hosts/ports.

### Verification
- 16 verify scripts green individually and via `verify:all`; suite leaves DB pristine (1 project, 2 real tasks, 0 debris).
- **Deploy dress rehearsal:** ran the real container image/compose on alt ports → migrate+seed+serve, `/health` 200, SPA served, auth 200/401; full integration suite green **against the container** (EXIT 0); live 3-coder demo showed concurrent presence + auto-detected collision.

### What worked
- Reusing `decomposePrd` for both PRD ingestion and proposal adoption.
- Throwaway-project pattern made tests isolated AND doubled as the multi-tenant proof.

### What failed / fixed
- `verify-report` was silently depending on `verify-gitpoll` polluting the default project → made it self-contained.
- Client audit ran on a stale 11-tool MCP connection (create/assign/edit already existed) — lesson: MCP clients cache the tool list; **reconnect after server tool changes**.

### Lessons
- Additive migrations + backward-compatible defaults let a single-tenant app become multi-tenant without breaking the running one.
- Build the deploy artifact early and rehearse it; a containerized dress rehearsal catches integration gaps a host-run dev server hides.

### Remaining
- Operational: actually deploy at work + onboard the 5 coders (outside this environment).
- Low-priority polish: search pagination/assignee+tag filters, idempotency keys on `post_decision`/`add_shared_pattern`, optional LLM-assisted decomposition, git-poll author-email mapping for real coders.
