#!/usr/bin/env bash
# UserPromptSubmit hook: block prompts containing accidentally pasted secrets
# Exit 2 (block) if secret detected, exit 0 (allow) otherwise
# Requires: jq

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.message // empty')

[[ -z "$PROMPT" ]] && exit 0

# High-confidence secret patterns combined into single regex (1 grep instead of 11)
COMBINED_PATTERN='AKIA[0-9A-Z]{16}'
COMBINED_PATTERN+='|ghp_[0-9a-zA-Z]{36}'
COMBINED_PATTERN+='|gho_[0-9a-zA-Z]{36}'
COMBINED_PATTERN+='|ghs_[0-9a-zA-Z]{36}'
COMBINED_PATTERN+='|ghu_[0-9a-zA-Z]{36}'
COMBINED_PATTERN+='|github_pat_[0-9a-zA-Z_]{22,}'
COMBINED_PATTERN+='|xox[bpars]-[0-9a-zA-Z-]{10,}'
COMBINED_PATTERN+='|AIza[0-9A-Za-z_-]{35}'
COMBINED_PATTERN+='|-----BEGIN[[:space:]]+(RSA |EC |OPENSSH )?PRIVATE KEY-----'
COMBINED_PATTERN+='|sk-[0-9a-zA-Z]{20,}'
COMBINED_PATTERN+='|((password|passwd|secret|api_key|apikey|access_token)[[:space:]]*[:=][[:space:]]*['"'"'""]?[A-Za-z0-9/+=_-]{16,})'

if echo "$PROMPT" | grep -qE "$COMBINED_PATTERN"; then
  MATCH=$(echo "$PROMPT" | grep -oE "$COMBINED_PATTERN" | head -1)
  MASKED="${MATCH:0:8}..."
  echo "[prompt-guard] Blocked: detected potential secret (${MASKED})." >&2
  echo "Remove the secret from your prompt and try again." >&2
  exit 2
fi

exit 0
