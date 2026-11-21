#!/bin/sh
# Single entry point for buggy scripts, used by skills and hooks.
#
#   sh <plugin>/scripts/run.sh <script> [args...]   e.g.  run.sh state
#
# Checks for Node.js >= 20 first, so a missing Node never aborts a skill with a
# shell error: it prints the standard JSON error instead (exit code 0).
# <script> must be a plain name (letters, digits, '-'); it maps to <script>.mjs.

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

name=$1
case "$name" in
  ''|*[!a-z0-9-]*)
    echo '{"status":"error","code":"bad-script","message":"Unknown buggy script."}'
    exit 0
    ;;
esac
shift

if [ ! -f "$dir/$name.mjs" ]; then
  echo '{"status":"error","code":"bad-script","message":"Unknown buggy script."}'
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo '{"status":"error","code":"node-missing","message":"Node.js >= 20 is required by buggy (https://nodejs.org)."}'
  exit 0
fi

major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
if [ -z "$major" ] || [ "$major" -lt 20 ]; then
  echo '{"status":"error","code":"node-too-old","message":"Node.js >= 20 is required by buggy (https://nodejs.org)."}'
  exit 0
fi

exec node "$dir/$name.mjs" "$@"
