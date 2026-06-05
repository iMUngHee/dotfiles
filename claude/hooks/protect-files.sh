#!/usr/bin/env bash
INPUT=$(cat)

# Fix 1: Fail-closed if jq is missing
if ! command -v jq &>/dev/null; then
  echo "Blocked: jq not found — failing closed for safety." >&2
  exit 2
fi

# Fix 5 (case-insensitive match): macOS has a case-insensitive filesystem, so
# `.ENV`, `.Env`, `Credentials` resolve to the same file and would otherwise
# bypass case-sensitive matching. Mirror the built-in toLowerCase() normalization.
shopt -s nocasematch

# --- Pattern categories (Fix 4) ---
# Extension patterns: match at end of basename
EXT_PATTERNS=(".env" ".pem" ".key" ".p8" ".p12" ".pfx")
# Exact filename patterns: match basename exactly. Blocked for BOTH read and
# write — either integrity-critical (lockfiles) or token/key-bearing
# (.npmrc/.netrc, id_rsa...), where even a read can exfiltrate.
EXACT_PATTERNS=(
  "package-lock.json" "pnpm-lock.yaml" "yarn.lock" "Cargo.lock" "go.sum" "bun.lock" "bun.lockb"
  ".npmrc" ".netrc"
  "id_rsa" "id_dsa" "id_ecdsa" "id_ed25519"
)
# Write-protected config: blocked for Edit/Write/MultiEdit ONLY (Read and Bash
# `source`/`git config` stay legitimate). These are arbitrary-code-execution or
# tool-control vectors where the real risk is an injected WRITE, not a read.
# NOTE: Bash redirects (e.g. `echo >> ~/.zshrc`) are intentionally NOT covered
# here to avoid breaking `source ~/.zshrc`; Edit/Write are the primary AI path.
WRITE_PROTECT_EXACT=(
  ".zshrc" ".bashrc" ".bash_profile" ".zprofile" ".profile"
  ".gitconfig" ".mcp.json" ".claude.json"
)
# Path segment patterns: match as a directory or filename component
SEGMENT_PATTERNS=("credentials" "secrets")
# Substring patterns: match anywhere in the path
SUBSTRING_PATTERNS=("-secret")
# Allowlisted basenames that legitimately contain a blocked substring
# (OS secret-store helpers). Referencing or editing these is permitted.
ALLOWLIST_BASENAMES=("mcp-secret-env.sh" "mcp-secret-set.sh")

# Check a single file path against all pattern categories
check_file() {
  local f="$1"
  local mode="${2:-write}"
  [[ -z "$f" ]] && return 1
  local base
  base="$(basename "$f")"

  # Allowlist: OS secret-store helpers legitimately contain a blocked
  # substring ('-secret'). Referencing or editing them is permitted.
  for a in "${ALLOWLIST_BASENAMES[@]}"; do
    [[ "$base" == "$a" ]] && return 1
  done

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

  # Write-protected config files: enforced only when the tool is writing.
  if [[ "$mode" == "write" ]]; then
    for p in "${WRITE_PROTECT_EXACT[@]}"; do
      if [[ "$base" == "$p" ]]; then
        echo "Blocked: '$f' — write-protected config '$p' (read is allowed)." >&2
        return 0
      fi
    done
  fi

  return 1
}

# Check a command string against all patterns (for Bash tool)
check_command() {
  local cmd="$1"
  [[ -z "$cmd" ]] && return 1

  # Mask allowlisted helper basenames before matching so referencing the OS
  # secret-store helpers is not blocked by the '-secret' substring.
  local scan="$cmd"
  for a in "${ALLOWLIST_BASENAMES[@]}"; do
    scan="${scan//$a/__allowlisted__}"
  done

  # Build a combined list of all pattern strings to search in the command
  local all_patterns=()
  all_patterns+=("${EXT_PATTERNS[@]}")
  all_patterns+=("${EXACT_PATTERNS[@]}")
  all_patterns+=("${SEGMENT_PATTERNS[@]}")
  all_patterns+=("${SUBSTRING_PATTERNS[@]}")
  # Also catch .env.* variants in commands
  all_patterns+=(".env.")

  for p in "${all_patterns[@]}"; do
    if [[ "$scan" == *"$p"* ]]; then
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
      if check_file "$f" write; then
        exit 2
      fi
    done <<< "$FILES"
    ;;

  Edit|Write)
    # Write tools: enforce secret patterns AND write-protected config files.
    FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    [[ -z "$FILE" ]] && exit 0
    if check_file "$FILE" write; then
      exit 2
    fi
    ;;

  Read|*)
    # Read (and unknown tools): enforce secret patterns only — write-protected
    # config (shell rc, git/mcp config) stays readable.
    FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
    [[ -z "$FILE" ]] && exit 0
    if check_file "$FILE" read; then
      exit 2
    fi
    ;;
esac

exit 0
