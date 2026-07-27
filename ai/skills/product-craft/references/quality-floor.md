# Product Craft Quality Floor

Apply these minimums to every product surface. Existing contracts and captured product systems may be more specific but cannot lower this floor.

## Accessibility Floor

- Text contrast: at least 4.5:1 for normal text and 3:1 for large text and non-text UI indicators.
- Focus visibility: a visible 2px minimum outline or equivalent high-contrast focus ring; never color-only.
- Touch targets: 44px minimum on touch-first controls. Dense desktop controls may be smaller only when keyboard focus and pointer affordance remain explicit.
- Keyboard: every interactive control is reachable and operable. Modal dialogs trap focus and restore it on close.
- Motion: `prefers-reduced-motion` removes non-essential animation; essential state changes remain understandable without motion.
- Semantics: use semantic HTML or appropriate ARIA for buttons, links, tabs, dialogs, tables, labels, errors, and status messages.
- State meaning: color is never the only signal; pair it with text, icon, shape, position, or pattern.

## Text Setting Floor

Language-aware, and judged by the rendered outcome rather than by the presence of a CSS
property.

- Korean: lines break at 어절 (word-unit) boundaries. A line ending mid-어절 is a defect.
- 중국어/일본어 (Chinese/Japanese): follow their own line-breaking conventions. Do not apply
  the Korean rule to them.
- Long unspaced strings — URLs, identifiers, code — wrap, scroll, or truncate with a route to
  the full value. They never overflow their container.
- Verify by looking at the render at the narrowest supported viewport. A source grep for a
  CSS property is supporting evidence, never proof.

## Neutral Mechanics

- Use the existing product tokens and primitives before introducing new ones.
- Use a 4px spacing step unless the captured system proves another scale.
- Default body copy is 14-16px with 1.45-1.65 line height; labels are 11-13px. Avoid viewport-scaled body text.
- Prefer borders and background separation before shadows; elevation communicates layering rather than decoration.
- Direct feedback typically fits 100-160ms, panels/dialogs 160-240ms, and low-frequency expressive transitions 240-360ms.
- Transition explicit properties; never use `transition: all`.
- Cover applicable default, hover, focus-visible, active, selected, disabled, loading, empty, invalid, success, warning, and error states.
- Long text, large numbers, translated copy, and non-numeric display values must not depend on short-content sizing.
- Controls in one form or toolbar group share a deliberate height and baseline.
- A default is still a decision. Generic typography, evenly spread color, decorative gradients, oversized type, excessive cards, and interchangeable section stacks require a traceable reason or must be replaced.

## Evidence Floor

- Separate captured facts, proposed decisions, and verified observations.
- A subjective design judgment cannot override a failed or missing objective check.
- A craft-readiness claim requires an inspected render. If rendering is impossible, name the missing coverage and report `NOT VERIFIED`.
- Audit findings include evidence, user-job impact, and a concrete correction; aesthetic preference alone is not a finding.
