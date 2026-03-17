#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"

changed=false

# ── settings.json (extract repo-tracked keys only, exclude local-only like model) ──
if [ -f "$CLAUDE_DIR/settings.json" ]; then
    jq -s '.[0] as $repo | .[1] | with_entries(select(.key | IN($repo | keys[])))' \
        "$REPO_DIR/settings.json" "$CLAUDE_DIR/settings.json" \
        > "$REPO_DIR/settings.json.tmp"
    if ! diff -q "$REPO_DIR/settings.json" "$REPO_DIR/settings.json.tmp" &>/dev/null; then
        mv "$REPO_DIR/settings.json.tmp" "$REPO_DIR/settings.json"
        echo "Synced: settings.json"
        changed=true
    else
        rm "$REPO_DIR/settings.json.tmp"
    fi
fi

# ── New memory files → prompt to classify ──
# Collect filenames already referenced in MEMORY.md or MEMORY.private.md
KNOWN_FILES=$(/usr/bin/grep -oh 'memory/[^)]*\.md' \
    "$REPO_DIR/MEMORY.md" "$REPO_DIR/MEMORY.private.md" 2>/dev/null \
    | sed 's|.*/||' | sort -u)

NEW_FILES=()
for f in "$REPO_DIR"/memory/*.md; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    if echo "$KNOWN_FILES" | /usr/bin/grep -qx "$fname"; then
        continue
    fi
    NEW_FILES+=("$fname")
done

if [ ${#NEW_FILES[@]} -gt 0 ]; then
    echo "New memory files found:"
    for i in "${!NEW_FILES[@]}"; do
        echo "  [$i] ${NEW_FILES[$i]}"
    done
    if [ -t 0 ]; then
        read -p "Enter indices to move to private (e.g. '0 2'), or press Enter to keep public: " indices
        for idx in $indices; do
            fname="${NEW_FILES[$idx]}"
            mkdir -p "$REPO_DIR/memory/private"
            mv "$REPO_DIR/memory/$fname" "$REPO_DIR/memory/private/$fname"
            echo "Moved to private: $fname"
            changed=true
        done
    else
        echo "Non-interactive mode — skipping classification. Run sync-back.sh manually to classify."
    fi
fi

# NOTE: MEMORY.md is NOT synced back.
# The deployed ~/.claude/MEMORY.md is a merged file (base + private).
# Edit MEMORY.md or MEMORY.private.md in the repo directly.

if [ "$changed" = false ]; then
    echo "Nothing to sync."
fi
