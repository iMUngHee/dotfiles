#!/bin/bash
# lib/rust-analyzer.sh — the rust-analyzer rustup component, shared by every
# platform's package layer.
#
# Sourced, not executed. Same shape as lib/tmux-plugins.sh.
#
# claude/settings.json enables rust-analyzer-lsp@claude-plugins-official, which
# runs `rust-analyzer` from PATH. Both package layers install rustup (Brewfile,
# arch/packages.sh) but not this component, and rustup still puts its
# rust-analyzer proxy on PATH — so the plugin finds a binary that only prints
# "`rust-analyzer` is unavailable for the active toolchain". The copy mason
# installs for nvim does not help: the rustup proxy comes first on PATH.
#
# The component belongs to one toolchain. A project that pins another in
# rust-toolchain.toml needs `components = ["rust-analyzer"]` there.
#
# RUSTUP_AUTO_INSTALL=0: with no toolchain yet (a fresh brew rustup) this has
# to warn, not download a whole toolchain as a side effect of the deploy.

if ! declare -F warn >/dev/null 2>&1; then
    warn() { echo "⚠ $1"; }
fi

ensure_rust_analyzer() {
    command -v rustup >/dev/null 2>&1 || { echo "rustup not installed — skip rust-analyzer"; return 0; }
    if RUSTUP_AUTO_INSTALL=0 rustup component add rust-analyzer >/dev/null 2>&1; then
        echo "rust-analyzer component present"
    else
        warn "rustup component add rust-analyzer failed — no toolchain yet? run 'rustup default stable', then bootstrap again"
    fi
}
