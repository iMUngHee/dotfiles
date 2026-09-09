#!/bin/bash
# ai/scripts/bootstrap.sh — orchestrator for the 3-tier deploy.
# Calls each tool's bootstrap if the tool is installed.
# Performs auto-backup of ~/.claude and ~/.codex on first/each run, retaining
# at most KEEP_BACKUPS copies and dropping anything older than 7 days.
# Final sanity checks after both tools deploy.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AI_DIR="$ROOT_DIR/ai"
CLAUDE_DIR="$ROOT_DIR/claude"
CODEX_DIR="$ROOT_DIR/codex"

NO_BACKUP=0
NO_CLEANUP=0
KEEP_BACKUPS=3
for arg in "$@"; do
    case "$arg" in
        --no-backup) NO_BACKUP=1 ;;
        --no-cleanup-backups) NO_CLEANUP=1 ;;
    esac
done

# Windows: `ln -s` has to create real NTFS symlinks, not MSYS's default copies.
# windows/scripts/deploy-ai.ps1 exports this before calling in, but it is not the
# only caller: githooks/post-merge runs this script directly after a pull, and so
# does a hand-run from a shell. Those inherit MSYS unset, and copy mode cannot
# write over a symlink an earlier nativestrict deploy left behind — `ln -sfn` on
# it fails with ENOTDIR and set -e aborts the whole deploy at the first one
# (claude/scripts/bootstrap.sh links hooks/ before anything else). It also leaves
# the half-made copy behind as a random-named directory in ~/.claude.
# Setting it here instead of in each caller makes every entry point agree.
case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) export MSYS=winsymlinks:nativestrict ;;
esac

echo "=== ai orchestrator bootstrap ==="
echo "Root:   $ROOT_DIR"

# ── 1. Backup (unless --no-backup) ──
# The scratch directories are skipped, which is what makes this survivable while
# a session of the tool being backed up is open. Codex keeps a lock file under
# ~/.codex/tmp for the life of a run; on Windows that file is opened with no
# sharing, so reading it fails outright — "Device or resource busy" — and under
# set -e that aborted the whole deploy before a single file was linked. Unix
# never saw it because an advisory lock there does not block a read.
#
# tmp and .tmp are the same directory under two names across Codex versions;
# skipping only one leaves the identical failure reachable. Neither holds
# anything a restore would want.
#
# cp has no exclude, so the entries are enumerated instead of copying the
# directory whole.
backup_dir() {
    src=$1
    dest=$2
    mkdir -p "$dest"
    # cp -a on the directory itself carried the directory's own mode across;
    # mkdir uses the umask instead, and ~/.codex holds auth.json, so a backup
    # must not end up more readable than what it copied. GNU spells the mode
    # -c %a and BSD -f %Lp, and GNU is asked first because BSD has no -c to
    # misread, while GNU's -f means "file system" and would answer with
    # statistics rather than refusing. Windows has no mode bits to read, so
    # nothing is found and nothing is set.
    dir_mode=$(stat -c %a "$src" 2>/dev/null || stat -f %Lp "$src" 2>/dev/null || echo "")
    case "$dir_mode" in
        [0-7][0-7][0-7] | [0-7][0-7][0-7][0-7]) chmod "$dir_mode" "$dest" ;;
    esac
    # Three globs, because one cannot name every entry cp -a would have copied:
    # * skips dotfiles, .[!.]* skips anything whose second character is a dot,
    # and ..?* picks up that remainder without ever matching . or .. themselves.
    for entry in "$src"/* "$src"/.[!.]* "$src"/..?*; do
        # -e follows the link, so a broken symlink reads as absent and would be
        # dropped - and ~/.claude is mostly symlinks into this repo, which is
        # exactly where a broken one shows up. -L catches those; the pair still
        # skips an unmatched glob, which is what this guard is here for.
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        case "${entry##*/}" in
            tmp | .tmp) continue ;;
        esac
        cp -a "$entry" "$dest/"
    done
}

if [ "$NO_BACKUP" -eq 0 ]; then
    TS=$(date +%s)
    if [ -d "$HOME/.claude" ] && [ ! -L "$HOME/.claude" ]; then
        backup_dir "$HOME/.claude" "$HOME/.claude.bak.$TS"
        echo "Backed up ~/.claude → ~/.claude.bak.$TS"
    fi
    if [ -d "$HOME/.codex" ] && [ ! -L "$HOME/.codex" ]; then
        backup_dir "$HOME/.codex" "$HOME/.codex.bak.$TS"
        echo "Backed up ~/.codex → ~/.codex.bak.$TS"
    fi
fi

# ── 2. Cleanup old backups (keep newest KEEP_BACKUPS, drop anything >7d) ──
# Age alone cannot bound repeated deploys: 8 runs in one afternoon left 7GB
# behind, every copy younger than the 7-day cutoff. The count sweep is the
# real guard; the age sweep only trims what outlives it.
if [ "$NO_CLEANUP" -eq 0 ]; then
    for prefix in .claude.bak .codex.bak; do
        find "$HOME" -maxdepth 1 -type d -name "$prefix.*" -mtime +7 -exec rm -rf {} + 2>/dev/null || true
        ls -dt "$HOME/$prefix".* 2>/dev/null | tail -n +$(( KEEP_BACKUPS + 1 )) | xargs -I{} rm -rf {} || true
    done
fi

# ── 3. Tool bootstraps ──
"$CLAUDE_DIR/scripts/bootstrap.sh"

if command -v codex &>/dev/null; then
    "$CODEX_DIR/scripts/bootstrap.sh"
else
    echo "Skipped codex bootstrap (codex CLI not installed)."
fi

# ── 4. Shared notifier ──
case "$(uname -s)" in
    Darwin)
        if command -v swiftc &>/dev/null; then
            "$ROOT_DIR/notifier/macos/build.sh"
        else
            echo "Skipped AgentNotifier macOS build (swiftc not found)."
        fi
        ;;
    Linux)
        if command -v go &>/dev/null; then
            "$ROOT_DIR/notifier/linux/build.sh"
        else
            echo "Skipped AgentNotifier Linux build (go not found)."
        fi
        ;;
esac

# ── 5. Git hooks ──
# The hooks live in githooks/ because .git/hooks is not version-controlled: a fresh
# clone had no post-merge hook, so merging a tier change deployed nothing and said
# nothing. core.hooksPath is absolute on purpose — a relative one resolves against
# the working directory, which differs per worktree.
if [ -e "$ROOT_DIR/.git" ] && [ -d "$ROOT_DIR/githooks" ]; then
    chmod +x "$ROOT_DIR"/githooks/* 2>/dev/null || true
    git -C "$ROOT_DIR" config core.hooksPath "$ROOT_DIR/githooks"
    echo "Git hooks: core.hooksPath → $ROOT_DIR/githooks"
fi

# ── 6. Sanity ──
"$AI_DIR/lib/verify-no-residual-tokens.sh"
"$AI_DIR/lib/verify-agents-md-size.sh"

# ── 7. Notice ──
cat <<'EOF'

=== Bootstrap complete ===
Edit source files under ~/.config/ai/, claude/, codex/ — NOT the deployed copies.
- Most ~/.claude/* are symlinks (Claude); editing those mutates ai/ originals.
- ~/.claude/CLAUDE.md is a COPY (keeps @imports internal). Direct edits are lost.
- ~/.codex/AGENTS.md is generated (concat+sed expand). Direct edits are lost.
- ~/.claude/MEMORY.md is generated. Direct edits are lost.
- Skills overlay: ~/.claude/skills/, ~/.agents/skills/ (Codex).
- AgentNotifier is shared by Claude and Codex hooks.
- Git hooks live in githooks/ via core.hooksPath — .git/hooks is not tracked.
- Merging a tier change into main runs this script (githooks/post-merge).
- New ai/*.md? Add to ai/AGENTS.manifest before next bootstrap.
EOF
