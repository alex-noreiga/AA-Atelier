#!/usr/bin/env bash
#
# Symlink this repo's hooks into .git/hooks. Run once per clone:
#
#   pnpm hooks:install
#
# Symlinks (not copies) so edits to scripts/*.sh take effect without reinstalling.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$(cd "$ROOT" && cd "$(git rev-parse --git-path hooks)" && pwd)"

# hook name -> source script
HOOKS="pre-push:pre-push.sh post-merge:post-merge.sh"

for pair in $HOOKS; do
  hook="${pair%%:*}"
  src="$ROOT/scripts/${pair##*:}"
  dest="$HOOKS_DIR/$hook"

  if [ ! -f "$src" ]; then
    echo "skip $hook — $src not found" >&2
    continue
  fi

  chmod +x "$src"

  # Leave a pre-existing hand-written hook alone rather than clobbering it.
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "skip $hook — $dest already exists and isn't a symlink (move it aside first)" >&2
    continue
  fi

  ln -sfn "$src" "$dest"
  echo "✓ $hook → scripts/${pair##*:}"
done
