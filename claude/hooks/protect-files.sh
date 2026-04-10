#!/usr/bin/env bash
INPUT=$(cat)

# Fix 1: Fail-closed if jq is missing
if ! command -v jq &>/dev/null; then
  echo "Blocked: jq not found — failing closed for safety." >&2
  exit 2
fi

# --- Pattern categories (Fix 4) ---
# Extension patterns: match at end of basename
EXT_PATTERNS=(".env" ".pem" ".key" ".p12" ".pfx")
# Exact filename patterns: match basename exactly
EXACT_PATTERNS=("package-lock.json" "pnpm-lock.yaml" "yarn.lock" "Cargo.lock" "go.sum" "bun.lock" "bun.lockb")
# Path segment patterns: match as a directory or filename component
SEGMENT_PATTERNS=("credentials" "secrets")
# Substring patterns: match anywhere in the path
SUBSTRING_PATTERNS=("-secret")

# Check a single file path against all pattern categories
check_file() {
  local f="$1"
  [[ -z "$f" ]] && return 1
  local base
  base="$(basename "$f")"

  # Extension patterns: basename ends with pattern
  for p in "${EXT_PATTERNS[@]}"; do
    if [[ "$base" == *"$p" ]]; then
      echo "Blocked: '$f' — matches extension pattern '$p'." >&2
      return 0
    fi
  done

  # Special case: .env.* files (e.g., .env.local, .env.production)
  if [[ "$base" == .env.* ]]; then
    echo "Blocked: '$f' — matches .env.* pattern." >&2
    return 0
  fi

  # Exact filename patterns
  for p in "${EXACT_PATTERNS[@]}"; do
    if [[ "$base" == "$p" ]]; then
      echo "Blocked: '$f' — matches exact filename pattern '$p'." >&2
      return 0
    fi
  done

  # Path segment patterns: appears as a path component
  for p in "${SEGMENT_PATTERNS[@]}"; do
    if [[ "$f" == *"/$p/"* || "$f" == "$p/"* || "$base" == "$p" ]]; then
      echo "Blocked: '$f' — matches path segment pattern '$p'." >&2
      return 0
    fi
  done

  # Substring patterns: appears anywhere in the full path
  for p in "${SUBSTRING_PATTERNS[@]}"; do
    if [[ "$f" == *"$p"* ]]; then
      echo "Blocked: '$f' — matches substring pattern '$p'." >&2
      return 0
    fi
  done

  return 1
}

# Check a command string against all patterns (for Bash tool)
check_command() {
  local cmd="$1"
  [[ -z "$cmd" ]] && return 1

  # Build a combined list of all pattern strings to search in the command
  local all_patterns=()
  all_patterns+=("${EXT_PATTERNS[@]}")
  all_patterns+=("${EXACT_PATTERNS[@]}")
  all_patterns+=("${SEGMENT_PATTERNS[@]}")
  all_patterns+=("${SUBSTRING_PATTERNS[@]}")
  # Also catch .env.* variants in commands
  all_patterns+=(".env.")

  for p in "${all_patterns[@]}"; do
    if [[ "$cmd" == *"$p"* ]]; then
      echo "Blocked: command references sensitive pattern '$p'." >&2
      return 0
    fi
  done

  return 1
}

# --- Detect tool type (Fix 2) ---
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL" in
  Bash)
    CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
    if check_command "$CMD"; then
      exit 2
    fi
    ;;

  MultiEdit)
    # Handle MultiEdit: try array structures first, fallback to top-level file_path
    FILES=$(echo "$INPUT" | jq -r '(.tool_input.files[]?.file_path // empty), (.tool_input.edits[]?.file_path // empty)' 2>/dev/null)
    if [[ -z "$FILES" ]]; then
      # Fallback: MultiEdit may use top-level file_path (single-file multi-edit)
      FILES=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
    fi
    [[ -z "$FILES" ]] && exit 0
    while IFS= read -r f; do
      if check_file "$f"; then
        exit 2
      fi
    done <<< "$FILES"
    ;;

  Edit|Write|Read|*)
    # Default: extract .tool_input.file_path (covers Edit, Write, and unknown tools)
    FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    if [[ -z "$FILE" ]]; then
      exit 0
    fi
    if check_file "$FILE"; then
      exit 2
    fi
    ;;
esac

exit 0
