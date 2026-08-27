#!/bin/bash
# claude/scripts/sync-back.sh — pull repo-tracked keys back from
# ~/.claude/settings.json, drop the now-defunct memory classify prompt
# (memory directory location IS the classification under the 3-tier model),
# add AGENTS.manifest drift detection.
# --strict: fail on manifest drift instead of WARN.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$REPO_DIR/.." && pwd)"
AI_DIR="$ROOT_DIR/ai"
CLAUDE_DIR="$HOME/.claude"

STRICT=0
for arg in "$@"; do
    case "$arg" in
        --strict) STRICT=1 ;;
    esac
done

changed=false

# ── 1. settings.json — keep only repo-tracked keys ──
if [ -f "$CLAUDE_DIR/settings.json" ]; then
    # Name the runtime keys the filter below is about to drop, so a flag enabled
    # in a live session is a decision to make rather than a silent loss.
    untracked_env=$(jq -s -r \
        '((.[1].env // {} | keys) - (.[0].env // {} | keys))[]' \
        "$REPO_DIR/settings.json" "$CLAUDE_DIR/settings.json")
    if [ -n "$untracked_env" ]; then
        echo "WARN: env keys in ~/.claude/settings.json are not tracked in the repo (not synced):"
        echo "$untracked_env" | sed 's/^/  /'
        echo "  add them to claude/settings.json by hand if they should persist"
    fi

    jq -s '
      .[0] as $repo | .[1] |
      with_entries(select(.key | IN($repo | keys[]))) |
      .permissions.allow = ([.permissions.allow[] | select(IN($repo.permissions.allow[]))]) |
      .permissions.deny  = ([.permissions.deny[]  | select(IN($repo.permissions.deny[]))]) |
      # env is the one object copied as a whole, so give it the same treatment
      # permissions gets: keep only keys the repo already tracks, in one
      # canonical order. Otherwise runtime keys the CLI appends land in the
      # source unreviewed and reflow it on every sync.
      (if has("env")
       then .env |= (to_entries
                     | map(select(.key | IN($repo.env // {} | keys[])))
                     | sort_by(.key)
                     | from_entries)
       else . end)
    ' "$REPO_DIR/settings.json" "$CLAUDE_DIR/settings.json" \
        > "$REPO_DIR/settings.json.tmp"
    if ! diff -q "$REPO_DIR/settings.json" "$REPO_DIR/settings.json.tmp" &>/dev/null; then
        mv "$REPO_DIR/settings.json.tmp" "$REPO_DIR/settings.json"
        echo "Synced: settings.json"
        changed=true
    else
        rm "$REPO_DIR/settings.json.tmp"
    fi
fi

# ── 2. AGENTS.manifest drift detection ──
MANIFEST="$AI_DIR/AGENTS.manifest"
if [ -f "$MANIFEST" ]; then
    listed=$(/usr/bin/grep -v '^[[:space:]]*\(#\|$\)' "$MANIFEST" | sort -u)
    actual=$(cd "$AI_DIR" && find . -type f -name '*.md' \
        -not -path './skills/*' \
        -not -path './scripts/*' \
        -not -path './lib/*' \
        -not -name 'README.md' \
        | sed 's|^\./||' | sort -u)
    missing=$(comm -23 <(echo "$actual") <(echo "$listed"))
    stale=$(comm -13 <(echo "$actual") <(echo "$listed"))

    if [ -n "$missing" ]; then
        echo "WARN: ai/ files NOT in AGENTS.manifest:"
        echo "$missing" | sed 's/^/  /'
    fi
    if [ -n "$stale" ]; then
        echo "WARN: AGENTS.manifest references missing files:"
        echo "$stale" | sed 's/^/  /'
    fi
    if [ -n "$missing$stale" ] && [ "$STRICT" -eq 1 ]; then
        echo "FAIL: --strict mode — manifest drift treated as error"
        exit 1
    fi
fi

# Note: MEMORY.md is auto-generated — never sync back.
# Memory classification prompt removed: directory location (ai/memory vs
# claude/memory vs ai/memory/private) is the classification under 3-tier.

if [ "$changed" = false ]; then
    echo "Nothing to sync."
fi
