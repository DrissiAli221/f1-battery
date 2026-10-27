# API contract (Phase 6), fixed before the API and view are built

The API is read-only and serves **derived** data only (DECISIONS.md D9):
never raw car_data or location samples. Base path `/api`. JSON. All list
endpoints are paginated with `?page=&size=` (default size 100, max 1000)
and return `{items, page, size, total}`. ETag on every GET; results are
immutable per `model_version`.

## Reference data (from Phase 1 and 2 tables)
- `GET /api/sessions` → sessions with `session_key, meeting_key, circuit_key,
  circuit_short_name, session_name, date_start, date_end, year, has_results`.
- `GET /api/sessions/{key}/drivers` → `driver_number, name_acronym, full_name,
  team_name, headshot_url, team_colour (`#RRGGBB`), first_name, last_name,
  broadcast_name, country_code`. The detail fields are nullable (null until
  `drivers` has been re-ingested). `headshot_url` is the OpenF1 source URL;
  the API never proxies or caches images (DECISIONS.md D24).
- `GET /api/sessions/{key}/laps?driver=` → from `lap` joined to
  `lap_quality`: `lap_number, date_start, lap_duration, green, reason`.
- `GET /api/circuits/{circuit_key}/straights` → from `straight`:
  `straight_id, label, start_pct, end_pct, has_results` (whether the
  published run has per-lap rows on the straight in any session of the
  circuit; null when the circuit has no results at all). The curated files
  label 120–250 m stretches "Straight" that the detector usually cannot use,
  so a view can draw `has_results = false` straights quieter.
- `GET /api/circuits/{circuit_key}/outline` → a coarse track outline for the
  map: one reference lap's `location` x/y downsampled to ~50 m spacing with
  cumulative distance; derived, not raw.
  `{session_key, driver_number, lap_number, points: [{d, x, y, z}]}`. The
  reference lap is the first of the circuit's fastest green laps (eight per
  session, races first) that draws the circuit: at least 20 samples, raw path
  length within 3 % of the circuit's median green lap length, first and last
  sample within 60 m, first sample within 50 m of the session's median lap
  start. `404` when no lap qualifies (never an empty `points`).
- `GET /api/sessions/{key}/regulation` → `regulation_event` row.

## Model results (from `model_result`)
Rows are `(model_version, run_id, session_key, driver_number, lap_number,
straight_id nullable, variable, value, ci_low, ci_high)`.
Variables written by Phase 4 (proxy mode, D10):
- per straight per lap: `cutoff_distance_m`, `cutoff_speed_kph`,
  `deploy_energy_rel` (relative units, dimensionless), `entry_speed_kph`,
  `plateau_accel_ms2`, `cutoff_detected` (1/0)
- per lap (straight_id null): `regime_share_deploy`, `regime_share_plateau`,
  `regime_share_lift`, `regime_share_brake`, `deploy_energy_rel_lap`
- per driver per session, lap_number = 0: `cutoff_distance_median_m` per
  straight with `ci_low/ci_high` from the bootstrap, `cutoff_distance_std_m`.

Endpoints:
- `GET /api/models` → distinct `model_version` with `run_id, created_at`.
- `GET /api/results?session=&driver=&variable=&straight=&lap=&model=` →
  paginated rows; `model` defaults to the latest version.
- `GET /api/sessions/{key}/summary?model=` → per driver: one `straights[]`
  entry per straight the driver has per-lap rows on, with `laps_analysed`,
  `laps_detected` and the median cut-off with CI (null unless at least three
  laps were detected, `pipeline.MIN_LAPS_FOR_SUMMARY`); regime shares averaged
  over green laps; team_name, team_colour
  (`#RRGGBB`), headshot_url. Drivers with no results (no green lap) are absent.
- `GET /api/sessions/{key}/laps/{lap}/regimes?driver=&model=` → the regime
  label per 50 m distance bin for that lap (from `model_result` variable
  `regime_bin_<n>` stored as value 0..3, or a compact JSON column if Phase 4
  chooses one; the API hides the storage).
- `GET /api/sessions/{key}/straights/{straightId}/profile?driver=&model=` →
  median speed (kph) and acceleration (m/s2) per 50 m bin from the straight's
  start (`speed_bin_<n>`, `accel_bin_<n>` at lap_number 0), with the lap-0
  cut-off median and interval; empty `bins` when the run has no profile rows.
- `GET /api/compare?session=&drivers=a,b&straight=&model=` → the two drivers'
  per-lap cut-off series side by side.

## Live replay (opt-in, `api.replay.enabled`)
- `GET /api/live` → which sessions have a replay feed right now:
  `{"enabled": true, "active": [{"session_key": 11361, "last_ts": "2026-10-27T11:59:48Z", "age_s": 12}], "capacity": {"max": 3, "used": 1}}`.
  `active` lists the `regime-state.<key>` Kafka topics whose newest record (Kafka record time, wall
  clock) is under 120 s old, newest first; the lookup probes at most the 50 highest session keys and
  is cached in memory for 10 s. With replay disabled the answer is `200 {"enabled": false, "active": [], "capacity": {"max": 0, "used": 0}}`.
  `capacity.max` is the number of replays the VM runs at once (`API_REPLAY_MAX_SESSIONS`), `used` the
  number of active sessions.
  A broker that cannot be reached is `503`.
- `GET /api/live/{session_key}` → server-sent events of the reduced regime state (`driver_number`,
  `ts`, `regime`, `lap_distance_est`); `404` when replay is disabled. See `docs/phase7-replay.md`. Opening the stream for a session that
  has model results records demand (see below); a session with no fresh feed gets the status event
  `{"state":"waiting"}` and the stream stays open until its first state arrives.
- `GET /api/live/demand` → `{"wanted": [{"session_key": 11361, "viewers": 1, "last_seen": "…", "since": "…"}]}`,
  the sessions with an open stream, plus those whose last viewer left under 5 minutes ago, longest
  wanted first. Read by the replay controller on the VM over the compose network; the Caddy origin
  answers 404 for this path, so it is not reachable from the public site. The API itself stays
  read-only: it records demand, it starts nothing.

## Non-functional
CORS for the view origin (env `API_CORS_ORIGIN`). Basic per-IP rate limit
(e.g. 60 req/min, env-configurable). `GET /api/health`. No auth.
