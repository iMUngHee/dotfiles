#!/usr/bin/env bash
# UserPromptSubmit adapter: normalize safe legacy plan ownership once, then
# inject the shared execution routing result. Fail-open with a visible diagnostic.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

project_dir=$(printf '%s' "$input" | jq -r '.project_dir // .cwd // empty' 2>/dev/null || true)
[[ -n "$project_dir" ]] || project_dir="$(pwd)"

config_root="${AI_CONFIG_ROOT:-$HOME/.config}"
engine="$config_root/ai/lib/worktree.mjs"
[[ -f "$engine" ]] || exit 0
if ! resolved=$(node "$engine" ensure-current --root "$project_dir" 2>/dev/null); then
  resolved='{"status":"internal_error"}'
fi
status=$(printf '%s' "$resolved" | jq -r '.status // empty')

case "$status" in
  empty|terminal) exit 0 ;;
  ok)
    plan_status=$(printf '%s' "$resolved" | jq -r '.plan_status')
    [[ "$plan_status" == "draft" || "$plan_status" == "active" ]] || exit 0
    [[ "$plan_status" == "draft" ]] && icon="⚙️" || icon="▶️"
    title=$(printf '%s' "$resolved" | jq -r '.title')
    plan=$(printf '%s' "$resolved" | jq -r '.plan')
    execution_root=$(printf '%s' "$resolved" | jq -r '.execution_root')
    branch=$(printf '%s' "$resolved" | jq -r '.branch')
    base=$(printf '%s' "$resolved" | jq -r '(.base_branch + " @ " + .base_commit)')
    route_required=$(printf '%s' "$resolved" | jq -r '.route_required')
    [[ "$route_required" == "true" ]] && route="switch to the execution root" || route="already at the execution root"
    context="$icon $plan_status: $title — $plan
execution root: $execution_root
branch: $branch
base: $base
route: $route"
    ;;
  legacy_unmapped)
    plan=$(printf '%s' "$resolved" | jq -r '.recovery.plan // .plan // "(unknown)"')
    candidate_count=$(printf '%s' "$resolved" | jq -r '.recovery.candidate_count // 0')
    [[ "$candidate_count" == "0" ]] && source_option=" [--start <ref-or-oid>]" || source_option=""
    context="⚠️ plan routing error: legacy_unmapped — $plan
recovery: pm worktree adopt --plan $plan --base <base-ref> [--base-commit <40-char-oid>]$source_option
candidate worktrees: $candidate_count"
    ;;
  internal_error)
    context="⚠️ plan routing error: ensure-current failed
recovery: node $engine resolve-current --root $project_dir; then run pm worktree adopt manually if reported"
    ;;
  *)
    plan=$(printf '%s' "$resolved" | jq -r '.plan // "(unknown)"')
    context="⚠️ plan routing error: $status — $plan"
    ;;
esac

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
