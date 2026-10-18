# Phase 2: lap alignment, data quality, straights

Status: built and run on the full 2026 season (46 sessions with data of 50).
Code: `model/f1battery_model/{db,alignment,quality,straights,regulation,validate_alignment}.py`,
tests in `model/tests/`, schema in `db/.../V4__compression_and_lap_quality.sql`.

## What it produces

* `lap_quality` (29,350 rows, one per lap): green flag, first excluding reason,
  sample count, integrated lap length, largest telemetry gap, rule flags.
* `straight` (see Follow-ups: 15 mapped plus 4 derived circuits) and `straight_windows()` for absolute
  distance windows.
* `regulation_event` (46 rows) loaded from `docs/regulation-events.csv`.
* A per-session quality report, `model/out/quality/<session>.json` (gitignored).
* No per-sample table. Lap and distance are recomputed in memory from
  `car_data` and `lap` (about 0.1 s per driver); a per-sample table would add
  roughly 18 M rows. The exit condition ("every sample has a lap and a distance
  or a reason") holds by construction: the report accounts for every sample
  (17,956,796 of 17,956,796) as assigned or as one of three named reasons.

## Compression (V4)

`car_data` and `location` use Timescale compression, segmented by
`(session_key, driver_number)`, ordered by `ts`; policy: chunks older than 1 day.
The policy job compressed most chunks within seconds of the migration; the
remainder were compressed with `compress_chunk`.

| | before | after |
|---|---|---|
| `pg_database_size('f1battery')` | 3693 MB | 292 MB |
| `car_data` table payload (compression stats) | 1900 MB | 122 MB |
| `location` table payload | 1725 MB | 95 MB |
| `count(*) car_data` / `location` | 17,956,796 / 17,571,268 | unchanged |

Reads of a single driver stay cheap because of the segmenting. Re-ingesting into
a compressed chunk is supported by this Timescale version (2.30); the policy
recompresses afterwards.

## Rules (`alignment.py`)

Each rule is a function with a docstring; `classify_laps` applies them in this
order and records the first that excludes a lap (`lap_quality.reason`).

| Reason | Function | Rule |
|---|---|---|
| unresolved | `resolve_lap_bounds` | Start cannot be derived; the lap gets no samples |
| no_start | `resolve_lap_bounds` | `date_start` missing. Lap 1: session start (else first sample). Other laps: previous start + previous duration |
| standing_start | `flag_lap_one` | Lap 1 of a Race or Sprint |
| out_lap | `lap.is_pit_out_lap` | Out-lap |
| pit | `flag_in_laps` | In-lap: the lap before an out-lap |
| neutralised | `neutral_windows`, `flag_neutralised` | Lap overlaps a closed SC / VSC / red-flag window |
| slow | `flag_slow` | Duration above 1.07 x the driver's median (see below), or untimed |
| sparse | `MIN_SAMPLES` | Fewer than 50 samples |
| gap | `MAX_GAP_S` | Any gap above 2.0 s, including lap start to first sample and last sample to lap end |
| length | `flag_length_outliers` | Integrated length differs more than 3 % from the driver's median green-candidate length |

Sample assignment (`assign_samples`) bisects on the resolved lap starts: a
sample belongs to the lap whose start precedes it, up to the next lap start. The
last lap ends at `date_start + lap_duration`.

Distance (`lap_distance`): trapezoidal integration of speed (km/h to m/s) from
the lap start. The interval from the lap start to the first sample and from the
last sample to the lap end uses the nearest sample's speed, so the lap length
spans the whole lap time.

### Edge cases

* **Lap 1 without `date_start`**: 31 laps, all lap 1. Session start used; lap
  flagged `no_start` and never green. Race lap 1 with a start is excluded as a
  standing start anyway.
* **Samples before the first lap / after the last lap**: reasons
  `before_first_lap` (1.45 M samples) and `after_last_lap` (3.56 M). These are
  grid, garage, formation and cool-down; the car_data window covers the whole
  session slot, the lap table only the laps.
* **Last lap with unknown duration** (retirements): zero length, its samples are
  `after_last_lap`.
* **Driver with telemetry but no laps**: reason `driver_without_laps`, 144,899
  samples (11230 drivers 18, 55; 11236 #11; 11245 #1, 23; 11275 #41; 11282 #23,
  30; 11365 #87).
* **Unclosed neutralisation windows**: not used; the slow-lap rule catches those
  laps. With the corrected matcher no session ends with an open window;
  the Monza window closes at the first TRACK CLEAR during the red flag, and the
  long red-flag lap is removed by the slow rule.
* **"CHEQUERED FLAG" contains "RED FLAG"**: the spike's substring match opened a
  window at the chequered flag. Matching is now on the word boundary. Stewards'
  messages that mention a safety car or red flag (INFRINGEMENT, INCIDENT,
  STEWARDS, NOTED) are ignored.
* **Slow-lap median**: taken over laps that are timed and not already excluded
  as lap 1, out, in or neutralised, so pit laps do not raise the threshold. This
  differs from the spike (median of all laps) and matters in qualifying. With
  fewer than 3 such laps the median of all timed laps is used.
* **Hungary / Shanghai / Suzuka time-base**: see Validation.

## Straights

Files: `data/reference/tracinginsights/sections/<name>.json`, `[label, start_pct,
end_pct]`. Sections labelled "Straight" are numbered 1..n in file order. Percent
of the lap from the start/finish line; `straight_windows(session_key,
lap_length_m)` scales by the lap length measured for the same lap. The straight
that spans the line is two entries (first and last), not merged.

| File stem | circuit_short_name | circuit_key | straights |
|---|---|---|---|
| albert-park-circuit | Melbourne | 10 | 7 |
| bahrain-international-circuit | Sakhir | 63 | 7 |
| jeddah-corniche-circuit | Jeddah | 149 | 8 |
| miami-international-autodrome | Miami | 151 | 5 |
| canada | Montreal | 23 | 7 |
| circuit-de-monaco | Monte Carlo | 22 | 6 |
| circuit-de-barcelona-catalunya | Catalunya | 15 | 8 |
| red-bull-ring | Spielberg | 19 | 6 |
| silverstone | Silverstone | 2 | 7 |
| circuit-de-spa-francorchamps | Spa-Francorchamps | 7 | 7 |
| hungary | Hungaroring | 4 | 6 |
| circuit-zandvoort | Zandvoort | 55 | 7 |
| monza | Monza | 39 | 6 |
| baku-city-circuit | Baku | 144 | 4 |
| marina-bay-street-circuit | Singapore | 61 | 8 |

No sections file: **Shanghai (49), Suzuka (46), Madring (153), Kuala Lumpur
(12)**. Files for circuits not in the 2026 table (unused): Mexico City, COTA,
Imola (emilia), Interlagos, Lusail, Yas Marina. Sakhir and Jeddah have a file but
no usable data (see data-quality-notes).

## Validation

Monza race 11361, driver 63 (`python -m f1battery_model.validate_alignment`):

* 46 green laps of 53 (spike: 46).
* Lap length with the spike's convention (distance up to the last sample):
  median 5749.5 m, std 10.0 m. Spike: 5737.5 m, std 9.9 m. The 12 m median
  difference is the spike's 0.25 s grid dropping the last partial step.
* Full-lap length (this pipeline): median 5759.9 m, std 6.4 m.
* T1 to Roggia is straight 2: 19.14-34.18 % = **1102-1969 m** on a 5760 m lap.
  The spike used 1016-1950 m; the sections file starts the straight about 85 m
  later (after the T1 chicane exit), the end agrees within 20 m.

Location path length vs speed-integrated length (`location_speed_ratio`, median
over drivers, green laps with at least 80 % location coverage), 46 sessions:

* 45 of 46 within +-2 % (range 0.988-1.006 outside Hungary).
* **Flagged: Hungaroring race 11342, ratio 0.927.** Consistent across drivers
  (0.91-0.99). Not a coverage problem (location/car_data samples 1.03). For
  driver 63 the stationary period and pit-limiter speeds in `car_data` fall in
  lap 31 (13:48:10), whereas the `pit` table puts the stop on lap 27 (13:42:56);
  second stop 2:45 later than `pit`. The telemetry and lap/pit clocks disagree
  by minutes, so lap windows contain the wrong stretch of track. 747 of 1273
  otherwise-green laps are removed by the length rule (green fraction 0.37). The
  rest may still be phase-shifted by a few seconds; treat the session as
  unreliable until understood.
* **Monaco race 11299**: location coverage 0.057 of car_data samples, as
  expected (feed partial); ratio 0.989 on the covered laps.
* The length rule also removes 121 of 813 laps in Shanghai race 11245, 94 of 295
  in Shanghai sprint 11240 and 101 of 925 in Suzuka race 11253; cause not
  investigated.
* Kuala Lumpur race 11731: the first backup cut `car_data` at 09:59:59; it was
  refetched (993,652 rows to 10:21:45) and `quality --all` rerun: no `sparse`
  laps, green fraction 0.565. `session.date_start` (07:00) is 1.5 h before the
  first lap, so 458 k samples are `before_first_lap`.

`quality --all` (46 sessions with data; Sakhir 11257/11261 and Jeddah 11265/11269
have no telemetry or laps and report zero drivers):

* 29,350 laps, 19,686 green (67.1 %). By session type: Race 77.5 %, Sprint
  79.8 %, Qualifying 33.9 %, Sprint Qualifying 36.7 %. First-reason counts:
  out_lap 2725, pit 2164, slow 2128, length 1146, neutralised 802,
  standing_start 497, gap 95, sparse 76, no_start 31.
* Sample rate (pooled 1/dt): median 4.17 Hz, p10 2.5 Hz, p90 6.25 Hz (the feed
  is irregular, 0.24 s typical). Largest gap 28.6 s.
* Samples without a lap: 5.15 M of 17.96 M (28.7 %); **all 46 sessions exceed
  5 %**, because of pre-start and post-finish samples (3 reasons above). Share of
  samples with the car moving (> 10 km/h) and no lap exceeds 5 % in 14 sessions
  (races, sprints; up to 15.7 %, Silverstone sprint): the cool-down lap after the
  chequered flag.

## How to run

```
cd model
../.venv/bin/python -m f1battery_model.quality --session 11361   # prints the report
../.venv/bin/python -m f1battery_model.quality --all             # all sessions, writes lap_quality + out/quality/*.json
../.venv/bin/python -m f1battery_model.straights                 # fills straight
../.venv/bin/python -m f1battery_model.regulation                # fills regulation_event
../.venv/bin/python -m f1battery_model.validate_alignment        # Monza check
../.venv/bin/python -m pytest tests
```

`DB_URL` accepts the JDBC form; `DB_USER`/`DB_PASSWORD` default to the
docker-compose development credentials. `--no-write` skips the `lap_quality`
upsert. A full run takes about a minute.

## Open decisions

1. **Hungary race (and possibly Shanghai/Suzuka)**: telemetry vs lap clock
   mismatch. Options: exclude affected sessions from Phase 3-5, or re-align by
   cross-correlating speed profiles with the lap structure. Needs an owner call.
2. **Length rule threshold** (3 %) and gap limit (2 s) are chosen from this data;
   confirm or tune.
3. **Slow-lap median** deviates from the spike (reference laps only).
4. **Straight spanning the start/finish line** is two entries; merge when a
   straight-level fit needs it.
5. **Sections files for Shanghai, Suzuka, Madring, Kuala Lumpur**: derive from
   the data or source them.
6. **Quality-flag semantics**: the "> 5 % samples without a lap" flag fires in
   every session; suggest keying it on moving samples instead.
7. **Per-sample lap/distance** is recomputed, not stored; revisit if Phase 3
   performance needs a table (disk is the constraint, compressed it would be
   small).
8. Kuala Lumpur race telemetry truncation is a Phase 1 ingest-window question
   (`ingest/` not touched here).

## Follow-ups (second pass)

**1. Telemetry boundaries (`boundary_source`, V5).** `alignment.detect_crossings`
finds start/finish-line crossings in `location` (line point and heading are the
median of lap-start positions of a trusted session on the same circuit, qualifying
first; a candidate is trusted if its lap-start positions cluster within 30 m);
`telemetry_laps` numbers them by order and matches the lap rows by count (N-1 or
N crossings, else the driver keeps the lap table). `process_session` runs the lap
table first; if the location/speed ratio is off by > 2 % or the length rule removes
> 10 % of the candidate laps it re-runs with telemetry boundaries and keeps that
result only if it yields more green laps. Result: it was never kept, so all 29,350
`lap_quality` rows have `boundary_source = 'laps'`; the telemetry pass is recorded
in each report under `telemetry_pass`.

| Session | green, lap table | green, telemetry | drivers matched by count |
|---|---|---|---|
| Hungary race 11342 | 526 | 525 | 1 of 22 |
| Shanghai race 11245 | 692 | 681 | 16 of 20 |
| Suzuka race 11253 | 824 | 823 | 2 of 22 |
| Shanghai sprint 11240 | 201 | 186 | 15 of 22 |

Findings: in Hungary the `location` feed is frozen for the rest of the race from
about 13:25 (about 90 % of samples are stationary for every driver), so
line crossings cannot be detected for most laps; the lap clock cannot be repaired
from location there. For Shanghai the telemetry boundaries reproduce the same
length outliers (laps 2-3 off by +-10 %), so those losses are not a lap-clock
problem; cause unknown. Suzuka mostly fails the count match.

**2. No-lap flag** now uses moving samples only (speed > 30 km/h, share of moving
samples). It fires in 24 of 46 sessions (cool-down laps and Hungary/Kuala Lumpur
style truncation), versus 46 before.

**3. Straights without a sections file** (Shanghai, Suzuka, Madring, Kuala
Lumpur): `derive_straights` takes the circuit's fastest green lap in
`lap_quality` and keeps full-throttle (>= 98 %) runs above 200 km/h of >= 4 s;
positions are percent of that lap's integrated length; label `derived`.

| Circuit | reference (session, driver, lap) | straights |
|---|---|---|
| Shanghai | 11236, 63, 10 | 5 |
| Suzuka | 11249, 12, 14 | 4 |
| Madring | 11365, 1, 18 | 4 |
| Kuala Lumpur | 11730, 3, 11 | 5 |

A straight crossing the start/finish line is one entry with start_pct > end_pct and
is id 1 (file circuits: Monza now has 5 straights, T1 to Roggia still id 2). Counts
in the table above drop by one for every circuit where the file had a first and
last straight touching the line. `straight_windows` returns `end_m` beyond the lap
length for a wrapping straight; `window_mask(dist, start_m, end_m, lap_length_m)`
tests distances against it.

**4. Kuala Lumpur** rerun included (see Validation). Run `straights` after
`quality --all`, since derivation reads `lap_quality`.
