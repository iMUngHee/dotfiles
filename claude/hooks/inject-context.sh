#!/usr/bin/env bash
# UserPromptSubmit adapter: pass Claude's project root to the shared read-only
# worktree resolver and inject its execution routing result. Fail-open.

set -euo pipefail

cat > /dev/null

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

CONFIG_ROOT="${AI_CONFIG_ROOT:-$HOME/.config}"
ENGINE="$CONFIG_ROOT/ai/lib/worktree.mjs"
[[ -f "$ENGINE" ]] || exit 0
RESOLVED=$(node "$ENGINE" resolve-current --root "$PROJECT_DIR" 2>/dev/null) || exit 0
STATUS=$(printf '%s' "$RESOLVED" | jq -r '.status // empty')

case "$STATUS" in
  empty|terminal) exit 0 ;;
  ok)
    PLAN_STATUS=$(printf '%s' "$RESOLVED" | jq -r '.plan_status')
    [[ "$PLAN_STATUS" == "draft" || "$PLAN_STATUS" == "active" ]] || exit 0
    [[ "$PLAN_STATUS" == "draft" ]] && ICON="⚙️" || ICON="▶️"
    TITLE=$(printf '%s' "$RESOLVED" | jq -r '.title')
    PLAN=$(printf '%s' "$RESOLVED" | jq -r '.plan')
    EXECUTION_ROOT=$(printf '%s' "$RESOLVED" | jq -r '.execution_root')
    BRANCH=$(printf '%s' "$RESOLVED" | jq -r '.branch')
    BASE=$(printf '%s' "$RESOLVED" | jq -r '(.base_branch + " @ " + .base_commit)')
    ROUTE_REQUIRED=$(printf '%s' "$RESOLVED" | jq -r '.route_required')
    [[ "$ROUTE_REQUIRED" == "true" ]] && ROUTE="switch to the execution root" || ROUTE="already at the execution root"
    CONTEXT="$ICON $PLAN_STATUS: $TITLE — $PLAN
execution root: $EXECUTION_ROOT
branch: $BRANCH
base: $BASE
route: $ROUTE"
    ;;
  *)
    PLAN=$(printf '%s' "$RESOLVED" | jq -r '.plan // "(unknown)"')
    CONTEXT="⚠️ plan routing error: $STATUS — $PLAN"
    ;;
esac

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
