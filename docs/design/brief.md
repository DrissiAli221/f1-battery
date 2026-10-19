# Frontend rebuild: design brief (draft, 2026-10-19)

Status: preparation. No code until the direction is chosen.

## What the reference set says

Twenty references were reviewed: F1 broadcast graphics (timing towers,
starting grid, race-finished table, flag states, fastest-lap cards), F1
official livery and poster art, f1tel.com telemetry pages, a Pirelli circuit
preview, a race lap chart, driver-swap and team-results infographics, a
Figma F1 card set, a telemetry concept with driver tags on a track map, team
radio quote cards, and one generic SaaS dashboard. The pitlane Framer site
sets the navbar language.

**The vibe, in one line:** broadcast-graphics clarity on a near-black
canvas, with F1 red as the single hot accent, team colours as data, condensed
uppercase type for labels and big tabular numbers for values, and the track
map treated as a hero object with neon-segmented lines, numbered corners and
driver tags, not as a widget in a card.

### Recurring elements, and where they map onto our pages

| Reference element | What it does there | Where it goes here |
|---|---|---|
| Neon track map, segmented by speed/sector, numbered corners, S/F marker, compass | f1tel.com, Pirelli preview, telemetry concept | The session view hero: outline with straights as named segments, regimes as colour along the line, the live replay with driver tags on the map |
| Timing tower rows: position, team-colour bar, 3-letter code, tabular numbers, delta colouring (green faster, purple best, yellow) | Broadcast tower, race-finished table, starting grid | Session summary table (median cut-off per straight, intervals), compare view, sessions list |
| Status pills with semantic colour: safety car yellow, red flag, green flag, fastest-lap purple | Flag-state cards, Figma card set | Lap quality (green / neutralised / pit / excluded), result pills ("no effect", "fail", "pass"), replay status |
| Team-colour vertical bar at the row's left edge | Everywhere | Every driver row and every driver tag; the five regime colours stay separate from team colours |
| Lap chart (bump chart) with thick team-coloured lines | F1 race lap chart | Cut-off per lap chart restyled: thick line, dots, median band; a season bump chart of cut-off ranks per maker (Findings) |
| Skewed/angled card edges and livery stripes, diagonal cuts | Livery strip collage, banner set | Section headers and the landing hero only; never on data tables (legibility) |
| Driver "radio" quote cards: name + team wordmark, waveform bar, quote in bold uppercase | Team-radio collage | The Findings page's driver-quotes section (Norris, Alonso, Verstappen, Ocon), as evidence the paddock believes the hypothesis |
| Light poster mode: F1 red sweeping track curves on off-white, one car, small caption type | Red Bull poster, F1 interaction poster | Landing hero in light theme; the dark theme uses the same curves in red on near-black |
| Team results heat grid, driver-swap ribbons | Infographics | Season overview: sessions × makers grid of median cut-off; optional |
| Sidebar SaaS dashboard with gauges | The one generic reference | **Avoid.** Gauges and sidebars are the "AI dashboard" look the rebuild must not have |

### Palette (proposal, to validate for contrast)

- Canvas dark: #0B0B10 to #15151E (F1 broadcast dark). Surface: #1E1E28. Lines: #2A2A36.
- Canvas light: #F7F5F2 off-white (poster mode). Surface: #FFFFFF. Lines: #E6E2DC.
- Accent: F1 red #E10600 (used sparingly: brand, active state, the hero curves). Never for data.
- Data semantics: regime deploy #3FD0B0, plateau #F2C94C, lift #9B8CFF, brake #FF5A5F, other #6B7280; sector semantics purple #B255FF (best), green #2ECC71 (improvement), yellow #FFD60A (slower).
- Team colours as data (2026 grid): Mercedes #27F4D2, Ferrari #E80020, McLaren #FF8000, Red Bull #3671C6, Racing Bulls #6692FF, Aston Martin #229971, Alpine #0093CC, Williams #64C4FF, Haas #B6BABD, Audi #9DFF00 (placeholder until verified), Cadillac #D4AF37 (placeholder). Verify each against the official 2026 palette before use.

### Type

- Display and labels: a condensed, wide-set geometric sans in uppercase for
  headers, 3-letter codes and pills. Numbers tabular.
- Body: a clean humanist sans at 15–16 px, generous line height, for the
  findings and method log.
- Font choice depends on the licence check (see "Fonts" below).

### Layout rules

- Full-bleed hero per page; content on a 12-column grid, max width 1280 px;
  16 px gutters on phones.
- Track map takes the full content width on the session page, with the
  straight selector drawn on the map itself (clickable segments), the chart
  below it, the table below that. No three-column card grid.
- Tables: zebra-free, 44 px rows, left team bar, right-aligned tabular
  numbers, sticky header.
- Pills: 24 px, uppercase, 11–12 px, semantic colour as background with
  dark text, or outlined on dark.
- Motion: one entrance per page (hero curves draw in), segment hover on the
  map, number count-up on stat tiles. Nothing else.

### Pages and what each must show

1. **Landing:** the question in one line, the hidden-data fact, the result
   in one sentence with its caveat, three entry points (Findings, Explorer,
   Method log), the honest banner.
2. **Findings:** designed version of docs/findings.md: headline result as a
   stat row, the frozen test tables, the spot checks as pills, the driver
   quotes as radio cards, the power-unit comparison as a bump chart, limits.
3. **Explorer:** sessions as timing-tower rows grouped by meeting; session
   view as described; compare as two columns with a shared chart.
4. **Method log:** timeline with the figure, status pills per entry
   (pass / fail / not demonstrated / explained).
5. **Live replay:** the map as hero with driver tags, a tower on the side.

### Open decisions for the owner
- Dark-first with a poster-style light mode, or dark only.
- Tailwind or CSS variables (the current build is CSS variables).
- Charts: keep hand-written SVG or adopt visx for the bump chart and the
  cut-off chart.
- Project wordmark.

## Fonts

- The official Formula 1 typeface (Formula1, Formula1Wide, Formula1Digits,
  loaded from formula1.com's own server; designed by Marc Rouault for the
  2018 identity) is proprietary with no public licence. It is not used and
  not committed, non-commercial use included. Unofficial recreations have
  unknown licences and are also out.
- Chosen stack, all under the SIL Open Font License on Google Fonts:
  - **Display and labels: Saira** (wide, squared, the closest free match to
    broadcast caps), weights 600–800, uppercase, letter-spacing +0.04 em.
  - **Body: Titillium Web** (formula1.com itself loads it alongside its
    proprietary faces, so it reads as "F1" without being F1), 400/600.
  - **Numbers: Titillium Web with `font-variant-numeric: tabular-nums`**;
    JetBrains Mono for lap times and gaps where alignment matters most.
- Alternatives considered: Barlow / Barlow Condensed (softer), Exo 2 and
  Chakra Petch (more sci-fi than broadcast), Michroma and Orbitron (titles
  only, too wide for labels), Rajdhani (dashboard-like, lighter).

## Navbar and page chrome from the pitlane reference

Observed on getpitlane.framer.website (HTML fetched 2026-10-19):
- A plain black-on-white (and white-on-black) palette with one red accent
  (#e82b1f) and a blue link colour; no gradients, no shadows beyond a 1 px
  inset ring; corner radius 40 px for pills and 50 % for avatars, 0
  elsewhere. Headings in Inter Display, code in JetBrains Mono.
- Navbar: logo left, a row of short text links, one filled pill CTA on the
  right ("Get Started"). Sections: hero with an uppercase eyebrow label,
  stats row, feature cards, product, use cases, testimonials, pricing, FAQ,
  closing CTA, footer. Entrance animations only (Framer appear, ~1–2 s with
  an ease-out curve), no decorative motion.
- What we take: the navbar shape (logo, text links, one pill CTA), the
  uppercase eyebrow labels over headings, the stats row pattern for the
  landing, the restraint (one accent, flat surfaces, large radius on pills
  only), and the entrance-only motion.
- What we don't: the SaaS section list (pricing, testimonials, FAQ) and the
  white default; our canvas is the broadcast dark with a poster-style light
  mode.

Navbar spec: 64 px, sticky, canvas colour at 85 % with backdrop blur,
1 px bottom line; left: wordmark in Saira 700; centre/right: Findings,
Explorer, Method log, Live; far right: theme toggle and one pill CTA
("Open the explorer" on the landing, "Sessions" elsewhere). Collapses to
a sheet menu under 720 px.
