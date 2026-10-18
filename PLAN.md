# Phase plan

Written 2026-10-17, revised 2026-10-18. A feasibility spike came first and
set the scope (DECISIONS.md D2, D10). Two independent reviews the same day
tightened the exit conditions and reframed the hypothesis (D7, D11). Phases
are built in order by agents; each ends with its exit condition met, a design
note in `docs/`, and a review checkpoint (D15).

**Hard rules:** HYPOTHESIS.md and docs/spot-checks.md are frozen before any
Phase 4 output exists. A phase whose own check fails stops and reports.

---

## Phase S: feasibility spike — done 2026-10-17, result 1/3, proxy mode

See spike/RESULT.md and D10. Question: can the energy regimes be seen in
3.7 Hz public telemetry at all?

Back-of-envelope (assumptions ~790 kg, ~400 kW ICE, CdA ~1.0 m² in low-drag
mode): integer-kph speed at 3.7 Hz gives ~0.4 m/s² noise on raw acceleration,
~0.13 m/s² after a 9-sample fit. A 350 kW deploy changes acceleration by
~5 m/s² at 300 kph; a full-throttle super-clip with harvest reads ~−6 m/s².
Unknowns: the active-aero state (not published; shifts the drag baseline by
~1.6 m/s² at 300 kph) and slipstream. The C5.2.8 taper starts at 290 kph
(1800 − 5·290 = 350), not near 345.

Exit conditions, fixed in advance (judgment calls, not proven thresholds):
1. Taper visible as a slope break in 290–345 kph relative to a drag-only fit
   below 290 kph. **Not demonstrated.**
2. Super-clip segments repeatable on ≥ 80 % of green-flag laps within ±50 m.
   **Fail as written**; the first pass was a smoothing artifact.
3. Lap-to-lap regime agreement ≥ 80 % on full-throttle bins. **Pass.**

Outcome: continue as an energy-management proxy (regimes, per-straight deploy
cut-off, relative deploy energy), no state-of-charge numbers.

---

## Phase 0: setup — done 2026-10-18 (D12)

- docker compose: Postgres + TimescaleDB.
- Maven multi-module build (D9): `db/` (Flyway migrations), `ingest/` (job),
  `api/` (server). Java 21, compiled with `--release 21`.
- Python package skeleton (`model/`), pinned venv (Python 3.14 confirmed for
  the scientific stack and PyNumDiff).
- One versioned results table, the only interface from Python to Java (D4).
- `.gitignore` excludes all data. Raw backup of every 2026 session in
  `data/raw/openf1/` (D13, D14).
- Open: the Flyway migrations are verified by `MigrationsIT` (Testcontainers);
  it runs in CI once Actions billing is enabled, or locally with Docker.

---

## Phase 1: ingestion

Scope: all 2026 sessions in the raw backup (races, qualifying, sprints).
Endpoints: sessions, meetings, drivers, laps, stints, pit, car_data, location,
overtakes, race_control, intervals, position, weather, session_result,
starting_grid.

- Two sources behind one interface (D9): `LocalBackupSource` reads
  `data/raw/openf1/` (one gzipped JSON file per request plus `manifest.json`);
  `ApiSource` calls the live API with the same parser and upsert. Only the
  fetch differs. Tests use local files and WireMock.
- Live source: rate-limited under 3 req/s and 30 req/min with a token bucket,
  exponential backoff with jitter on 429/5xx, gzip transfer, keep-alive.
- **Idempotent**: upsert on the natural keys in `V1__init.sql`; a second full
  run inserts 0 rows. **Resumable**: the ingestion log records every fetched
  unit (endpoint, session, driver, window) with status; a restart skips
  complete units.
- Dedupe duplicate (driver, timestamp) rows before insert.
- Bulk inserts (JDBC batching), not row-by-row.
- Sessions selected by `session_name`, never `session_type` (which lumps
  sprints with races). Session 11731 is the relocated Bahrain GP at Kuala
  Lumpur; key on `meeting_key`/`circuit_key`, not country name. 404 sessions
  are recorded as "no data".
- Data-quality facts from the backup (docs/data-quality-notes.md) are
  asserted, not discovered again: Monaco race location gap, grid on the
  qualifying session.
- Actuator health, Micrometer counters (rows, requests, 429s), structured
  logs, configuration via environment variables.
- Tests: Testcontainers (timescaledb image) and WireMock recordings for the
  200, 404, 429 and 502 paths. CI on GitHub Actions, arm64 image build.

**Exit condition:** every session in the backup loaded from local files; a
second run inserts 0 rows; row counts match the manifest and are recorded in
DECISIONS.md; the live source passes its WireMock tests; CI green.

---

## Phase 1.5: thin cloud deploy

Containerised ingestion job plus Postgres/Timescale on an Oracle Cloud ARM
instance, cached raw JSON synced to a private S3 bucket (backup and the AWS
piece, D9), deployed from GitHub Actions, with basic metrics. A weekly cron
re-runs the ingester, then the model; the ingester is idempotent and
resumable, so a new race is "run it again". No raw data served publicly.

**Exit condition:** one command deploys; the cron run completes on the
server; metrics visible.

---

## Phase 2: data model and alignment

- Map each sample to a lap and a distance along the lap (integrate speed
  between lap start timestamps; validate against `location` once per race).
- Explicit lap-assignment rules: lap 1 without a start time, out-laps, pit
  laps, SC/VSC laps. Data-quality report per session: sample rate, gaps,
  missing drivers, samples with no lap, neutralised laps.
- Per-circuit straight definitions from the curated sections files
  (data/reference/tracinginsights) so comparisons use the same segments.
- `regulation_event` filled from docs/regulations.md for every session, with
  `limit_known` false where the per-event value is not public.

**Exit condition:** every sample in every session has a lap and a distance or
an explicit reason why not; the quality report is produced per session.

---

## Phase 3: physics baseline and regimes

- Acceleration: compare Savitzky–Golay, a Kalman/RTS smoother and
  total-variation differentiation (PyNumDiff) on a synthetic straight with
  known truth; pick by error and document the choice (D11). The 1.5 s
  brake-onset guard stays.
- Slope correction g·sinθ from `location.z`, computed over 50–100 m because
  `z` is integer-quantised (D11).
- Mass falls linearly with laps from a sourced start mass; CdA fitted per car
  per event and reported, never assumed (D11). Coasting may include MGU-K
  recharge and the active-aero mode is unknown, so fit segments are chosen
  explicitly and documented.
- Electric power envelope by speed read from `regulation_event`, never
  hard-coded.
- Regime classification: deploy / brake-harvest / lift-and-coast / super-clip /
  idle, shown on a track map per car. Prior art (Energymind HMM) read first
  and cited in docs/findings.md.
- **Derate detector:** the cut-off is a ramp, not a step. C5.12.6 limits the
  reduction to 50 kW/s at events whose power-limited distance exceeds 3500 m
  and 100 kW/s elsewhere, only while ERS-K power is above 100 kW. The cut-off
  is the **ramp start**; the ramp is fitted with the event's rate from
  `regulation_event`; a hinge fit per straight per lap, bootstrapped over laps
  for a confidence interval per car per event. Lift labels allow for the
  ~200 kW burst on throttle reapplication.

**Exit condition:** the method comparison is reproducible from a script; the
Monza and Singapore spike results are reproduced by the pipeline (cut-offs
within the spike's error bars; no cut at Singapore); regime maps exist for
every session. **A failure here stops the build and is reported.**

**Precondition for Phase 4:** HYPOTHESIS.md and docs/spot-checks.md frozen,
lap numbers filled from data.

---

## Phase 4: energy-management estimator (proxy mode, D10)

- Per-straight deploy cut-off distance and speed with confidence intervals,
  relative deploy energy above the ICE-only plateau, per-lap regime shares.
  No state-of-charge numbers unless a later qualifying check shows the taper.
- Uncertainty bands, not single numbers. Assumptions listed in the output.
- Written to `model_result` with `model_version` and `run_id`; a re-run with
  the same `run_id` is idempotent.

**Exit condition:** every session has results for every car; the spot checks
are evaluated and reported pass/fail/not testable.

---

## Phase 5: findings

- Run the frozen HYPOTHESIS.md test exactly as written, including the
  permutation negative control. Report it even if the effect is null.
- Power-unit maker comparison: cut-off distance and speed by straight, by
  event.
- Write-up in `docs/findings.md`: method, assumptions, results, limits, prior
  art.

**Exit condition:** findings.md complete with every number reproducible from
a committed script.

---

## Phase 6: API and view

- Java REST API over `model_result`: read-only, paginated, ETag caching,
  CORS, basic rate limit. Serves derived outputs only (D9), never raw samples.
- React + TypeScript view (D8): track map from `location` with regimes per
  lap, time scrubbing, two-car comparison, per-event PU-maker summary.
- Deployed on the Phase 1.5 infrastructure.

**Exit condition:** the view works against the deployed API for every
session with results.

---

## Phase 7 (optional): live replay with Kafka

Re-emit one race's samples at real speed onto a Kafka topic; a consumer keeps
a running regime estimate and the view follows it live. The only justified
use of streaming here (D8).

## Deferred

Team radio as weak validation (2026 radio coverage is very low). Remaining
2026 races as they happen (the ingester re-runs). A qualifying-only check of
the C5.2.8 taper, which may lift the proxy-mode restriction.
