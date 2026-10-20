# DESIGN.md: the view's concept and system

Status: locked 2026-10-20 (D29). Replaces the broadcast/telemetry hybrid direction
(D26) as the art direction; keeps the PRNDL tokens (D27) as primitives and the
spacious-layout rule (D28). `docs/design/brief.md` holds the reference research.

## Brief

- **Subject:** a season-wide estimate of hidden 2026 F1 battery behaviour, read
  off public telemetry, and one pre-registered test that returned "no effect".
- **Audience:** engineering managers and recruiters (the owner is a final-year
  backend/cloud student looking for an internship abroad), then F1 data people.
- **Job:** make the rigour visible in ten seconds, and make a stranger want to
  click into one straight.
- **Assets:** real data from the API, driver headshots and team logos at runtime,
  circuit outlines from the API, Geist and Geist Mono (OFL), Orbitron (OFL).
- **Constraints:** derived aggregates only, never raw samples (AGENTS.md, D5/D9);
  no F1/FIA/FOM marks or typeface; non-commercial; hash routing with state in
  the query string; React 18 + Vite + Tailwind + GSAP (already in the project).
- **Not using:** ASCII-art renderings (ascii-magic). They are decoration with no
  link to the subject, and a 2024 trope; the site's texture comes from real
  traces instead.

## Three concepts considered

| | A. Read off the speed trace (material) | B. The pre-registration (process) | C. Hidden / estimated (formal) |
|---|---|---|---|
| Idea | F1 hides the battery, so everything on this site is read off the only witness: the speed trace, metre by metre down the straight | The site performs the scientific method: a question, a hypothesis frozen on a date, the test, the verdict, the failed attempts | Everything measured is drawn solid; everything estimated is drawn hatched or dashed; the hidden battery is a blank band the estimate fills in |
| Anchor | the estimator literally differentiates speed and finds where acceleration drops below 0.5 m/s² above 250 kph | HYPOTHESIS.md frozen 2026-10-18; docs/method-log.md lists the failures | "estimate under stated assumptions, never a measurement" (README) |
| Signature | one real straight drawn edge to edge; a cursor runs down it and the numbers follow; at the cut-off the colour turns | the frozen document, dated and uneditable, then the verdict stamped on it | the hatched band resolving into the estimate as you scroll |
| Screenshot | the question set huge over the running trace, cursor on the cut-off | the stamp "NO EFFECT, 18 OCT 2026" | a chart half solid, half hatched |
| O / F / Fe / P | 4 / 5 / 4 / 2 | 4 / 4 / 5 / 3 | 3 / 4 / 4 / 3 |

**Pick A.** It is the project's own method, it gives the explorer its instrument
(the same component is the landing's hero and the session page's core), and it
is not portable to any other site. Take from B the dated verdict as a detail
(the Findings header), and from C the drawing rule: estimates are hatched.

## Concept card

```
Idea:        F1 hides the battery. This site reads it the only way anyone can:
             off the speed trace, metre by metre down the straight.
Metaphor:    a measuring instrument reading a trace (a chart recorder, a cam
             follower): an instrument, never a dashboard.
Signature:   "the straight": one real straight's speed profile drawn edge to
             edge; a cursor runs down it (scroll on the landing, pointer and
             lap scrubber in the explorer); speed, acceleration, regime colour,
             the map dot and the corner readout all follow one variable, the
             distance d along the straight. Where the trace flattens, the
             colour turns and the cut-off tick lands. Recipe: driver module
             (patterns.md 1) + sticky stage hero (patterns.md 2).
Emotion:     "someone measured this carefully", with one big plain question.
Motion verb: run down the straight: fast off the line, tapering to a plateau.
             Everything enters along x (the distance axis) and decelerates;
             nothing fades up from below.
Screenshot:  the hero at the cut-off: the question at mega size, the session
             median trace running under it across the viewport, the cursor at
             the cut-off with the readout saying "plateau" and the colour
             turned from deploy to plateau.
```

The idle input: with nobody touching anything, d creeps along the straight at
walking pace and wraps; the pointer's x nudges it; scroll (landing) or the lap
scrubber (explorer) owns it when active. Off under reduced motion (cursor parked
at the cut-off: the best frame).

## Art direction system

### Palette (roles)

| Role | Value | Source |
|---|---|---|
| ground | `#0c0c11` | broadcast dark from the brief; replaces PRNDL's grey page bg (one token, `--page-bg`) |
| ground-2 (surface, curtain) | `#15151d` | PRNDL surface |
| ink | `#f7f4f1` | PRNDL text |
| muted | `#97959e` | PRNDL navy-300, AA on ground |
| line | `rgba(247,244,241,0.12)` | hairlines, axes, hatching |
| accent | `#e10600` | PRNDL/F1 red: wordmark, the cursor, focus ring, the verdict stamp. Never data |
| data | deploy `#a8f04a`, plateau `#ffd84d`, lift `#9e5bff`, brake `#ff8ae0` | the four regimes, the only other colour on the page; team colours from the API on driver rows only |

Light mode: not now (D28). The ground is one token.

### Type

- **Geist** (display and text). Display: `clamp(3rem, 1rem + 8vw, 9.5rem)`,
  leading 0.9, tracking −0.045em, optical margin −0.06em. Section: `clamp(2rem,
  1.2rem + 3vw, 4.5rem)`, tracking −0.03em. Body 17 px, leading 1.5, measure
  ≤ 62ch. UI 12–13 px, tracking 0.
- **Geist Mono** for every number, axis, readout and lap time, `tabular-nums`.
- **Orbitron** only for the wordmark, three-letter driver codes and position
  numbers in tower rows. Nowhere else (no headings, no eyebrows).
- No eyebrow label above every heading. Section labels exist only where they
  carry a real value (the straight's name, the session key, the date frozen).

### Grid and rhythm

Addendum (owner, 2026-10-20): navbar, hero parallax and spacing are ported from
the owner's own site (MonarcPulse), restyled in these tokens. This replaces the
plain bar and the 190svh sticky stage below.

- 12 columns inside a 1200 px centre column, gutter 24 px (= outer margin);
  the hero and the instrument run edge to edge; text blocks hang from column 1,
  5 or 9.
- Spacing tokens: section padding 112 px (lg 128); heading block top 40 px
  (lg 96); heading to the grid under it 32 / 48 / 80 px (base, md, lg);
  heading to paragraph 12 px (lg 16); stacked blocks 40 px (lg 64). Section
  header: h2 left, muted paragraph right, two columns from lg. A dashed
  hairline that fades at both ends (`Rule`) separates blocks where space is
  not enough.
- Chrome, desktop: a fixed 64 px bar, 1200 px row, wordmark (Orbitron) left,
  links (16 px, underline draw, aria-current) and the CTA right. Transparent
  over a hero with the links in white under mix-blend-difference; glass
  (ground at 0.78, 18 px blur) once the hero's bottom passes 64 px, and on
  every route without a hero. Phones: a floating glass pill (top 20 px,
  min(90 %, 700 px), radius 32) with a three-bar button and a drop panel
  (radius 16). Pill and panel are the two radius exceptions.
- CTA: square two-cell button, label on the accent and the arrow on ink; on
  hover the left edge clips in 4 px, the label steps 4 px along x and a second
  arrow slides in. Secondary: an outline that floods with ink.
- The one fixed data element is the bottom-right readout: d, speed and the
  regime in words in the explorer; the verdict and its date on the landing. It
  steps aside on scroll down and returns on scroll up (patterns.md 6).
- Rhythm moods: tight 32 px, normal = the section padding, airy 160 px, full
  viewport. Each landing section uses a different one.
- Radius: 0 on everything except pills (999), the mobile nav pill and panel,
  and avatars (50 %). No cards with borders and padding; sections are
  separated by one hairline or by space.

### Motion language

- Ease family: `expo.out` for entries, `expo.inOut` for the curtain, a custom
  `taper` ease (`M0,0 C0.1,0.9 0.3,1 1,1`) for anything that "runs down the
  straight".
- Entries slide along x by 24–48 px (never up), 1.0–1.3 s, stagger 40 ms.
- Page transition: the curtain is the cursor line sweeping left to right
  (0.8 s), the new page's trace draws behind it.
- Hover (one treatment per role): nav and index rows get an underline that
  draws left to right (the cursor verb); buttons fill from the pointer's side;
  table rows light their team bar and slide 4 px along x; the map's straights
  thicken and the readout jumps to them. Inline links keep an underline at rest.
- One clock: everything on `gsap.ticker`, including the anatomy figure's loop.
  No scroll listeners of our own; Lenis for smooth scroll on desktop.
- Reduced motion: no smooth scroll, no scrub, no idle creep; the cursor parks
  at the cut-off; every entry is visible at once.

### Drawing rule (from concept C)

Measured things are drawn solid (the speed trace, lap times, positions).
Estimated things are drawn with a visible construction: the cut-off is a tick
with its bootstrap interval as a bracket, medians are hatched bands, and every
estimated number carries "est." in its label. The honest banner disappears; the
drawing says it.

## Composition plan

### Landing `#/`

```
1 HERO (one viewport, 100svh, min 600 px; parallax)  family: poster + full-bleed data
  Addendum: the straight is the back layer (moves 0 to 30 % of its height over
  the hero's scroll), the copy the front layer (0 to 20 %), one ScrollTrigger
  scrub; the same progress runs the cursor, and the idle creep runs at the
  top. Hairlines: the 1200 px column's edges and centre, one horizontal at
  55.55 %. The question sits bottom-left (the hero step of the display voice,
  `--t-hero`), then 12 px, the line, 40 px, the CTA row (12 px gaps). The
  sketch below is the earlier stacked layout.
┌──────────────────────────────────────────────────────────────┐
│ WORDMARK                              Findings Explorer Method│
│                                                               │
│ Does a defender's                                             │
│ energy management                                             │
│ predict being passed?            ← display, 8 cols, col 1    │
│                                                               │
│ ───────────────────── speed trace, edge to edge ────────────  │
│      │ cursor  310 kph  0.4 m/s²                              │
│ 0 m   200   400   600   800   1,000  ┆cut-off est. 1,412 m    │
│ Monza, main straight, NOR,     No effect · frozen 18 Oct 2026 │
│ median of 52 laps (est.)       Findings →   Open the explorer →│
└──────────────────────────────────────────────────────────────┘
Scroll runs the cursor from 0 to the end of the straight; the question stays.

2 VERDICT                                      family: statement + one fact
   "No effect."  (col 1–8, section size)        FROZEN 18 OCT 2026 (col 9–12)
   An earlier cut-off did not predict being passed...
   0.92 ───┼───  odds ratio with its 0.81–1.04 interval drawn as a real bracket
   caveat in muted, col 9–12

3 HOW IT IS READ                               family: sticky narrative
   The hero's trace is pinned at a smaller size (col 5–12) while three short
   chapters scroll past it (col 1–4), each lighting one thing on the trace:
   the slope is acceleration; the 0.5 m/s² threshold; the four ticks above
   250 kph where the cut-off lands. Same component, same driver variable.

4 THE SEASON                                   family: index list
   One row per session: circuit, date, type, median cut-off on its main
   straight (est.), drivers with a cut, and the row's own small trace (the
   session median profile) drawn in the line colour. Hover: the row's trace
   lights up and its cursor runs; no floating image. Click: the session page.

5 THE RECORD                                   family: data strip (full viewport)
   The method log as ticks on one long axis: pass, fail, not demonstrated;
   the first estimator crossed out. The most original section, so it gets the
   most room. Click: the method log.

6 FOOTER FINALE
   "Estimates from public telemetry. Never measured battery data." at section
   size; credits (OpenF1, headshots, logos, PRNDL, anatomy) small; not affiliated.
```

### Session page `#/session/:key`

```
┌ WORDMARK                                  Findings Explorer Method ┐
│ MONZA  Race, 6 Sept 2026                 [NOR ▾]  vs  [RUS ▾]      │  display name, col 1
│                                                                     │
│ MAP (col 1–7, full height)       THE STRAIGHT (col 8–12)           │
│  outline with straights as        speed profile for the selected    │
│  thick segments, regimes along    straight and lap, cursor shared   │
│  the line, cut-off ticks          with the map dot, readout         │
│                                                                     │
│ LAP SCRUBBER as the distance axis across all 12 cols                │
├─────────────────────────────────────────────────────────────────────┤
│ CUT-OFF BY LAP (chart, col 1–12, airy)                              │
│ MEDIAN CUT-OFF PER STRAIGHT (tower rows, col 1–12)                  │
│ Monza, lap 40 (BL)                         1,412 m  298 kph (BR)    │
```

The straight component is the hero's component. No cards.

### Sessions `#/sessions`: the landing's index, full, grouped by meeting.
### Findings `#/findings`: the document. Dated verdict stamp in accent; the
three charts redrawn in the system (brackets, hatching); the driver quotes as
plain pulled quotes with headshot and team bar; limits as a list.
### Method log `#/method`: the record strip at full size, entries below, and
Fig. 1 (anatomy, optional scope, built last): a carriage rides a rail (distance
down the straight); its follower rides a cam plate cut to the session median
speed profile; a dial gauge reads the follower's slope (acceleration); when the
needle stays under 0.5 for four ticks above 250 kph, a pawl drops and marks the
cut-off on the ruler. It explains the detector; the hero is the signature, so
the figure lives here and not on the landing.
### Live `#/live`: the map as hero, driver tags, tower on the right.
### 404: the trace ends; "No data beyond this point." and the way back.

## Genericness test

A generic model given this brief lands on: dark SaaS dashboard, left-aligned
hero with an eyebrow, three cards, stat row, yellow banner, charts in boxes.
That is the current site. Changed: the hero is the data itself; cards and the
banner are gone; the drawing rule replaces the disclaimer; the four-corner
frame; one instrument reused on every page; the index rows draw their own
trace instead of a floating image; the record strip; type at mega size with
negative tracking; motion along x only.

## Data the concept needs (D30)

D9 allows regime labels at coarse distance bins and forbids raw speed samples.
At 3.7 Hz a car covers 20–25 m between samples, so a per-lap profile at 10 m
would be the raw trace with a different name. The site therefore uses a
**cross-lap aggregate at the regime-bin resolution**: per driver and per
straight, the median speed over all clean laps in the session per 50 m bin
(whole kph) and the median of the per-lap mean acceleration per bin, stored as
`speed_bin_<n>` and `accel_bin_<n>` variables on lap 0 of the model run, next
to the regime bins, and served by `GET /sessions/{key}/straights/{s}/profile?driver=`.
Nothing is committed under `src/content`; the landing fetches it at runtime
and shows a drawn skeleton of the axis while it loads. The hero label names it:
"Monza, main straight, NOR, median of 52 laps (est.)". The explorer's per-lap
view keeps the regime bins and the per-lap cut-off tick; no per-lap profile
endpoint is built.

## Build order

0. D29/D30 recorded; model script writes the profile variables; backend PR
   adds the endpoint.
1. Tokens, shell, routing with Lenis on the GSAP ticker, the straight
   component with a fixture. A critic looks at the straight before anything
   is built on it.
2. In parallel: the landing; the session page; findings, sessions and 404.
3. Last: the method page with Fig. 1, the live page.
4. A fresh critic after every round; QA on a production build.

## Build rules the review added

- Same-page anchors scroll with `lenis.scrollTo`, never `href="#..."`, because
  the hash is the router. On every route change: scroll to top, and
  `ScrollTrigger.refresh()` once the page's data has arrived.
- Lenis runs from `gsap.ticker` with lag smoothing off: one clock.
- The straight is a pure function of d and its data; each page owns its input
  (scroll, scrubber, pointer). No trigger survives a route change.
- The trace is one static SVG path; only the cursor and the readout move, with
  transforms. Text updates on bin changes, not per frame. On touch devices: no
  Lenis, no idle creep. The ticker pauses when the instrument is off screen.
- Reduced motion covers the curtain and the hover slides too. The page must
  read with JS loaded and data missing.
