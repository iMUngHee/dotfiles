---
name: Global memory storage path
description: Save 'global' memories to the shared ~/.config/ai/memory/ source, not project-specific paths.
type: feedback
---

When 대협 asks to remember something **globally** (e.g. "글로벌하게 기억해줘", "전역으로 기억해"), save the memory file to `~/.config/ai/memory/` (the shared source). The bootstrap deploys it into `{{TOOL_HOME}}/memory/` for the running tool to read.

For project-specific memory, use the default `projects/<key>/memory/` path as usual.

**Why:** `~/.config/ai/memory/` is the dotfiles repo's shared single source for cross-machine sync and cross-tool reuse (Claude Code, Codex CLI). Project-specific paths are local to that machine and mixed with disposable session logs.

**How to apply:** Only use the global shared path when 대협 explicitly requests global/cross-machine persistence. If the rule is tool-specific (e.g. references slash commands or tool-only systems), put it under the tool's directory (`~/.config/{{TOOL_NAME_LC}}/memory/`) with the `{{TOOL_NAME_LC}}-` prefix instead. Otherwise, default project-specific behavior is correct.
