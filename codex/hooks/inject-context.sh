#!/usr/bin/env bash
# UserPromptSubmit adapter: pass Codex's project root to the shared read-only
# worktree resolver and inject its execution routing result. Fail-open.

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
resolved=$(node "$engine" resolve-current --root "$project_dir" 2>/dev/null) || exit 0
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
