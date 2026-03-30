@RTK.md
@PERSONAL.md
@DEVGUARD.md
@MEMORY.md
@MEMORY.private.md

## Automated by Hooks (do not do manually)

- **Command rewriting**: Bash commands are automatically rewritten to use `rtk` for token savings (PreToolUse hook). Do not manually prefix commands with `rtk`.
- **File protection**: Edits to sensitive files (.env, credentials, lock files) are blocked by hook. If blocked, report to 대협 instead of retrying.
- **Notifications**: Task completion and approval requests trigger macOS notifications automatically. Do not use osascript for notifications.
- **Context monitor**: At 50% and 65% context usage, warnings are injected via PostToolUse hook. Heed the warnings — autocompact triggers at 70%.
- **Post-compact context**: After compaction, git branch, recent commits, and modified files are automatically injected. Do not re-query basic git state after compact.

## After Compaction

When compacting, always preserve: current task objectives, list of modified files, architectural decisions made, and test results from this session.
