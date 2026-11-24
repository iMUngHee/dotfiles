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

Conventions differ in how much they decide. In order of reach:

1. **Architecture**: module responsibility, layering, dependency direction, ownership of state and resources.
2. **Semantics**: types, error model, API contracts, invariants.
3. **Implementation**: memory, allocation, concurrency, data structures, the cost of abstraction.
4. **Idiom**: the language's and standard library's usual way.
5. **Style**: naming, imports, formatting, file placement.

A formatter and a linter cover most of the last two; the floor's value is in the first three, so spend the effort there and adopt idiom and style where they keep those decisions consistent. For each consequential rule you adopt, know:

- its **source**: the owning code, a public contract, a reasoned project decision, or a guide's section or rule ID;
- the **failure** it prevents, as a technically working change that would make the code worse, and the legitimate alternative it must keep allowing;
- **where it goes** by the [decision order](../SKILL.md#where-a-decision-goes) and the [code path and cost comparison](structure.md);
- its **enforcement**: the compiler, a native lint, a precise check, or the judgment left to review;
- the **evidence** it needs, such as a measurement before and after a claimed speed-up.

These are questions to settle, not fields to write down. For example, adopting Microsoft's M-HOTPATH for a request path names the failure (per-request allocation, cloning and logging), puts the decision in the API that request handlers call, enforces what a lint can see, and asks for a measurement only when someone claims a speed-up; a rule like "borrow instead of clone" stays a reviewed rule with its source, because no lint decides every case. Record the source and reason of a consequential rule, exclusion or override where contributors read it, and record nothing to pad the document.
