#!/bin/sh
# PreToolUse (Bash, Write): cheap filter in sh, decisions in Node (scripts/guard.mjs).
# Fails open: without Node, or on any error, it prints nothing (normal permissions apply).
input=$(cat)
case "$input" in
  *git*|*run.sh*|*.buggy/.tmp/*) ;;
  *) exit 0 ;;
esac
command -v node >/dev/null 2>&1 || exit 0
printf '%s' "$input" | node "${CLAUDE_PLUGIN_ROOT}/scripts/guard.mjs"
exit 0
