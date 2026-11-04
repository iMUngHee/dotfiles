#!/bin/bash
# lib/agent-clis.sh — pager and gaebu, built from source into ~/.local/bin,
# shared by the macOS/Linux package layers. Windows does the same in
# windows/scripts/install-pager.ps1 and install-gaebu.ps1.
#
# Sourced, not executed. Same shape as lib/rust-analyzer.sh.
#
# Both are called bare by the deployed hooks (`command -v pager`, `command -v
# gaebu` in claude/settings.json and codex/config.toml.template), and
# claude/scripts/bootstrap.sh registers each MCP server only when its binary is
# on PATH. So they have to exist before the AI deploy runs, or the first deploy
# silently skips them. Neither has a Homebrew or pacman package.
#
# Install only when absent: an upgrade replaces a binary that live sessions are
# running `pager mcp` / `gaebu mcp` from, which is a decision for the person
# (`go install ...@latest` / `cargo install ... --force`), not a side effect of
# a deploy. Network is fine here; this is the package layer, not the offline-safe
# AI deploy (ai/scripts/bootstrap.sh never calls these).
#
# gaebu needs pager: its state-changing commands resolve the caller through
# `pager whoami`, so pager is ensured first.

if ! declare -F warn >/dev/null 2>&1; then
    warn() { echo "⚠ $1"; }
fi

LOCAL_BIN="${LOCAL_BIN:-$HOME/.local/bin}"
PAGER_MODULE="${PAGER_MODULE:-github.com/iMUngHee/pager/cmd/pager@latest}"
GAEBU_GIT="${GAEBU_GIT:-https://github.com/iMUngHee/gaebu}"

# This process and the AI deploy it hands off to must find what was just built.
# zsh/.zshrc puts the same directory on PATH for interactive shells.
local_bin_on_path() {
    LOCAL_BIN="${LOCAL_BIN:-$HOME/.local/bin}"
    mkdir -p "$LOCAL_BIN"
    case ":$PATH:" in
        *":$LOCAL_BIN:"*) ;;
        *) PATH="$LOCAL_BIN:$PATH"; export PATH ;;
    esac
}

ensure_pager() {
    local_bin_on_path
    if command -v pager >/dev/null 2>&1; then
        echo "pager present — skip ($(command -v pager))"
        return 0
    fi
    command -v go >/dev/null 2>&1 || { warn "go not installed — pager not built"; return 0; }
    echo "── go install $PAGER_MODULE ──"
    if GOBIN="$LOCAL_BIN" go install "$PAGER_MODULE" && "$LOCAL_BIN/pager" who >/dev/null 2>&1; then
        echo "pager built ($LOCAL_BIN/pager)"
    else
        warn "pager build or smoke ('pager who') failed"
    fi
}

ensure_gaebu() {
    local_bin_on_path
    if command -v gaebu >/dev/null 2>&1; then
        echo "gaebu present — skip ($(gaebu --version 2>/dev/null || command -v gaebu))"
        return 0
    fi
    command -v cargo >/dev/null 2>&1 || { warn "cargo not installed — gaebu not built"; return 0; }
    # A fresh brew rustup has no toolchain yet; RUSTUP_AUTO_INSTALL=0 makes that
    # a warning instead of a whole toolchain download (same as lib/rust-analyzer.sh).
    if ! RUSTUP_AUTO_INSTALL=0 cargo --version >/dev/null 2>&1; then
        warn "cargo has no toolchain — run 'rustup default stable', then bootstrap again"
        return 0
    fi
    echo "── cargo install gaebu ($GAEBU_GIT) ──"
    # --root ~/.local puts the binary in ~/.local/bin, next to pager, instead of
    # ~/.cargo/bin, which nothing here puts on PATH.
    if RUSTUP_AUTO_INSTALL=0 cargo install --git "$GAEBU_GIT" --locked --root "$HOME/.local" gaebu \
        && "$LOCAL_BIN/gaebu" --version >/dev/null 2>&1; then
        echo "gaebu built ($("$LOCAL_BIN/gaebu" --version))"
    else
        warn "gaebu build or smoke ('gaebu --version') failed"
    fi
}
