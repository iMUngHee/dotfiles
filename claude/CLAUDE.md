# Claude Code Global Config — ~/.config/claude/

@PERSONAL.md
@guardrails.md
@DEVGUARD.md
@MEMORY.md

## Automated by Hooks (do not do manually)

- **Command rewriting**: Bash commands are automatically rewritten to use `rtk` for token savings (PreToolUse hook). Do not manually prefix commands with `rtk`.
- **File protection**: Edits and Bash commands targeting sensitive files (.env, credentials, lock files, keys) are blocked by hook. If blocked, report to 대협 instead of retrying.
- **Notifications**: Task completion and approval requests trigger macOS notifications automatically. Do not use osascript for notifications.
- **Final gate**: On Stop, modified files are auto-formatted, then the type checker runs. If type check fails, you will be asked to fix and retry (up to 2 retries; on the 3rd failure the stop is allowed through). Do not bypass.
- **Auto-format**: After Edit/Write/MultiEdit, files are auto-formatted (prettier, gofmt, rustfmt, etc.). If you see "[auto-format]" output, the formatter changed the file — do not revert. Rapid successive edits within 30s may skip formatting due to debounce, but a final format pass runs on Stop to close that gap.
- **Context monitor**: At 50% and 65% context usage, warnings are injected via PostToolUse hook. Heed the warnings — autocompact triggers at 70%.
- **Post-compact context**: After compaction, git branch, recent commits, and modified files are automatically injected. Do not re-query basic git state after compact.
- **Prompt guard**: User prompts are scanned for accidentally pasted secrets (API keys, tokens, private keys). If blocked, remove the secret and retry.
- **Subagent trust reminder**: On subagent stop, a trust reminder is automatically injected. Do not duplicate the reminder manually.

## After Compaction

When compacting, always preserve: current task objectives, list of modified files, architectural decisions made, and test results from this session.
