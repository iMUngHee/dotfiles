#!/usr/bin/env bash
# UserPromptSubmit hook: block prompts containing accidentally pasted secrets
# Exit 2 (block) if secret detected, exit 0 (allow) otherwise
# Requires: jq

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.message // empty')

[[ -z "$PROMPT" ]] && exit 0

# High-confidence secret patterns (regex only, no external calls)
PATTERNS=(
  'AKIA[0-9A-Z]{16}'
  'ghp_[0-9a-zA-Z]{36}'
  'gho_[0-9a-zA-Z]{36}'
  'ghs_[0-9a-zA-Z]{36}'
  'ghu_[0-9a-zA-Z]{36}'
  'github_pat_[0-9a-zA-Z_]{22,}'
  'xox[bpars]-[0-9a-zA-Z-]{10,}'
  'AIza[0-9A-Za-z_-]{35}'
  '-----BEGIN[[:space:]]+(RSA |EC |OPENSSH )?PRIVATE KEY-----'
  'sk-[0-9a-zA-Z]{20,}'
  '(password|passwd|secret|api_key|apikey|access_token)[[:space:]]*[:=][[:space:]]*['"'"'""]?[A-Za-z0-9/+=_-]{16,}'
)

for pattern in "${PATTERNS[@]}"; do
  if echo "$PROMPT" | grep -qE "$pattern"; then
    MATCH=$(echo "$PROMPT" | grep -oE "$pattern" | head -1)
    MASKED="${MATCH:0:8}..."
    echo "[prompt-guard] Blocked: detected potential secret (${MASKED})." >&2
    echo "Remove the secret from your prompt and try again." >&2
    exit 2
  fi
done

exit 0
