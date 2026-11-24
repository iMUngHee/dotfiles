# Sourcing conventions

A convention is a target, not a description of the code as it stands. Code written before the gate existed shows what the repository does, which may be exactly the slop the gate is meant to clear, so observed practice is evidence, never authority.

## Order of authority

1. **Decisions with a stated reason**: the maintainer's current directions, and rules, design notes or ADRs that say why. These win, including over a published guide.
2. **The maintainer's stated preferences.**
3. **Published guides that you fetch and read for this setup** (below). Never take a convention from memory: a remembered rule has no source a reviewer can check and drifts from the version the repository uses.
4. **The stack's supported defaults** ([defaults.md](defaults.md)).

Observed practice settles only what none of these decides, such as which of two acceptable spellings the repository already uses everywhere. Where the code contradicts the adopted target, the code is the debt: the gate enforces the target on new code and ratchets the existing violations ([stacks.md](stacks.md)), and the garden skill clears them. Keep an observed practice against a guide only when someone can state why; that reason becomes a decision of the first kind and goes into the development guide.

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
2. Write each adopted item as a short rule that cites the guide's rule ID or section, such as `(M-PANIC-ON-BUG)` or `(AIP-158)`, and ends with its tag like any rule.
3. Cover performance explicitly: allocation and logging on hot paths, blocking in async code, the cost of the chosen data structures, and that a performance claim needs a before-and-after measurement.
4. Enforce what a tool can: turn on the linter rules that implement a guide item, and ratchet the existing violations. An item no tool can decide stays `[unchecked: reason]`, and code that differs adopts it as that code is touched.
5. Record in the development guide the reason and link for each adopted item, and each guide item a decision overrides with that decision's reason.

The report lists the guides read, with their versions or retrieval dates, and how many items were adopted, enforced, left unchecked and overridden.
