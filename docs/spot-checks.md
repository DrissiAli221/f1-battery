# Pre-registered spot checks

**Status: DRAFT.** Frozen before any Phase 3 output exists; then never edited
(deviations go in DECISIONS.md). There is no ground truth, so these are
named real-world moments with the expected sign written down in advance.
Each is reported pass / fail / not testable.

Frozen on: _not yet_

| # | Moment | Source | What the model should show | Session / lap / straight | Result |
|---|---|---|---|---|---|
| 1 | Norris, Suzuka 2026 race: "I literally had 5% of my battery coming out the last corner. There was no point of trying to defend." | pitdebrief.com, The Race 2026-04-04 | On that lap, Norris's main-straight deploy phase is absent or cut far earlier than his own median; the car behind closes or passes | Japan 11253: Norris (1) was passed by Hamilton (44) on lap 48 (06:33:09 UTC) and again on lap 51 (06:37:57) of 53, from `overtakes` + `laps` (2026-10-18). Check laps 47–51, main straight and the run to 130R | |
| 2 | Hamilton vs Verstappen, Canada 2026, the lap-62 pass | r/F1Technical post (snippet) | Hamilton's cut-off on the long straight moves earlier (saving) over the laps before 62, then later (spending) on lap 61–62; Verstappen's does not | Canada 11291: Hamilton (44) passed Verstappen (3) for P2 on lap 62 at 21:29:37 UTC, from `overtakes` + `laps` (2026-10-18); Verstappen had passed Hamilton on lap 9. Check laps 50–62, back straight | |
| 3 | Ferrari derates earlier than Mercedes at Monza | Scuderia Fans (FP2 telemetry article), The Race 2026-09-05 | Leclerc/Hamilton median cut-off distance on T1→Roggia and Lesmo→Ascari is earlier than Russell/Antonelli's | Italy 11361 race (spike: Hamilton 1457 m vs Russell 1479 m on T1→Roggia; direction matches, size to be tested with error bars) | |
| 4 | Singapore has no derating | Spike result | No cut-off on any straight for any car | Singapore 11388 | pass (spike, 2026-10-17) |
| 5 | Piastri, Monza preview: a higher harvest limit would have cost "30 or 40 km/h" per straight | The Race 2026-09-04 | Harvest-under-throttle absent at Monza (5/7 MJ limits); present at an event with a high limit and long straights, e.g. Baku (8.5 MJ) | Azerbaijan 11377 vs Italy 11361 | |

Rules: fill the lap numbers from data before freezing; never change the
expected sign after seeing Phase 3 output; a failed check is reported as such.
