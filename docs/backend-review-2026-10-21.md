# Backend review (2026-10-21)

Read-only review of the backend behind the rebuilt view, prompted by two
symptoms seen in the view: some circuits show no map, and some straights show
no data. Evidence comes from the local database (the published run
`proxy-0.1` / `6f9df732…`), the code on `feat/web-rebuild`, and the open pull
requests. Nothing was changed. Fixes are proposed at the end, one pull request
per group (D23 practice).

## Summary

| # | Finding | Effect in the view | Severity |
|---|---|---|---|
| 1 | The circuit outline is built from the first race session with no check that the chosen lap has location samples or is a closed lap | Monaco: no map, no straights, no profile (both sessions). Hungaroring: the map is a 3.65 km open arc whose origin is not the start line, so every straight, tick and dot is misplaced | high |
| 2 | A straight that crosses the start/finish line is skipped unless the previous lap is green | Straight 1 (the main straight) has no rows and no speed profile in **every** qualifying and sprint-qualifying session (14 sessions) | high |
| 3 | The speed-profile endpoint exists only on PR #8 (`feat/straight-profile`); the built jar from 2026-10-19 predates it | Every speed profile answers 404 when the API runs from `feat/web-rebuild`, `main`, or that jar | high (environment) |
| 4 | 20 curated "Straight" sections are 120–250 m long; 14 of them never produce a row (the detector needs a 4 s full-throttle run), 6 do because they sit inside a longer run | Listed as straights with no data on 10 circuits | medium, by design |
| 5 | Cut-off medians need 3 detected laps; qualifying gives each driver 3–5 green laps | Medians exist for under half the field on most qualifying straights | low, by design, undocumented |
| 6 | 29 car-sessions have telemetry but no results | All have zero green laps (lap-1 retirements, no classified lap); the audit's "unexplained" item is explained | docs only |
| 7 | Audit fix PRs #1–#5 are still open; PR #6 and #8 are stacked on #4 | The published-run logic, Dockerfiles, API-source windows and CI fixes are not on `main` | process |
| 8 | Port 8080 is held by an unrelated container on this machine | The API cannot bind, or the Vite proxy reaches the wrong service | environment |

Backup and database agree: 50 sessions through Singapore (11388), 45 complete,
4 with no data (Bahrain and Jeddah), one with the known Monaco feed gap.
Python tests: 53 pass. Java tests: see the last section.

## 1. Outline reference lap (API)

`OutlineService.build` takes the circuit's earliest race session, its fastest
green lap, and the `location` rows inside that lap's `[date_start, date_start +
lap_duration]` window. Two circuits break this:

| Circuit | Reference lap | What comes back | Why |
|---|---|---|---|
| Monte Carlo (22) | 11299 driver 12 lap 76, 13:58 + 76 s | 0 points | the race `location` feed ends at 14:00:14 (docs/data-quality-notes.md); the first laps that have location are 7, 19, 44 |
| Hungaroring (4) | 11342 driver 44 lap 59 | 309 points, path 3,650 m against a 4,328 m lap | the race lap clock is off by 3–6 min and the location feed is frozen from about 13:25 (D17). The session is excluded from modelling but still chosen for the outline because it is the only race |

For the other 14 circuits the reference lap's path length is within 1.3 % of
the median lap length and the ring closes within 60 m, so they are sound.

Two smaller faults in the same path: an empty outline is returned as `200`
with `points: []` rather than `404`, so the view says "not ingested yet" for a
session that is fully ingested; and `OutlineService` only caches non-empty
results, so Monaco rebuilds the empty outline on every request (three queries).

**Proposed fix (api, one PR):** pick candidate green laps across all sessions
of the circuit whose `boundary_source` is `laps` (races first, then by lap
time), build the outline for each in turn, and accept the first that passes
three checks:
- path length, summed over the raw `location` samples (not the 50 m chords,
  which under-read on twisty circuits), within 3 % of the circuit's median
  green `lap_length_m`, not the candidate lap's own (a lap with a wrong clock
  has a wrong length too);
- first and last points within 60 m (the ring closes);
- the first point within about 50 m of the median position at `date_start`
  over that session's green laps, so the outline starts at the line. Length
  and closure alone would pass a lap whose clock is 2 s off, which shifts
  every straight by about 150 m.

Return `404` when none qualifies. One `location` query per candidate, and
the result is cached per circuit (the cache never expires, so the API needs a
restart after the fix). Add an `ApiIT` case with a lap that has no location
rows and one with a shifted clock.

## 2. The main straight in qualifying (model)

`pipeline.sweep` and `profile.straight_profiles` apply the same rule to a
straight whose window starts before the line (`start_pct > end_pct`): the
previous lap must be green **and** consecutive. In a race that holds for most
laps. In qualifying the lap before a flying lap is always the out-lap (reason
`out_lap`, 1,611 cases) or a cool-down lap (`slow`, 545), never green, so the
window is never analysed:

| Session | Straight 1 | Drivers with per-lap rows | Drivers with a profile |
|---|---|---|---|
| 11357 Monza Q | 1,111 m | 0 of 22 | 0 |
| 11249 Suzuka Q | 1,139 m | 0 of 22 | 0 |
| 11322 Silverstone Q | 893 m | 0 of 22 | 0 |
| 11303 Catalunya Q | 883 m | 0 of 22 | 0 |
| 11276 Miami Q, 11241 Shanghai Q, 11311 Spielberg Q, 11330 Spa Q, 11338 Hungaroring Q, 11730 Kuala Lumpur Q, 11365 Madring Q, 11317/11379 sprint qualifying | 277–702 m | 0–1 | 0 |

The gate is stricter than it needs to be. The trace (`physics.build_trace`) is
one continuous resampled series per driver over the whole session, and
`_lap_windows` places a wrapping window by measuring backwards from this lap's
own line crossing (`s - lap_len`), so the previous lap's length or speed does
not enter. What matters is that the samples before the line are real and
continuous: an out-lap's last kilometre at full throttle is exactly the start
of the flying lap.

**Proposed fix (model, one PR):** gate a wrapping window on the previous
lap's flags and samples, not on its `reason`. `classify_laps` stores only the
first rule that fires (order: unresolved, no_start, standing_start, out_lap,
pit, neutralised, slow, sparse, gap), so `out_lap` can hide a neutralised or
gapped lap, and `build_trace` interpolates across `car_data` gaps, which would
turn a gap in the previous lap's tail into an invented full-throttle run. The
rule: previous lap row exists and is consecutive, bounds resolved, not
`neutralised`, not `pit` (in-lap), `max_gap_s` under the gap limit; better
still, test the samples that fall in the window itself (no raw gap, no overlap
with a neutralised window). Put the rule in one helper used by both
`pipeline.sweep` and `profile.straight_profiles` so they cannot drift. Add a
unit test with a green lap preceded by an out-lap.

Then a **full** re-run of `estimate.py --all` and `profile.py --all-sessions`
under a new `run_id`, and publish (D23 fix 3). Two reasons it cannot be a
qualifying-only run: the API serves exactly one published run for every
endpoint, so a partial run would blank the races; and the hinge CdA is pooled
over every analysed straight-lap of the session (`cda_profile`), so adding
straight 1 moves the cut-offs on the other straights of those sessions. Race
results should move very little (a race lap's previous lap is usually green
already) and the diff against the current run is the acceptance check.
Expected gain: the main straight on every qualifying session, about 14
sessions × 20 drivers.

A second reason straights look empty on the session page, which this fix
alone does not remove: the map marks a straight "with data" only from summary
medians (`lap_number = 0` rows), which need 3 detected laps per driver. With 3–6
flying laps per driver in qualifying, many straights will keep showing no data
even where per-lap rows exist. Either drive that marker from per-lap rows
(`/results` or `/compare`) or lower the threshold for qualifying-type sessions;
whichever is chosen goes in docs/phase4-estimator.md.

## 3. Profile endpoint not on this branch (API, process)

`GET /sessions/{key}/straights/{s}/profile` was added in commit `926a41b`,
which only exists on `feat/straight-profile` (PR #8). `feat/web-rebuild` has
the model side (`profile.py`, commit `64f9178`) and the client, but not the
endpoint; `api/target/api-0.1.0-SNAPSHOT.jar` is from 2026-10-19 19:12 and
does not contain it. Running the API from either gives a 404 on every profile,
which the session page reports as "The speed profile could not be loaded".
The endpoint itself is sound (one indexed query, 200 with empty bins when the
run has no profile rows; a per-straight `cutoff_distance_median_m` row is
read in the same query).

**Action:** merge the stack #4 → #6 → #8, or cherry-pick `926a41b` onto the
branch the API is run from, and rebuild the jar. Until then start the API from
a checkout of `feat/straight-profile`.

## 4. Short curated sections (data)

The TracingInsights files label every full-throttle section "Straight",
including 24 sections of 120–250 m: Zandvoort S2/S4/S6, Monte Carlo S4/S5,
Montreal S2, Melbourne S6, Catalunya S3/S5, Hungaroring S4/S5, Singapore
S2/S4/S7, Spa S3, Silverstone S6, Monza S3 (169 m). `derate.straight_lap`
needs a full-throttle run of 4 s (`MIN_RUN_S`), about 250 m at 220 kph, and a
usable 2.5 s after guards, so these sections never yield a per-lap row. They
do get 2–4 profile bins, which is why the view can show a speed trace with no
cut-off on them.

**Correction after review (PR #11).** The length is not the right test:
`derate.straight_lap` applies the 4 s rule to the whole full-throttle run that
overlaps the window, not to the section, so a short section inside a longer
flat-out run does get rows (Montreal S3, 246 m: 1,078 rows, 84 cut-offs; Monza
S3, 169 m: 42 cut-offs). A length rule at 250 m marks 20 sections false, 6 of
which have rows. The fix taken instead: `/circuits/{k}/straights` reports
`has_results`, whether the published run has per-lap rows on that straight in
any session of the circuit, so the view can draw the others quieter. Ids are
kept (the curated names in `web/src/content/straight-names.json` are keyed on
them).

**Found on the way: one throttle run assigned to two straights.** Where two
curated sections lie on the same flat-out run, `straight_lap` picks the
largest-overlap run for each window independently, so both straights get the
same cut-off on the same lap: Monza S3's 42 cut-offs are S2's, Spa S4 and S5
share 210, Silverstone S5 and S6 share 2. Any aggregate across straights
double-counts those laps. Fix for a separate PR: a run belongs to the straight
with the largest overlap only.

## 5. Medians in qualifying (documented limit)

A per-driver median needs `MIN_LAPS_FOR_SUMMARY = 3` detected laps. Qualifying
gives 3–5 green laps per driver and the primary detector fires on 30–70 % of
laps on medium straights, so most qualifying drivers end with 1–2 detections
and no median. Example: 11384 Singapore Q straight 3 (619 m): 19 drivers have
rows, 7 have a cut-off, 2 have a median. This is the method, not a fault, but
`docs/phase4-estimator.md` and the API contract do not say it, and the view's
tower shows those drivers as "no data" without the distinction. Worth one
sentence in both, and a `laps_detected` count next to the median in the
summary endpoint so the view can say "2 laps, no median".

Also seen: the profile for 11240 Shanghai Sprint has 15 bins on a 696 m
straight and 30 on a 1,382 m one (one driver's bins run past the straight),
from one driver whose median lap length is short; harmless, cut at
`nb = len(window)/50` of the median lap rather than the per-lap window.

## 6. Drivers without results

All 29 (listed below by session) have zero green laps: lap-1 retirements,
drivers who never set a lap, and the seven Singapore sprint cars with 1–7 laps
and none green. `estimate.py` correctly skips them; the audit's "unexplained"
item is closed. The reason should be stated in `docs/phase4-estimator.md`, and
the summary endpoint could return them with `laps_green: 0` so the view can show
"no classified lap" instead of nothing.

11230: 3, 18, 55 · 11234: 27, 81 · 11236: 11 · 11245: 1, 5, 23, 81 · 11275: 27,
41 · 11282: 23, 30 · 11291: 41 · 11299: 3 · 11334: 63 · 11353: 3, 87 · 11361:
16 · 11365: 87 · 11383: 5, 6, 11, 18, 43, 63, 77 · 11384: 6.

## 7. Open pull requests

| PR | Branch | Base | State |
|---|---|---|---|
| #1 model_run lifecycle | fix/model-run-lifecycle | main | open since 10-19 |
| #2 Dockerfiles, pinned TimescaleDB | fix/docker-compose | main | open |
| #3 ingest API source windows | fix/ingest-api-source | main | open |
| #4 API hardening (published run, read-only role, SSE) | fix/api-hardening | main | open; already merged into feat/web-rebuild |
| #5 CI | fix/ci | main | open |
| #6 driver fields | feat/driver-fields | fix/api-hardening | open; already in feat/web-rebuild |
| #8 profile endpoint | feat/straight-profile | feat/driver-fields | open; **not** in feat/web-rebuild |
| #7 web rebuild | feat/web-rebuild | main | open |

Nothing from the audit has reached `main`. The checks show as failing only
because Actions billing is off. Suggested merge order: #1, #2, #3, #5 (independent),
then #4 → #6 → #8, then #7 rebased on the result.

## 8. Environment on this machine

- `127.0.0.1:8080` is held by the `dvwa` container; the API's default port and
  the Vite proxy both point there. Start the API with `SERVER_PORT` set and
  `VITE_API_PROXY` matching, or stop that container.
- `JAVA_HOME` in a fresh shell is Temurin 17; the build needs 21
  (`maven.compiler.release`). `./mvnw test` fails with "release version 21 not
  supported" until `JAVA_HOME` points at the installed Temurin 21.
- The project database container was stopped at the start of this review and
  was started with `docker compose up -d db`.

## Checks run

- Python: `pytest` in `model/`, 53 passed.
- Java: `./mvnw test` with Temurin 21, 54 unit tests pass (ingest 28, api
  15, replay 11). `./mvnw verify` cannot run the Testcontainers integration
  tests here: Testcontainers 1.20.6 gets an empty `400` from Docker Desktop
  29.4.1 ("Could not find a valid Docker environment"), the incompatibility
  that PR #5's bump to 1.21.4 addresses. `IngestIT`, `MigrationsIT` and
  `ApiIT` are therefore unverified on this branch and on this machine.
- Related but out of scope: after the Monaco and Hungary location freezes the
  interpolated `z` holds its last value, so the slope term is silently zero
  on those laps. Worth a line in docs/data-quality-notes.md.
- Database: every query above is reproducible with
  `docker exec -i f1-battery-db-1 psql -U f1 -d f1battery`; the coverage table
  (session × straight: drivers with rows, cut-offs, medians, profiles) is the
  basis for findings 2, 4 and 5.

## Pull requests opened (2026-10-21), each reviewed once more by a second agent

| PR | Finding | What changed after the second review |
|---|---|---|
| #9 api: outline from a lap that draws the circuit | 1 | 404 cached; deterministic candidate order; tests for a blind circuit and the fall-through to qualifying; the start check is per session, so a session-wide clock offset is not caught (follow-up: rotate to a circuit-wide line estimate) |
| #10 model: the main straight in qualifying, D33 | 2 | the pooled CdA keeps the strict gate (the relaxed rows dragged it to the grid edge in six qualifying sessions); hinge and energy withheld on the new rows; `proxy-0.2` so the frozen findings run is not overwritten; full re-run and publish |
| #11 api: `has_results` per straight | 4 | the length flag and its migration were dropped (see the correction above) |
| #12 api: lap counts in the summary | 5, 6 | counts from `cutoff_detected`; measured qualifying shares with the SQL in the doc; the view's `SummaryDriver` type still needs the two fields |

Still open: the audit PRs #1–#5 and the profile endpoint #8 (findings 3, 7).
Merge order: #1, #2, #3, #5, then #4 → #6 → #8, then #9–#12 (independent of
each other; #11 and #12 both touch docs/api-contract.md), then #7.
