# Claude Code Global Config — ~/.config/claude/

@PERSONAL.md
@guardrails.md
@DEVGUARD.md
@MEMORY.md

## Hook-Enforced (Claude Code only)

Everything in this section is enforced by shell hooks in `settings.json`, so it
holds only where those hooks run: Claude Code, on a machine whose bootstrap has
deployed them. Surfaces that read this file but run no hooks — Claude Cowork and
the Claude desktop app — get none of it. There, treat the guarantees below as
absent rather than assumed: nothing blocks a write to a sensitive or generated
file, nothing formats or type-checks on Stop, so make those checks yourself.


- **File protection**: Edits and Bash commands targeting sensitive files (.env, credentials, lock files, keys) are blocked by hook. Writes to generated files (those declaring `AUTO-GENERATED`/`@generated`/`DO NOT EDIT` in their first 20 lines) are blocked too — edit the source and re-run its generator (`~/.config/ai/scripts/bootstrap.sh`). This file is a deployed copy; its source is `~/.config/claude/CLAUDE.md`. If blocked, report to 대협 instead of retrying.
- **Final gate**: On Stop, modified files are auto-formatted, then the type checker runs. If type check fails, you will be asked to fix and retry (up to 2 retries; on the 3rd failure the stop is allowed through). Do not bypass.
- **Auto-format**: After Edit/Write/MultiEdit, files are auto-formatted (prettier, gofmt, rustfmt, etc.). If you see "[auto-format]" output, the formatter changed the file — do not revert. Rapid successive edits within 30s may skip formatting due to debounce, but a final format pass runs on Stop to close that gap.
