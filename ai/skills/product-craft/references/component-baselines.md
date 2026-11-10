# Component Baselines

What each kind of component is expected to do without being asked. Check every kind the
surface uses. A baseline may be dropped only on purpose, with the reason in **Decided for
you**. Where a component library provides the behaviour, use the library's — do not rebuild it.

## Everything interactive

- Visible states: rest, hover (where a pointer exists), focus, pressed, disabled, busy.
- Reachable and operable by keyboard; focus is always visible and never trapped.
- A name a screen reader can announce; icon-only controls carry a label and a tooltip.
- Disabled controls say why, or are not shown.

## Text and code

- **Code block**: syntax highlighting for the language, a monospace face, a copy control,
  the language or file name shown, horizontal scroll rather than overflow, tabs and
  indentation preserved. Long blocks may collapse. Inline code is visibly distinct from prose.
- **Rendered Markdown or rich text**: headings, lists, tables, links, quotes, images and code
  all styled — not just paragraphs. Links look like links and say where they go.
- **Long text**: wraps at word boundaries for its language (Korean at 어절 boundaries; Chinese
  and Japanese by their own rules), never mid-word. Unbroken strings (URLs, paths, ids)
  wrap, scroll or truncate with a way to see the whole value.
- **Truncated text**: an ellipsis, and the full value on hover, focus or expand.
- **Numbers, dates, durations, sizes**: formatted for people, aligned when in columns,
  consistent across the surface. Relative times have an absolute form available.

## Collections

- **List or grid**: empty state that says how to fill it; loading and error states; selection
  that is visible; keyboard movement; a context menu or per-item actions; sensible default
  order, and sort or filter once it can hold more than a screenful.
- **Table**: column headers, sortable where order matters, aligned figures, a header that
  stays visible when rows scroll, row hover and selection, column widths that survive long
  values.
- **Tree or navigation**: the current location is marked; expand and collapse by pointer and
  keys; deep items stay reachable at narrow widths.
- **Search or filter field**: clear control, a no-results state that says what was searched,
  results update without losing the query, Escape clears or closes.

## Input

- **Form field**: a visible label (a placeholder is not a label), help where the format is
  not obvious, validation that says what is wrong and how to fix it, next to the field, at a
  sensible moment — not on every keystroke, not only after submit.
- **Form**: Enter submits where that is expected, the primary action is obvious, unsaved
  changes are not lost silently, submitting shows progress and prevents double submission.
- **File or drop target**: says what it accepts, reacts while something is dragged over it,
  reports what was rejected and why.
- **Password or secret**: never echoed, a reveal control where appropriate, paste allowed.

## Feedback and overlays

- **Dialog**: a title that states the decision, buttons labelled with the action ("Delete 3
  books", not "OK"), the safe choice easy, Escape cancels, focus goes in and comes back.
- **Destructive action**: names what will be lost, confirms or offers undo.
- **Notification or toast**: says what happened, offers the obvious next action, goes away on
  its own unless it reports an error, never covers what the user is working on.
- **Progress**: determinate when the total is known, cancellable when it takes long, and it
  says what is happening.
- **Menu or context menu**: on every object that has actions; shortcuts shown beside items;
  destructive items separated.

## Media

- **Image**: correct aspect ratio, a placeholder while loading and when missing, alt text.
- **Thumbnail or cover**: consistent size and crop across the collection; a designed
  placeholder, not a blank box.
- **Player or viewer**: play state obvious, seek, time shown, volume, fullscreen, keyboard
  controls, controls that do not cover what is being watched for long.
- **Zoomable or pageable content**: fit modes, zoom by wheel and keys, position shown, first
  and last reachable.

## App shell

- **Window or page**: a title that names where the user is, a way back from every sub-view,
  size and position remembered where the platform allows, usable at the smallest and largest
  supported size.
- **Settings**: grouped, each with a plain-language description, applied immediately or with
  a clear save, and a way to return to defaults for anything risky.
- **First run**: the empty app says what it is for and offers the first action.
- **Light and dark**: both supported, or the choice to support one made on purpose.
- **Shortcuts**: discoverable — in menus, tooltips or a list.
