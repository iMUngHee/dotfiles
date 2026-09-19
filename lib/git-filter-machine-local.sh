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
# To change the value every machine starts from, edit the constant below; the
# filter is what decides the stored content, so the file in the index follows.
set -euo pipefail

CANONICAL_FONT_SIZE=16

sed -E "s/^font-size = .*/font-size = ${CANONICAL_FONT_SIZE}/"
