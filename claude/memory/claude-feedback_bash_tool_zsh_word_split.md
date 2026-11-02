---
name: claude-feedback_bash_tool_zsh_word_split
description: On the Mac the Bash tool runs zsh, where an unquoted $var holding a list does not word-split — `for x in $list`, `git diff -- $files`, `kill $pids` act on one whole string; loop over lists inside `bash <<'EOF'` or use a zsh array.
metadata:
  type: feedback
---

The Bash tool runs commands in 대협's login shell, which is zsh on the Mac. zsh does not split an unquoted parameter expansion on whitespace, so a variable holding a space- or newline-separated list stays one word: `for f in $files` runs once with the whole list as `f`, `git diff -- $files` asks for one nonexistent path and prints an empty diff, `kill -KILL $pids` gets a single bogus argument and kills nothing, and an unmatched glob such as `ls $T/prefix-*` aborts the command with "no matches found" instead of passing through.

**Why:** in the 2026-11-02 Rust-harness session this silently broke five commands — an empty patch (`No valid patches in input`), a test-file loop that never ran, leftover fixture processes that survived a `kill`, and a duplicate-name check that inspected nothing — each costing a retry, and the empty-diff case could have shipped a no-op port.

**How to apply:** for anything that iterates over a list or passes a list as arguments, run the block under bash (`bash <<'EOF' … EOF`, or `bash -c '…'`), or use a real zsh array (`files=(a b c); for f in $files`). Treat an empty result from a command fed by a list variable as a sign the list was not split. On the VM, Claude Code runs with `SHELL=/bin/bash` (irteam's login shell; checked in the running processes' environment 2026-11-02), so this does not apply there.
