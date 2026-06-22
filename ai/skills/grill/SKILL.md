---
name: grill
description: "Preemptively interrogate 대협 to surface tacit intent BEFORE large/irreversible/ambiguous work. AI asks one question at a time, each with a recommended answer, exploring code+context first. Read-only pre-step to design: reads the same context/memory/backlog design reads, writes nothing. TRIGGER: explicit 'grill'/'캐물어봐'/'의도 맞춰줘'/'심문해'; OR before design only when intent risk stays high after code/context discovery and at least two of these hold: large blast radius, irreversible/high-cost choice, multiple valid directions, unstated priority/constraint. SKIP: one ordinary clarifying question suffices; already inside design/debug/verify/retro/pm-* unless the latest user message explicitly asks for grill; root-cause debugging; clear single-step work; ordinary multi-file planning where /design suffices."
argument-hint: "[what to grill about]"
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion
model: opus
effort: high
disable-model-invocation: false
---

Interrogate 대협 to extract tacit intent before the real work begins. **You are the questioner; 대협 is the validator.**

Subject: $ARGUMENTS (if empty, ask what to grill about)

## System — design's read-only pre-step

grill is an **optional read-only front-step to `design`** — not a pm-* loop node (it owns no per-task artifact, so the canonical loop is unchanged). It consumes the same per-task inputs `design` reads — pm-context links, retro memory, the pm-roadmap item — interrogates 대협 to resolve what they leave unstated, then hands the aligned intent to `design`. It **persists nothing**: the intent flows into the next step (`design` plan `Decisions`, or `retro` task memory). If no `design`/`retro` follows, the intent is intentionally session-volatile — by design, not a bug.

## Inputs — read BEFORE asking (do not ask what these answer)

```bash
pm_root="$HOME/.config/ai/skills/pm-roadmap"
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || repo_root=""
if [ -n "$repo_root" ] && [ -x "$pm_root/node_modules/.bin/tsx" ]; then
  pm() { PM_ROOT="$repo_root" "$pm_root/node_modules/.bin/tsx" "$pm_root/pm-roadmap.ts" "$@"; }
fi
```

- `pm current-task` returns the owning **`<KEY>` only** (not an item id) → read `.agents/tasks/<KEY>/links.md` (context) and `.agents/tasks/<KEY>/memory.md` (retro-owned prior decisions), both read-only.
- Run `pm get <id>` only when an item id is explicitly given.
- Always grep/read the **codebase** for anything answerable from code.
- No task/focus, or outside a repo → skip the pm probes, inspect code only. **Never run `npm install` from grill.**

## Protocol

1. **Explore first.** Answer everything you can from the inputs. Only what code+context cannot answer goes to 대협.
2. **One question at a time** via `AskUserQuestion`. Never batch.
3. **Each question carries your recommended answer first** + a one-line rationale.
4. **Dependency-tree order** — each answer narrows the next; prune branches a prior answer closed.
5. **Hunt tacit knowledge** — prioritize constraints / priorities / "why this way" over surface choices.
6. Default **1 round**; hard cap **3 rounds**.

## Stop conditions

Stop when ANY holds: the actionable choices are settled; 대협 says proceed/skip; questions start repeating; further questions no longer reduce design risk; the 3rd round is reached. Then emit a compact **Extracted Intent** bullet block for the next step to consume.

## Hard rules

- **Write nothing.** Write/Edit are omitted from `allowed-tools`, and Bash is restricted to read-only commands only: `git rev-parse`, `git status/log/branch`, `pm list|tree|get|next|recent|validate|current-task`, and read-only `rg`/`grep`/`find`/`ls`/`sed -n`. Forbidden: shell redirection, heredocs, `tee`, `sed -i`, `npm install`, and every pm write subcommand (`task`/`add`/`plan`/`approve`/`close`/`drop`/`triage`/`focus`/`memory`/`links`/`persist`/`complete`/`migrate --apply`). Durable capture is delegated downstream — point there, never write it yourself.
- **Don't re-ask what code/context answers.** Exploring first is mandatory, not optional.
- **Recursion SKIP**: if already inside another skill flow (design / debug / …), do not start grill anew unless 대협's latest message explicitly asks for it.
- Questions are decision-shaped (about intent), not a code review.
