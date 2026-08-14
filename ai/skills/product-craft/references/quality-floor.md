# Product Craft Quality Floor

Apply these minimums to every product surface in every medium. Existing contracts and captured
product systems may be more specific but cannot lower this floor.

This file holds **invariant intent only**. How each intent is realized depends on the declared
medium: read the matching section of `../../interface-design/references/medium-profiles.md`
for the mechanism. Together — intent plus the medium's mechanism — they form the accessibility
floor. An intent whose medium supplies no mechanism is a GAP, not a pass.

## Accessibility Floor

- Foreground must stay legible against its background. The ratio and the way to measure it
  belong to the medium; where the palette is not the author's to control, the medium supplies
  the substitute rule.
- The focused element must be identifiable without relying on color alone.
- An operable target must be reliably reachable with whatever input device the medium has.
- Every interactive control is reachable and operable. Where the keyboard is the only input,
  this covers the entire surface rather than a parallel path.
- Essential state changes remain understandable without motion.
- Role and meaning must be exposed through the medium's own mechanism. The absence of such a
  mechanism is a gap to report, not a reason to skip the intent.
- Every state the experience defines as applicable must be covered. Which states *exist* is a
  medium capability; what they *mean* comes from the experience contract. A medium that cannot
  express a required semantic state raises `CONTRACT GAP` — it never deletes the state.
- Color is never the only signal; pair it with text, icon, shape, position, or pattern.

## Text Setting Floor

Language-aware, and judged by the rendered outcome rather than by the presence of a declared
property.

- Korean: lines break at 어절 (word-unit) boundaries. A line ending mid-어절 is a defect. This
  is harder, not easier, where each Hangul syllable occupies two cells and width arithmetic
  interacts with breaking.
- 중국어/일본어 (Chinese/Japanese): follow their own line-breaking conventions. Do not apply
  the Korean rule to them.
- Long unspaced strings — URLs, identifiers, code — wrap, scroll, or truncate with a route to
  the full value. They never overflow their container.
- Verify by looking at the render at the extreme of the medium's adaptation axis; the medium
  names that extreme. A source grep for a declared property is supporting evidence, never
  proof.

## Neutral Mechanics

- Use the existing product tokens and primitives before introducing new ones.
- Long text, large numbers, translated copy, and non-numeric display values must not depend on
  short-content sizing.
- A default is still a decision. Generic typography, evenly spread color, decorative
  gradients, oversized type, excessive containers, and interchangeable section stacks require
  a traceable reason or must be replaced.

Conventional starting values — spacing steps, body sizing, elevation habits, timing bands,
grouped-control alignment — are **medium craft defaults**, not floor items. They live in the
medium profile and sit at the bottom of the precedence chain: the job, the contract, and the
purpose profile all outrank them, and a deliberate departure with a stated reason beats a
compliant default.

## Evidence Floor

- Separate captured facts, proposed decisions, and verified observations.
- A subjective design judgment cannot override a failed or missing objective check.
- A craft-readiness claim requires an inspected render in the medium's own substrate. If
  rendering is impossible, name the missing coverage and report `NOT VERIFIED`.
- Audit findings include evidence, user-job impact, and a concrete correction; aesthetic
  preference alone is not a finding.
