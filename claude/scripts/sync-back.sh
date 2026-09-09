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

    # The output goes through tr because jq on Windows opens stdout in text mode
    # and turns every newline into CRLF. This file is tracked and the pre-commit
    # hook runs this script, so without it a commit made on Windows rewrites
    # settings.json with line endings .gitattributes then normalises away again,
    # leaving a working copy that permanently differs from the index — which is
    # why git status there reported every tracked file modified while git diff
    # showed nothing. A raw CR cannot appear inside jq JSON output, which
    # escapes control characters, so dropping all of them is safe; on macOS and
    # Linux there are none to drop.
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
        | tr -d '\r' > "$REPO_DIR/settings.json.tmp"
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

    # memory/private/* is gitignored and lives only in the main checkout; a linked
    # worktree must not report those entries as drift. Resolve them against the
    # main root and keep only entries that are missing there too.
    if [ -n "$stale" ]; then
        common_dir="$(git -C "$ROOT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
        main_root="${common_dir%/.git}"
        resolved=""
        remaining=""
        while IFS= read -r entry; do
            [ -z "$entry" ] && continue
            case "$entry" in
                memory/private/*)
                    if [ -n "$common_dir" ] && [ -f "$main_root/ai/$entry" ]; then
                        resolved+="$entry"$'\n'
                        continue
                    fi ;;
            esac
            remaining+="$entry"$'\n'
        done <<< "$stale"
        if [ -n "$resolved" ]; then
            echo "INFO: private manifest entries resolved against the main checkout ($main_root):"
            printf '%s' "$resolved" | sed 's/^/  /'
        fi
        stale="$(printf '%s' "$remaining")"
    fi

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
