#!/usr/bin/env bash
# Shared project detection utility — sourced by post-edit-pipeline.sh, stop-handler.sh
# Sets: CHECK_CMD, LANG_LABEL, FMT_CMD based on file extension + project root

detect_project_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

# Portable timeout for macOS (no coreutils timeout)
# Usage: portable_timeout <seconds> <command> [args...]
portable_timeout() {
  local secs="$1"; shift
  if command -v timeout &>/dev/null; then
    timeout "$secs" "$@"
  else
    perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
  fi
}

# detect_checker <file> <project_root>
# Sets CHECK_CMD (type checker), LANG_LABEL, FMT_CMD (formatter)
detect_checker() {
  local file="$1" root="$2"
  CHECK_CMD="" LANG_LABEL="" FMT_CMD=""

  case "$file" in
    *.ts|*.tsx)
      if [[ -f "$root/tsconfig.json" ]]; then
        CHECK_CMD="npx tsc --noEmit --pretty 2>&1"
        LANG_LABEL="tsc"
      fi
      command -v npx &>/dev/null && FMT_CMD="npx prettier --write"
      ;;
    *.js|*.jsx|*.json|*.css|*.scss)
      command -v npx &>/dev/null && FMT_CMD="npx prettier --write"
      ;;
    *.go)
      if [[ -f "$root/go.mod" ]]; then
        CHECK_CMD="go vet ./... 2>&1"
        LANG_LABEL="go vet"
      fi
      command -v gofmt &>/dev/null && FMT_CMD="gofmt -w"
      ;;
    *.rs)
      if [[ -f "$root/Cargo.toml" ]]; then
        CHECK_CMD="cargo check --message-format short 2>&1"
        LANG_LABEL="cargo check"
      fi
      command -v rustfmt &>/dev/null && FMT_CMD="rustfmt"
      ;;
    *.py)
      if command -v ruff &>/dev/null; then
        FMT_CMD="ruff format"
      elif command -v black &>/dev/null; then
        FMT_CMD="black -q"
      fi
      ;;
    *.lua)
      command -v stylua &>/dev/null && FMT_CMD="stylua"
      ;;
  esac
}
