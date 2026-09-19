#!/bin/bash
# arch/scripts/update-all.sh — the `buu` implementation for Arch/Omarchy.
#
# On macOS `buu` is `brew update; brew upgrade`, and brew genuinely owns almost
# everything. Here `omarchy update` plays that part, and it covers more than
# pacman alone. In order it runs:
#
#   omarchy-update-system-pkgs   pacman
#   omarchy-update-aur-pkgs      the AUR (ccusage lives there)
#   omarchy-update-mise          MISE_MINIMUM_RELEASE_AGE=0 mise up — the same
#                                call Omarchy's own `mup` alias makes, which
#                                bypasses the cooldown that otherwise holds
#                                tools back for days
#
# around a btrfs snapshot, a keyring refresh, migrations and an orphan sweep.
# mise itself is not self-updating on this install — it says so and points back
# at however it was installed — so it updates as a system package here.
#
# What omarchy update cannot know about is what this tier builds from source.
# pager publishes no release binaries, so `make build` IS its update mechanism,
# which is the same reason windows/scripts/update-all.ps1 rebuilds it rather
# than version-checking it. Leaving it out would make `buu` mean something
# narrower here than on the other two platforms.
#
# Arguments are passed through to omarchy update, so `buu -y` is unattended.
set -euo pipefail

PAGER_SRC="${PAGER_SRC:-$HOME/Projects/pager}"
WARNINGS=()

warn() { echo "⚠ $1"; WARNINGS+=("$1"); }
step() { echo -e "\n\033[0;32m── $1 ──\033[0m"; }

# ── 1. system: pacman + AUR + mise ──────────────────────────────────────────
if command -v omarchy >/dev/null 2>&1; then
    step "omarchy update (pacman, AUR, mise)"
    omarchy update "$@"
else
    warn "omarchy not found — skipping system update"
fi

# ── 2. pager (built from source; rebuild is the update) ─────────────────────
step "pager"
if [ ! -d "$PAGER_SRC/.git" ]; then
    echo "no checkout at $PAGER_SRC — skip (set PAGER_SRC to override)"
elif ! command -v go >/dev/null 2>&1; then
    warn "go not installed — pager left at its current build"
else
    git -C "$PAGER_SRC" pull --ff-only --quiet || warn "pager: git pull failed, building what is on disk"
    # make build runs its own smoke check and swaps the binary atomically, which
    # matters because live sessions' hooks are already calling it.
    make -C "$PAGER_SRC" build || warn "pager: make build failed"
fi

# ── summary ─────────────────────────────────────────────────────────────────
if [ "${#WARNINGS[@]}" -gt 0 ]; then
    echo ""
    echo "=== ⚠ ${#WARNINGS[@]} warning(s) ==="
    for w in "${WARNINGS[@]}"; do echo "  - $w"; done
fi
step "update done"
echo -e "\033[0;90mNeovim plugins and mason tools update inside nvim: :Lazy sync, :MasonUpdate"
echo -e "tmux plugins: prefix + U\033[0m"
