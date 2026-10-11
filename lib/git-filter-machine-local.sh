#!/bin/bash
# lib/git-filter-machine-local.sh — git clean filter for machine-local lines
# inside tracked config files.
#
# Registered by ai/scripts/bootstrap.sh as filter.machine-local.clean and wired
# to files in .gitattributes. Reads the file on stdin, writes to stdout what git
# should store; the working tree is never touched.
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
# says. Only `clean` is defined: a smudge would have to know this machine's
# value, and git gives a filter no way to read the working tree it is about to
# overwrite. The consequence is that checking this file out — a pull that
# changes it, or a hard reset — restores CANONICAL_FONT_SIZE, and the slider
# has to be used again. That is rare, and recoverable in one move.
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
