#!/bin/bash
# arch/packages.sh — the Brewfile analog for Arch Linux / Omarchy.
#
# Apply:  ~/.config/arch/packages.sh
# Called by arch/bootstrap.sh as step 1.
#
# Every name below was verified against `pacman -Si <pkg>` (official) or
# `yay -Si <pkg>` (AUR). Names are pinned by name only, never version — pacman
# resolves the current release the same way `brew "foo"` does.
#
# Omarchy ships `omarchy-pkg-add` / `omarchy-pkg-aur-add`: idempotent,
# non-interactive, --needed. They are preferred when present so a package this
# script installs is indistinguishable from one the user added through the
# Omarchy menu. Plain pacman/yay is the fallback on bare Arch.
#
# Entries the Brewfile carries but Arch has no need or no equivalent for are
# listed at the bottom with the reason, so the mapping stays auditable rather
# than silently lossy.
set -euo pipefail

DRY_RUN=0
SKIP_OPTIONAL=0   # CLI + toolchain only; no desktop apps
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --skip-optional) SKIP_OPTIONAL=1 ;;
    esac
done

have() { command -v "$1" >/dev/null 2>&1; }

# ── Shared CLI / TUI — mirrors the Brewfile "Shared CLI / TUI" block ─────────
PACMAN_CLI=(
    bat                 # brew "bat"
    eza                 # brew "eza" — backs the `l` alias in zsh/.zshrc
    fd                  # brew "fd" — backs FZF_DEFAULT_COMMAND
    fzf                 # brew "fzf"
    github-cli          # brew "gh" (binary is `gh`)
    git-delta           # brew "git-delta"
    git-lfs             # brew "git-lfs"
    git-filter-repo     # brew "git-filter-repo"
    neovim              # brew "neovim" — $EDITOR, and nvim/ deploys as-is
    tmux                # brew "tmux"
    tree                # brew "tree"
    tree-sitter-cli     # brew "tree-sitter-cli"
    wget                # brew "wget"
    zoxide              # brew "zoxide"
    uv                  # brew "uv"
    python-pipx         # brew "pipx"
    python-pipenv       # brew "pipenv"
    jq                  # REQUIRED by claude/scripts/bootstrap.sh (settings.json merge)
    yq                  # REQUIRED by codex/scripts/bootstrap.sh  (config.toml merge)
    ripgrep             # bundled with Claude Code, but not on PATH for hooks/scripts
)

# ── Languages / runtimes / build — mirrors the Brewfile block ────────────────
PACMAN_LANG=(
    luajit              # brew "luajit" — neovim runtime dep, pinned explicitly
    go                  # brew "go" — REQUIRED to build notifier/linux
    rustup              # brew "rustup"
    kotlin              # brew "kotlin"
    gradle              # brew "gradle"
    python              # brew "python"
)

# ── Shell — zsh/ deploys a .zshrc, so the shell itself has to exist ─────────
PACMAN_SHELL=(
    zsh                 # no Brewfile entry: macOS ships zsh, Arch does not
)

# ── Desktop apps — the Brewfile cask/flatpak block ──────────────────────────
PACMAN_APPS=(
    ghostty             # cask "ghostty" (macOS) — official Arch package here
    obsidian            # cask "obsidian" (macOS) / flatpak (was bazzite)
)

# ── AUR ─────────────────────────────────────────────────────────────────────
AUR=(
    ccusage             # brew "ccusage" — Claude Code usage CLI, AUR only
)

# ── Deliberately NOT installed here ─────────────────────────────────────────
#   fnm          — mise manages node on this tier; two node shims would fight
#   claude-code  — mise (`mise use -g claude@latest`), not a system package
#   codex        — mise, same reason
#   coreutils    — GNU userland is native on Arch; the Brewfile entry is a
#                  macOS-only fix for BSD userland
#   swift-format — macOS toolchain only
#   tmux-fingers — macOS tap only; no Arch package, no AUR equivalent kept
#   aldente / bettertouchtool — macOS hardware utilities, no Linux counterpart

install_pacman() {
    [ "$#" -gt 0 ] || return 0
    echo "── pacman: $* ──"
    if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
    if have omarchy-pkg-add; then
        omarchy-pkg-add "$@"
    elif [ "$(id -u)" -eq 0 ]; then
        pacman -S --noconfirm --needed "$@"
    else
        sudo pacman -S --noconfirm --needed "$@"
    fi
}

install_aur() {
    [ "$#" -gt 0 ] || return 0
    echo "── AUR: $* ──"
    if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
    if have omarchy-pkg-aur-add; then
        omarchy-pkg-aur-add "$@"
    elif have yay; then
        yay -S --noconfirm --needed "$@"
    elif have paru; then
        paru -S --noconfirm --needed "$@"
    else
        echo "⚠ no AUR helper (yay/paru) — skipped: $*" >&2
        return 0
    fi
}

echo "=== arch packages ==="
[ "$DRY_RUN" -eq 1 ] && echo "(dry run — nothing will be installed)"

install_pacman "${PACMAN_CLI[@]}"
install_pacman "${PACMAN_LANG[@]}"
install_pacman "${PACMAN_SHELL[@]}"
if [ "$SKIP_OPTIONAL" -eq 0 ]; then
    install_pacman "${PACMAN_APPS[@]}"
    install_aur "${AUR[@]}"
else
    echo "── skipping desktop apps + AUR (--skip-optional) ──"
fi

echo "=== arch packages done ==="
