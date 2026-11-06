#!/bin/bash
# lib/go-tools.sh — gremlins, the mutation tester ai/skills/go runs, built into
# ~/.local/bin by the macOS/Linux package layers.
#
# Sourced, not executed. Same shape as lib/rust-analyzer.sh.
#
# gremlins has no pacman or Homebrew core package, so it comes from `go install`
# at a pinned version: v0.6.0 is the version the skill's instructions were
# measured against (-count=1 in GOFLAGS, --diff and its gaps, exit status). Install
# only when absent; moving the pin is a decision, not a side effect of a deploy.
# staticcheck, the skill's linter, is a regular package (arch/packages.sh,
# homebrew/Brewfile).

if ! declare -F warn >/dev/null 2>&1; then
    warn() { echo "⚠ $1"; }
fi

GREMLINS_MODULE="${GREMLINS_MODULE:-github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0}"

ensure_gremlins() {
    local bin="${LOCAL_BIN:-$HOME/.local/bin}"
    if command -v gremlins >/dev/null 2>&1; then
        echo "gremlins present — skip ($(command -v gremlins))"
        return 0
    fi
    command -v go >/dev/null 2>&1 || { warn "go not installed — gremlins not built"; return 0; }
    mkdir -p "$bin"
    echo "── go install $GREMLINS_MODULE ──"
    if GOBIN="$bin" go install "$GREMLINS_MODULE" && "$bin/gremlins" --version >/dev/null 2>&1; then
        echo "gremlins built ($bin/gremlins)"
    else
        warn "gremlins build or smoke ('gremlins --version') failed"
    fi
}
