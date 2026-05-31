#!/usr/bin/env bash
# UserPromptSubmit hook: inject the current repo-local plan as context.
# Fail-open: any parse, jq, or filesystem issue returns no context.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

project_dir=$(printf '%s' "$input" | jq -r '.project_dir // .cwd // empty' 2>/dev/null || true)
[[ -n "$project_dir" ]] || project_dir="$(pwd)"

state_file="$project_dir/.agents/state/current.txt"
[[ -f "$state_file" ]] || exit 0

plan_rel=$(awk 'NF { print; exit }' "$state_file")
[[ -n "$plan_rel" ]] || exit 0

case "$plan_rel" in
  /*) plan_path="$plan_rel" ;;
  *)  plan_path="$project_dir/$plan_rel" ;;
esac
[[ -f "$plan_path" ]] || exit 0

extract_field() {
  awk -v key="$1" '
    $0 ~ "^"key":" {
      sub("^"key": ?", "")
      sub(/[[:space:]]*#.*$/, "")
      sub(/[[:space:]]+$/, "")
      print
      exit
    }
  ' "$plan_path"
}

status=$(extract_field "status")
title=$(extract_field "title")

case "$status" in
  draft|active) ;;
  *) exit 0 ;;
esac

context="[$status] ${title} - ${plan_rel}"

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'
