#!/usr/bin/env bash
# Shared project detection utility for Codex quality hooks.

detect_project_root() {
  git rev-parse --show-toplevel 2>/dev/null || true
}

portable_timeout() {
  local secs="$1"
  shift
  if command -v timeout &>/dev/null; then
    timeout "$secs" "$@"
  else
    perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
  fi
}

file_checksum() {
  local file="$1"
  if command -v md5sum &>/dev/null; then
    md5sum "$file" 2>/dev/null | awk '{print $1}'
  elif command -v md5 &>/dev/null; then
    md5 -q "$file" 2>/dev/null
  else
    shasum -a 256 "$file" 2>/dev/null | awk '{print $1}'
  fi
}

detect_checker() {
  local file="$1" root="$2"
  CHECK_CMD="" LANG_LABEL="" FMT_CMD=""

  case "$file" in
    *.ts|*.tsx)
      if [[ -f "$root/tsconfig.json" ]] && [[ -f "$root/node_modules/.bin/tsc" ]]; then
        CHECK_CMD="npx tsc --noEmit --pretty 2>&1"
        LANG_LABEL="tsc"
      fi
      if command -v npx &>/dev/null && [[ -f "$root/node_modules/.bin/prettier" ]]; then
        FMT_CMD="npx prettier --write"
      fi
      ;;
    *.js|*.jsx|*.json|*.css|*.scss)
      if command -v npx &>/dev/null && [[ -f "$root/node_modules/.bin/prettier" ]]; then
        FMT_CMD="npx prettier --write"
      fi
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
