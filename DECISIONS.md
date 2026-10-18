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
