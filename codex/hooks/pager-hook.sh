#!/usr/bin/env bash

if command -v pager >/dev/null 2>&1; then
  input=$(cat)
  output=$(printf '%s' "$input" | pager hook)
  if [[ -n "$output" ]]; then
    printf '%s\n' "$output"
  fi
  if command -v node >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
    if [[ -n "$output" ]] && printf '%s' "$output" | jq -e '.decision == "block"' >/dev/null 2>&1; then
      exit 0
    fi
    printf '%s' "$input" | node "$(dirname "${BASH_SOURCE[0]}")/pager-session-name.mjs"
  fi
fi

exit 0
