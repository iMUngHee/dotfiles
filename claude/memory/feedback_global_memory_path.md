---
name: Global memory storage path
description: When 대협 asks to remember something "globally", save to ~/.claude/memory/ instead of project-specific paths
type: feedback
---

When 대협 asks to remember something **globally** (e.g. "글로벌하게 기억해줘", "전역으로 기억해"), save the memory file to `~/.claude/memory/` and add a reference in `~/.claude/MEMORY.md` using the path `memory/filename.md`.

For project-specific memory, use the default `projects/<key>/memory/` path as usual.

**Why:** `~/.claude/memory/` is symlinked to the dotfiles repo for cross-machine sync. Project-specific paths are local to that machine and mixed with disposable session logs.

**How to apply:** Only use global path when 대협 explicitly requests global/cross-machine persistence. Otherwise, default project-specific behavior is correct.
