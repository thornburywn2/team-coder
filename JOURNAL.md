# Team Coder — Project Journal

> Append-only. Newest entries at the top. Format per ~/CLAUDE-MEMORY-SYSTEM.md.

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
