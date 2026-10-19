#!/usr/bin/env bash
set -euo pipefail

MAX_ITERS="${MAX_ITERS:-60}"
i=0

while (( i < MAX_ITERS )); do
  [[ -f STOP ]] && { echo "STOP sentinel present — halting."; break; }

  # Done when no unchecked tasks remain in progress.md.
  if ! grep -q '^\- \[ \]' ../Docs/progress.md; then
    echo "All tasks complete."; break
  fi

  echo "=== Ralph iteration $i ==="
  # Headless Claude Code against the fixed iteration prompt.
  claude -p --dangerously-skip-permissions "$(cat ralph/iteration-prompt.md)" || true

  # Per-task verification gate: build must pass before the work counts.
  if ./ralph/verify.sh; then
    git add -A && git commit -m "ralph: iteration $i" || true
  else
    echo "Verification failed — rolling back this iteration."
    git reset --hard HEAD
  fi
  (( i++ )) || true
done
