#!/usr/bin/env sh
# team-coder-sync — keep your local clone in sync with the team, SAFELY.
#
# Pulls teammates' pushed commits (FAST-FORWARD ONLY). It NEVER touches your work:
# no reset, no stash-drop, no force, no overwrite. If you have uncommitted changes
# or unpushed local commits, it only fetches the refs and tells you — your
# checked-out and committed work is left exactly as-is.
#
# Usage:
#   ./team-coder-sync.sh [path-to-your-repo]     # watch (default: current dir)
#   SYNC_INTERVAL=0 ./team-coder-sync.sh         # run once (good for cron / a git hook)
#
# Tip: run it in your product repo while you work, so once anyone commits & pushes,
# you fast-forward to it within ~SYNC_INTERVAL seconds.

set -eu
REPO="${1:-.}"
INTERVAL="${SYNC_INTERVAL:-60}"   # seconds; 0 = run once and exit
cd "$REPO"

sync_once() {
  git fetch --quiet origin || { echo "[sync] fetch failed (offline?)"; return 0; }
  branch=$(git rev-parse --abbrev-ref HEAD)
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
  [ -z "$upstream" ] && { echo "[sync] '$branch' has no upstream — skipping"; return 0; }

  local_sha=$(git rev-parse @)
  remote_sha=$(git rev-parse '@{u}')
  [ "$local_sha" = "$remote_sha" ] && return 0   # already in sync

  # Only fast-forward, and only if local HEAD is an ancestor of the remote
  # (i.e. you have no diverging local commits). Otherwise: fetch-only + notify.
  if git merge-base --is-ancestor "$local_sha" "$remote_sha"; then
    if git merge --ff-only '@{u}' >/dev/null 2>&1; then
      echo "[sync] $(date +%H:%M:%S) fast-forwarded $branch → $(git rev-parse --short '@')"
    else
      echo "[sync] $(date +%H:%M:%S) new commits fetched, but you have uncommitted changes — commit or stash, then they'll fast-forward (untouched for now)"
    fi
  else
    echo "[sync] $(date +%H:%M:%S) you have local commits not yet pushed — fetched only; push/rebase when ready (your work is untouched)"
  fi
}

if [ "$INTERVAL" -eq 0 ]; then
  sync_once
else
  echo "[sync] watching '$REPO' every ${INTERVAL}s — fast-forward only, your work is never touched"
  while true; do sync_once; sleep "$INTERVAL"; done
fi
