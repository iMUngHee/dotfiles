#!/usr/bin/env bash
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
