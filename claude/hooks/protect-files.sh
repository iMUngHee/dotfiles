#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE" ]]; then
  exit 0
fi

PROTECTED_PATTERNS=(".env" "-secret" "credentials" ".pem" ".key" ".p12" ".pfx" "package-lock.json" "pnpm-lock.yaml" "yarn.lock" "Cargo.lock" "go.sum" "bun.lock" "bun.lockb")

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE" == *"$pattern"* ]]; then
    echo "Blocked: '$FILE' — matches sensitive file pattern '$pattern'." >&2
    exit 2
  fi
done

exit 0
