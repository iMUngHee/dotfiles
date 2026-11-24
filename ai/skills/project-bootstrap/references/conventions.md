# Sourcing conventions

A convention is a target, not a description of the code as it stands. Code written before the gate existed shows what the repository does, which may be exactly the slop the gate is meant to clear, so observed practice is evidence, never authority.

## Order of authority

1. **Decisions with a stated reason**: the maintainer's current directions, and rules, design notes or ADRs that say why. These win, including over a published guide.
2. **The maintainer's stated preferences.**
3. **Published guides that you fetch and read for this setup** (below). Never take a convention from memory: a remembered rule has no source a reviewer can check and drifts from the version the repository uses.
4. **The stack's supported defaults** ([defaults.md](defaults.md)).

Observed practice settles only what none of these decides, such as which of two acceptable spellings the repository already uses everywhere. Where the code contradicts the adopted target, the code is the debt: the gate enforces the target on new code and ratchets the existing violations ([stacks.md](stacks.md)), and maintainers clear them as the affected code changes. Keep an observed practice against a guide only when someone can state why; that reason becomes a decision of the first kind and goes into the development guide.

## Find the guides

When a consequential choice needs outside guidance, read a primary source that applies to the repository and consult another when a relevant question remains open:

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

1. Record why the decision fits this project. Cite the owning code, contract or reasoned project decision. For an adopted external rule, cite the applicable guide section or rule ID and record a consequential override or exclusion with its reason.
2. Trace the effect on a real change. At the architecture level, ask who owns the responsibility, allowed dependencies and state. At the semantic level, ask what inputs, errors and states the public contract permits. For implementation, look at actual callers and workload before adding abstractions, copies, blocking work or dependencies. Language idioms and formatting matter when they help contributors work within those decisions.
3. Preserve a nearby valid choice. A CLI may translate a domain error for a user while its storage package still owns persistence and retry. A hot path may borrow a value where the lifetime permits and copy it when ownership really transfers. Measure a speedup under equivalent work and results. Add a benchmark when the cost or risk warrants keeping one.
4. Prefer an existing sound path or a small structure, type or API change. For violations that remain possible, choose a precise check and ratchet existing debt if useful. A check tag names the actual mechanism. Give review-owned rules an unchecked reason. Keep the decision and its legitimate alternatives discoverable from contributor guidance.
