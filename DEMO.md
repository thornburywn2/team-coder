# Team Coder — Demo Walkthrough

A guided tour for the team. Team Coder is the **coordination layer** for a group of
"vibe coders" each driving AI agents on one shared product: it keeps everyone
seeing the same picture, avoids collisions, and turns design discussion into work —
while the agents pull live context over MCP.

> Setup for the demo: have the portal open on the projector, and 2–3 people ready
> to connect an agent ([GETTING-STARTED.md](./GETTING-STARTED.md)).

---

## The 60-second pitch

> "Five of us, five agents, one codebase. Team Coder shows who's doing what in real
> time, warns us when two agents touch the same file, lets us propose and vote on
> direction, auto-turns accepted proposals into tasks, and shares reusable code —
> all while our agents read the plan and report progress through one MCP endpoint.
> At the end it tells us who built what, in which language, in which part of the
> stack."

---

## Tour (tab by tab)

### 1. Login & project creation
- Enter the **team token** → pick your name. (Web-only is fine — no agent required.)
- **"Create a new project"** mints a fresh token and lets you **type the team
  roster right there** (one name per line). Each member gets their own agent token
  to hand out. (SSO will replace manual entry later.)

### 2. Board — the shared picture
- **Who's working on what:** a live swim lane per coder (status + current file).
- **Tasks:** create / claim / mark done, with priority + tags + a 🎯 goal marker.
  Click 💬 on any task to open its discussion thread.
- **Project header:** name, repo, the goal/PRD, and progress vs. that goal.
- **Notes:** a shared scratchpad, live for everyone.
- **Collision banner:** if two coders edit the same file within ~10 min, an amber
  "⚠️ Ada & Grace are both editing src/…" appears — advisory, never blocks.
- **Activity feed + ownership:** live event stream and auto-inferred module owners.

### 3. Proposals — collective design evolution
- Raise an idea/direction change (optionally with an experiment branch + a
  reference implementation). The team **votes** (👍/👎/🤷) and **discusses** inline.
- **Accept** a proposal and watch it **auto-create tasks** from its description,
  record an **ADR** (decision of record), and **publish its code to the reuse kit**.

### 4. Reuse kit — don't rebuild it twice
- Browse + publish reusable code patterns (with copy button), filter by tag.
  Adopted proposals land here automatically.

### 5. Agents — who/which agent is live, team awards *(new)*
- Every running session shows up as an **agent**, grouped under its coder — so one
  person driving **multiple agents** shows multiple entries. Per-agent stats:
  prompts, tool calls, files touched, active minutes, current file, status.
- **🏆 Team awards:** everyone gets a positive award for a real strength (The
  Closer, Heavy Lifter, Data Wizard, Frontend Champion, …) — it's a team event,
  nothing negative.
- **😴 Idle alerts:** an agent that goes quiet is flagged here and in the feed, so
  a stalled/abandoned agent gets noticed.

### 6. Report — who built what *(now with language + stack analysis)*
- Blended contribution % per coder (commits · lines · tasks · edits), module
  breakdown, and **Languages** (TypeScript/Python/SQL/…) + **Where in the stack**
  (frontend / backend / database / infra / docs) — **both team-wide and per coder**
  (chips under each person). Uses git LOC when a repo is configured, otherwise live
  edit activity; the timeline rolls up to daily buckets for multi-day projects.
  Export JSON / Markdown / Print-PDF.

### 7. Connect — wire up your agent
- Your agent token + copy-paste MCP command and hooks config (filled in for you).

---

## Suggested 5-minute live demo

1. **Create a project** with the real attendees as members; show each got a token.
2. **Two people connect agents** (one with two sessions) → Board lights up; the
   **Agents** tab shows 3 agents across 2 people.
3. Ask both agents to **edit the same file** → the **collision banner** fires.
4. Have an agent **`create_task`** / **`claim_task`** → it appears live for everyone.
5. **Raise a proposal**, vote, **accept** it → tasks auto-appear + an ADR is recorded.
6. Open **Report** → show the language + stack breakdown of what just happened.

---

## How agents "see" the project (the MCP surface)

Agents read and write through one endpoint. Highlights: `whoami`,
`get_project_goal`, `get_my_tasks` / `list_tasks`, `get_module_context`,
`get_shared_patterns`, `create_task` / `claim_task` / `update_task_progress` /
`complete_task`, `create_proposal` / `vote_proposal`, `post_comment`,
`post_decision`, `add_shared_pattern`. Humans steer; agents follow.

See [GETTING-STARTED.md](./GETTING-STARTED.md) to connect, [DEPLOY.md](./DEPLOY.md)
to deploy, and [agent-kit/](./agent-kit/) for per-tool setup.
