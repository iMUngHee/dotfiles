---
name: claude-feedback_env_scrub_forces_manual_mode
description: CLAUDE_CODE_SUBPROCESS_ENV_SCRUB silently pins permission mode to default/manual, overriding permissions.defaultMode and even --permission-mode. Removed 2026-08-03; do not re-add.
metadata:
  type: feedback
---

`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` in the `env` block of `claude/settings.json` pinned every session to `default` (rendered as "manual" in the UI). Claude Code 2.1.220 merges `settings.env` into its own process env before resolving the initial permission mode, and that resolver short-circuits at the top: when the variable is truthy it returns `{mode:"default"}` before `permissions.defaultMode` is ever read, and discards a CLI `--permission-mode` as well. The warning (`Permission mode forced to default — CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set (allowed_non_write_users hardening)`) renders only when a mode was requested explicitly, so a bare launch fails silently. Removed from both the source and `~/.claude/settings.json` on 2026-08-03.

**Why:** it was added 2026-04-17 (`17f6d90`) for "credential stripping in subprocesses", and the coupling to permission mode appears in no settings documentation — only in the binary. 대협 chose auto mode over the scrubbing (`isScrubEnabled()` gates `subprocessEnv`, `scrubSandboxConfig`, `enforceScriptCaps`); the `permissions.deny` rules covering `~/.ssh/**`, `**/.env`, and credential paths are unaffected and still apply.

**How to apply:** do not re-add the variable — while it is set, `permissions.defaultMode: "auto"` and `--permission-mode` are both dead config, and a launcher patch cannot work around it. Two branches under `.agents/worktrees/` still carry it; drop it there if either is merged. To inspect the live gate, run `claude --debug -p ok` and read the `[auto-mode] verifyAutoModeGateAccess:` line. Auto mode is confirmed active when `Ignoring dangerous permission ... (bypasses classifier)` lines appear — 12 with the current allow list, 0 under manual mode.
