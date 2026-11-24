# Maintenance defaults

Use the decisions that affect this repository. Resolve ordinary preferences from the checkout and present an inferred setup in one sentence. If purpose is unknown, ask what the maintainer expects to do with the project. Defer stack-specific files until that answer exists.

| Decision | Default | When to ask |
| --- | --- | --- |
| Conventions | Use existing formatter, test layout, naming and documented exceptions. For a new stack check its version-matched official tools or bundled help. | A requested change implies a disruptive migration. |
| Compatibility | Identify a concrete consumer of a command, setting, file format, result or interaction. Preserve its observable behavior. | A missing acceptance criterion determines whether the result is correct. |
| Verification | Reuse the cheapest relevant working entrypoint. Name the changed behavior, trigger and expected observation. | An expensive job, specialized device or uncertain scientific threshold needs a human decision. |
| Agent guidance | Keep one editable source with the smallest working loader arrangement. Scope instructions to their owning package and use a skill for a real repeated procedure. | Independent human-owned instructions conflict with the requested migration. |
| Versioning | Keep the existing version owner, bump rule, release unit and tag convention. For a new release target propose the native package version, SemVer, vX.Y.Z tags and user-visible change notes when appropriate. Defer publishing machinery for a project without a release target. | Independent release units or a compatibility promise cannot be inferred. |

A keyboard-only save/reopen flow may need a manual GUI check; a terminal UI may need restoration verified after exit. A small CPU fixture can exercise a research pipeline and a full dataset can test numerical equivalence only once the reference and tolerance are known. A runner that exits successfully with zero applicable tests proves only that the runner starts. Record actual and proposed checks separately. Split fast/full when the cost or coverage difference matters.

## Shared source and discovery

Reuse an existing manifest, handwritten entrypoint or generator first. A simple layout can keep AGENTS.md as the editable document and CLAUDE.md containing `@AGENTS.md` where the installed Claude loader supports imports. Preserve any existing tool-specific instructions. With a concrete shared skill, expose the same source through both .agents/skills/<name> and .claude/skills/<name> using the repository's existing mechanism. Inspect both SKILL.md paths after wiring. If directory links are unavailable, use an existing copy/sync mechanism or report the missing discovery path.

For a new two-tool layout that needs generated surfaces and already supports Node 22.16+ and relative symlinks:

- Copy the bundled asset to scripts/agents-build.mjs. Inspect any existing destination before copying.
- Write project guidance in .ai/PROJECT.md. Put actual area rules in .ai/rules/*.md and actual skills in .ai/skills/<name>/SKILL.md. Both collections are optional.
- To scope a rule, begin the file with YAML frontmatter containing only a `paths:` list of indented dash-prefixed patterns, optionally quoted. Use plain Markdown for an unconditional rule.
- Run `node scripts/agents-build.mjs`, then `node scripts/agents-build.mjs --check`. The builder creates root instruction files, Claude rule links and both tools' skill links. Edit the sources to change them. The consuming repository owns its builder.
- When Node or link creation is unavailable use the simple layout. Keep the existing environment sufficient to maintain the project.

Official support indicates a compatible default. Describe a choice as measurably more efficient only with a relevant comparison.
