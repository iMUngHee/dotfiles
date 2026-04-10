#!/usr/bin/env bash
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SESSION_ID="${SESSION_ID//[^a-zA-Z0-9_-]/}"
SID_DIR="/tmp/claude/sessions/${SESSION_ID:-default}"
rm -rf "$SID_DIR/context-markers" 2>/dev/null
rm -f "$SID_DIR/context-pct" 2>/dev/null
BRANCH=$(git branch --show-current 2>/dev/null || echo 'N/A')
COMMITS=$(git log --oneline -3 2>/dev/null | tr '\n' ';' | sed 's/;$//')
MODIFIED=$(git diff --name-only 2>/dev/null | head -10 | tr '\n' ', ' | sed 's/,$//')
STAGED=$(git diff --cached --name-only 2>/dev/null | head -5 | tr '\n' ', ' | sed 's/,$//')
CWD=$(basename "$PWD")

echo "[post-compact context restore]"
echo "  branch: $BRANCH"
echo "  recent commits: $COMMITS"
[ -n "$MODIFIED" ] && echo "  modified (unstaged): $MODIFIED"
[ -n "$STAGED" ] && echo "  staged: $STAGED"
echo "  working dir: $CWD"
