# FIA energy limits by event

Code reads limits from this table, never from constants (DECISIONS.md D6).
Every value cites the regulation issue and article in force at that event.

## Baseline: Section C, Issue 20 (2026-08-05)

Source: [FIA 2026 F1 Regulations, Section C, Issue 20](https://api.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_20_-_2026-08-05.pdf).
Text extracted with pdftotext on 2026-10-17.

| Article | Limit |
|---|---|
| C5.2.3 | Fuel energy flow ≤ 3000 MJ/h |
| C5.2.7 | ERS-K DC power ≤ 350 kW |
| C5.2.8.i | Propulsion, no Overtake: P = 1800 − 5v (v < 340 kph); 6900 − 20v (340–345); 0 at ≥ 345 |
| C5.2.8.ii | Overtake active: P = 7100 − 20v (v < 355); 0 at ≥ 355 |
| C5.2.8.iii | Race/Sprint, specified sectors in power-limited periods: 250 kW below 310 kph, then the taper above |
| C5.2.8.iv | Low-grip curves: in FIA-F1-DOC-111 (not public?) |
| C5.2.9 | Max − min state of charge ≤ 4 MJ on track |
| C5.2.10 | Recharge ≤ 8.5 MJ/lap. May be cut to 7 MJ at events where the FIA judges braking/partial-load harvest ≤ 7 MJ. Qualifying and Sprint Qualifying can be cut further: floor is **4 MJ in Issue 20** (redline "5 4MJ" = 5 struck, 4 inserted; Issues 17–19 said 5 MJ). +0.5 MJ/lap extra harvest under B7.2 conditions (Overtake enabled and activated at the Control Line, per B7.2.1b). No recharge limit behind the SC in low grip |
| C5.12.4 | At the start of a power-limited pending period the driver's max power demand may be cut by at most 150 kW, fixed for ≥ 1 s. Low grip: minimum 250 kW cut in specified race/sprint sectors |
| C5.12.5 | Max power demand may not be increased during a power-limited (pending) period, except Boost or a permitted reset |
| C5.12.6 | While ERS-K DC power is **above 100 kW**, power may fall by at most 50 kW per 1 s at events where the FIA's power-limited distance exceeds 3500 m, else 100 kW per 1 s. Total reduction ≤ 700 kW |
| C5.12.7 | The C5.12.6 rate does not apply when: the post-reduction power would be < 100 kW, ICE power is negative, C5.2.8 forces a faster cut, driver demand is negative, a gearshift is in progress, or speed < 210 kph (higher threshold in specified sectors) |

**Per-event values are not public.** Section B (Issue 09, 2026-10-01), Article
B7.2.1b: the FIA notifies teams of the per-event recharge limit, the extra
Overtake recharge, the specified sectors and the low-grip curves at least four
weeks before each event, and may amend them. B7.2.1c: the reduced qualifying
limit (C5.2.10.ii) may apply at no more than 12 events per season, of which no
more than 4 may be below 5 MJ. Code therefore uses the baseline curve above and
carries an explicit `limit_known = false` flag per event unless a public source
(FIA event notes, reputable reporting) gives the event value.

Note on reading C5.2.8: 1800 − 5v exceeds 350 kW below 290 kph, so the
effective no-Overtake limit is min(350, 1800 − 5v). The taper starts at
**290 kph**, not near 345. The 350 kW "super-clip recharge power" figure is
reported by The Race and is **not** an explicit number in C5.2.x; cite it as
secondary.

## In-season changes

- **2026-04-20 package, applied from Miami (2026-05-03):** qualifying recharge
  8→7 MJ, super-clip recharge power 250→350 kW, race MGU-K 350 kW in
  acceleration zones and 250 kW elsewhere, lower-limit events 8→12. Secondary
  source: [The Race](https://www.the-race.com/formula-1/f1-2026-mid-season-rule-changes/).
  Issue in force at Miami was **Issue 17 (2026-04-28)**; Issue 18 is dated
  2026-05-07, after the race. Section C issues in 2026: 16 (02-27), 17 (04-28),
  18 (05-07), 19 (06-25), 20 (08-05, newest as of 2026-10-17). The 8→7 MJ
  change is visible as a "87MJ" redline in Issue 17's C5.2.10.i.

## Per-event table (to fill in Phase 2)

Issue in force = newest Section C issue dated before the race. Recharge limit
stays "unknown" until a public source gives it (see B7.2.1b above).

| Race | session_key | Date | Issue in force | Recharge limit | Notes |
|---|---|---|---|---|---|
| Australia | 11234 | 2026-03-08 | 16 | unknown | Pre-April package |
| China | 11245 | 2026-03-15 | 16 | unknown | 11240 is the sprint |
| Japan | 11253 | 2026-03-29 | 16 | unknown | |
| Bahrain | 11261 | 2026-04-12 | 16 | | No OpenF1 data (404); round relocated to Kuala Lumpur, see 11731 |
| Saudi Arabia | 11269 | 2026-04-19 | 16 | | No OpenF1 data (404) |
| Miami | 11280 | 2026-05-03 | 17 | unknown | First race of the April package |
| Canada | 11291 | 2026-05-24 | 18 | unknown | |
| Monaco | 11299 | 2026-06-07 | 18 | unknown | |
| Spain (Barcelona) | 11307 | 2026-06-14 | 18 | unknown | |
| Austria | 11315 | 2026-06-28 | 19 | unknown | |
| Britain | 11326 | 2026-07-05 | 19 | unknown | |
| Belgium | 11334 | 2026-07-19 | 19 | unknown | |
| Hungary | 11342 | 2026-07-26 | 19 | unknown | |
| Netherlands | 11353 | 2026-08-23 | 20 | unknown | 11348 is the sprint |
| Italy (Monza) | 11361 | 2026-09-06 | 20 | unknown | Spike race |
| Spain (Madrid) | 11369 | 2026-09-13 | 20 | unknown | |
| Azerbaijan | 11377 | 2026-09-26 | 20 | unknown | |
| Bahrain GP in Malaysia (Kuala Lumpur) | 11731 | 2026-10-04 | 20 | unknown | Real race: OpenF1 meeting 1308 is "FORMULA 1 GULF AIR BAHRAIN GRAND PRIX IN MALAYSIA 2026" (relocated Bahrain round, country label kept as Bahrain). Include. Checked 2026-10-17 |
| Singapore | 11388 | 2026-10-11 | 20 | unknown | Spike contrast race |

Data caveat (checked 2026-10-17): OpenF1 `sessions?session_type=Race` returns
31 rows for 2026 because sprints also carry session_type "Race". Select races
by `session_name == "Race"`, not by session_type.
