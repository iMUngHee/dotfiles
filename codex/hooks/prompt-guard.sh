#!/usr/bin/env bash
# UserPromptSubmit hook: block prompts that contain high-confidence secrets.
set -euo pipefail

input=$(cat)

if ! command -v jq &>/dev/null; then
  echo "[codex prompt-guard] Blocked: jq not found." >&2
  exit 2
fi

prompt=$(printf '%s' "$input" | jq -r '.prompt // .message // empty' 2>/dev/null)
[[ -z "$prompt" ]] && exit 0

combined_pattern='AKIA[0-9A-Z]{16}'
combined_pattern+='|ghp_[0-9a-zA-Z]{36}'
combined_pattern+='|gho_[0-9a-zA-Z]{36}'
combined_pattern+='|ghs_[0-9a-zA-Z]{36}'
combined_pattern+='|ghu_[0-9a-zA-Z]{36}'
combined_pattern+='|github_pat_[0-9a-zA-Z_]{22,}'
combined_pattern+='|xox[bpars]-[0-9a-zA-Z-]{10,}'
combined_pattern+='|AIza[0-9A-Za-z_-]{35}'
combined_pattern+='|-----BEGIN[[:space:]]+(RSA |EC |OPENSSH )?PRIVATE KEY-----'
combined_pattern+='|sk-[0-9a-zA-Z_-]{20,}'
combined_pattern+='|((password|passwd|secret|api_key|apikey|access_token)[[:space:]]*[:=][[:space:]]*['"'"'""]?[A-Za-z0-9/+=_-]{16,})'

if printf '%s' "$prompt" | grep -qE "$combined_pattern"; then
  match=$(printf '%s' "$prompt" | grep -oE "$combined_pattern" | head -1)
  masked="${match:0:8}..."
  echo "[codex prompt-guard] Blocked: detected potential secret (${masked})." >&2
  echo "Remove the secret from the prompt and retry." >&2
  exit 2
fi

exit 0
