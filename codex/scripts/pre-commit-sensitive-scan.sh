#!/usr/bin/env bash
# Read-only staged-diff sensitive information scan for Codex commit workflow.

set -euo pipefail

# Site-local internal patterns (hostnames/emails) are kept out of this public
# repo. If present, sensitive-patterns.local (gitignored) defines:
#   INTERNAL_HOSTNAME_RE, INTERNAL_EMAIL_RE   (ERE fragments for grep -Eo)
# Without it the internal-hostname/email checks are skipped; the token, key,
# private-key, and ticket checks always run. See sensitive-patterns.local.example.
INTERNAL_HOSTNAME_RE=""
INTERNAL_EMAIL_RE=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$SCRIPT_DIR/sensitive-patterns.local" ]]; then
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/sensitive-patterns.local"
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "FAIL SensitiveInfo: not inside a git repository"
  exit 1
fi

staged_files=()
while IFS= read -r staged_file; do
  staged_files+=("$staged_file")
done < <(git diff --cached --name-only --diff-filter=ACMRT)

if [[ ${#staged_files[@]} -eq 0 ]]; then
  echo "PASS SensitiveInfo: no staged files"
  exit 0
fi

fail_count=0
warn_count=0

mask() {
  local value="$1"
  local len=${#value}
  if (( len <= 12 )); then
    printf '%s' "$value"
  else
    printf '%s...%s' "${value:0:6}" "${value:$((len - 4)):4}"
  fi
}

report_fail() {
  local file="$1"
  local kind="$2"
  local match="$3"
  printf 'FAIL SensitiveInfo: %s: %s (%s)\n' "$file" "$kind" "$(mask "$match")"
  fail_count=$((fail_count + 1))
}

report_warn() {
  local file="$1"
  local kind="$2"
  local match="$3"
  printf 'WARN SensitiveInfo: %s: %s (%s)\n' "$file" "$kind" "$(mask "$match")"
  warn_count=$((warn_count + 1))
}

scan_text() {
  local file="$1"
  local text="$2"
  local match

  if [[ -n "$INTERNAL_HOSTNAME_RE" ]]; then
    match=$(printf '%s\n' "$text" | grep -Eo "$INTERNAL_HOSTNAME_RE" | head -1 || true)
    [[ -z "$match" ]] || report_fail "$file" "internal hostname" "$match"
  fi

  if [[ -n "$INTERNAL_EMAIL_RE" ]]; then
    match=$(printf '%s\n' "$text" | grep -Eo "$INTERNAL_EMAIL_RE" | head -1 || true)
    [[ -z "$match" ]] || report_fail "$file" "internal email" "$match"
  fi

  match=$(printf '%s\n' "$text" | grep -Eo 'AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{22,}|xox[baprs]-[0-9A-Za-z-]{10,}|sk-[A-Za-z0-9_-]{20,}' | head -1 || true)
  [[ -z "$match" ]] || report_fail "$file" "token-like secret" "$match"

  match=$(printf '%s\n' "$text" | grep -Eo -- '-----BEGIN (RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----' | head -1 || true)
  [[ -z "$match" ]] || report_fail "$file" "private key block" "$match"

  match=$(printf '%s\n' "$text" | grep -Eo '\b[A-Z][A-Z0-9]+-[0-9]{2,}\b' | head -1 || true)
  [[ -z "$match" ]] || report_warn "$file" "ticket-like identifier" "$match"
}

for file in "${staged_files[@]}"; do
  scan_text "$file" "$file"

  if ! git show ":$file" >/dev/null 2>&1; then
    continue
  fi

  if ! git show ":$file" | LC_ALL=C grep -Iq .; then
    continue
  fi

  content=$(git show ":$file")
  scan_text "$file" "$content"
done

if (( fail_count > 0 )); then
  echo "FAIL SensitiveInfo: ${fail_count} fail, ${warn_count} warn"
  exit 1
fi

if (( warn_count > 0 )); then
  echo "WARN SensitiveInfo: 0 fail, ${warn_count} warn"
  exit 2
fi

echo "PASS SensitiveInfo: ${#staged_files[@]} staged file(s) scanned"
