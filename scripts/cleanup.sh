#!/usr/bin/env bash
#
# Reclaim disk space from build output and Playwright runs.
#
#   ./scripts/cleanup.sh            fast clean: regenerable repo artifacts only
#   ./scripts/cleanup.sh --deep     also prune stale Playwright browser builds
#                                   and orphaned packages from the pnpm store
#   ./scripts/cleanup.sh --deep -n  preview a deep clean; delete nothing
#   ./scripts/cleanup.sh --hook     quiet fast clean; used by the pre-push hook
#
# The fast path only removes things a build regenerates, and only paths that git
# already ignores. It deliberately leaves node_modules and downloaded browsers
# alone: clearing those before a push just forces a ~540MB re-download the next
# time the tests run.
#
# The real disk growth is in --deep. Playwright pins browsers by build number
# (chromium-1228, ...), so every version bump downloads a fresh ~540MB set and
# leaves the previous one in the shared cache forever. Nothing evicts it.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PW_BIN="$ROOT/tests/node_modules/.bin/playwright"

DEEP=0
DRY=0
HOOK=0
ASSUME_YES=0

# Warn from the pre-push hook once the browser cache exceeds this. One complete
# browser set is ~540MB, so anything past ~700MB means a stale build is sitting
# there. Override with CLEANUP_PW_WARN_MB.
PW_WARN_MB="${CLEANUP_PW_WARN_MB:-700}"

while [ $# -gt 0 ]; do
  case "$1" in
    --deep) DEEP=1 ;;
    -n|--dry-run) DRY=1 ;;
    --hook) HOOK=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "cleanup: unknown option '$1' (try --help)" >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  DIM=$'\033[2m'; BOLD=$'\033[1m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  DIM=""; BOLD=""; YELLOW=""; GREEN=""; RESET=""
fi

say()  { [ "$HOOK" -eq 1 ] && return 0; printf '%s\n' "$*"; }
note() { printf '%s\n' "$*"; }  # always shown, even in hook mode

kb_of() { du -sk "$1" 2>/dev/null | awk '{ print $1 }'; }

human() {
  awk -v k="${1:-0}" 'BEGIN {
    if (k >= 1048576) printf "%.1f GB", k / 1048576;
    else if (k >= 1024) printf "%.0f MB", k / 1024;
    else printf "%d KB", k;
  }'
}

# ---------------------------------------------------------------------------
# Fast clean: regenerable artifacts inside the repo.
# ---------------------------------------------------------------------------

# Candidates. node_modules is pruned from the walk (both for speed and because
# we never delete it here); the Vite/Vitest caches that live *inside* it are
# picked up explicitly.
repo_candidates() {
  find "$ROOT" -name node_modules -prune -o -type d \
    \( -name test-results -o -name playwright-report -o -name blob-report -o -name dist \) -print
  find "$ROOT" -name node_modules -prune -o -type f -name '*.tsbuildinfo' -print
  find "$ROOT" -type d \( -path '*/node_modules/.vite' -o -path '*/node_modules/.vitest' \) -print
}

fast_clean() {
  local candidates ignored total=0 count=0 kb path
  candidates="$(repo_candidates)"
  [ -z "$candidates" ] && { say "${DIM}nothing to clean${RESET}"; return 0; }

  # Safety rail: only ever delete paths git already ignores. A tracked file can
  # never be reached by this script, whatever the find patterns above match.
  ignored="$(printf '%s\n' "$candidates" | git -C "$ROOT" check-ignore --stdin || true)"
  [ -z "$ignored" ] && { say "${DIM}nothing to clean${RESET}"; return 0; }

  while IFS= read -r path; do
    [ -e "$path" ] || continue
    kb="$(kb_of "$path")"
    total=$((total + ${kb:-0}))
    count=$((count + 1))
    say "  ${DIM}rm${RESET} ${path#$ROOT/}  ${DIM}($(human "${kb:-0}"))${RESET}"
    [ "$DRY" -eq 0 ] && rm -rf "$path"
  done <<EOF
$ignored
EOF

  local verb="removed"
  [ "$DRY" -eq 1 ] && verb="would remove"
  if [ "$HOOK" -eq 1 ]; then
    [ "$total" -gt 0 ] && note "${DIM}cleanup: $verb $count artifact(s), $(human "$total")${RESET}"
  else
    note "${GREEN}✓${RESET} $verb $count artifact(s) — $(human "$total")"
  fi
}

# ---------------------------------------------------------------------------
# Playwright browser cache (shared across every project on this machine).
# ---------------------------------------------------------------------------

# Resolve the cache root and the builds the *installed* Playwright still needs,
# straight from the CLI, so this keeps working across version bumps instead of
# hardcoding "chromium-1228". Prints "<root>\n<keep>\n<keep>..." on success.
pw_keep_set() {
  [ -x "$PW_BIN" ] || return 1
  "$PW_BIN" install --dry-run 2>/dev/null \
    | awk '/Install location:/ { print $NF }'
}

pw_cache_root() {
  if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    printf '%s\n' "$PLAYWRIGHT_BROWSERS_PATH"
  elif [ "$(uname -s)" = "Darwin" ]; then
    printf '%s\n' "$HOME/Library/Caches/ms-playwright"
  else
    printf '%s\n' "$HOME/.cache/ms-playwright"
  fi
}

# Emits the stale build directories, one per line.
pw_stale() {
  local keep root entry
  keep="$(pw_keep_set)" || return 1
  # Never proceed on an empty keep-set — that would mean deleting every browser.
  [ -z "$keep" ] && return 1

  root="$(dirname "$(printf '%s\n' "$keep" | head -1)")"
  [ -d "$root" ] || return 1

  for entry in "$root"/*; do
    [ -d "$entry" ] || continue
    case "$(basename "$entry")" in .*) continue ;; esac
    if ! printf '%s\n' "$keep" | grep -qxF "$entry"; then
      printf '%s\n' "$entry"
    fi
  done
}

deep_clean_playwright() {
  local stale total=0 kb entry root
  root="$(pw_cache_root)"

  if [ ! -d "$root" ]; then
    say "${DIM}playwright: no browser cache at $root${RESET}"
    return 0
  fi

  if ! stale="$(pw_stale)"; then
    say "${YELLOW}!${RESET} playwright: couldn't determine which browsers are in use"
    say "  ${DIM}(is tests/node_modules installed? run: pnpm install)${RESET}"
    say "  ${DIM}skipping the browser cache — $(human "$(kb_of "$root")") left in place${RESET}"
    return 0
  fi

  if [ -z "$stale" ]; then
    say "${GREEN}✓${RESET} playwright: no stale builds — cache is $(human "$(kb_of "$root")")"
    return 0
  fi

  say ""
  say "${BOLD}Stale Playwright builds${RESET} ${DIM}($root)${RESET}"
  while IFS= read -r entry; do
    kb="$(kb_of "$entry")"
    total=$((total + ${kb:-0}))
    say "  ${DIM}rm${RESET} $(basename "$entry")  ${DIM}($(human "${kb:-0}"))${RESET}"
  done <<EOF
$stale
EOF

  say ""
  say "  ${YELLOW}⚠${RESET}  This cache is shared by every Playwright project on this machine."
  say "     Another project pinned to an older Playwright will re-download on its next run."
  say ""

  if [ "$DRY" -eq 1 ]; then
    note "${DIM}would reclaim $(human "$total") from the browser cache${RESET}"
    return 0
  fi

  if [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then
    printf 'Delete these and reclaim %s? [y/N] ' "$(human "$total")"
    local reply
    read -r reply
    case "$reply" in
      y|Y|yes|YES) ;;
      *) note "skipped the browser cache"; return 0 ;;
    esac
  fi

  while IFS= read -r entry; do
    rm -rf "$entry"
  done <<EOF
$stale
EOF
  note "${GREEN}✓${RESET} reclaimed $(human "$total") from the Playwright browser cache"
}

deep_clean_pnpm_store() {
  local before after store
  store="$(pnpm store path 2>/dev/null || true)"
  [ -n "$store" ] && [ -d "$store" ] || { say "${DIM}pnpm: no store found${RESET}"; return 0; }

  before="$(kb_of "$store")"
  if [ "$DRY" -eq 1 ]; then
    note "${DIM}would run 'pnpm store prune' (store is currently $(human "${before:-0}"))${RESET}"
    return 0
  fi

  say ""
  say "${BOLD}Pruning the pnpm store${RESET} ${DIM}($store)${RESET}"
  pnpm store prune >/dev/null 2>&1 || { say "${YELLOW}!${RESET} pnpm store prune failed — skipped"; return 0; }
  after="$(kb_of "$store")"
  note "${GREEN}✓${RESET} pnpm store: $(human "${before:-0}") → $(human "${after:-0}")"
}

# ---------------------------------------------------------------------------
# Hook-mode nudge: cheap size check, no CLI spawn, no prompts.
# ---------------------------------------------------------------------------
hook_warn_if_bloated() {
  local root kb mb
  root="$(pw_cache_root)"
  [ -d "$root" ] || return 0
  kb="$(kb_of "$root")"
  mb=$(( ${kb:-0} / 1024 ))
  if [ "$mb" -ge "$PW_WARN_MB" ]; then
    note "${YELLOW}⚠${RESET}  Playwright browser cache is $(human "${kb:-0}") — likely holding stale builds."
    note "   ${DIM}reclaim with:${RESET} pnpm clean:deep"
  fi
}

# ---------------------------------------------------------------------------

if [ "$HOOK" -eq 1 ]; then
  fast_clean
  hook_warn_if_bloated
  exit 0
fi

[ "$DRY" -eq 1 ] && note "${DIM}dry run — nothing will be deleted${RESET}" && note ""

say "${BOLD}Repo artifacts${RESET}"
fast_clean

if [ "$DEEP" -eq 1 ]; then
  deep_clean_playwright
  deep_clean_pnpm_store
else
  say ""
  say "${DIM}Shared caches left alone. To prune stale Playwright builds and the${RESET}"
  say "${DIM}pnpm store too:  pnpm clean:deep   (preview: pnpm clean:deep -- -n)${RESET}"
fi
