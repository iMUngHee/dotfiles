# Claude Code Global Config — ~/.config/claude/

@PERSONAL.md
@guardrails.md
@DEVGUARD.md
@MEMORY.md

## Hook-Enforced

- **Command rewriting**: a hook rewrites Bash commands to `rtk`. Never type `rtk` yourself.
- **File protection**: Edits and Bash commands targeting sensitive files (.env, credentials, lock files, keys) are blocked by hook. Writes to generated files (those declaring `AUTO-GENERATED`/`@generated`/`DO NOT EDIT` in their first 20 lines) are blocked too — edit the source and re-run its generator (`~/.config/ai/scripts/bootstrap.sh`). This file is a deployed copy; its source is `~/.config/claude/CLAUDE.md`. If blocked, report to 대협 instead of retrying.
- **Final gate**: On Stop, modified files are auto-formatted, then the type checker runs. If type check fails, you will be asked to fix and retry (up to 2 retries; on the 3rd failure the stop is allowed through). Do not bypass.
- **Auto-format**: After Edit/Write/MultiEdit, files are auto-formatted (prettier, gofmt, rustfmt, etc.). If you see "[auto-format]" output, the formatter changed the file — do not revert. Rapid successive edits within 30s may skip formatting due to debounce, but a final format pass runs on Stop to close that gap.
