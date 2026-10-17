# Phase plan

Written 2026-10-17. Reviewed by an advisor pass the same day, which changed the
order: a feasibility spike comes first, and scope is cut to race sessions until
the core idea is proven. A second independent review the same day (DECISIONS.md
D7) tightened the Phase S exit conditions, reframed the hypothesis, added a
thin early cloud deploy and a 2026-11-15 "minimum interview story" milestone.

**Priority rule:** the job search comes first. This project never reduces the
daily application volume. Agents can build in parallel, but Ali's study time
is the real bottleneck.

**Ownership rule:** Ali owns the architecture, DECISIONS.md and HYPOTHESIS.md.
Agents build. Each phase ends with a **study gate**: Ali explains the phase out
loud in about 2 minutes, without notes, then Claude quizzes him with follow-up
"why" questions. A phase goes on the CV only after its gate is passed.

**Agent assignment:** one agent per area at a time (see AGENTS.md). The phases
below say what "done" means, not who does it. Ali assigns.

---

## Phase S: feasibility spike (target 2026-10-18 → 10-20)

Question: can the energy regimes be seen in 3.7 Hz public telemetry at all?

- Throwaway Python notebook in `spike/`. Pull data straight from OpenF1, no DB.
- One race: **Monza 2026** (session_key 11361; long straights, cars reach the
  345 kph cutoff). Add Singapore (11388) as a contrast circuit. 3–5 cars from
  different power-unit makers.
- Plot speed, smoothed acceleration, throttle and gear against distance along
  the lap, overlaying green-flag laps.

Back-of-envelope (review, 2026-10-17; assumptions ~790 kg, ~400 kW ICE,
CdA ~1.0 m² in low-drag mode): integer-kph speed at 3.7 Hz gives ~0.4 m/s²
noise on raw acceleration, ~0.13 m/s² after a 9-sample fit. A 350 kW deploy
changes acceleration by ~5 m/s² at 300 kph; a full-throttle super-clip with
harvest reads ~−6 m/s². The signal should be well above the noise. The real
unknowns are the **active-aero state** (not published either; low-drag vs
high-downforce mode shifts the drag baseline by ~1.6 m/s² at 300 kph) and
**slipstream**. Note the C5.2.8 taper starts at **290 kph** (1800 − 5·290 =
350), not near 345.

**Exit condition (all three, each with a number):**
1. **Taper visible:** at full throttle in top gear, the acceleration-vs-speed
   curve shows a slope break in the 290–345 kph band relative to a drag-only
   fit made below 290 kph (same car, same lap set). Report the residual.
2. **Super-clip candidates are repeatable:** segments with full throttle, top
   gear and deceleration beyond the drag baseline appear on at least **80 %**
   of green-flag laps within **±50 m** of the same lap distance, for at least
   one straight at Monza.
3. **Regime map is repeatable lap to lap:** per-car regime labels
   (deploy / clip / other) agree on at least **80 %** of distance bins across
   consecutive green-flag laps. Differences between power-unit makers are a
   *finding* to note, not a pass/fail criterion.

**If it fails:** record that in DECISIONS.md, rename the output an
"energy-management proxy" (regime detection only, no state-of-charge numbers),
and continue with a reduced scope. Don't hide the result.

**Gate S:** Ali explains why acceleration from 3.7 Hz integer-kph speed is
noisy, what was done about it, and why active aero is a confounder.

---

## Phase 0: setup (after Phase S)

- docker compose: Postgres + TimescaleDB.
- Java 21 Spring Boot skeleton (`ingest/`). JDK 23 is installed, so compile
  with `--release 21`.
- Python package skeleton (`model/`), pinned venv. Check that the scientific
  stack supports the local Python 3.14. If not, use 3.12.
- One versioned results table, the only interface from the Python side to the
  Java side (see DECISIONS.md D4).
- `.gitignore` excludes all data.

**Gate 0:** Ali draws the architecture from memory and explains each arrow.

---

## Phase 1: ingestion, race sessions only (target: gate passed by 2026-10-30)

Scope: 2026 **race** sessions only. Endpoints: sessions, drivers, laps, stints,
pit, car_data, overtakes, race_control. Qualifying, sprints and location are
deferred.

- Java service calling the OpenF1 REST API: rate-limited (stay under 3 req/s
  and 30 req/min), **idempotent** (re-running never creates duplicates),
  **resumable** (a crash mid-season continues where it stopped).
- About 17 races × 22 cars ≈ 400 car_data requests. The rate limit isn't the
  bottleneck.
- Handle the 404 races (Bahrain 11261, Jeddah 11269) as "no data", not as errors.
- Select races by `session_name == "Race"`: `session_type=Race` also returns
  sprints (31 rows for 2026). Exclude session 11731 (bad "Kuala Lumpur" row)
  until explained.
- Ingestion log table: what was fetched when, row counts.
- Bulk inserts (JDBC batching or COPY), not row-by-row.
- Integration tests with Testcontainers (Postgres), CI on GitHub Actions.
- **Ali writes by hand:** the rate limiter, the upsert, and the resume logic.
  Agents may draft the rest.

**Exit condition:** all available 2026 races loaded. A second full run inserts 0
new rows. Row counts are recorded in DECISIONS.md. CI is green.

**Gate 1:** how is idempotency guaranteed? What happens on a 429 or a 502? Why
this primary key? (Ali must answer these himself.)

**CV line allowed after Gate 1** (wording to be approved by Ali): building an
ingestion pipeline for 2026 F1 telemetry (~9M rows) in Spring Boot and
TimescaleDB, as groundwork for estimating hidden battery usage.

---

## Phase 1.5: thin cloud deploy (target: by 2026-11-15)

Cloud is half the profile, so it doesn't wait for Phase 6. Containerised
ingestion service plus a managed Postgres on one cloud provider, deployed
from CI, with basic metrics (rows ingested, requests, 429 count). No public
data (DECISIONS.md D5). Gate: Ali explains the deploy pipeline end to end.

**Minimum interview story, due 2026-11-15:** Phase S figures, ingestion in
the cloud with CI, and a regime map for one Monza car. Everything after this
is a bonus for the Jan/Feb 2027 applications.

---

## Phase 2: data model and alignment

- Hypertable for car_data. Map each sample to a lap and a distance along the
  lap (integrate speed between lap start timestamps). Validate once against
  the `location` endpoint on one race.
- Data-quality report per race: sample rate, gaps, missing drivers, laps
  behind the safety car or VSC (from race_control).
- `docs/regulations.md` filled for every race (see Phase 3 dependency).

**Gate 2:** why distance and not time as the x-axis? How do you treat safety-car laps?

---

## Phase 3: physics baseline and regimes

- Smoothed acceleration, with the method chosen in Phase S.
- Per-car, per-event drag/rolling-resistance fit. **Caution:** in 2026,
  "coasting" may include MGU-K recharge, and the active-aero mode is unknown,
  so choose fit segments carefully and document the choice.
- Read the Energymind README (HMM regime model) first so the regime model is
  not reinvented; cite it in docs/findings.md.
- Electric power envelope by speed, **read from docs/regulations.md for that
  event**, never hard-coded.
- Regime classification: deploy / brake-harvest / lift-and-coast / super-clip /
  idle. Show it on a track map per car.

**Gate 3:** what is the model's biggest assumption, and how would you know if it's wrong?

---

## Phase 4: energy-state estimator

**Precondition:** HYPOTHESIS.md is complete, dated and frozen before any
Phase 4 output exists.

- Per-lap energy trajectory, constrained to the 4 MJ state-of-charge window
  (C5.2.9) and the per-event recharge cap (C5.2.10).
- Uncertainty bands, not single numbers. Assumptions (engine power, mass/fuel
  burn, drag) listed in the output.
- If Phase S failed: skip state numbers and keep only per-lap regime proxies.

**Gate 4:** why can't you separate engine power from electric power exactly?
What did you assume instead?

---

## Phase 5: findings (stretch goal for the application window)

- Run the frozen HYPOTHESIS.md test exactly as written, including the
  permutation negative control. Report it even if the effect is null.
- Power-unit maker comparison: clipping frequency, where on track, race vs race.
- Write-up in `docs/findings.md`: method, assumptions, results, limits.

**Gate 5:** a 3-minute talk of the finding as if in an interview.

---

## Phase 6: API, view, deploy

- Java REST API over the results table.
- Small web view: track map with regimes, per-race comparison.
- Extends the Phase 1.5 deploy. Public view shows **aggregates or a recorded
  demo only**. Full per-lap derived telemetry stays local (see DECISIONS.md D5).

**Gate 6:** walk through a request from browser to database.

---

## Deferred (only after Phase 5)

Qualifying and sprint sessions (cleanest clipping signal). Location data.
Team radio as weak validation (2026 radio coverage is very low per OpenF1).
Remaining 2026 races as they happen.
