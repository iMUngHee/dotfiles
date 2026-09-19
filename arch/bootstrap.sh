#!/bin/bash
# arch/bootstrap.sh — package + shell layer for Arch Linux / Omarchy.
#
# The Arch counterpart of homebrew/bootstrap.sh. Same contract: install what
# the Brewfile installs on macOS, guarantee the shell environment, and leave
# the AI config deploy to ai/scripts/bootstrap.sh (the root bootstrap.sh calls
# that next, exactly as it does on macOS).
#
#   1) arch/packages.sh        — pacman + AUR (the Brewfile mapping)
#   2) mise install            — node/claude/codex/gh, if mise is configured
#   3) ~/.zshenv ZDOTDIR       — lib/shell-env.sh
#   4) oh-my-zsh               — lib/shell-env.sh
#   5) tmux plugins (tpm)      — lib/tmux-plugins.sh
#   6) zsh/private.sh stub     — sources arch/zsh.sh
#
# There is no step matching homebrew/bootstrap.sh's "Linux-only" block: the
# ghostty AppImage and the claude.ai install.sh existed because bazzite had no
# package for either. Arch has `ghostty` in extra, and claude/codex come from
# mise, so both are ordinary entries in arch/packages.sh.
#
# Idempotent: re-running is safe. Optional-step failures are collected and
# printed as a WARN summary; only a missing pacman aborts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WARNINGS=()

warn() { echo "⚠ $1"; WARNINGS+=("$1"); }
have() { command -v "$1" >/dev/null 2>&1; }

# --dry-run is forwarded to packages.sh, but it has to gate the steps in THIS
# script too: `mise install` downloads toolchains and the oh-my-zsh installer
# writes to $HOME, so a dry run that only skipped pacman would still change the
# machine — which is the one thing the flag promises not to do.
DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
    esac
done

# shellcheck source=../lib/shell-env.sh
. "$ROOT_DIR/lib/shell-env.sh"
# shellcheck source=../lib/tmux-plugins.sh
. "$ROOT_DIR/lib/tmux-plugins.sh"

# ── zsh/private.sh stub ─────────────────────────────────────────────────────
# arch/zsh.sh is tracked, but nothing loads it on its own. .zshrc sources
# $ZDOTDIR/private.sh at line 178 and that path is gitignored, so a fresh clone
# arrives with the Omarchy zsh layer present and unreachable — the same silent
# gap tmux/plugins had. This writes the one line that connects them.
#
# A marked block appended rather than a file written: private.sh is the seam for
# anything genuinely machine-local, so whatever else is in it has to survive.
# Same idiom as the ~/.zshenv block in lib/shell-env.sh.
ZSH_PRIVATE="$ROOT_DIR/zsh/private.sh"
ZSH_PRIVATE_START="# >>> arch-bootstrap >>>"
ZSH_PRIVATE_END="# <<< arch-bootstrap <<<"

ensure_zsh_private_stub() {
    local block
    block="$ZSH_PRIVATE_START
# Loads the tracked Omarchy zsh layer. Edit arch/zsh.sh, not this block.
[[ -r \"\$HOME/.config/arch/zsh.sh\" ]] && source \"\$HOME/.config/arch/zsh.sh\"
$ZSH_PRIVATE_END"
    if [ ! -f "$ZSH_PRIVATE" ]; then
        printf '%s\n' "$block" >"$ZSH_PRIVATE"
        echo "zsh/private.sh created (sources arch/zsh.sh)"
    elif grep -qF "$ZSH_PRIVATE_START" "$ZSH_PRIVATE"; then
        echo "zsh/private.sh already sources arch/zsh.sh — unchanged"
    else
        printf '\n%s\n' "$block" >>"$ZSH_PRIVATE"
        echo "zsh/private.sh: appended arch/zsh.sh source block"
    fi
}

if ! have pacman; then
    echo "ERROR: pacman not found — this is not an Arch system."   # critical
    exit 1
fi

echo "=== arch bootstrap ==="
if have omarchy; then
    echo "omarchy: detected (using omarchy-pkg-* helpers)"
else
    echo "omarchy: not detected (plain pacman/yay)"
fi

# ── 1. packages (pass-through flags: --dry-run, --skip-optional) ────────────
"$SCRIPT_DIR/packages.sh" "$@" || warn "arch/packages.sh reported a failure"

# ── 2. mise — the runtime manager this tier uses instead of fnm/brew casks ──
# claude, codex, gh and node are pinned in ~/.config/mise/config.toml, which is
# machine-local (not tracked here — see .gitignore). If it is absent this is a
# no-op, and the packages step already provided a system `gh`.
if have mise; then
    if [ -f "$HOME/.config/mise/config.toml" ]; then
        echo "── mise install ──"
        if [ "$DRY_RUN" -eq 1 ]; then
            mise ls --current 2>/dev/null || true
        else
            mise install || warn "mise install failed"
        fi
    else
        echo "mise present but no ~/.config/mise/config.toml — skip"
    fi
else
    echo "mise not installed — skip (https://mise.jdx.dev)"
fi

# ── 3+4. shell environment (shared with the macOS path) ─────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
    echo "── would ensure ~/.zshenv ZDOTDIR + oh-my-zsh + tpm (dry run) ──"
else
    ensure_zshenv
    ensure_oh_my_zsh
    ensure_tmux_plugins
    ensure_zsh_private_stub
fi

# ── WARN summary (실패가 exit 0에 묻히지 않도록) ────────────────────────────
if [ "${#WARNINGS[@]}" -gt 0 ]; then
    echo ""
    echo "=== ⚠ ${#WARNINGS[@]} warning(s) ==="
    for w in "${WARNINGS[@]}"; do echo "  - $w"; done
fi
echo "=== arch bootstrap done ==="
