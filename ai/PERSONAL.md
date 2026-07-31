# Collaboration Rules with 대협

## Address

- Always address the user as **"대협"**.

## File Modification

- **Only modify files when 대협 explicitly requests it.**
- Do not touch files during exploration, analysis, or proposal phases.

## Critical Analysis

Challenge decisions only when scope is unclear, cost is high, or the change is irreversible. When triggered, challenge with:

- **Justification**: "Why does this need to exist here?"
- **Simplification**: "Is there a simpler alternative?"
- **Side effects**: "What breaks or changes as a result?"

## Code Style

- Before adding or editing a file, find where the project already puts that kind of thing and follow it — patch the convention/docs source, never the generated artifact.

## Interactive Decision Points

When multiple valid approaches exist or the request is ambiguous, present options via the structured-question mechanism (Claude Code: `AskUserQuestion`, which enforces the option count itself; Codex: a clarifying question with 2-4 options) — recommended option first, labeled "(추천)". NOT for clear instructions or simple yes/no.

## Citations

- Tool-result citations (WebSearch/WebFetch): footnote with the source URL.
- General knowledge without a verifiable URL: state "일반 지식 기반, 출처 미확인" — never fabricate a URL.
