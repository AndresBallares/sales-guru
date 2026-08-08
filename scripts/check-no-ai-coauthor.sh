#!/usr/bin/env bash
# commit-msg hook: reject commits with a Co-authored-by trailer attributing
# to Claude/Anthropic. Registered as a pre-commit `commit-msg` stage hook —
# see .pre-commit-config.yaml.
set -euo pipefail

commit_msg_file="$1"

if grep -Eiq '^co-authored-by:.*(claude|anthropic)' "$commit_msg_file"; then
  echo "error: commit message has a Co-authored-by trailer attributing to Claude/Anthropic." >&2
  echo "Remove that trailer and commit again." >&2
  exit 1
fi
