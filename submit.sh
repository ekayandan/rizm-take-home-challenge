#!/bin/sh
# Builds the submission zip: collects your AI session logs into .logs/, shows you
# what will be included, and zips the repository together with the logs.
# See README.md, section "We record your AI coding sessions".
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for py in python3 python py; do
  if command -v "$py" >/dev/null 2>&1 \
     && "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 13) else 1)' >/dev/null 2>&1; then
    exec "$py" "$dir/tools/ai-logs/collect.py" submit "$@"
  fi
done
echo "Python 3.13 or newer is required to build the submission: https://www.python.org/downloads/" >&2
exit 1
