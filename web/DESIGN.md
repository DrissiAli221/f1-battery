# DESIGN.md: the view's system

Status: v3, 2026-10-20 (D32). Replaces the "instrument" art direction (D29). The
owner's references for this version: f1tel.com track maps and telemetry
charts, the "F1 Telemetry Concept" broadcast timing tower and track map with
driver tags, the F1 app's dark surfaces. The navbar and the hero parallax stay
as ported from the owner's MonarcPulse site (D29 addendum).

## What was wrong with v2

Looking at the built pages on 2026-10-20: a flat black canvas with text on it,
hairline charts and a hairline track, one SVG isometric figure that reads as a
toy, and a wordmark nobody asked for. Nothing on the page says "F1" except the
hero photo. Proportions were off: display type at 9.5 rem next to 12 px mono
captions, 160 px gaps between sections with nothing in them.

## Direction

**A broadcast product, not an instrument.** Every data view is drawn the way
the TV graphics and the better telemetry sites draw it:

- The **track** is a road: a wide light-grey edge under a dark asphalt body,
  round caps and joins, corner numbers in circles on the outside of each bend,
  a start/finish marker, a compass. Colour runs inside the road (regimes, the
  selected straight, a car's trail), never as the road itself.
- **Drivers** are tags: a team-colour chip with the three-letter code, a dot on
  the line and a short leader. Headshots in rows, not on the map.
- **Numbers** are big and tabular. Sector colours (purple, green, yellow) mean
  what they mean on TV: best, improved, slower.
- **Surfaces** exist. The page is deep black; content sits on raised dark cards
  (#15151e family) with 1 px hairlines and 12-16 px radii. Photos fade into the
  ground with gradient scrims. No flat black-with-text sections.
- **Red** is the brand accent only: wordmark slash, active tab, CTA, focus.

## Tokens (src/styles/tokens.css)

Palette, dark only:

| Role | Value |
|---|---|
| ground | `#030303` |
| surface-1 (card) | `#111115` |
| surface-2 (raised, header rows) | `#15151e` |
| surface-3 (chips, inputs, tooltips) | `#1f1f27` |
| line / line-2 | `rgba(255,255,255,.08)` / `.14` |
| ink / muted / faint | `#f4f4f6` / `#a0a0aa` / `#6e6e78` |
| accent red | `#e10600`, deep `#b30500` |
| sector best / improved / slower | `#b55bff` / `#2fd36e` / `#ffd400` |
| tyre soft / medium / hard / inter / wet | `#ff3b30` / `#ffd400` / `#f0f0f0` / `#3ac65b` / `#2b7bff` |
| regime deploy / plateau / lift / brake | `#19e68c` / `#ffd400` / `#8a6cff` / `#ff4d6d` |
| road edge / body | `#44444e` / `#17171c` |

Team colours come from the API at runtime, never tokens.

Type: Geist for everything readable, Geist Mono for every number and axis,
**Titillium Web** (OFL; formula1.com's face for a decade) 700-900 uppercase
for the wordmark, labels, tabs, corner numbers, driver codes and position
numbers. Orbitron is gone.

Scale: display `clamp(2.6rem, 1rem + 4.8vw, 5.6rem)`, section
`clamp(1.8rem, 1rem + 2.4vw, 3.2rem)`, body 16 px, ui 13 px, label 11 px
tracking 0.08em. Big numbers (stat tiles) 40-64 px mono, weight 500.

Radius: card 16, panel 12, chip 6, pill 999. Shadows: none, except the
floating tooltip and the mobile nav pill.

Spacing: section 96 px (lg 120), container 1240 px, gutter 24. Cards pad 20/24.

## Components (src/components)

- `Card` (surface-1, hairline, radius 16) and `Panel` (surface-2 inset).
- `Tabs` (broadcast tabs: uppercase Titillium, active underline in red).
- `Chip` (team tag), `Pill` (status: pass/fail/green/pit/live), `Stat` (big
  number with label and unit), `Flag` (country flag from flagcdn by ISO code).
  No tyre component: the API has no stint data.
- `SessionHeader`: flag, "Italian Grand Prix" over "Autodromo Nazionale
  Monza", type, laps, date, as in the concept's tower header.
- `TrackMap` (src/track/TrackMap.tsx, shared by the explorer, live and the
  landing): the road drawn from the MultiViewer centreline (D32), official
  corner numbers, S/F chequer, compass, scale, pickable straights, regime
  runs, cut-off ticks with brackets, driver tags (team chips with a dot and a
  leader; an imperative `place()` for live feeds); entrance is a fade, no
  draw-in. `src/track/circuits.ts` loads the per-circuit reference and names.
- `SpeedChart` (src/instrument/SpeedChart.tsx): f1tel-style chart of one
  straight: grid in line colour, speed and distance axes in mono, the
  cut-off tick, one trace per driver, a regime strip under the axis, a
  cursor with a tooltip card. Always a per-straight median of clean laps in
  50 m bins (D30), never a single lap.
- `Tower` (src/components/Tower.tsx): the broadcast table (position, team
  bar, headshot, code, name, page-defined mono columns). Tones (best, good,
  warn) only where the TV meaning is true; estimates stay neutral.
- `SessionHeader`: flag, Grand Prix, circuit and country, session facts.

## Pages

1. **Landing.** Hero photo with scrim and the question (kept). Then "Last
   race" card: session header, the track map full width with every driver's
   median cut-off as a tag and the main straight lit, an 8-row tower beside it.
   Then the verdict as four stat tiles and one sentence. Then the season as
   session cards in a grid (flag, round, circuit silhouette from the outline,
   date, median cut-off). Then a short "how it is read" with the telemetry
   chart. Footer.
2. **Sessions.** The same cards, grouped by round, with filters as tabs.
3. **Session.** Session header card; tabs Track map / Straight / Cut-off by
   lap / Timing (a sticky sub-nav that scrolls). Stage: map (8 columns) and
   the straight panel with the speed chart (4 columns) sharing the cursor;
   below, the cut-off by lap chart and the timing table (position, team
   bar, headshot, code, name, one column per straight in metres with the
   interval, regime share bar; no sector colours on estimates).
4. **Live.** The same map with moving tags (the concept image), the tower as a
   card on the right with position, code, gap, regime pill.
5. **Findings.** Stat row, quotes as cards (headshot, team chip), the charts
   on cards with the shared grid style, spot checks as rows with pass/fail
   pills.
6. **Method.** The record strip in a card, entries as cards in one reading
   column. The isometric bench figure is removed.

## Motion

Lenis smooth scroll, the hero parallax, the nav transparent-to-glass toggle
(all from MonarcPulse). Entrances: opacity and 12 px y, 0.5 s, expo.out,
once. Tags ease on the ticker. No DrawSVG, no curtain page transition, no idle
cursor creep. Reduced motion: nothing moves.
