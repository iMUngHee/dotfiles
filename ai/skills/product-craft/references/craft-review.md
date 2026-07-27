# Craft Review

Look at the render and say what is wrong with it. This pass is deliberately **not** scoped to
the contract: a defect no contract row mentions is still a defect, and catching those is the
entire point of this file.

Run it against the same inspected renders used for contract comparison. Two passes, two
questions:

- Contract comparison asks: does the render match what was approved?
- This pass asks: looking at this render with a trained eye, what is wrong?

A finding here needs no contract row to justify it. If it is material, it blocks readiness
exactly as a failed contract row does.

## What "material" means

Material defects change what a person perceives or can do: text they cannot read cleanly, a
control they cannot hit, content they cannot reach, an element that reads as broken.

A preference about hue, or a different-but-defensible spacing choice, is not material. When
unsure, ask whether a competent designer reviewing this screen would mention it unprompted.
If yes, report it.

## Where defects hide

These are the places renders usually fail. They are prompts for looking, not boxes to tick —
a clean pass on every heading while the screen is visibly broken means the looking was wrong.

**Text setting.** Korean must break at 어절 (word-unit) boundaries; a line ending mid-어절 is
a defect, not a rendering quirk. Chinese and Japanese follow their own line-breaking
conventions and must not inherit the Korean rule. Long unspaced strings — URLs, identifiers,
code — wrap, scroll, or truncate with a route to the full value; they never overflow
silently. Judge this at the narrowest supported viewport, not the wide one.

**Optical alignment.** Geometric centering is not optical centering. Icons beside text,
arrows inside buttons, and glyphs with heavy sidebearing usually need a nudge. Punctuation,
quotation marks, and bullets opening a line often want to hang outside the text edge.

**Padding balance.** A button whose horizontal padding equals its vertical padding almost
always reads as cramped. Compare the space around a label to the label's cap height, not to
the box. Verify the space stays balanced left to right once the text is centered — a
trailing icon quietly steals from one side.

**Vertical rhythm.** Gaps should express grouping, not accident. Three different gap values
on one screen, none of them meaning anything, is arbitrary rhythm. Related items belong
closer to each other than to the next group.

**Clipping and overflow.** Look at every edge. Code blocks, tables, long labels, and
absolutely positioned elements clip quietly. A scrollbar appearing only on hover still means
content is cut. Check that nothing important sits under a sticky header or fixed bar.

**Density coherence.** One screen should read at one density. A compact table beside a
generously spaced card usually means defaults were assembled from two places.

**State completeness.** Empty, loading, error, and long-content states are where craft
collapses. A screen that only looks right with three short fixture rows is not finished.

## Reporting

Give the observation, where it is (screenshot, selector, or measurement), what it costs the
reader or user, and one concrete correction. Rank by cost: unusable, then degrades the task,
then polish.

State what you did not inspect. An unexamined viewport or state is uncovered scope, not a
pass.

A finding supported only by "I would have done it differently" is not a finding.
