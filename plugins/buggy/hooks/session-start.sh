#!/bin/sh
# SessionStart: silent outside buggy projects (Node is not even started).
dir=${CLAUDE_PROJECT_DIR:-$PWD}
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/.buggy/config.yaml" ] || exit 0
if ! command -v node >/dev/null 2>&1; then
  echo "buggy project, but Node.js >= 20 is missing: buggy commands will not work (https://nodejs.org)."
  exit 0
fi
node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs"
exit 0
