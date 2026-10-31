#!/bin/sh
# Entry point for every AI tool hook in this repo: finds a Python 3 and runs the
# collector. Exits 0 no matter what, so a missing Python can never break a session.
# Usage: hook.sh <tool>    (claude | codex | cursor | copilot | gemini)
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for py in python3 python py; do
  if command -v "$py" >/dev/null 2>&1 \
     && "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 13) else 1)' >/dev/null 2>&1; then
    "$py" "$dir/collect.py" hook "$@" 2>/dev/null
    exit 0
  fi
done
exit 0
