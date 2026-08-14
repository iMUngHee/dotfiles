# Medium Profiles

The medium owns the substrate: what an artifact literally is, what unit decisions are
expressed in, which states exist at all, and how a candidate is looked at. The purpose
profiles in `surface-profiles.md` own priority — what the surface optimizes for. Read the
shared quality floor, the one purpose profile matching the approved experience, and **only
the section for the declared medium**.

## Declaring the medium

The medium is declared, not chosen. Read it from whatever evidence exists — the request
itself, the plan or artifact the request produced, or the code. At least one is always
present, so no detection machinery is needed.

1. Repository evidence first.
2. Otherwise the request.
3. When substrate and medium diverge, the medium wins. Electron and Tauri render DOM but are
   Desktop GUI products: window chrome, OS menus, no address bar, offline, platform
   integration.
4. Deck and print agree on several fields, so name the discriminator explicitly: a deck is
   **presented while someone speaks**, a document is **read without a presenter**. When the
   request will not say which, that is the ambiguity below, not a coin flip.
5. Still ambiguous → `CONTRACT GAP`. A misread medium is a gate, not one more axis to offer.

## Admission

A medium earns its own section only when **at least three of the eleven fields differ such
that applying another medium's rules produces a real defect**. Below that it is a variation
of an existing medium — mobile *web* is the Web medium at a narrow viewport, not a separate
medium.

## Precedence

Highest wins. This extends `product-craft/SKILL.md` and `surface-profiles.md`, it does not
replace them.

1. Invariant floor intent plus this medium's accessibility mechanism.
2. The approved contract and the selected artifact, within their reviewed scope.
3. The actual job — `surface-profiles.md` keeps "if a value conflicts with what the job
   needs, the job wins".
4. Purpose × medium calibration — most media have no calibration table at all, and that is
   the normal case, not a hole. An absent table means the same as an absent row: the purpose
   applies its own meaning, and concrete values come from layer 6.
5. Purpose profile priority.
6. This medium's craft defaults.

Layers 4-6 are all starting points; a deliberate departure with a stated reason beats a
compliant default. When a purpose and a craft default disagree, the purpose wins — but if the
medium **cannot express** what the purpose requires, that is a capability limit, not a
ranking question, and it routes as `CONTRACT GAP`. The medium never deletes a semantic state.
An artifact that contradicts the contract is `ARTIFACT DRIFT` and stops; it is never resolved
by ranking.

## Fields

Substrate · Adaptation axis · Unit · Color authority · State vocabulary · Type authority ·
Motion · Accessibility mechanism · Render evidence · Forbidden defaults · Differentiation
vocabulary.

Differentiation vocabulary answers "what makes two candidates genuinely different here",
because a prohibition list alone shrinks the space and pushes candidates back into cosmetic
swaps. Every entry is tagged `interface-owned` (free to vary inside the approved experience)
or `experience-delta` (changes IA, flow, screen inventory, or content priority — take an
experience delta before drawing it).

When there is **no approved experience yet** — a surface built from scratch, where the
`experience-delta` entries are the substance rather than a variation of it — those entries are
not interface choices to vary between candidates. They are the experience stage's work, and it
runs first, even at Seed depth where the baseline is a disclosed compact inference. Drawing
candidates that differ in them without that step is inventing the experience under cover of
showing options.

---

## Web / DOM

- **Substrate**: one self-contained HTML file; style, script, SVG, images, and fonts inlined.
- **Adaptation axis**: viewport width, plus the user's text-size setting.
- **Unit**: px and rem.
- **Color authority**: the author, subject to dark mode and forced-colors modes.
- **State vocabulary**: default, hover, focus-visible, active, selected, disabled, loading,
  empty, invalid, success, warning, error.
- **Type authority**: free. Embed the faces the candidate needs as base64 `@font-face` data
  URIs, subset to the glyphs used.
- **Motion**: CSS and script, under the reduced-motion setting.
- **Accessibility mechanism**: semantic HTML and ARIA; a visible focus ring; measurable
  contrast.
- **Render evidence**: browser render at both extremes of the viewport range.
- **Forbidden defaults**: interchangeable SaaS section stacks, decorative gradients, card
  overuse, viewport-scaled body text, platform default type stacks left unchosen.
- **Differentiation vocabulary**:
  - what dominates the first screen and what yields to it — `interface-owned`
  - columns versus stacked bands — `interface-owned`
  - navigation persistent versus revealed — `interface-owned`
  - density — `interface-owned`
  - what holds the composition: grid, rule, interval, or a single anchor — `interface-owned`
  - splitting one route into several, or merging them — `experience-delta`
  - what the reader is asked to do first — `experience-delta`

### Purpose calibration

A cell exists only where this medium actually changes the purpose's calculation. A purpose
absent from this table applies its own meaning unchanged — that is the default, not an
omission. `Source` traces each cell to the migration ledger so a later change can be checked.

| Purpose | Calibration | Source |
| --- | --- | --- |
| Dashboard / Admin / Operations | rows 32-40px, toolbar controls 32-36px, panel padding 16-24px; body 13-14px, labels 11-12px, page title 18-24px | `dash.density.values`, `dash.type.values` |
| Form-Heavy Flow | field columns 480-720px, vertical rhythm 16-24px; labels 13-14px, helper/error 12-13px, section titles 16-20px | `form.density.values`, `form.type.values` |
| Data Visualization | labels 11-13px, annotations 12-14px, titles 16-20px | `viz.type.values` |
| Landing / Marketing | hero 40-64px desktop and 32-44px mobile, supporting copy 16-20px, section headings 24-40px | `land.type.values` |
| Content / Editorial | paragraph spacing 16-24px, line height 1.55-1.75; body 16-18px, h1 36-56px desktop, h2 24-36px, captions 12-14px | `cont.density.values`, `cont.type.values` |
| Product App / Workflow | work-list rows 36-44px, panel padding 16-24px, control gaps 8-16px; body 14-16px, labels 12-13px, page title 22-32px, section title 16-20px | `app.density.values`, `app.type.values` |

### Floor mechanisms

| Item | Value |
| --- | --- |
| `QF-07.m` contrast | 4.5:1 normal, 3:1 large text and non-text indicators, measured on computed colors |
| `QF-08.m` focus | visible 2px minimum outline or equivalent high-contrast ring on `:focus-visible` |
| `QF-09.m` target size | 44px minimum on touch-first controls; denser pointer controls only with explicit focus and affordance |
| `QF-10.m` modal focus | modal dialogs trap focus and restore it on close |
| `QF-11.m` reduced motion | `prefers-reduced-motion` removes non-essential animation |
| `QF-12.m` semantics | semantic HTML, or ARIA where no element carries the role |
| `QF-25.m` inspection extreme | narrowest and widest supported viewport |
| `QF-36.m` capability states | full set including hover and focus-visible |
| `QF-31` spacing | 4px step unless the captured system proves another scale |
| `QF-32` body type | 14-16px with 1.45-1.65 line height, labels 11-13px, no viewport-scaled body text |
| `QF-33` elevation | borders and background separation before shadows |
| `QF-34` timing | 100-160ms direct, 160-240ms panels, 240-360ms expressive |
| `QF-35` transitions | name the animated properties; never `transition: all` |
| `QF-38` control grouping | controls in one form or toolbar share height and baseline |

---

## TUI / cell grid

- **Substrate**: a runnable terminal render captured at the declared widths — not an HTML
  file.
- **Adaptation axis**: columns × rows, and reflow on resize.
- **Unit**: whole cells. One row is one line; one column is one character width. Hangul and
  most CJK occupy two cells, which interacts with 어절 line breaking. **Ambiguous-width
  characters (UAX#11) are the bigger hazard**: box drawing, `▸ ✓ ● … ·` and most symbol glyphs
  are one cell on a Western terminal and two when `ambiguous=wide` is set — the setting a
  Korean user is most likely to have. Compute width from a UAX#11 table, or restrict content
  glyphs to unambiguous ASCII and confirm the frame under both settings.
- **Color authority**: **the user.** The terminal theme is theirs. Use the sixteen semantic
  ANSI slots for meaning and never absolute RGB; truecolor is for non-semantic decoration
  only.
- **State vocabulary**: the *capability* states this medium has — default, focus, selected,
  disabled. **No hover**, assume no pointer. Semantic states the experience owns (empty,
  loading, error, partial, conflict) are not listed here and are not the medium's to drop; they
  are expressed in whatever this medium can render, usually as words in a region.
- **Type authority**: **none.** Monospace at one size. Hierarchy comes from weight, rules,
  spacing, and position.
- **Motion**: effectively none; a redraw is atomic and animation reads as flicker.
- **Accessibility mechanism**: output order is reading order; every action needs a keybinding
  and a way to discover it. Where a floor requirement can only be met by a keybinding — "a
  route to the full value" for a truncated string, for instance — and no existing key serves,
  that is an `EXPERIENCE DELTA REQUIRED`, because what a key means is experience-owned. Do not
  invent the binding to satisfy the floor.
- **Render evidence**: actually run it and capture at each declared width; a takeover surface
  needs one capture per state per width, not one per candidate. A computed mock made before
  anything runs is a **pre-run comparison artifact** — legitimate for comparing candidate
  skeletons, never render evidence, and it leaves `QF-25.m` `NOT VERIFIED` until a real run
  replaces it.
- **Forbidden defaults**: cards, shadows, gradients, faked rounded corners, pixel alignment
  assumptions, emoji whose width is guessed.
- **Differentiation vocabulary**:
  - single pane versus split, and how a pane subdivides — `interface-owned` (rearranging the
    same regions)
  - list versus table versus tree — `interface-owned`
  - inline versus modal detail — `interface-owned`
  - border treatment: boxes, rules, or whitespace only — `interface-owned`
  - status line position and content — `interface-owned`
  - command-first versus navigation-first — `experience-delta`
  - which panes exist at all, meaning a region appears or disappears — `experience-delta`
  - what a key means — `experience-delta`

### Floor mechanisms

| Item | Value |
| --- | --- |
| `QF-07.m` contrast | `N/A: the palette is user-owned.` Substitute: semantic ANSI slots for meaning, never absolute RGB |
| `QF-08.m` focus | reverse video, a selection bar, or a bracket marker — never color alone |
| `QF-09.m` target size | `N/A: no pointing device.` The operable unit is a keybinding |
| `QF-10.m` modal focus | a modal pane captures the key scope, restores it on close, and shows which scope is active |
| `QF-11.m` reduced motion | `N/A: no animation system.` |
| `QF-12.m` semantics | `N/A: no role API.` Output order is reading order; every region carries a visible label |
| `QF-25.m` inspection extreme | narrowest supported column count, and the shortest supported row count |
| `QF-36.m` capability states | default, focus, selected, disabled. `N/A: hover` |
| `QF-31` spacing | whole cells only; the smallest gap is one cell |
| `QF-32` body type | `N/A: monospace at one size.` |
| `QF-33` elevation | rules and blank lines; `N/A: shadows do not exist` |
| `QF-34` timing | `N/A: redraw is atomic.` |
| `QF-35` transitions | `N/A: no transition system.` |
| `QF-38` control grouping | grouped controls share a column and start at the same cell |

---

## CLI / stream output

- **Substrate**: a runnable command plus its captured output, on a TTY and piped.
- **Adaptation axis**: unknown width, and whether stdout is a TTY.
- **Unit**: character columns. One line is one record. Hangul and most CJK occupy two columns,
  so padding computed on character count misaligns every column that follows — the same defect
  as in a cell grid, and it applies here too.
- **Color authority**: **the TTY.** Color disappears under `NO_COLOR` or a pipe, so it is
  always optional decoration. Where it is used, use the sixteen semantic ANSI slots and never
  absolute RGB — the user's theme, not the author, decides what a slot looks like.
- **State vocabulary**: none — there is no interaction. Exit codes, progress, and the
  stdout/stderr split carry the outcome.
- **Type authority**: none. Hierarchy comes from indentation, alignment, separators, and
  case.
- **Motion**: none. Progress indicators appear only on a TTY and stay silent when piped.
- **Accessibility mechanism**: output order is reading order; **the output may be parsed by a
  machine**, so column alignment must not break `grep` or `awk`.
- **Render evidence**: run it twice — once on a TTY, once piped — and inspect both.
- **TTY versus piped**: the *data* and its structure must be identical in both. Only decoration
  may differ — color, progress, alignment padding. A pipe that yields different fields, a
  different order, or a different record count is a defect, because the two forms would then be
  two undocumented formats.
- **Forbidden defaults**: box drawing that imitates a screen, state distinguished by color
  alone, fixed-width assumptions, diagnostics mixed into stdout.
- **Differentiation vocabulary**:
  - table versus key-value versus prose versus tree — `interface-owned`
  - column order and what is elided — `interface-owned`
  - quiet versus verbose default — `interface-owned`
  - subcommand structure — `experience-delta`
  - what belongs on stdout versus stderr — `experience-delta`
  - what an exit code means — `experience-delta`

### Floor mechanisms

| Item | Value |
| --- | --- |
| `QF-07.m` contrast | `N/A: theme is user-owned and output may be colorless.` Meaning must survive `NO_COLOR` and piping |
| `QF-08.m` focus | `N/A: no focus concept.` |
| `QF-09.m` target size | `N/A: no pointing device.` |
| `QF-10.m` modal focus | `N/A: no modal concept.` |
| `QF-11.m` reduced motion | `N/A: no animation.` Progress output is TTY-only |
| `QF-12.m` semantics | output order is reading order; stdout carries data, stderr carries diagnostics |
| `QF-25.m` inspection extreme | a TTY run and a piped run, **each also at a narrow width**, all inspected. Width is this medium's adaptation axis, so TTY-vs-piped alone does not cover it |
| `QF-36.m` capability states | `N/A: no interaction states.` |
| `QF-31` spacing | `N/A: alignment is by column, not by a spacing scale.` |
| `QF-32` body type | `N/A: monospace at one size.` |
| `QF-33` elevation | `N/A: no elevation.` |
| `QF-34` timing | `N/A: no timing model.` |
| `QF-35` transitions | `N/A: no transition system.` |
| `QF-38` control grouping | aligned columns start at the same column across every row **of the same line class**. A nested or grouped shape has more than one line class; alignment holds within each |

---

## Desktop GUI

- **Substrate**: a platform toolkit build (AppKit/SwiftUI, WinUI, GTK, Qt), or Electron/Tauri
  — DOM substrate, desktop medium.
- **Adaptation axis**: window resize, DPI scale, platform, and light/dark.
- **Unit**: platform logical units.
- **Color authority**: **the platform.** System accent and semantic colors, automatic dark
  mode; hardcoded values fight the OS.
- **State vocabulary**: the full pointer set plus window active/inactive, menus, drag, and
  right-click context.
- **Type authority**: the platform system face by default; a custom face needs a reason.
- **Motion**: platform animation APIs under the system reduce-motion setting.
- **Accessibility mechanism**: the platform accessibility API (AX / UIA / AT-SPI) and the HIG
  role vocabulary.
- **Render evidence**: a real build screenshot. If that is impossible, a platform-shell mock
  **explicitly labeled a mock**, gated per `concept-stage.md` rather than treated as a render.
- **Forbidden defaults**: a web page dropped into a window, ignored platform conventions
  (button order, menu placement), scroll-driven landing structure.
- **Differentiation vocabulary**:
  - sidebar-led versus toolbar-led — `interface-owned`
  - inspector versus inline editing — `interface-owned`
  - single-window versus multi-window presentation of the same objects — `interface-owned`
  - menu structure — `experience-delta`
  - which objects are top-level — `experience-delta`
  - the document model — `experience-delta`

### Floor mechanisms

| Item | Value |
| --- | --- |
| `QF-07.m` contrast | 4.5:1 / 3:1 against platform semantic backgrounds, in light and dark |
| `QF-08.m` focus | the platform focus ring; never suppressed |
| `QF-09.m` target size | the platform pointer minimum; denser controls follow the HIG |
| `QF-10.m` modal focus | platform modal semantics trap and restore focus |
| `QF-11.m` reduced motion | the system reduce-motion setting |
| `QF-12.m` semantics | platform accessibility API roles and labels |
| `QF-25.m` inspection extreme | smallest and largest supported window, 1× and 2× DPI, light and dark |
| `QF-36.m` capability states | full pointer set plus window active/inactive, menu, drag, context |
| `QF-31` spacing | the platform spacing scale |
| `QF-32` body type | the platform system face at its body size, honoring the user's text-size setting |
| `QF-33` elevation | platform elevation conventions before custom shadows |
| `QF-34` timing | platform animation durations |
| `QF-35` transitions | `N/A: no CSS.` Name animated properties in the platform API |
| `QF-38` control grouping | grouped controls follow the platform control height |

---

## Mobile GUI

- **Substrate**: an iOS or Android build, or a cross-platform toolkit build.
- **Adaptation axis**: orientation, safe area and notch, dynamic type size, device size class,
  and **the software keyboard** — on any entry surface it is a first-order layout force, not an
  overlay to ignore. Say where the primary action goes when it is raised.
- **Unit**: pt (iOS) / dp (Android).
- **Color authority**: the platform semantic palette, light and dark.
- **State vocabulary**: press, long-press, swipe, drag, selected, disabled. **No hover.**
  Focus exists only on the accessibility path.
- **Type authority**: the platform system face, and **dynamic type is mandatory** — a fixed
  body size is a defect, not a style.
- **Motion**: platform transitions under the system reduce-motion setting; gesture-linked
  animation follows the finger.
- **Accessibility mechanism**: VoiceOver / TalkBack labels, traits, and gesture navigation.
- **Render evidence**: device or simulator, portrait and landscape, at the largest dynamic
  type size. When neither is available, a labeled wireframe is a **mock**, not a render: say so
  and gate it as an unrendered concept per `concept-stage.md`. No-simulator is at least as
  common here as on desktop, so the fallback rung is named rather than improvised.
- **Forbidden defaults**: desktop density transplanted, safe-area intrusion, gestures that
  collide with system edge swipes, anything that depends on hover, fixed text size.
- **Differentiation vocabulary**:
  - tab bar versus drawer versus stack-only — `interface-owned`
  - list versus card versus grid — `interface-owned`
  - sheet versus full-screen presentation — `interface-owned`
  - which destinations exist — `experience-delta`
  - what a gesture means — `experience-delta`
  - whether onboarding exists — `experience-delta`

### Floor mechanisms

| Item | Value |
| --- | --- |
| `QF-07.m` contrast | 4.5:1 / 3:1 against the platform's **resolved** semantic colors, verified in both appearances. The author does not own the palette, so the obligation is to check both resolutions rather than to hardcode a passing pair |
| `QF-08.m` focus | `N/A: no pointer focus.` The accessibility focus indicator is platform-supplied and must not be suppressed |
| `QF-09.m` target size | 44pt (iOS) / 48dp (Android) minimum — mandatory, not conditional |
| `QF-10.m` modal focus | platform modal presentation traps accessibility focus and restores it |
| `QF-11.m` reduced motion | the system reduce-motion setting; gesture animation degrades to a cut |
| `QF-12.m` semantics | VoiceOver / TalkBack labels, traits, and gesture navigation |
| `QF-25.m` inspection extreme | portrait and landscape, smallest and largest device class, largest dynamic type |
| `QF-36.m` capability states | press, long-press, swipe, drag, selected, disabled. `N/A: hover` |
| `QF-31` spacing | the platform spacing scale |
| `QF-32` body type | the platform system face under dynamic type; a fixed body size is a defect |
| `QF-33` elevation | platform elevation conventions |
| `QF-34` timing | platform transition durations; gesture-linked animation tracks the finger |
| `QF-35` transitions | `N/A: no CSS.` |
| `QF-38` control grouping | grouped controls share the platform control height and respect safe-area insets |

---

## Deck / fixed canvas

- **Substrate**: an actual slide render.
- **Adaptation axis**: **none.** Scale the frame; there are no breakpoints.
- **Unit**: pt-equivalents on a fixed 16:9 canvas with a consistent safe area.
- **Color authority**: the author, constrained by projection.
- **State vocabulary**: **none.** Build steps and presenter notes take their place.
- **Type authority**: free, with a distance-legibility floor.
- **Motion**: one consistent advance; builds only to pace a single idea.
- **Accessibility mechanism**: contrast at distance, minimum size, never color-only, and a
  readable distributed file.
- **Render evidence**: the real slide, plus a thumbnail check — if it collapses at thumbnail
  size the hierarchy is not doing its job.
- **Forbidden defaults**: scroll assumptions, document-like slides, tiny type, decorative
  per-element animation.
- **Differentiation vocabulary**:
  - full-bleed visual versus framed — `interface-owned`
  - text-first versus image-first — `interface-owned`
  - one column versus two — `interface-owned`
  - narrative order — `experience-delta`
  - how many ideas share one unit — `experience-delta`
  - adding or removing a unit — `experience-delta`

### Floor mechanisms

| Item | Value |
| --- | --- |
| `QF-07.m` contrast | projection-safe: treat 7:1 as the working target for body text rather than 4.5:1, because ambient light and projector gamma are unknown |
| `QF-08.m` focus | `N/A: no interaction focus.` Substitute for the intent: what the audience should be looking at is marked by position and scale, never by color alone |
| `QF-09.m` target size | `N/A: no operable targets.` |
| `QF-10.m` modal focus | `N/A: no modals.` |
| `QF-11.m` reduced motion | `N/A: no reduce-motion API.` Substitute: every build must be removable — the unit read with all steps shown must still carry the idea |
| `QF-12.m` semantics | the distributed file's structure — unit titles as headings, reading order, alt text on figures. A deck file carries real structure; treating it as having none is what produces an unreadable export |
| `QF-25.m` inspection extreme | `N/A: fixed canvas.` Inspect at full size and at thumbnail size. For text setting, inspect the **longest line in the longest unit** — with no adaptation axis that is the only place breaking can fail |
| `QF-36.m` capability states | `N/A: no interaction states.` Build steps replace them |
| `QF-31` spacing | a declared column grid inside the safe area — state the canvas size, column count, and gutter once and hold them across every unit |
| `QF-32` body type | title 40-72pt-eq, body 24-32pt-eq, never below about 20pt-eq, leading 1.2-1.4 |
| `QF-33` elevation | `N/A: elevation reads as decoration at distance.` |
| `QF-34` timing | one consistent advance, 200-400ms, used for every unit change |
| `QF-35` transitions | `N/A: no CSS.` The advance is a single named behaviour, not a per-property transition |
| `QF-38` control grouping | repeated elements hold their position across units — that is the master |

---

## Print / paged document

- **Substrate**: an actual page render (PDF).
- **Adaptation axis**: **none** beyond the declared paper size; page breaks are the only
  variable.
- **Unit**: mm and pt, with margins and gutters.
- **Color authority**: the author, but **it must survive greyscale** — background fills are
  not guaranteed to print.
- **State vocabulary**: none. Page flow and continuity markers take their place.
- **Type authority**: free, with a print-legibility floor.
- **Motion**: none at all. Anything that would have been explained by a transition must be
  carried by sequence, repetition, or an explicit continuity marker instead.
- **Accessibility mechanism**: PDF structure tags, reading order, alt text, greyscale
  contrast.
- **Render evidence**: the rendered PDF, a greyscale conversion, and the page boundaries. With
  no renderer available, a page-by-page specification is a **mock**, not a render: say so and
  gate it as an unrendered concept per `concept-stage.md`.
- **Forbidden defaults**: screen density, scroll assumptions, a table cut across pages
  **without** repeated headers and continuation markers, a single row split across two pages,
  meaning carried by a background color, information reachable only through a hyperlink.
- **Differentiation vocabulary**:
  - single column versus multi-column — `interface-owned`
  - figures inline versus floated — `interface-owned`
  - running-head content — `interface-owned`
  - section order — `experience-delta`
  - what moves to an appendix — `experience-delta`
  - whether a table of contents exists — `experience-delta`

### Floor mechanisms

| Item | Value |
| --- | --- |
| `QF-07.m` contrast | convert to greyscale and re-measure: the same 4.5:1 / 3:1 must still hold after conversion. No distinction may rest on tint alone, and background fills are not guaranteed to print at all |
| `QF-08.m` focus | `N/A: no focus.` |
| `QF-09.m` target size | `N/A: no operable targets.` |
| `QF-10.m` modal focus | `N/A: no modals.` |
| `QF-11.m` reduced motion | `N/A: static medium.` |
| `QF-12.m` semantics | PDF structure tags, reading order, and alt text on figures |
| `QF-25.m` inspection extreme | `N/A: fixed paper size.` Inspect page boundaries, greyscale conversion, and the final page |
| `QF-36.m` capability states | `N/A: no interaction states.` Continuity markers replace them: a table continuing onto another page repeats its full header, marks itself continued, carries forward any running total, and never leaves fewer than two rows stranded on either side of the break |
| `QF-31` spacing | the baseline grid and the margin/gutter scale |
| `QF-32` body type | body 9-11pt with print leading; secondary furniture — column headers, running heads, folios, footnotes — never below 7pt |
| `QF-33` elevation | rules and white space before tints; heavy tints cost ink and may not reproduce |
| `QF-34` timing | `N/A: static medium.` |
| `QF-35` transitions | `N/A: no transition system.` |
| `QF-38` control grouping | repeated furniture — headers, footers, folios — holds its position across pages |
