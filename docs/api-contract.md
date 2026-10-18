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
  team_name`.
- `GET /api/sessions/{key}/laps?driver=` → from `lap` joined to
  `lap_quality`: `lap_number, date_start, lap_duration, green, reason`.
- `GET /api/circuits/{circuit_key}/straights` → from `straight`:
  `straight_id, label, start_pct, end_pct`.
- `GET /api/circuits/{circuit_key}/outline` → a coarse track outline for the
  map: the fastest green lap of one reference session, `location` x/y
  downsampled to ~50 m spacing with cumulative distance; derived, not raw.
  `{session_key, driver_number, lap_number, points: [{d, x, y, z}]}`.
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
- `GET /api/sessions/{key}/summary?model=` → per driver: median cut-off per
  straight with CI, regime shares averaged over green laps, team_name.
- `GET /api/sessions/{key}/laps/{lap}/regimes?driver=&model=` → the regime
  label per 50 m distance bin for that lap (from `model_result` variable
  `regime_bin_<n>` stored as value 0..3, or a compact JSON column if Phase 4
  chooses one; the API hides the storage).
- `GET /api/compare?session=&drivers=a,b&straight=&model=` → the two drivers'
  per-lap cut-off series side by side.

## Non-functional
CORS for the view origin (env `API_CORS_ORIGIN`). Basic per-IP rate limit
(e.g. 60 req/min, env-configurable). `GET /api/health`. No auth.
