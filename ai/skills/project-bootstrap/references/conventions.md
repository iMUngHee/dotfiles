# Sourcing conventions

A convention is a target, not a description of the code as it stands. Code written before the gate existed shows what the repository does, which may be exactly the slop the gate is meant to clear, so observed practice is evidence, never authority.

## Order of authority

1. **Decisions with a stated reason**: the maintainer's current directions, and rules, design notes or ADRs that say why. These win, including over a published guide.
2. **The maintainer's stated preferences.**
3. **Published guides that you fetch and read for this setup** (below). Never take a convention from memory: a remembered rule has no source a reviewer can check and drifts from the version the repository uses.
4. **The stack's supported defaults** ([defaults.md](defaults.md)).

Observed practice settles only what none of these decides, such as which of two acceptable spellings the repository already uses everywhere. Where the code contradicts the adopted target, the code is the debt: the gate enforces the target on new code and ratchets the existing violations ([stacks.md](stacks.md)), and maintainers clear them as the affected code changes. Keep an observed practice against a guide only when someone can state why; that reason becomes a decision of the first kind and goes into the development guide.

## Find the guides

Cover every area the rules govern, not only the language's style. For each area that matters to the repository, fetch and read a primary source and, where it leaves gaps, a second:

| Area | Known examples (search the same way for anything missing) |
| --- | --- |
| Language style, errors, naming, performance | Rust: Google Rust style guide, Microsoft Pragmatic Rust Guidelines, Rust API Guidelines. Go: Effective Go, Go Code Review Comments, Google Go style guide. TypeScript and JavaScript: Google TypeScript style guide, the TypeScript handbook. Python: PEP 8, Google Python style guide. Java and Kotlin: Google Java style guide, Kotlin coding conventions. C++: C++ Core Guidelines, Google C++ style guide |
| Framework | the framework's own documented rules, such as the Rules of React |
| API design | Google API Improvement Proposals, Microsoft REST API Guidelines |
| Security | OWASP ASVS and Top 10, the CWE entries for the code's input boundaries |
| Testing and review | Google Engineering Practices (code review), the testing chapters of *Software Engineering at Google* |
| Logging and telemetry | OpenTelemetry semantic conventions |
| User interfaces | WCAG for accessibility, the platform's human interface guidelines |
| Commits, versions, changelog | Conventional Commits, Semantic Versioning, Keep a Changelog |
| Documentation | Diátaxis |

Use the version matching the language edition or framework major version the repository pins, else the current published one. When a guide cannot be fetched, say so, and mark any rule you still write from it as unsourced.

## Turn them into rules

1. Open each rule file that a guide governs with a guide header. Name the guides with links and the sections excluded and why. Then state the order above as it applies here.
2. Write each adopted item as a short rule that cites the guide's rule ID or section, such as `(M-PANIC-ON-BUG)` or Google's [pagination guidance](https://google.aip.dev/158), and ends with its tag like any rule.
3. Start with responsibilities, allowed dependencies, state ownership and the public error contract. For implementation choices consider unnecessary wrappers, traits, dependencies, blocking I/O and data structures against an actual caller and workload. Prefer a borrowed input on a hot path when its lifetime permits; ownership transfer can legitimately need a copy. Require before/after evidence for a performance claim. Install benchmarks only for a concrete cost risk.
4. Try a type, visibility or API boundary first. Where a violation remains expressible, choose a precise check and ratchet legacy violations if appropriate. Mark review decisions `[unchecked: reason]`; a valid tag alone proves only the check name exists.
5. Keep the guide section, reason, exceptions and overrides close to the rule or in the existing contributor guide. Record an expensive structural migration as a separate decision.
