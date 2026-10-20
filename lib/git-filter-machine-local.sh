#!/bin/bash
# lib/git-filter-machine-local.sh — git filter for machine-local lines inside
# tracked config files.
#
# Registered by ai/scripts/bootstrap.sh as filter.machine-local.clean (no
# argument) and filter.machine-local.smudge (`smudge`), and wired to files in
# .gitattributes. Reads the file on stdin and writes to stdout: clean writes
# what git should store, smudge what a checkout should put in the working tree.
# Neither touches the working tree itself.
#
# The case this exists for: Omarchy's display text size slider runs
#     sed -i -E "s/^font-size = .*/font-size = $pt/" ~/.config/ghostty/config
# against a hardcoded path, which is a file this repo tracks. Font size follows
# the monitor, so it is not something to carry between machines — but moving the
# line out of the file is not an option either, because then that sed matches
# nothing and the slider silently does nothing, the same way omarchy-font-set
# did before its value was quoted.
#
# So the line stays where Omarchy expects it and git is told to ignore what it
# says: clean stores CANONICAL_FONT_SIZE. Anything that rewrites the file — a
# pull that changes it, a reset, and `git stash`, which resets the working tree
# to the cleaned content — would then leave CANONICAL_FONT_SIZE behind, and git
# gives a filter no way to read the working tree it is about to overwrite.
#
# Smudge puts the machine's value back from the one place it survives outside
# the file: the slider's own record, `[font] base-size` (px) in
# ~/.config/omarchy/shell.toml, which this repo does not track. It converts px
# to points exactly as the slider does, reading the constants and the formula
# out of the installed omarchy-display-text-size rather than copying them, so
# an Omarchy update that changes either is noticed instead of silently
# producing a different size: smudge then leaves the line alone and says why on
# stderr. ai/lib/git-filter-machine-local.test.mjs checks the installed script
# still has that shape. With no shell.toml (macOS, or a machine where the
# slider was never moved) smudge passes the file through, as `cat` used to.
# Smudge never fails: the filter is `required`, so a failing smudge would
# abort the checkout.
#
# The second case: a block between `# >>> machine-local` and
# `# <<< machine-local` lines is dropped whole. aerospace/aerospace.toml uses it
# for work-machine float rules (VPN and endpoint-agent bundle IDs) that should
# not reach a public repo; AeroSpace has no include, so they cannot live in a
# separate file. The same checkout caveat applies, and harder: a checkout of
# that file removes the block from the working tree, and it has to be re-added
# by hand. Only this Mac edits the file, so a pull rarely rewrites it.
#
# That by-hand re-add is why an unterminated block is refused rather than
# guessed at, and why the block is matched by awk rather than a sed range.
#
# `sed '/start/,/end/d'` leaves its range open when the end pattern never
# arrives, so one typo'd or forgotten `# <<< machine-local` stores the file
# truncated from the opening marker to EOF — for aerospace.toml that is the
# float rules and the whole service mode. The diff does show it, but a file
# carrying a machine-local block is *expected* to show deletions, so the extra
# loss reads as the intended drop.
#
# Keeping the block instead would be worse, not better: withholding those
# bundle ids is the only reason this case exists, so storing them because a
# marker was mistyped trades a recoverable truncation for a leak into a public
# repo. There is no safe guess between the two, so the filter takes neither —
# it writes what went wrong to stderr and exits non-zero, and
# ai/scripts/bootstrap.sh registers filter.machine-local.required so git aborts
# the add instead of falling back to the unfiltered content (that fallback is
# git's default, and it is exactly the leak). Every git command that cleans the
# file then fails with the reason until the marker pair is closed, which is the
# intended loudness: nothing is stored while the file's own shape is ambiguous.
#
# awk, not sed, because the decision can only be made at EOF, and stderr is
# reached through `cat 1>&2` rather than "/dev/stderr" so no awk build has to
# special-case that name.
#
# To change the value every machine starts from, edit the constant below; the
# filter is what decides the stored content, so the file in the index follows.
set -euo pipefail

CANONICAL_FONT_SIZE=16

warn() {
    echo "git-filter-machine-local: $*; font-size left as stored" >&2
}

# The terminal point size the Omarchy slider would write on this machine, or
# nothing when there is none to restore. Mirrors current_base_size and
# term_pt_for in omarchy-display-text-size; the formula itself is read from it.
slider_font_size() {
    local shell_config="$HOME/.config/omarchy/shell.toml" script px pt_default px_default
    [ -f "$shell_config" ] || return 0
    if ! px=$(awk '
        /^[[:space:]]*\[/ { in_font = ($0 ~ /^[[:space:]]*\[font\]([[:space:]]|$)/); next }
        in_font && /^[[:space:]]*base-size[[:space:]]*=/ {
            v = $0
            sub(/^[^=]*=[[:space:]]*/, "", v)
            sub(/[[:space:]]*(#.*)?$/, "", v)
            print v
            exit
        }
    ' "$shell_config" 2>/dev/null); then
        warn "cannot read $shell_config"
        return 0
    fi
    case "$px" in
        "") return 0 ;;
        *[!0123456789]*) warn "base-size '$px' in $shell_config is not a whole number"; return 0 ;;
    esac
    script=$(command -v omarchy-display-text-size || true)
    if [ -z "$script" ] || [ ! -f "$script" ]; then
        warn "$shell_config exists but omarchy-display-text-size was not found"
        return 0
    fi
    # The two lines that make up term_pt_for. If Omarchy rewrites them, the
    # conversion below no longer matches the slider.
    if ! grep -qF 'awk -v s="$1" -v p="$TERM_DEFAULT_PT" -v b="$SHELL_DEFAULT_PX"' "$script" ||
        ! grep -qF "'BEGIN { printf \"%d\", int(s * p / b + 0.5) }'" "$script"; then
        warn "the px-to-pt formula in $script changed"
        return 0
    fi
    pt_default=$(sed -n 's/^TERM_DEFAULT_PT=\([0-9][0-9]*\)$/\1/p' "$script")
    px_default=$(sed -n 's/^SHELL_DEFAULT_PX=\([0-9][0-9]*\)$/\1/p' "$script")
    if [ -z "$pt_default" ] || [ -z "$px_default" ]; then
        warn "TERM_DEFAULT_PT or SHELL_DEFAULT_PX is missing from $script"
        return 0
    fi
    awk -v s="$px" -v p="$pt_default" -v b="$px_default" 'BEGIN { printf "%d", int(s * p / b + 0.5) }'
}

if [ "${1:-}" = smudge ]; then
    pt=$(slider_font_size) || pt=""
    if [ -n "$pt" ] && [ "$pt" -gt 0 ] 2>/dev/null; then
        sed -E "s/^font-size = .*/font-size = ${pt}/"
    else
        cat
    fi
    exit 0
elif [ -n "${1:-}" ]; then
    echo "usage: git-filter-machine-local.sh [smudge]" >&2
    exit 2
fi

sed -E "s/^font-size = .*/font-size = ${CANONICAL_FONT_SIZE}/" | awk '
    /^# >>> machine-local/ && !inblock { inblock = 1; opened = NR; next }
    inblock && /^# <<< machine-local/ { inblock = 0; next }
    inblock                           { next }
                                      { print }
    END {
        if (inblock) {
            print "git-filter-machine-local: `# >>> machine-local` opened at line " opened \
                  " is never closed by `# <<< machine-local`." | "cat 1>&2"
            print "Refusing to store this file: closing the block would hide it, leaving it" \
                  " open would commit it. Fix the marker pair and retry." | "cat 1>&2"
            exit 1
        }
    }
'
