# Media

Read the section for the surface's medium. Each says what the medium fixes (behaviour to
respect), what it leaves free (the look), how to capture a render, and where good references
live. When the substrate and the product differ, the product wins: an Electron or Tauri app
draws with web technology but is a desktop app.

Find the **host ceiling** before designing: list what this toolkit, engine or host cannot
draw or will not let you set. Design inside it, and tell the owner when it rules out what
they asked for.

Rules that hold in every medium:

- Text stays readable against its background; state is never carried by colour alone.
- Everything operable is reachable with the medium's input devices; focus is visible.
- Meaning survives without motion, and motion respects the system's reduce-motion setting.
- Korean breaks at 어절 boundaries; Chinese and Japanese follow their own line-breaking
  rules; long unbroken strings never overflow their container.
- A render that was produced but not looked at is not evidence of anything.

## Web

- **Fixed by the medium**: semantic structure and accessible names, keyboard operation,
  visible focus, contrast (4.5:1 text, 3:1 large text and essential graphics), targets around
  44px on touch, reduced-motion support, working from the narrowest to the widest supported
  width, and the user's text-size setting.
- **Free**: everything visual. Choose typefaces deliberately and load them; the system font
  stack is a choice only when it is the reference's choice.
- **Capture**: a browser at the narrowest and widest supported widths, light and dark.
- **Measure**: `scripts/measure-dom.js` in the page.
- **References**: the live products themselves — you can read their styles directly; design
  galleries and reference libraries for whole-page captures.
- **If a web-page design skill is installed**, it may drive a marketing or content page.

## Desktop

Applies to every desktop toolkit and platform: Windows, macOS, Linux; native toolkits and
web-based shells alike.

- **Fixed by the medium**: the platform's behaviour — standard shortcuts, menu placement and
  window controls, button order in dialogs, the accessibility API with roles and names, the
  system's focus, contrast and reduce-motion settings, resizing, display scaling, and
  whatever window sizes the user or a tiling window manager imposes.
- **Free**: the look. Colour, type, radius, spacing, depth and icon style belong to the app.
  A custom palette or a brand typeface is how well-made desktop apps distinguish themselves;
  it is not a violation of the platform. On platforms with no single native look, an app
  with its own coherent look is the only sensible target.
- **Avoid**: a web page dropped in a window (scrolling landing layout, no menus or
  shortcuts), and a window far larger than its content. Size the window to what it shows.
- **Capture**: a real build, at the smallest and largest supported window size, at 100% and
  a scaled display setting, in each supported theme. When a build cannot be produced yet, a
  mock labelled as a mock may be used to choose a direction but never to claim a result.
- **Measure**: the platform's accessibility tree — `scripts/measure-uia.ps1` on Windows; the
  toolkit's inspector elsewhere. Custom-drawn surfaces may expose nothing; say so and rely
  on tiles.
- **References**: shipping apps of the same kind — their sites, store listings, press kits
  and repositories carry full-size screenshots.
- **Toolkit skills**: when one is installed for the toolkit (for example a WinUI skill), load
  it before writing UI code and use its pitfalls and anti-pattern list as review checks.

## Mobile

- **Fixed by the medium**: platform navigation and gestures (back, swipe, pull), safe areas,
  the on-screen keyboard, touch targets (about 44pt / 48dp), dynamic text size, the
  accessibility API, orientation and size classes.
- **Free**: the look, within what the platform's components can be themed to.
- **Capture**: a simulator or device at the smallest and largest supported sizes, in each
  theme, with the largest text setting.
- **References**: shipping apps of the same kind; app-screen libraries.

## Terminal UI

- **Fixed by the medium**: a grid of cells; one monospace size; keyboard first, with every
  action bound and discoverable (a key bar or help); reading order is output order; Hangul
  and most CJK take two cells, and many symbols are one cell or two depending on the user's
  ambiguous-width setting — compute widths or keep to glyphs that are safe either way.
- **Free**: far more than a list with labels. Modern terminal apps use full colour with a
  16-colour fallback, borders and panels, rounded box glyphs, gradients across text or rules,
  bars and sparklines, spinners and animated progress, and layout that reflows with the
  window. Use what the references use.
- **Check the host first**: a pane inside another program (an editor, an agent host) may
  allow only its own theme keys and components. Find that ceiling before promising a look.
- **Respect the user's theme**: use semantic colour slots for meaning so a custom theme
  stays legible; add richer colour where the terminal supports it and degrade cleanly where
  it does not. Never signal state by colour alone — pair it with a glyph or word.
- **Capture**: actually run it, at the narrowest and a comfortable width and height, and
  capture real output. A hand-drawn text mock or an HTML imitation is a sketch for choosing
  between structures, never the render.
- **References**: well-known terminal apps of the same kind, and the showcase galleries of
  the terminal UI libraries for the language in use.
- **Libraries**: use the established terminal UI library for the language rather than
  hand-placing escape codes.

## Command-line output

- **Fixed**: it is read both on a terminal and through a pipe. Colour and decoration only on
  a terminal and never when disabled by the environment; piped output stays plain and
  stable; errors go to the error stream; widths are not assumed.
- **Free**: alignment, grouping, restrained colour for meaning, progress on a terminal.
- **Capture**: the same command on a terminal and piped to a file.

## Deck

- **Fixed**: one idea per slide, legible from the back of the room, a fixed canvas that
  scales as a whole, speaker notes for what is said rather than shown.
- **Free**: everything visual. One typeface family and one accent used consistently beats
  variety.
- **Capture**: each slide at full size, and all slides as thumbnails to check rhythm.

## Print and documents

- **Fixed**: physical page size and margins, readable body size, page breaks that do not
  strand headings, legibility in greyscale.
- **Capture**: the rendered pages, including the first, a dense one, and the last.
