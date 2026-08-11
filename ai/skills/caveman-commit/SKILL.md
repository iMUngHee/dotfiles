---
name: caveman-commit
description: "Draft or rewrite concise commit-message text. TRIGGER when: asked for a commit message, commit subject/body, or wording for a commit. SKIP: requests to stage, commit, amend, push, or execute Git operations; PR bodies use pr-body; release notes are out of scope."
argument-hint: "[change summary or intended commit message]"
allowed-tools: Read, Grep, Glob
model: sonnet
effort: low
disable-model-invocation: false
---

Draft commit-message text only. Never run or replace the commit workflow.

## Routing Boundary

- Use this skill only for drafting, rewriting, or suggesting commit-message text.
- If the request includes staging, committing, amending, pushing, or another Git write, do not apply this skill. Return control to the normal commit workflow without performing Git work here.
- PR bodies route to `pr-body`. Release notes are out of scope.
- This skill never replaces the sensitive-information scan, pre-commit verifier, project checks, user confirmation, staging, committing, or pushing.
- Claude enforces the read-only `allowed-tools` frontmatter. Codex must follow these same boundaries from this body.

## Convention and Language

- Follow repository commit-convention evidence already present in context. Do not claim or discover a convention when no evidence is available.
- Follow the convention's dominant language. Commit-message language is independent of the conversation language.
- Without convention evidence, use the fallback below in English.

## Fallback Format

- Format: `<type>(<scope>): <imperative subject>`; scope is optional.
- Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`.
- Target 50 characters for the subject; never exceed 72.
- Use imperative mood and no trailing period.
- Add a body only for non-obvious rationale, breaking changes, or migration notes. Wrap it at 72 characters.
- Preserve exact issue identifiers and required trailers already present in context. Never invent them or add AI attribution unless an existing project or user rule requires it.

## Output

Return only the commit message in a fenced `text` block unless the user asks for rationale or alternatives.

Before:

```text
Implement a robust solution for preventing expired refresh tokens from being accepted
```

After:

```text
fix(auth): reject expired refresh tokens
```
