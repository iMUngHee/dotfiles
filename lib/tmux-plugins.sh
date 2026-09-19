#!/bin/bash
# lib/tmux-plugins.sh — tpm bootstrap, shared by every platform's package layer.
#
# Sourced, not executed. Same shape as lib/shell-env.sh.
#
# tmux/tmux.conf declares eleven plugins and ends with
#     run '~/.config/tmux/plugins/tpm/tpm'
# but .gitignore excludes tmux/plugins/, so a fresh clone has no tpm and that
# run line does nothing. tmux still starts, which is why this went unnoticed:
# the failure is silent and the only symptom is a status bar left holding
# unresolved #{E:@catppuccin_*} tokens, with tmux-resurrect, tmux-continuum,
# vim-tmux-navigator and the rest simply absent.
#
# Installing plugins needs no privileges, so this runs in the same step as the
# package layer rather than waiting for a manual prefix + I.

if ! declare -F warn >/dev/null 2>&1; then
    warn() { echo "⚠ $1"; }
fi

TPM_DIR="${TPM_DIR:-$HOME/.config/tmux/plugins/tpm}"

ensure_tmux_plugins() {
    command -v tmux >/dev/null 2>&1 || { echo "tmux not installed — skip tpm"; return 0; }
    command -v git >/dev/null 2>&1 || { warn "git not found — skipped tpm"; return 0; }

    if [ -d "$TPM_DIR/.git" ]; then
        echo "tpm present — skip clone"
    else
        echo "── installing tpm ──"
        git clone -q --depth 1 https://github.com/tmux-plugins/tpm.git "$TPM_DIR" \
            || { warn "tpm clone failed"; return 0; }
    fi

    # install_plugins is tpm's own non-interactive entry point; prefix + I is
    # only the keybinding around it. It is idempotent: an already-present
    # plugin is reported and skipped.
    if [ -x "$TPM_DIR/bin/install_plugins" ]; then
        "$TPM_DIR/bin/install_plugins" >/dev/null 2>&1 || warn "tpm plugin install reported a failure"
        echo "tmux plugins installed"
    else
        warn "tpm has no bin/install_plugins — left for prefix + I"
    fi
}
