# Skill Authoring Measurement Contract

Checked against the Claude Code skills documentation on 2026-07-20:

https://code.claude.com/docs/en/skills

This contract defines how the local skill catalog is measured. It does not authorize automatic edits, impose a local optimization budget, or make Codex behavior authoritative for authored frontmatter.

## Authority

Claude Code-native `SKILL.md` frontmatter is the authoring authority for shared and tool-native skills in this repository.

Codex consumption is a separate observation axis. A field that Codex ignores is not invalid, unnecessary, or removable merely because Codex does not consume it. In particular, `disable-model-invocation`, `allowed-tools`, `model`, and `effort` retain their Claude Code meanings.

## Checked frontmatter fields

The reporter recognizes the current Claude Code skill fields below:

| Field | Accepted shape |
| --- | --- |
| `name` | String |
| `description` | String |
| `when_to_use` | String |
| `argument-hint` | String |
| `arguments` | String or string list |
| `disable-model-invocation` | Boolean |
| `user-invocable` | Boolean |
| `allowed-tools` | String or string list |
| `model` | String |
| `effort` | String |
| `context` | String |
| `agent` | String |
| `hooks` | Mapping or list |
| `paths` | String or string list |
| `shell` | String |

Claude Code treats these fields as optional, with `description` recommended. The local catalog expects `name`, `description`, and `disable-model-invocation` to be explicit so invocation intent is reviewable. Missing explicit local fields are warnings, not parse failures.

Unknown fields are warnings rather than failures. Claude Code can add fields independently of this repository, so an unknown field must be checked against current official documentation before it is removed or rejected.

## Invocation and listing semantics

- `disable-model-invocation: false` or an omitted value means Claude may load the skill automatically. Its `description` and `when_to_use` contribute to the Claude listing view.
- `disable-model-invocation: true` means the skill is manual-only in Claude Code. Its listing text is counted as excluded rather than model-visible.
- `user-invocable` controls user menu visibility and does not replace `disable-model-invocation`.
- `when_to_use` is measured separately and then combined with `description` for the Claude listing total.
- The Codex view counts `description` for skills in the Codex deployment scope. It does not reinterpret Claude invocation fields.

Critical shared routing text must not be moved from `description` into `when_to_use` solely for cosmetic structure until the installed Codex consumer is verified to preserve it.

## Deployment scopes

The reporter mirrors the source order used by the bootstrap overlays:

```text
Claude:
  ai/skills/*
  ai/skills/private/*
  claude/skills/*

Codex:
  ai/skills/*
  ai/skills/private/*
  codex/skills/*
```

A later tool-native directory with the same top-level basename shadows the earlier directory for that runtime. Nested `SKILL.md` files inside an effective top-level skill are included because the deployed directory contains them.

## Metrics

All sizes are Unicode character counts, not byte counts or tokenizer estimates.

| Metric | Meaning |
| --- | --- |
| Claude listing characters | `description + when_to_use` for model-visible skills |
| Claude manual-only characters | Combined text excluded by `disable-model-invocation: true` |
| Codex description characters | `description` in the effective Codex deployment scope |
| Body lines | Markdown body lines after frontmatter |
| Nested skills | Nested `SKILL.md` files under deployed top-level skill roots |

The Codex total is a deterministic deployment inventory. It is not labeled as exact prompt tokens or proof that every installed Codex version consumes every field identically. Runtime samples are compared separately and any mismatch is reported rather than guessed away.

The reporter emits raw totals and ranked contributors. It intentionally has no 320-character or 420-character local budget in this phase.

## Diagnostics

`FAIL` is reserved for objective integrity failures:

- Invalid or unterminated YAML frontmatter
- Unsupported field value types
- Invalid Claude Code skill name format
- Duplicate effective skill names within one runtime scope
- Explicit local resource paths that do not exist

`WARN` records reviewable conditions:

- Missing explicit local metadata
- Unknown frontmatter fields
- Intentional overlay shadowing
- More than 1,536 combined Claude listing characters under the documented default cap
- More than 500 body lines under the documented skill-body recommendation

Warnings do not change the process exit code. Any failure produces exit code 1. Invalid CLI arguments or an analysis failure produce exit code 2.

## Resource checks

Only explicit relative paths beginning with one of these prefixes are checked:

```text
references/
scripts/
assets/
```

The reporter recognizes those paths in inline code and Markdown links. Other prose and generic filenames are not inferred as resources.

## Commands

Run from the reporter directory:

```sh
go test ./...
go run .
go run . --root "$(git rev-parse --show-toplevel)"
go run . --format json
```

The implementation uses `gopkg.in/yaml.v3` for complete YAML parsing. It has no rewrite, fix, install, bootstrap, or deployment mode.
