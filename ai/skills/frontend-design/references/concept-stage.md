# Concept Stage Reference

Read this when entering SKILL.md workflow step 3 (Concept & Direction Commit): no-reference work, or a redesign that materially changes an existing surface's visual direction. SKILL.md owns the obligations; this file owns the how.

## Candidate Positions

Draft 2-3 candidates spanning distinct positions — never variations of one safe idea:

- **Safe read**: the direction a competent designer would expect for this product. Include it to anchor comparison, not to default to it.
- **Sharp read**: a bold interpretation of the SAME job — push one dimension (palette character, type voice, density rhythm) far enough to be memorable while every floor holds.
- **Borrowed read**: name an unexpected domain whose job resembles this product's (instrument panels, print editorial, transit maps, field notebooks, game HUDs) and borrow one STRUCTURAL idea from it. Borrow structure, not costume.

Divergence test: if swapping two candidates' palettes would make them interchangeable, they are one idea in different coats — redraft.

## Candidate Anatomy

Each candidate names, in one line each:

- Personality: the character ("calm clinical utility", "warm editorial confidence", "high-energy arcade").
- Palette character: the role structure AND its character ("ink-on-paper warm neutrals with one saturated signal" versus "near-black surfaces with one electric accent") — never an evenly-spread timid palette.
- Type voice: display and body intent with a point of view, not a default UI font by reflex.
- Design tension: one dominant + one counterpoint ("monochrome austerity + one saturated signal color in exactly three places"). The tension is the kick generator — without a counterpoint the direction flattens into wallpaper.
- Signature moment: the ONE memorable element serving the job (a satisfying completion motion, a distinctive data-viz treatment, an inspired empty state). Functional and subtle counts.
- One convention it breaks, and why the job tolerates it.
- Job closure: the requested action and how success/recovery remain obvious in this direction. A visually stronger candidate that weakens the requested action is not viable.

Motion and shape/space character follow from the concept within the surface's motion budget and density rules.

## Render Spec (owner-taste gate)

- ONE representative screen per candidate: same markup and realistic content, different tokens (palette, type, radius, density). Never a full app per candidate.
- One desktop screenshot per variant; fixed canvas for Presentation/Deck.
- Realistic content only — taste judgment is invalid on lorem ipsum.
- Label each variant: `Art direction: <concept> — <why it fits>`.
- For a direction-changing redesign, one variant is "keep & refine the current direction".

## Pick Flow

1. Present the variants together with the candidate record (use a structured selection mechanism when the tool has one; otherwise a plain question).
2. Owner picks — tweak requests are part of the pick. Commit the picked concept; discard the rest.
3. Owner answers "you choose" → switch to the autonomous path (sharpest survivor).
4. Rendering infeasible → say so and gate on text concepts explicitly marked "direction chosen without render". Never silently go autonomous.

## UX Opportunity Pass Method

Trigger and output obligations live in SKILL.md step 4. Method:

1. Capture the existing surface first (reconnaissance as usual).
2. Run the UX Audit method (SKILL.md) once: lens = accessibility floor → existing approved contract or captured system → craft-defaults surface profile. Look for friction AND missed opportunities against the surface job.
3. Rank findings by user-job impact; keep the top 2-4. Missing flows, workflow shortcuts, missing states, and recovery paths outrank cosmetic rearrangement.
4. Write each as `[proposed]` in the contract's UX Model with a one-line impact. The owner accepts or rejects at contract review — never silently implement them.
