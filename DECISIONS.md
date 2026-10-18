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
- **Addendum 2026-10-17 (second agent's search, arXiv checked by Claude):**
  the deploy cut-off found in Phase S is a known effect called **derating**
  (media: PlanetF1, Scuderia Fans; arXiv 2603.01290 "Opponent State
  Inference Under Partial Observability: An HMM-POMDP Framework for 2026 F1
  Energy Strategy" models a rival's ERS state with an explicit L_derate
  mode, on **simulated data only**, real telemetry listed as future work, no
  code). A Reddit r/F1Technical post read Hamilton's Canada 2026 top speed
  falling then recovering before a pass as save-then-attack: our hypothesis
  as one anecdote. Pitch therefore: "measured derating per car across the
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

## D8 — 2026-10-17 — Stack choices confirmed by Ali
- **Postgres + TimescaleDB from the start.** Timescale is a Postgres extension
  (hypertables: automatic time chunking, compression, time-bucket helpers),
  not a separate database. At ~9M rows plain Postgres would cope; Ali keeps
  Timescale to learn it. Gate 0 must include "what would change without it".
- **Rejected: MongoDB.** The data is relational (car_data → laps → stints,
  overtakes → two drivers, everything → sessions), the workload is analytical
  SQL (window functions, group by distance bin), and pandas reads SQL in one
  line. Every row has the same ten fields, so documents buy nothing.
- **Rejected: Kafka and Spark in the main pipeline.** The season is ~9M rows
  fetched once in ~25 min and analysed in batch. Kafka is for continuous
  multi-producer streams, Spark for data that doesn't fit one machine. Neither
  applies. Adding them would be for the CV, and that is the wrong interview
  answer. Kafka is allowed later as a **replay mode** (Phase 7): re-emit a
  race at real speed onto a topic, consumer updates the regime estimate live.
  That is a real streaming problem with a real reason.
- **View: React + TypeScript (Vite).** Frontend is a strength of Ali's; the
  view should be genuinely good: track map from the `location` endpoint with
  regimes per lap, time scrubbing, two-car comparison. Consequence: `location`
  is ingested in Phase 2, no longer deferred.
- **Cloud: Oracle Cloud free tier (ARM VM, 24 GB) for the services and
  database, plus one small AWS piece (S3 for cached raw JSON, or ECR, or a
  scheduled Lambda fetch) for AWS exposure at near-zero cost.** One deploy
  path only.
- **Ingestion details:** Spring Data JDBC with explicit SQL (not JPA), a
  hand-written token-bucket rate limiter (not Resilience4j), build tool TBD.

## D9 — 2026-10-17 — Design details confirmed by Ali
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
- **Hosting:** Ali's existing Oracle Cloud free-tier ARM server (already runs
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
- Interview-relevant reasoning is collected in docs/interview-notes.md.

## D10 — 2026-10-17 — Phase S result: proceed in proxy mode (CONFIRMED by Ali, 2026-10-17)
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
(docs/improvements-2026-10-18.md; Ali confirmed items 1 (corrected), 2, 3, 4, 5, 7)
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
- **Deferred:** item 6 (publishing in FastF1 #861, r/F1Technical, blog,
  upstream PR) waits for a result and Ali's explicit OK; aggregates only.
- **Rejected:** deep models (no labels), F1 TV tokens (terms), broadcast bar
  as ground truth (FOM estimate).

## Gate results
(date — gate — pass/fail — notes)
