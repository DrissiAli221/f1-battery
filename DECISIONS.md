# Decision log

One entry per decision: date, what was chosen, why, what was rejected.
Ali owns this file. Agents propose entries, Ali confirms them.

## D1 — 2026-10-17 — Topic: estimate the hidden 2026 battery state
- **Why:** F1 hides ERS data in 2026 (FastF1 #861, confirmed 2026-10-17; a
  battery graphic appeared on the broadcast early in the season and was then
  dropped). The FIA rules constrain deploy power by speed. It's measurable
  against overtakes.
- **Prior work (corrected 2026-10-17, see D7):** not thin, but small and
  fragmented. Closest: rahul2006malik/Energymind (physics-informed HMM, all 22
  drivers, per race, models an attacker/defender "counter-harvest" game),
  rhianarnold/F1-Belgium-2026-Energy-Analysis (Markov-switching regimes, Spa
  qualifying), Tiwari1782/SPARC (SoC estimate, in development), a Modena
  thesis reconstructing MGU-K deployment from GPS telemetry, a Kaggle China GP
  analysis linked in FastF1 #861, The Overcut substack, and about ten 0–2-star
  simulators/visualisers. **None found is season-wide, engineered as a
  pipeline, or validated against an observable outcome.** Those three are the
  differentiators, not novelty of the idea.
- **Rejected:** race replay (heavily cloned), winner prediction (heavily cloned),
  pit-strategy simulator (already done), team-radio AI (2026 radio mostly
  missing), stewarding dataset (less fun, scraping terms unclear).
- Evidence: docs/research-2026-10-17.md.

## D2 — 2026-10-17 — Feasibility spike before infrastructure
- **Why:** 3.7 Hz integer-kph speed makes acceleration noisy. Total power can't
  be split exactly into engine and electric without an assumed engine curve.
  Mass and fuel burn are unknown. Coasting may include recharge. The
  active-aero mode is not published either and shifts the drag baseline. If
  the signal isn't visible, infrastructure built first would be wasted.
- **If the spike fails:** output becomes an "energy-management proxy" (regimes only).

## D3 — 2026-10-17 — Architecture
- Java 21 Spring Boot ingestion → Postgres + TimescaleDB → Python batch model →
  Java REST API → small web view.
- **Why:** backend Java is the main profile. The Python part (numerical work)
  gives real Python contact. Time-series volume (~9M rows for race car_data
  alone) justifies Timescale.

## D4 — 2026-10-17 — One versioned results table between Python and Java
- **Why:** the Java side never needs to understand modelling internals. Model
  versions can be compared.

## D5 — 2026-10-17 — Data terms
- OpenF1 says it is "intended for educational purposes, personal learning
  projects, research, and non-commercial fan engagement". It is not affiliated
  with F1/FIA/FOM and doesn't claim ownership of F1 data. Site content is
  CC BY-NC-SA 4.0. Checked on openf1.org 2026-10-17.
- **Decision:** raw and derived data stay local and are never committed. A
  public deploy shows aggregates or a recorded demo only. Credit OpenF1 with a link.

## D6 — 2026-10-17 — Limits come from a per-event regulation table
- **Why:** the rules changed during the season (April 2026 package applied
  from Miami; Issue 20 is dated 2026-08-05). Each race must use the limits in
  force at that event. See docs/regulations.md.

## D7 — 2026-10-17 — Changes from the second independent review
- **Review:** Claude (Fable 5.1) with three fact-checking sub-agents; FIA
  Section C Issues 16–20 and Section B Issue 09 read from the PDFs, openf1.org
  terms and five rate-limited API calls, GitHub search for prior art.
- **Verdict:** go with changes. All C5.2.x numbers in docs/regulations.md
  confirmed verbatim.
- **Corrections applied:** Miami ran under Issue 17, not 18; the Issue 20
  qualifying recharge floor is 4 MJ (redline "5 4MJ"); C5.12.4–7 conditions
  added; per-event limits are FIA notices to teams (B7.2.1b), not public, so
  code carries a `limit_known` flag; the 350 kW super-clip recharge figure is
  cited to The Race, not C5.2.x; `session_type=Race` includes sprints; session
  11731 is the Bahrain GP relocated to Kuala Lumpur, a real race (first
  flagged as bad data, corrected the same day after checking meeting 1308);
  `overtakes` has no reason field.
- **Plan changes:** Phase S exit conditions now have numbers (slope break in
  290–345 kph vs a drag-only fit; clip segments on ≥ 80 % of green-flag laps
  within ±50 m; ≥ 80 % lap-to-lap regime agreement) and PU-maker differences
  are a finding, not a gate. Active aero recorded as a confounder. Phase 1
  gains Testcontainers, CI, bulk inserts and the rule that Ali hand-writes the
  rate limiter, upsert and resume logic. New Phase 1.5: thin cloud deploy and
  a "minimum interview story" due 2026-11-15. Phase 5 is a stretch goal for
  the application window.
- **Hypothesis reframed:** from instantaneous attacker − defender state of
  charge (near-circular with Overtake mode, and SoC is roughly periodic per
  lap) to lap-level energy behaviour measured before the attack, with pace
  delta, tyre age and Overtake availability as controls and a permutation
  negative control.
- **Rejected:** dropping the overtake test entirely (it is the one
  differentiator no prior project has); filling the per-event limits table
  from guesses.
- **Owner note:** Ali confirms D1, D7 and HYPOTHESIS.md wording.

## Gate results
(date — gate — pass/fail — notes)
