# Decision log

One entry per decision: date, what was chosen, why, what was rejected.
The project owner maintains this file; agents propose entries.

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
- **Addendum 2026-10-17 (second agent's search, arXiv checked by Claude):**
  the deploy cut-off found in Phase S is a known effect called **derating**
  (media: PlanetF1, Scuderia Fans; arXiv 2603.01290 "Opponent State
  Inference Under Partial Observability: An HMM-POMDP Framework for 2026 F1
  Energy Strategy" models a rival's ERS state with an explicit L_derate
  mode, on **simulated data only**, real telemetry listed as future work, no
  code). A Reddit r/F1Technical post read Hamilton's Canada 2026 top speed
  falling then recovering before a pass as save-then-attack: our hypothesis
  as one anecdote. Framing therefore: "measured derating per car across the
  season from public data and tested whether it predicts overtakes", never
  "discovered the cut-off".
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
- **Amended by D9 (2026-10-17):** derived outputs may be served publicly;
  raw samples never.

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
  gains Testcontainers, CI and bulk inserts. New Phase 1.5: thin cloud deploy and
  a minimum demonstrable milestone due 2026-11-15.
- **Hypothesis reframed:** from instantaneous attacker − defender state of
  charge (near-circular with Overtake mode, and SoC is roughly periodic per
  lap) to lap-level energy behaviour measured before the attack, with pace
  delta, tyre age and Overtake availability as controls and a permutation
  negative control.
- **Rejected:** dropping the overtake test entirely (it is the one
  differentiator no prior project has); filling the per-event limits table
  from guesses.
- Wording of D1, D7 and HYPOTHESIS.md confirmed by the owner.

## D8 — 2026-10-17 — Stack choices
- **Postgres + TimescaleDB from the start.** Timescale is a Postgres extension
  (hypertables: automatic time chunking, compression, time-bucket helpers),
  not a separate database. At ~9M rows plain Postgres would cope; Timescale is
  kept for its time-series tooling; the design note records what would change
  without it.
- **Rejected: MongoDB.** The data is relational (car_data → laps → stints,
  overtakes → two drivers, everything → sessions), the workload is analytical
  SQL (window functions, group by distance bin), and pandas reads SQL in one
  line. Every row has the same ten fields, so documents buy nothing.
- **Rejected: Kafka and Spark in the main pipeline.** The season is ~9M rows
  fetched once in ~25 min and analysed in batch. Kafka is for continuous
  multi-producer streams, Spark for data that doesn't fit one machine. Neither
  applies. Adding them would not be justified by the workload. Kafka is allowed later as a **replay mode** (Phase 7): re-emit a
  race at real speed onto a topic, consumer updates the regime estimate live.
  That is a real streaming problem with a real reason.
- **View: React + TypeScript (Vite).** The view is the one place to spend
  design effort: track map from the `location` endpoint with
  regimes per lap, time scrubbing, two-car comparison. Consequence: `location`
  is ingested in Phase 2, no longer deferred.
- **Cloud: Oracle Cloud free tier (ARM VM, 24 GB) for the services and
  database, plus one small AWS piece (S3 for cached raw JSON, or ECR, or a
  scheduled Lambda fetch) for AWS exposure at near-zero cost.** One deploy
  path only.
- **Ingestion details:** Spring Data JDBC with explicit SQL (not JPA), a
  custom token-bucket rate limiter (not Resilience4j), build tool TBD.

## D9 — 2026-10-17 — Design details
- **D5 amended:** this is a personal, non-commercial project. The public
  deploy may serve **derived** outputs (regime labels per lap at coarse
  distance bins, energy estimates, aggregates) credited to OpenF1 under
  CC BY-NC-SA. It never serves raw speed, throttle, brake, rpm or location
  samples. Raw data still stays local and is never committed.
- **Build: Maven, multi-module monorepo.** `db/` owns every Flyway migration
  (including the Python results table), `ingest/` is a job that runs and
  exits, `api/` is a long-running read-only server. `ingest` and `api` depend
  on `db`, never on each other. No shared entity classes.
- **Schema ownership:** Flyway in `db/` only. Python inserts into the results
  table with `model_version` and `run_id`; it never creates tables.
- **Fetch granularity:** car_data and location are fetched in time windows
  (~10 min). The window is the unit of the ingestion log and of resumability.
- **Keys:** car_data unique on (session_key, driver_number, date); Timescale
  requires the time column in any unique index. Duplicate timestamps from the
  API are deduped in the ingester before insert.
- **Hosting:** an existing Oracle Cloud free-tier ARM server (already runs
  another light project). All images built arm64 in CI. Keep something
  running so Oracle doesn't reclaim it.
- **Backup = the AWS piece:** cached raw JSON goes to a private S3 bucket.
  Database and results are rebuildable from it. A private bucket is not
  redistribution.
- **Lap assignment:** explicit rules in Phase 2 for lap 1 without a start
  time, out-laps, pit laps and SC/VSC laps; the quality report counts samples
  with no lap.
- **API:** read-only, paginated, CORS for the React origin, ETag caching
  (results are immutable per model version), basic rate limit (unauthenticated).
- **Tests:** Testcontainers (timescaledb image) for the DB, WireMock with
  recorded OpenF1 responses for HTTP, including 429 and 502 paths. CI never
  calls the live API.
- **Observability:** Actuator health, Micrometer counters (rows, requests,
  429s), structured logs, config via environment variables, no secrets in git.

## D10 — 2026-10-17 — Phase S result: proceed in proxy mode (CONFIRMED by the owner, 2026-10-17)
- **Result:** 1 of 3 exit conditions passed (spike/RESULT.md). Taper not
  demonstrated (Overtake state and active aero unobserved, few samples above
  340 kph). Super-clip harvest segments: the first pass was a smoothing
  artifact, none survive a brake-onset guard. Regime agreement lap to lap:
  pass (≥ 0.91 mean at Monza, ≥ 0.94 at Singapore).
- **What is real:** a per-straight deploy cut-off above ~300 kph, repeatable
  within 20–75 m on the two long Monza straights, absent at Singapore.
- **Decision:** continue as an **energy-management proxy**: regimes, cut-off
  distance and speed per straight, relative deploy energy. No state-of-charge
  numbers. HYPOTHESIS.md variables to be re-expressed in cut-off terms before
  freezing. Taper check deferred to qualifying data.
- **Rejected:** claiming the first-pass super-clip result; estimating SoC with
  an assumed engine curve (not identifiable from this data).

## D11 — 2026-10-18 — Improvements adopted from the second review
(docs/improvements-2026-10-18.md; items 1 (corrected), 2, 3, 4, 5, 7 accepted)
- **1, corrected:** OpenF1 `location` already has `z` (elevation) and all
  cars share timestamps, so gap-to-car-ahead is computed from positions.
  From TracingInsights/2026 take only the curated `sections/` and corner
  files (standard straight definitions per circuit), not the 4.3 GB clone.
  `z` is integer-quantised like speed: compute slope over 50–100 m, never
  sample to sample.
- **2:** Phase 3 compares at least three differentiation methods (PyNumDiff:
  Kalman/RTS, total-variation; plus Savitzky–Golay) on a synthetic straight
  with known truth before choosing one. The 1.5 s brake guard stays.
- **3:** cut-off = ramp start, fitted per straight per lap with a hinge /
  piecewise-linear model; bootstrap over laps for a confidence interval per
  car per race.
- **4:** `docs/spot-checks.md`: named real-world moments with the expected
  sign written down before Phase 3 runs, frozen like HYPOTHESIS.md.
- **5:** constants with sources in docs/regulations.md (768 kg minimum
  without fuel; fuel burn as a linear mass decrease; CdA fitted per car per
  event, never assumed); slope correction g·sinθ from `z` in the baseline.
- **7:** backup tooling also saves weather, session_result, starting_grid,
  team_radio, meetings; FIA race director's competition notes PDFs per event;
  TracingInsights sections/corners files.
- **Deferred:** item 6 (publishing) waits for a result and the owner's
  explicit OK; aggregates only.
- **Rejected:** deep models (no labels), F1 TV tokens (terms), broadcast bar
  as ground truth (FOM estimate).

## D12 — 2026-10-18 — Phase 0 scaffolding choices (built by an agent, reviewed)
- Spring Boot 3.4.5, WireMock 3.9.2, Testcontainers; failsafe runs `*IT`
  tests; `db` is a plain jar holding the Flyway migrations; Boot plugin only on
  `ingest` and `api`. Maven wrapper is script-only (no jar committed).
- Keys: lap (session, driver, lap_number); stint (session, driver,
  stint_number); pit (session, driver, lap_number); overtake (session, date,
  overtaking, overtaken); interval_sample and position (session, driver,
  date); race_control unique on (session, date, md5(message),
  coalesce(driver, -1)); ingestion_log unique on (endpoint, session,
  coalesce(driver, -1), window_start) because NULLs are distinct in a plain
  unique index; car_data and location unique on (session, driver, ts), the
  time column being mandatory in Timescale unique indexes; model_result
  unique on (model_version, run_id, session, driver, lap, coalesce(straight,
  -1), variable) so a model re-run is idempotent too.
- Added by review: `position` and `weather` tables (both in the backup,
  weather needed by Phase 3), lap speed traps i1/i2, DB port bound to
  127.0.0.1 only.
- No foreign keys except driver → session, so ingestion order stays free.
- **Unverified as of 2026-10-18:** the migrations have not run against a
  real TimescaleDB yet (Docker Desktop was not running; pulling the image
  would also compete with the backup for bandwidth). `MigrationsIT` is the
  check; it runs in CI and locally once Docker is up. Phase 0 is closed once it passes.

## D13 — 2026-10-18 — Raw OpenF1 backup, race sessions (done)
- `tools/backup_openf1.py`, gzip files under `data/raw/openf1/` (gitignored),
  one request per driver per endpoint, ≤30 req/min, two in flight. Ran
  2026-10-17 → 2026-10-18; finished 15:28 UTC.
- Endpoints per session: drivers, laps, stints, pit, overtakes, race_control,
  intervals, position, weather, session_result, starting_grid, team_radio,
  car_data, location; plus sessions and meetings for 2026.
- Coverage check: a session is complete only if each driver's location rows
  are within 10 % of car_data rows; failures get one windowed re-fetch.

| session | name | status | laps | overtakes | intervals | car_data | location |
|---|---|---|---|---|---|---|---|
| 11234 | Melbourne Race 2026-03-08 | complete | 1002 | 299 | 22276 | 433,664 | 444,994 |
| 11245 | Shanghai Race 2026-03-15 | complete | 924 | 279 | 20663 | 492,976 | 499,158 |
| 11253 | Suzuka Race 2026-03-29 | complete | 1108 | 218 | 28324 | 521,092 | 535,546 |
| 11261 | Sakhir Race 2026-04-12 | no data (404) | | | | | |
| 11269 | Jeddah Race 2026-04-19 | no data (404) | | | | | |
| 11280 | Miami Race 2026-05-03 | complete | 1042 | 267 | 25483 | 501,446 | 516,318 |
| 11291 | Montreal Race 2026-05-24 | complete | 1212 | 243 | 22532 | 504,922 | 515,218 |
| 11299 | Monte Carlo Race 2026-06-07 | complete_with_feed_gaps (22 drivers short) | 1452 | 132 | 29916 | 735,856 | 39,644 |
| 11307 | Catalunya Race 2026-06-14 | complete | 1241 | 296 | 25022 | 490,644 | 502,194 |
| 11315 | Spielberg Race 2026-06-28 | complete | 1342 | 242 | 26312 | 468,006 | 477,444 |
| 11326 | Silverstone Race 2026-07-05 | complete | 1114 | 232 | 28253 | 472,626 | 484,682 |
| 11334 | Spa-Francorchamps Race 2026-07-19 | complete | 875 | 214 | 23116 | 453,002 | 462,374 |
| 11342 | Hungaroring Race 2026-07-26 | complete | 1432 | 262 | 29593 | 516,736 | 529,914 |
| 11353 | Zandvoort Race 2026-08-23 | complete | 1369 | 292 | 30616 | 673,596 | 666,182 |
| 11361 | Monza Race 2026-09-06 | complete | 1055 | 334 | 21955 | 592,614 | 599,874 |
| 11369 | Madring Race 2026-09-13 | complete | 1109 | 123 | 26935 | 520,036 | 525,250 |
| 11377 | Baku Race 2026-09-26 | complete | 983 | 160 | 24933 | 528,506 | 543,598 |
| 11731 | Kuala Lumpur Race 2026-10-04 | complete | 1145 | 505 | 21448 | 885,984 | 900,944 |
| 11388 | Singapore Race 2026-10-11 | complete | 1240 | 191 | 28131 | 539,044 | 540,496 |

- **Totals (17 races):** car_data 9,330,750, location 8,783,830, laps 19,645, overtakes 4,289, intervals 435,508.
- **Known gaps:** Bahrain 11261 and Jeddah 11269 have no data; Monaco 11299
  location stops at 14:00:14 for all 22 drivers (feed gap, re-fetch
  confirmed); starting_grid is empty for every 2026 race; team_radio is 0–40
  clips per race. Details: docs/data-quality-notes.md.
- Qualifying and sprint pass: recorded in D14.
- **Correction 2026-10-18:** Kuala Lumpur 11731 was truncated at 10:00 by the
  backup's window cap (scheduled end + 60 min); refetched after the cap was
  changed to the last lap end, now 993,652 car_data rows. The table above
  keeps the original count as recorded.

## D14 — 2026-10-18 — Raw OpenF1 backup, qualifying and sprint sessions (done)
Same tooling and checks as D13. Finished 2026-10-18 evening UTC. 31 sessions.

| session | name | status | laps | car_data | location |
|---|---|---|---|---|---|
| 11230 | Melbourne Qualifying 2026-03-07 | complete | 359 | 407,132 | 413,336 |
| 11236 | Shanghai Sprint Qualifying 2026-03-13 | complete | 257 | 233,442 | 238,458 |
| 11240 | Shanghai Sprint 2026-03-14 | complete | 399 | 198,330 | 203,082 |
| 11241 | Shanghai Qualifying 2026-03-14 | complete | 325 | 318,560 | 321,882 |
| 11249 | Suzuka Qualifying 2026-03-28 | complete | 324 | 313,456 | 318,758 |
| 11257 | Sakhir Qualifying 2026-04-11 | no data (404) | | | |
| 11265 | Jeddah Qualifying 2026-04-18 | no data (404) | | | |
| 11271 | Miami Sprint Qualifying 2026-05-01 | complete | 237 | 231,286 | 235,180 |
| 11275 | Miami Sprint 2026-05-02 | complete | 381 | 182,468 | 190,124 |
| 11276 | Miami Qualifying 2026-05-02 | complete | 324 | 331,408 | 341,990 |
| 11282 | Montreal Sprint Qualifying 2026-05-22 | complete | 300 | 327,272 | 339,988 |
| 11286 | Montreal Sprint 2026-05-23 | complete | 491 | 176,528 | 182,072 |
| 11287 | Montreal Qualifying 2026-05-23 | complete | 456 | 309,342 | 315,568 |
| 11295 | Monte Carlo Qualifying 2026-06-06 | complete | 484 | 345,246 | 349,998 |
| 11303 | Catalunya Qualifying 2026-06-13 | complete | 255 | 359,810 | 374,770 |
| 11311 | Spielberg Qualifying 2026-06-27 | complete | 290 | 316,888 | 320,342 |
| 11317 | Silverstone Sprint Qualifying 2026-07-03 | complete | 236 | 233,574 | 237,204 |
| 11321 | Silverstone Sprint 2026-07-04 | complete | 372 | 166,100 | 172,920 |
| 11322 | Silverstone Qualifying 2026-07-04 | complete | 309 | 351,736 | 358,050 |
| 11330 | Spa-Francorchamps Qualifying 2026-07-18 | complete | 269 | 359,524 | 368,764 |
| 11338 | Hungaroring Qualifying 2026-07-25 | complete | 299 | 311,124 | 319,572 |
| 11344 | Zandvoort Sprint Qualifying 2026-08-21 | complete | 254 | 228,184 | 234,190 |
| 11348 | Zandvoort Sprint 2026-08-22 | complete | 506 | 190,498 | 185,306 |
| 11349 | Zandvoort Qualifying 2026-08-22 | complete | 377 | 305,492 | 296,230 |
| 11357 | Monza Qualifying 2026-09-05 | complete | 307 | 314,314 | 320,210 |
| 11365 | Madring Qualifying 2026-09-12 | complete | 312 | 317,108 | 321,266 |
| 11373 | Baku Qualifying 2026-09-25 | complete | 373 | 334,400 | 342,716 |
| 11730 | Kuala Lumpur Qualifying 2026-10-03 | complete | 239 | 315,084 | 321,288 |
| 11379 | Singapore Sprint Qualifying 2026-10-09 | complete | 287 | 361,218 | 364,034 |
| 11383 | Singapore Sprint 2026-10-10 | complete | 320 | 408,232 | 412,060 |
| 11384 | Singapore Qualifying 2026-10-10 | complete | 363 | 378,290 | 388,080 |

- **Totals:** car_data 8,626,046, location 8,787,438, laps 9,705; sprint races add 548 overtakes and 54,813 intervals.
- Location gaps: none. `starting_grid` is populated on qualifying sessions (22 rows each).
- Whole backup on disk: see manifest; gzip files.

## D15 — 2026-10-18 — All phases built sequentially by agents
- Phases 1 to 6 are built in order by agents without pausing between phases.
  Each phase ends with its exit condition met, a design note in `docs/`, and
  a review checkpoint. The freeze rule (HYPOTHESIS.md and docs/spot-checks.md
  before any Phase 4 output) is unchanged. A phase whose own check fails stops
  the build and is reported.
- Code carries ordinary maintainer comments explaining intent and trade-offs.

## D16 — 2026-10-18 — Phase 1 ingestion loaded and verified
- Full local-backup load, 50 sessions (48 with data, 2 no-data), 2,982 fetch
  units, 0 failed, ~45 min on the laptop. Second run: 4 s, 2,702 complete
  units skipped, 280 no-data units re-checked, **0 rows inserted**.
- Row counts in the database: car_data 17,956,796 (equals the backup manifest
  total, D13 + D14), location 17,571,268, interval_sample 490,321, lap 29,350,
  overtake 4,837, session 50. Database size 3.7 GB before compression.
- Design choices from the build (docs/phase1-ingestion.md): V3 adds text
  columns for "+1 LAP" intervals, jsonb for per-segment qualifying results,
  and `window_label` to the ingestion-log key; no-data units are re-checked
  on every run; `brake` is stored as received (values 0, 100 and 104 occur).
- Local Compose database on host port 55432 (5432 and 5433 are taken by
  other local Postgres instances).
- CI could not run (Actions billing); all tests, including Testcontainers
  ITs, pass locally with Docker (`-Dapi.version=1.44` needed for the local
  Docker Desktop).

## D17 — 2026-10-18 — Phase 2 closed; sessions excluded from modelling
- Alignment, lap quality, straights and regulation seed are in
  (docs/phase2-alignment.md). Database compressed from 3.7 GB to 292 MB with
  row counts unchanged. 29,350 laps, 19,762 green (race 77 %, qualifying
  34 %, as expected since qualifying is mostly out/in laps).
- **Hungary race 11342 is excluded from modelling.** Its lap and pit
  timestamps disagree with the telemetry by a non-constant 3–6 min, and its
  `location` feed is frozen from about 13:25, so lap boundaries cannot be
  recovered from either source. A speed-profile tracker on car_data alone
  could recover it later; deferred.
- Shanghai race and sprint and Suzuka race lose 94–121 laps each to the
  3 % lap-length rule (mostly laps 2–3, off by ±10 %); telemetry-derived
  boundaries do not fix it and the cause is unexplained. The laps are
  excluded conservatively; the sessions stay.
- Straights: curated sections files for 11 circuits; derived from the
  fastest green lap (full throttle ≥ 4 s above 200 kph) for Shanghai,
  Suzuka, Madrid and Kuala Lumpur, labelled 'derived'. The straight across
  the start/finish line is one entry (id 1) with wrap handling.
- Kuala Lumpur race was truncated by the backup cap and refetched (D13
  correction); now complete.

## D18 — 2026-10-18 — Phase 3 check failed on one criterion; estimator choice
- The Phase 3 reproduction check (PLAN.md) passed on Monza (all ten
  cut-offs within 5 m of the spike) and on regime agreement, and **failed**
  on Singapore straight 3: the hinge derate detector flags a ramp on 27.5 %
  of laps against a 10 % limit (0 % on the other straights). The detector's
  plateau condition was fixed before the run and was not tuned afterwards;
  a value that makes Singapore pass loses most Monza Lesmo→Ascari
  detections (docs/phase3-regimes.md).
- **Decision:** the threshold-crossing estimator (the quantity the spike
  validated and the pipeline reproduces) is the primary cut-off for Phases 4
  and 5. The hinge ramp start is computed alongside and stored as
  experimental (`hinge_*` variables). No exit criterion is rewritten after
  the fact. Singapore straight 3 is investigated separately
  (docs/investigations/singapore-straight3.md); its outcome may change the
  hinge detector's status through a later decision, never this check.
- Assumptions accepted from the build: drag area is not identifiable per
  car from full-throttle data, so a session-wide value is used (±50 m
  systematic on the hinge start); start mass 838 kg (768 dry + 70 fuel)
  with assumed fuel loads; relative deploy energy is power-based (J/kg);
  the per-event derate rate is unknown everywhere, so 100 kW/s is used and
  flagged (Monza fits imply ~66–77 kW/s).

## D19 — 2026-10-18 — Singapore straight 3 explained: hinge detector artifact
- Investigation (docs/investigations/singapore-straight3.md): the power drop
  the hinge detector reports appears on 95.7 % of straight-3 laps, flagged or
  not; the flag is a threshold cut through a smooth distribution of
  plateau acceleration (median 1.14 m/s² against a 1.0 limit), lowered by a
  26° flat-out bend at 1320–1500 m. Tow, Overtake windows, gearshifts, drag
  area and gradient are ruled out with numbers.
- More important: the fitted ramp start sits at the earliest index the fit
  allows on 62 % of those laps and 85 % of Monza T1→Roggia laps. Power peaks
  ~0.75 s after full throttle and falls steadily, so there is no flat deploy
  level for a hinge to find. The hinge ramp start was therefore not a
  measurement, at Monza either.
- **Decision:** the Phase 3 Singapore criterion stands as written. The hinge
  detector stays experimental; it now requires an interior ramp start (≥ 1 s
  of deploy level before the start) and reports "not detected" when pinned.
  The plateau limit is not tuned. The primary cut-off remains the
  threshold-crossing estimator (D18).

## D20 — 2026-10-18 — Phase 5 result: no effect (frozen test, run as written)
- Test run exactly as frozen in HYPOTHESIS.md (docs/findings.md). Analysis
  frame: 364 events and 1,324 non-events in 19 sessions after dropping rows
  with no detected defender cut-off on the approach straight (the main drop,
  445 events), which makes the test a selection on straights where a cut-off
  exists.
- Odds of being passed per 1 SD earlier defender cut-off: 0.92 [0.81, 1.04]
  (point), 0.85 [0.74, 0.99] (lower band), 0.94 [0.83, 1.07] (upper band).
  Opposite sign to the hypothesis in all three runs; permutation control
  fails (observed coefficient less extreme than 79 % of permutations).
  Verdict in the frozen vocabulary: **no effect**.
- Pace delta dominates (OR 0.63 per SD, p < 1e-9); Overtake availability
  OR 1.72 [1.22, 2.43]. The energy terms add nothing detectable beyond the
  controls (LR chi² 3.69, 3 df, p = 0.30).
- Sensitivities (not pre-registered: without deploy energy, without the 16
  drag-area-edge sessions, races only) do not change the verdict.
- Spot checks reported as-is: 3 fail, 1 pass, 1 not testable; the
  resolution-floor explanation is labelled post-hoc.
- Power-unit comparison: at Monza, Mercedes-powered cars cut latest on
  straights 2, 4 and 5 and Ferrari-powered earlier on 2 and 4; the bootstrap
  pools laps across cars and does not capture car-to-car spread.
- `statsmodels` added to model/pyproject.toml.

## D21 — 2026-10-18 — Method log kept and published in the view
- A curated record of what was tried, what each pre-set check said, what was
  found and what changed (docs/method-log.md, generated from
  web/src/content/method-log.json; page `#/method` in the view). Eight
  entries from the Phase S artifact to the frozen test, each citing its
  source document or decision.
- **Why:** the pre-set checks and their outcomes, including the ones that
  failed, are the evidence that the results were not tuned; they stay
  visible rather than being summarised away. Nothing in the log rewrites a
  criterion; later status changes are separate decisions (D18, D19).

## D22 — 2026-10-18 — Phase 7 built: Kafka replay as the one streaming use
- Optional module `replay/` plus a `kafka` Compose service behind the
  `replay` profile; an SSE endpoint in the API enabled only by
  `API_REPLAY_ENABLED=true`; a live page in the view. With Kafka absent,
  ingestion, the model, the API and the view behave exactly as before (the
  API returns 404 "replay disabled" on the live endpoint).
- Why Kafka here and not in ingestion (D8): ingestion is a one-shot batch
  of ~9 M rows per pass with one producer and one consumer; the replay is
  a continuous, keyed, real-time-paced stream (one key per car) with
  independent consumers (the regime consumer, the API's SSE bridge), which
  is the workload a log-based broker exists for.
- Verified end to end on Monza 11361 at 20× speed: producer pacing held,
  consumer emitted per-driver regime states, SSE delivered them, the live
  page showed four cars moving with regimes and speeds.
- Limits recorded in docs/phase7-replay.md: the live regime labeller is a
  simplified version of the batch rules (no Savitzky–Golay, no brake
  guard); lap distance on the live page is a running integral since the
  consumer started, so dot position is approximate; single-node Kafka;
  local-only because the feed carries near-raw speed values (D9).
- Found while building: `car_data` and `location` do not share timestamps
  across feeds (docs/data-quality-notes.md).

## D23 — 2026-10-19 — Backend audit accepted
- docs/backend-audit-2026-10-19.md records the review after Phases 0–7.
  Headline findings: Dockerfiles broken by the `replay` module, CI never
  run (Actions billing), the API source truncates sessions at the
  scheduled end, the API serves the newest model run so a partial or
  single-session run hides the others, unbounded SSE streams, raw fields in
  the live feed, superuser DB role for the API, floating image tag.
- Fixes 1–9 are accepted and built now; fix 10 (Phase 1.5 deploy) waits
  for server access. Exit conditions in PLAN.md are not changed; the audit's
  "partly" rows stay partly until the fixes land.

## D24 — 2026-10-19 — Frontend rebuild: typography and imagery
- Base typeface Geist with Geist Mono for numbers (Inter as the drop-in
  alternative), tracking −5 % on display sizes scaling to −1 % on body;
  Saira as a sparing F1-style accent for labels, codes and the wordmark.
  All three under the SIL Open Font License. The proprietary F1 typeface is
  not used.
- Driver headshots and team logos are used in the view for this personal,
  non-commercial project. They are loaded at runtime from their source URLs
  (OpenF1's `headshot_url`; team logos from the confirmed source), credited
  in the footer, and never committed or redistributed. The F1, FIA and FOM
  logos and wordmark stay out, as before. Team colours come from OpenF1's
  `team_colour` at runtime.
- Consequence for the backend: the ingester currently drops `headshot_url`,
  `team_colour`, `first_name`, `last_name`, `broadcast_name` and
  `country_code` from `drivers`; a migration and upserter change add them,
  and the API exposes them (separate pull request).

## D25 — 2026-10-19 — Frontend rebuild stack
- Dark first, light mode later. Tailwind for layout and styling only; GSAP
  (MotionPath, DrawSVG) for track-map animations; Motion for UI
  transitions; charts as hand-written SVG with d3-scale. React, Vite and
  TypeScript stay. The project name and wordmark are decided later.
- Before any page is built, three static mockup directions are produced
  with real Monza data, and one is chosen.

## D26 — 2026-10-19 — Frontend direction: Broadcast with Telemetry instruments
- The rebuild uses the Broadcast mockup's shell, track and timing-tower
  grammar with the Telemetry lab's mono numbers, linear distance strip,
  scrubber and cursor readout. The Editorial direction is dropped.
- None of the three mockups met the bar as built; the brief lists the
  density, type-scale and chart problems and the rules that fix them. One
  hybrid mockup validates those rules before the React build starts.

## D27 — 2026-10-19 — Adopt the PRNDL design system
- The frontend's tokens and components come from PRNDL, an unofficial,
  student-made F1 design system on the Figma Community, used with its
  author's permission and credited. Its terms (unofficial, no F1
  affiliation, non-commercial) match this project.
- Orbitron replaces Saira as the accent face; Geist and Geist Mono stay for
  body and numbers. Logos, photos and renders in the file are not reused;
  team colours still come from OpenF1.

## D28 — 2026-10-19 — Spacious layout; hash routing kept
- The rebuild drops D26 rule 1 (session explorer in one viewport with a
  side panel). After the PRNDL mockup the layout was judged too condensed:
  pages now use a wide container, large section spacing and one idea per
  section, with the track map full width as the explorer's hero. Mockups
  end here; work continues in `web/`.
- Hash routing stays (static hosting needs no server rewrites); explorer
  state is kept in the query string so views can be shared.
- The page background stays PRNDL's for now and is to be revisited; it is
  a single token.

## D29 — 2026-10-20 — Art direction: everything read off the speed trace
- The view's concept, replacing the broadcast/telemetry hybrid of D26 as the
  art direction (PRNDL primitives from D27 and the spacious rule of D28 stay):
  F1 hides the battery, so the site reads it the only way anyone can, off the
  speed trace, metre by metre down the straight. One instrument, "the
  straight" (a straight's speed profile with a cursor whose position drives
  every readout, colour and map dot), is the landing hero, the session
  page's core and the opener of every page. The full system (palette, type,
  grid, motion, per-page composition, build order) is in `web/DESIGN.md`.
- Considered and rejected as the main concept: the pre-registration as a
  performed scientific method (kept as a detail: the dated verdict), and
  measured-solid versus estimated-hatched (kept as the drawing rule).
  ASCII-art renderings were proposed and rejected: decoration with no link
  to the subject.
- The page background becomes the broadcast near-black (`#0c0c11`, one
  token); PRNDL's grey page bg was the disliked part of D27. Orbitron is
  limited to the wordmark, driver codes and position numbers.
- An isometric explainer figure of the cut-off detector (anatomy skill) is
  optional scope on the method page only, so the landing keeps one
  signature moment.

## D30 — 2026-10-20 — Straight speed profiles are cross-lap aggregates at 50 m
- The straight instrument needs a speed profile. A per-lap profile at 10 m
  bins would be the raw trace under another name (at 3.7 Hz a car covers
  20–25 m between samples), which D9 forbids. The site therefore serves,
  per driver and per straight, the median speed over all clean laps in the
  session per 50 m bin (whole kph) and the median per-lap mean acceleration
  per bin, stored as `speed_bin_<n>` and `accel_bin_<n>` variables on lap 0
  of the model run next to the regime bins, and served by
  `GET /sessions/{key}/straights/{s}/profile?driver=`.
- Nothing of it is committed to the repository; the view fetches it at
  runtime. No per-lap profile endpoint is built; the per-lap view keeps the
  regime bins and the per-lap cut-off tick.

## D31 — 2026-10-20 — F1 imagery, logos and typefaces may be used in the view
- The owner's call: this is a private, non-commercial portfolio project, so
  the self-imposed ban on F1, FIA and FOM marks and on the official F1
  typeface (D24, AGENTS.md) is lifted. Imagery is chosen by the owner (the
  first is the F1 "digital presentation" wallpaper as the landing hero),
  compressed to WebP/JPG under `web/public/`, and credited in the footer.
- Caveat recorded for later: revisit before the site is linked publicly from
  applications; trademark use that is fine for a private project can draw
  attention once it is public.

## D33 — 2026-10-21 — A straight across the line needs usable, not green, samples from the previous lap
- The window of a straight that crosses the start/finish line is measured
  back from the lap's own line crossing, so the previous lap only has to
  supply real, continuous samples there. The gate was "previous lap green",
  which in qualifying is never true (the lap before a flying lap is the
  out-lap), so straight 1 had no rows and no speed profile in all 14
  qualifying and sprint-qualifying sessions (docs/backend-review-2026-10-21.md).
- **Decision:** for the per-lap threshold cut-off, the entry speed and the
  speed profile, the gate is `pipeline.tail_usable`: consecutive, resolved,
  not neutralised, not an in-lap, no telemetry gap over `MAX_GAP_S`, at least
  `MIN_SAMPLES` samples. That accepts out-laps, cool-down (`slow`) laps,
  `length` outliers, `no_start` laps and a race's standing-start lap 1 as the
  previous lap; the length rule does not matter for a tail because the window
  is placed from the next lap's own start. Flags are used rather than
  `reason`, which names only the first failed rule and would hide a gapped or
  neutralised lap behind `out_lap`. A gap straddling the line can still reach
  about 4 s of interpolation (2 s on each side); that is unchanged.
- **The pooled hinge CdA keeps the strict gate** (`sweep(strict_wrap=True)`).
  The hinge model fits runs that start from an out-lap badly (their residual
  rises with CdA), and with them pooled the CdA fell to the grid edge in six
  qualifying sessions. The hinge outputs and `deploy_energy_rel` are not
  written for the new rows either. So D33 is additive: every row of the
  previous run is unchanged, the only new output is straight 1 after a
  non-green lap.
- Known effect to keep in mind when reading straight-1 medians: after an
  out-lap the cut-off can sit earlier (Baku Q 11373: median −1,072 m after an
  out-lap against −577 m after a green lap). Rows do not yet carry the kind of
  previous lap; a `prev_lap_kind` variable is a candidate follow-up.
- `MODEL_VERSION` becomes `proxy-0.2`, so the frozen findings run (`proxy-0.1`,
  `6f9df732…`, docs/findings.md) stays reproducible and is not overwritten by
  the recipe at HEAD. Results are recomputed for every session under run id
  `5b91540f-6b7a-4516-9d3f-ba55385ea129` and published; until the run lifecycle of PR #1 is
  merged, publishing is a row in `model_run` written by hand.
- Numbering: D32 is taken by the view rebuild on `feat/web-rebuild`.
