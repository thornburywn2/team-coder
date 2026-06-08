# Staying in sync (every engineer's local repo)

The whole team works on **one product repo** (GitHub is the source of truth). Team
Coder watches that repo and the goal is simple: **once anyone commits & pushes,
everyone fast-forwards to it** — without ever disturbing your own work.

## The model

- **You** (your agent) write code and `git push` as normal.
- **Team Coder** polls the repo (server-side), ingests new commits for the
  contribution report/ownership, and broadcasts a `REPO_UPDATED` signal + exposes
  `GET /api/repo/status` (latest team HEAD).
- **`team-coder-sync.sh`** runs on each engineer's machine and **fast-forwards your
  local clone** when there's new upstream — safely.

> Team Coder never writes to or force-updates your repo. It reads. The sync script
> only ever **fast-forwards**; if that's not possible (you have uncommitted changes
> or unpushed commits) it just fetches and tells you — your checked-out and
> committed work is left exactly as-is.

## Use it

```bash
# in your product repo, while you work:
curl -fsSL https://raw.githubusercontent.com/thornburywn2/team-coder/main/agent-kit/team-coder-sync.sh -o team-coder-sync.sh
chmod +x team-coder-sync.sh
./team-coder-sync.sh                 # watches every 60s, ff-only
# or one-shot (cron / a post-merge git hook):
SYNC_INTERVAL=0 ./team-coder-sync.sh
```

That's it — push from one machine, and within ~a minute every other engineer's
clone fast-forwards to the same commit. Nobody clobbers anyone.

## Server side (the appliance)

Enable continuous polling so the portal keeps its mirror + report current and
emits `REPO_UPDATED`:

```bash
# .env on the appliance
ENABLE_GIT_POLL=1
PRODUCT_REPO_POLL_SECONDS=60     # how often to pull (default 300)
```

Each project's repo is set at creation (`githubRepoUrl`) and polled independently —
fully isolated per project.
