# Materials

Collect these before deciding anything visual. The surface is assembled from them; it is not
invented and then decorated.

## References

A reference is a real, shipping product that does the same kind of job in the same medium and
is widely regarded as well made. Not a mood, not an adjective, not a design-system doc page.

**Find at least three.** Use whatever the session has: web search, a browser, a
reference-library tool or connector if one is installed, the product's own site, store page,
press kit or repository README. Good places to look by medium are listed in `media.md`.

- Match the **job** first (a manga reader studies readers; a link-and-play video tool studies
  players and launchers), then the medium (a desktop window studies desktop windows, not web
  pages).
- When the owner named or showed a product, it is the first reference. It tells you their
  taste more reliably than anything they wrote.
- When the owner has other apps of their own, look at them too: they are the sibling products
  this one should feel related to, and the source of features they will assume exist.
- Make the three differ from each other in structure, so the choice between them is real.

**Capture them.** Save screenshots under `.agents/design/refs/` in the project, named for the
product and the screen, at the largest size you can get. For a live web product, capture it
yourself at the widths that matter. Record the URL each came from. A reference you only read
about is not a reference.

**Read each one for what it actually does**, at the level you can carry over:

- Layout: what occupies the window, in what proportions, and what is absent.
- Palette: the actual colours — background layers, text levels, accent, borders. Sample them
  from the screenshot or read them from the page's styles.
- Type: families, the sizes in use, the weights, how many levels there are.
- Shape and depth: corner radii, borders versus shadows, how surfaces are separated.
- Density and rhythm: row heights, padding, the gaps that repeat.
- Icons and imagery: outline or filled, stroke weight, where imagery appears and how big.
- Motion, where you can observe it.
- The one or two things that make it feel finished rather than assembled.

Write those down as values. "Calm, restrained borders" is what a reference turns into when it
has been thrown away; `#0f1115` background, 1px `#ffffff14` separators, 13/20 body, 8px radius
is what it turns into when it has been kept.

**What you may carry and what you may not.** Carry look and structure: palette relationships,
type scale, spacing, component shapes, layout patterns. Do not carry logos, product names,
brand marks, proprietary illustrations, icon sets whose licence does not allow reuse, or a
signature screen reproduced whole. The result should be recognisably of that quality and
family, and recognisably its own product.

## Design system or component library

When the project already has components and tokens, they are the system: use them, and only
extend them.

When it has none and the stack has a mature library, adopt one rather than drawing buttons
and dialogs by hand. A library brings states, keyboard behaviour, accessibility and a
coherent look for free; hand-built controls are where missing hover states and broken focus
come from.

How to choose:

1. Find what the stack offers. Check the toolkit's own first-party components, then the
   well-known community libraries for it. Look this up — do not rely on memory for what is
   current or how it is installed.
2. Check the **licence and terms** before using anything: some systems are open (MIT,
   Apache), some are published for reading but licensed only for the vendor's own platform.
   A system you may not use is still a legitimate visual reference.
3. Prefer the one whose default look is closest to the chosen direction, and that lets you
   set its tokens (colour, radius, type, density) to the reference's values.
4. Record the choice, version and licence in the contract's Implementation Bridge.

When nothing suitable exists for the toolkit, say so, and build the few components the
surface needs as a small consistent set — one definition per component, reused everywhere.

## Assets

List every non-text visual the surface needs before building, in the contract:

| Asset | Where it appears | Size(s) | Source |
| --- | --- | --- | --- |

Typical rows: app icon, window or favicon sizes, navigation and action icons, status glyphs,
empty-state illustration, placeholder for missing media, loading indicator, logo mark.

Sources, in order of preference:

1. **An existing icon set** for interface icons — one set for the whole surface, so grid,
   stroke and optical size agree. Check its licence. Never mix sets, and never stand in font
   glyphs, emoji or text characters for icons: they sit on a different baseline and it shows.
2. **Draw it yourself as vector** when it is geometric: marks, simple illustrations,
   patterns, diagrams, placeholders. Then *render it and look at it* at the sizes it will be
   used at, fix what is off, and render again. An asset that was written but never rendered
   is not finished; small sizes are where vector marks fall apart.
3. **Generate it** with an image-generation tool when the session has one, for anything
   textured, illustrative or photographic — an app icon with depth, an empty-state scene.
   Give it the chosen reference and palette as the brief, generate, look at the result at
   target sizes, and iterate. When this session has no such tool but another available
   session does, ask that session for it with the same brief.
4. **Ask the owner** only for what none of the above can make: their own logo, photographs,
   licensed artwork.

A surface that ships with an empty state made of grey text, a default toolkit app icon, or
letter glyphs as buttons is not finished. Those are the first things an owner notices.
