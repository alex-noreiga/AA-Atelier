#!/usr/bin/env bash
#
# git pre-push hook. Install with: pnpm hooks:install
#
# Clears regenerable build/test artifacts before each push and nudges when the
# shared Playwright browser cache has grown stale builds. Deliberately cheap
# (~1s, no network, no CLI spawn) and deliberately non-fatal: a cleanup problem
# must never be the reason a push fails.
#
set -u

ROOT="$(git rev-parse --show-toplevel)"
"$ROOT/scripts/cleanup.sh" --hook </dev/null || true

exit 0
