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

# A conversation reopened from the agents view (←, then Enter) continues under a new session
# id, and Claude Code records the move only as the old transcript's last row:
# {"type":"continued-in","sessionId":<old>,"continuedInSessionId":<new>}. Bindings are keyed
# by session id, so the same conversation would come up unbound. When this session has no
# binding of its own, follow that row back (at most five moves) to a session that was bound
# to a draft/active plan and bind this one to it. /clear, /branch and --resume write no such
# row (measured on 2.1.292), so they never inherit. Any failure leaves the session unbound.
predecessor_of() {
  local dir=$1 id=$2 file
  while IFS= read -r file; do
    tail -n 1 "$file" 2>/dev/null \
      | jq -er --arg id "$id" 'select(.type == "continued-in" and .continuedInSessionId == $id) | .sessionId' 2>/dev/null \
      && return 0
  done < <(ls -t "$dir"/*.jsonl 2>/dev/null | head -n 50)
  return 1
}
INHERITED_FROM=""
TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
if [[ -n "$SESSION_ID" && -n "$TRANSCRIPT_PATH" ]] \
  && [[ "$(printf '%s' "$RESOLVED" | jq -r '"\(.status)/\(.reason)"' 2>/dev/null)" == "unbound/missing_binding" ]]; then
  CURRENT="$SESSION_ID"
  for _ in 1 2 3 4 5; do
    PREVIOUS=$(predecessor_of "$(dirname "$TRANSCRIPT_PATH")" "$CURRENT") || break
    [[ -n "$PREVIOUS" && "$PREVIOUS" != "$SESSION_ID" ]] || break
    HELD=$(PM_SESSION_TOOL=claude PM_SESSION_ID="$PREVIOUS" node "$ENGINE" resolve-session --root "$PROJECT_DIR" --tool claude 2>/dev/null) || break
    HELD_STATE=$(printf '%s' "$HELD" | jq -r '"\(.status)/\(.binding_status)/\(.plan_status)/\(.reason)"' 2>/dev/null) || break
    case "$HELD_STATE" in
      ok/bound/draft/*|ok/bound/active/*)
        HELD_PLAN=$(printf '%s' "$HELD" | jq -r '.plan')
        BOUND=$(PM_SESSION_TOOL=claude PM_SESSION_ID="$SESSION_ID" node "$ENGINE" bind-session --root "$PROJECT_DIR" --tool claude --plan "$HELD_PLAN" 2>/dev/null) || break
        [[ "$(printf '%s' "$BOUND" | jq -r '.binding_status')" == "bound" ]] || break
        if CARRIED=$(PM_SESSION_TOOL=claude PM_SESSION_ID="$SESSION_ID" node "$ENGINE" ensure-session --root "$PROJECT_DIR" --tool claude 2>/dev/null); then
          RESOLVED="$CARRIED"
          INHERITED_FROM="$PREVIOUS"
        fi
        break
        ;;
      unbound/*/*/missing_binding) CURRENT="$PREVIOUS" ;;
      *) break ;;
    esac
  done
fi

STATUS=$(printf '%s' "$RESOLVED" | jq -r '.status // empty')
SESSION_LABEL="${SESSION_ID:-unavailable}"
SESSION_META="session tool: claude
session id: $SESSION_LABEL"
UNBOUND_GUARD="task authority: no validated session-bound plan
continuation guard: restored or compacted summaries are context only. If the latest prompt is shorthand and its task target appears only in a synthesized summary, ask which task to continue before any task read, edit, command, or lifecycle action. Explicit non-plan task wording or an unambiguous target in verbatim user messages may proceed; plan execution or lifecycle action requires a validated session binding."
APPLY_UNBOUND_GUARD=true

case "$STATUS" in
  unbound|empty)
    CONTEXT="ℹ️ session plan: unbound
$SESSION_META
binding: unbound
main current: launcher-only; persist or select an explicit plan before lifecycle actions"
    ;;
  ok)
    PLAN_STATUS=$(printf '%s' "$RESOLVED" | jq -r '.plan_status')
    if [[ "$PLAN_STATUS" == "draft" || "$PLAN_STATUS" == "active" ]]; then
      APPLY_UNBOUND_GUARD=false
      [[ "$PLAN_STATUS" == "draft" ]] && ICON="⚙️" || ICON="▶️"
      TITLE=$(printf '%s' "$RESOLVED" | jq -r '.title')
      PLAN=$(printf '%s' "$RESOLVED" | jq -r '.plan')
      EXECUTION_ROOT=$(printf '%s' "$RESOLVED" | jq -r '.execution_root')
      BRANCH=$(printf '%s' "$RESOLVED" | jq -r '.branch')
      BASE=$(printf '%s' "$RESOLVED" | jq -r '(.base_branch + " @ " + .base_commit)')
      ROUTE_REQUIRED=$(printf '%s' "$RESOLVED" | jq -r '.route_required')
      BINDING_STATUS=$(printf '%s' "$RESOLVED" | jq -r '.binding_status // "bound"')
      [[ -n "$INHERITED_FROM" ]] && BINDING_STATUS="$BINDING_STATUS (inherited from $INHERITED_FROM)"
      [[ "$ROUTE_REQUIRED" == "true" ]] && ROUTE="switch to the execution root" || ROUTE="already at the execution root"
      CONTEXT="$SESSION_META
binding: $BINDING_STATUS
$ICON $PLAN_STATUS: $TITLE — $PLAN
execution root: $EXECUTION_ROOT
branch: $BRANCH
base: $BASE
route: $ROUTE"
    else
      CONTEXT="⚠️ session plan routing error: invalid_bound_payload — plan status: ${PLAN_STATUS:-missing}
$SESSION_META
binding: unbound"
    fi
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

if [[ "$APPLY_UNBOUND_GUARD" == "true" ]]; then
  CONTEXT="$CONTEXT
$UNBOUND_GUARD"
fi

jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
