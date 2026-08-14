# UI Engineering Implementation Baseline

Use this baseline only after build authorization. The approved contract controls product and interface intent; this file constrains how that intent reaches code and may expose a routed gap.

## Existing System First

1. Inventory actually used primitives, tokens, themes, styling conventions, state helpers, accessibility utilities, asset pipelines, and tests.
2. Reuse an installed dependency or native platform capability before introducing custom code.
3. Import the existing shared component instead of rebuilding it from a visual snapshot or specimen.
4. Add a new variant only when the approved contract cannot be expressed by an existing variant.
5. Do not add a design-system dependency, icon family, font, animation library, or UI registry without explicit technical authorization.

Record verified choices in Implementation Bridge: source primitive/token, target use, any adapter or variant, and the proof command.

## Structure and State Coverage

- Keep semantic document order aligned with visual and keyboard order.
- Implement every contract state the medium can express — on the web that is default, hover, focus-visible, active, selected, disabled, loading, empty, invalid, partial, success, warning, error, overflow, long content, and conflict.
- Distinguish first-use empty, filtered/no-result, permission, offline, and server failure when their recovery differs.
- Preserve primary action, success feedback, failure/retry, cancel/back, confirmation, undo, and interruption behavior from user-job closure.
- Avoid hiding state meaning in color, transient reveal, or animation alone.

## Accessibility

- Prefer the medium's native semantic mechanism before an added accessibility layer.
- Give every control an accessible name and every field a persistent label.
- Keep keyboard operation, visible focus, logical focus movement, modal focus trap/restore, and escape behavior aligned with the contract.
- Associate validation/error text programmatically and announce consequential async status where appropriate.
- Meet the shared contrast and target-size floors through the medium's mechanism; confirm disabled controls remain understandable.
- Decorative media is hidden from assistive technology; meaningful media has task-relevant alternative text.

## Adaptation and Content Resilience

- Implement the contract's actual adaptation rules — reflow, collapse, scroll, or hold fixed — rather than generic thresholds, and only along the axis the declared medium actually has.
- Test realistic long labels, translated copy, large numbers, dense rows, empty data, and maximum expected volume.
- Set text for the language it is in. Korean must break at 어절 boundaries, not mid-word;
  Chinese and Japanese follow their own conventions and must not inherit the Korean rule.
  Verify by looking at the render at the adaptation extreme — a declared property is not the same
  as the text breaking correctly.
- Use min-size, wrapping, clamping, scrolling, or explicit truncation with a recovery path; never size only for short fixtures.
- Keep grouped controls aligned and preserve primary actions at narrow widths.

## Motion and Performance

- Animate `transform` and `opacity` when possible; avoid repeated layout reads/writes and paint-heavy blur/shadow animation.
- Never use `transition: all`; name properties.
- Keep repeated/high-frequency actions quieter than low-frequency transitions.
- Avoid scroll listeners or frame loops that force synchronous layout; use platform observers and scheduled updates where appropriate.
- Pause or remove offscreen/nonessential continuous motion.
- The medium's motion-reduction mechanism removes non-essential movement while leaving state change and feedback legible; where the medium has none, motion is not carrying meaning in the first place.
- Do not use motion to delay access to required content or controls.

## Visual Fidelity

- Map approved token names and values to code; do not substitute a near match without an interface delta.
- Preserve component hierarchy, density, radius, elevation, type roles, color roles, and asset treatment.
- Ensure the selected design tension and signature moment survive implementation without spreading them into every component.
- Keep formatting for dates, timezones, numbers, units, and truncation consistent with the contract.

## Contract Gap Rules

- An absent job/state/recovery/microcopy decision → `EXPERIENCE DELTA REQUIRED`.
- An absent composition/token/component/adaptation/formatting decision → `INTERFACE DELTA REQUIRED`.
- Conflicting evidence or unclear owner → `CONTRACT GAP`.
- A technical limitation may be documented in Implementation Bridge, but changing approved intent requires its owner.
