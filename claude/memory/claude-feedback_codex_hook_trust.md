---
name: Codex skips untrusted hooks (Claude deploying Codex hooks)
description: Codex 0.16x silently skips a newly added hook until the person approves it in the TUI (/hooks); check [hooks.state.*].trusted_hash before debugging the hook itself.
type: feedback
---

Codex records a trust hash for every hook position, `[hooks.state."<config path>:<event>:<group>:<index>"].trusted_hash` in `~/.codex/config.toml`. A hook at a position with no record never runs, and nothing says so: `codex exec` finishes normally, the other hooks still fire, and the new hook's own logging stays empty. A deploy that adds a Codex hook is not working until the person opens interactive `codex`, sees "hooks need review before they can run", and approves it with `/hooks`; that write bumps the `trusted_hash` count.

**Why:** gaebu's Codex hooks were deployed through bootstrap and looked dead. Three hypotheses (exec mode skips hooks, an untrusted project folder, PATH) were each disproved before the missing trust records turned up. One approval also did not persist (config.toml unchanged), so checking the file, not taking "approved" on report, is what settles it. Editing the hash yourself or running `--dangerously-bypass-hook-trust` is the person's security call, not an agent's.

**How to apply:**
- After deploying a Codex hook, map each hook position to its trust state (parse `config.toml` with `tomllib`: positions under `hooks.<Event>[group].hooks[index]` against `hooks.state` keys) before reading the hook's own code.
- Ask the person to approve in the Codex TUI with `/hooks`; then re-check `trusted_hash` and run one `codex exec` turn to confirm the hook's effect.
- A hook that runs through `codex/hooks/run-bash-hook.ps1` on Windows must read stdin as UTF-8 (fixed in dotfiles `96c3cd5`); verify non-ASCII input, not just ASCII.
