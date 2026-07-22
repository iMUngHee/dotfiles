#!/usr/bin/env bash
# UserPromptSubmit adapter: resolve the current Claude session binding, normalize only
# safe checkout-local legacy ownership, and fail open with a visible diagnostic.

set -euo pipefail

INPUT=$(cat)

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

CONFIG_ROOT="${AI_CONFIG_ROOT:-$HOME/.config}"
ENGINE="$CONFIG_ROOT/ai/lib/worktree.mjs"
[[ -f "$ENGINE" ]] || exit 0
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
if ! RESOLVED=$(PM_SESSION_TOOL=claude PM_SESSION_ID="$SESSION_ID" node "$ENGINE" ensure-session --root "$PROJECT_DIR" --tool claude 2>/dev/null); then
  RESOLVED='{"status":"internal_error"}'
fi
STATUS=$(printf '%s' "$RESOLVED" | jq -r '.status // empty')
SESSION_LABEL="${SESSION_ID:-unavailable}"
SESSION_META="session tool: claude
session id: $SESSION_LABEL"

case "$STATUS" in
  unbound|empty)
    CONTEXT="ℹ️ session plan: unbound
$SESSION_META
binding: unbound
main current: launcher-only; persist or select an explicit plan before lifecycle actions"
    ;;
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
    BINDING_STATUS=$(printf '%s' "$RESOLVED" | jq -r '.binding_status // "bound"')
    [[ "$ROUTE_REQUIRED" == "true" ]] && ROUTE="switch to the execution root" || ROUTE="already at the execution root"
    CONTEXT="$SESSION_META
binding: $BINDING_STATUS
$ICON $PLAN_STATUS: $TITLE — $PLAN
execution root: $EXECUTION_ROOT
branch: $BRANCH
base: $BASE
route: $ROUTE"
    ;;
  legacy_unmapped)
    PLAN=$(printf '%s' "$RESOLVED" | jq -r '.recovery.plan // .plan // "(unknown)"')
    CANDIDATE_COUNT=$(printf '%s' "$RESOLVED" | jq -r '.recovery.candidate_count // 0')
    [[ "$CANDIDATE_COUNT" == "0" ]] && SOURCE_OPTION=" [--start <ref-or-oid>]" || SOURCE_OPTION=""
    CONTEXT="⚠️ session plan routing error: legacy_unmapped — $PLAN
$SESSION_META
recovery: pm worktree adopt --plan $PLAN --base <base-ref> [--base-commit <40-char-oid>]$SOURCE_OPTION
candidate worktrees: $CANDIDATE_COUNT"
    ;;
  internal_error)
    CONTEXT="⚠️ session plan routing error: ensure-session failed
$SESSION_META
recovery: PM_SESSION_TOOL=claude PM_SESSION_ID=<session-id> node $ENGINE resolve-session --root $PROJECT_DIR --tool claude"
    ;;
  *)
    CONTEXT="⚠️ session plan routing error: $STATUS
$SESSION_META
binding: unbound"
    ;;
esac

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
