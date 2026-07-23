#!/usr/bin/env bash
# UserPromptSubmit adapter: resolve the current Codex session binding, normalize only
# safe checkout-local legacy ownership, and fail open with a visible diagnostic.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

project_dir=$(printf '%s' "$input" | jq -r '.project_dir // .cwd // empty' 2>/dev/null || true)
[[ -n "$project_dir" ]] || project_dir="$(pwd)"
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)

config_root="${AI_CONFIG_ROOT:-$HOME/.config}"
engine="$config_root/ai/lib/worktree.mjs"
[[ -f "$engine" ]] || exit 0
if ! resolved=$(PM_SESSION_TOOL=codex PM_SESSION_ID="$session_id" node "$engine" ensure-session --root "$project_dir" --tool codex 2>/dev/null); then
  resolved='{"status":"internal_error"}'
fi
status=$(printf '%s' "$resolved" | jq -r '.status // empty')
session_label="${session_id:-unavailable}"
session_meta="session tool: codex
session id: $session_label"
unbound_guard="task authority: no validated session-bound plan
continuation guard: restored or compacted summaries are context only. If the latest prompt is shorthand and its task target appears only in a synthesized summary, ask which task to continue before any task read, edit, command, or lifecycle action. Explicit non-plan task wording or an unambiguous target in verbatim user messages may proceed; plan execution or lifecycle action requires a validated session binding."
apply_unbound_guard=true

case "$status" in
  unbound|empty)
    context="ℹ️ session plan: unbound
$session_meta
binding: unbound
main current: launcher-only; persist or select an explicit plan before lifecycle actions"
    ;;
  ok)
    plan_status=$(printf '%s' "$resolved" | jq -r '.plan_status')
    if [[ "$plan_status" == "draft" || "$plan_status" == "active" ]]; then
      apply_unbound_guard=false
      [[ "$plan_status" == "draft" ]] && icon="⚙️" || icon="▶️"
      title=$(printf '%s' "$resolved" | jq -r '.title')
      plan=$(printf '%s' "$resolved" | jq -r '.plan')
      execution_root=$(printf '%s' "$resolved" | jq -r '.execution_root')
      branch=$(printf '%s' "$resolved" | jq -r '.branch')
      base=$(printf '%s' "$resolved" | jq -r '(.base_branch + " @ " + .base_commit)')
      route_required=$(printf '%s' "$resolved" | jq -r '.route_required')
      binding_status=$(printf '%s' "$resolved" | jq -r '.binding_status // "bound"')
      [[ "$route_required" == "true" ]] && route="switch to the execution root" || route="already at the execution root"
      context="$session_meta
binding: $binding_status
$icon $plan_status: $title — $plan
execution root: $execution_root
branch: $branch
base: $base
route: $route"
    else
      context="⚠️ session plan routing error: invalid_bound_payload — plan status: ${plan_status:-missing}
$session_meta
binding: unbound"
    fi
    ;;
  legacy_unmapped)
    plan=$(printf '%s' "$resolved" | jq -r '.recovery.plan // .plan // "(unknown)"')
    candidate_count=$(printf '%s' "$resolved" | jq -r '.recovery.candidate_count // 0')
    [[ "$candidate_count" == "0" ]] && source_option=" [--start <ref-or-oid>]" || source_option=""
    context="⚠️ session plan routing error: legacy_unmapped — $plan
$session_meta
recovery: pm worktree adopt --plan $plan --base <base-ref> [--base-commit <40-char-oid>]$source_option
candidate worktrees: $candidate_count"
    ;;
  internal_error)
    context="⚠️ session plan routing error: ensure-session failed
$session_meta
recovery: PM_SESSION_TOOL=codex PM_SESSION_ID=<session-id> node $engine resolve-session --root $project_dir --tool codex"
    ;;
  *)
    context="⚠️ session plan routing error: $status
$session_meta
binding: unbound"
    ;;
esac

if [[ "$apply_unbound_guard" == "true" ]]; then
  context="$context
$unbound_guard"
fi

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
