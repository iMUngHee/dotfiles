# Maintenance defaults

Use the decisions that affect this repository. Resolve ordinary preferences from the checkout and present an inferred setup in one sentence. If purpose is unknown, ask what the maintainer expects to do with the project. Defer stack-specific files until that answer exists.

| Decision | Default | When to ask |
| --- | --- | --- |
| Conventions | Use the existing formatter, test layout, naming and documented exceptions, and make each of them fail in the gate. For a new stack, find its version-matched official tools ([stacks.md](stacks.md)). | A requested change implies a disruptive migration, such as a repository-wide reformat. |
| Strictness | Warnings are errors, lint suppressions carry a reason, a flaky test fails, every rule names its check. New code is strict at once; violations that already exist enter a ratchet baseline that only shrinks ([gate.md](gate.md)). | Turning a rule on would change many existing files in one go. |
| Gate | One `scripts/check.sh` with fast and full tiers, run by a pre-push hook. Extend an existing gate instead of adding a second. Wire an existing CI to call the same script; do not create CI. | The maintainer wants CI created, or the full tier needs special hardware or credentials. |
| Compatibility | Identify a concrete consumer of a command, setting, file format, result or interaction. Preserve its observable behavior. | A missing acceptance criterion determines whether the result is correct. |
| Verification | Reuse the cheapest relevant working entrypoint. Pick further methods by risk ([verification.md](verification.md)). Name the changed behavior, trigger and expected observation. | An expensive job, specialized device, uncertain scientific threshold, or a model or proof toolchain needs a human decision. |
| Agent guidance | Keep one editable source with the smallest working loader arrangement. Rules are short, tagged with their check, and their reasons live in the development guide. Seed the maintenance rule and the default skills ([skills.md](skills.md)). | Independent human-owned instructions conflict with the requested migration. |
| Versioning | Keep the existing version owner, bump rule, release unit and tag convention. For a new release target propose the native package version, SemVer, vX.Y.Z tags and an unreleased changelog section that the gate checks. Defer publishing machinery for a project without a release target. | Independent release units or a compatibility promise cannot be inferred. |

A keyboard-only save/reopen flow may need a manual GUI check; a terminal UI may need restoration verified after exit. A small CPU fixture can exercise a research pipeline and a full dataset can test numerical equivalence only once the reference and tolerance are known. A runner that exits successfully with zero applicable tests proves only that the runner starts. Record actual and proposed checks separately. Put each check in fast or full by its cost.

## Shared source and discovery

Reuse an existing manifest, handwritten entrypoint or generator first. A simple layout can keep AGENTS.md as the editable document and CLAUDE.md containing `@AGENTS.md` where the installed Claude loader supports imports. Preserve any existing tool-specific instructions. With a concrete shared skill, expose the same source through both .agents/skills/<name> and .claude/skills/<name> using the repository's existing mechanism. Inspect both SKILL.md paths after wiring. If directory links are unavailable, use an existing copy/sync mechanism or report the missing discovery path.

For a new two-tool layout that needs generated surfaces and already supports Node 22.16+ and relative symlinks:

- Copy the bundled asset to scripts/agents-build.mjs. Inspect any existing destination before copying.
- Write project guidance in .ai/PROJECT.md. Put actual area rules in .ai/rules/*.md and actual skills in .ai/skills/<name>/SKILL.md. Both collections are optional.
- To scope a rule, begin the file with YAML frontmatter containing only a `paths:` list of indented dash-prefixed patterns, optionally quoted. Use plain Markdown for an unconditional rule.
- Run `node scripts/agents-build.mjs`, then `node scripts/agents-build.mjs --check`. The builder creates root instruction files, Claude rule links and both tools' skill links. Edit the sources to change them. The consuming repository owns its builder.
- When Node or link creation is unavailable use the simple layout. Keep the existing environment sufficient to maintain the project.

Official support indicates a compatible default. Describe a choice as measurably more efficient only with a relevant comparison.
