# Phase 6: API and view

Implements `docs/api-contract.md`. The API is read-only and serves derived data
only (DECISIONS.md D9); the view is a small Vite + React + TypeScript app that
draws everything as SVG.

## Endpoints (all under `/api`, JSON)

List endpoints return `{items, page, size, total}`; `page` is zero-based,
`size` defaults to 100, maximum 1000 (400 outside 0..1000 / below 0).

| Path | Notes |
|---|---|
| `GET /health` | `{"status":"ok"}`, exempt from the rate limit |
| `GET /sessions?year=&circuit=` | newest first; `has_results` = any `model_result` row for the session |
| `GET /sessions/{key}/drivers` | 404 for an unknown session |
| `GET /sessions/{key}/laps?driver=` | `lap` left-joined to `lap_quality`; also returns `driver_number`; `green`/`reason` are null without a verdict |
| `GET /sessions/{key}/regulation` | the `regulation_event` row; 404 if none |
| `GET /circuits/{ck}/straights` | empty list if the table is absent or has no rows |
| `GET /circuits/{ck}/outline` | see below; 404 if the circuit has no race session or lap |
| `GET /models` | published runs from `model_run` (`created_at` = `finished_at`); from `model_result` only while `model_run` is empty |
| `GET /results?session=&driver=&variable=&straight=&lap=&model=` | one run only: the latest published run of `model` (default: latest published run overall), see Model runs |
| `GET /sessions/{key}/summary?model=` | one item per driver: `straights[]` (one entry per straight with per-lap rows: `laps_analysed`, `laps_detected` from `cutoff_detected`, and `cutoff_distance_median_m`, `ci_low`, `ci_high` from `lap_number = 0`, null below three detected laps) and `regime_shares` averaged over green laps (all laps if the session has no `lap_quality` rows) |
| `GET /sessions/{key}/laps/{lap}/regimes?driver=&model=` | `[{bin, d_start_m, label}]` from `regime_bin_<n>` variables, value 0..3 = deploy, plateau, lift, brake; `d_start_m = bin * 50` |
| `GET /compare?session=&drivers=a,b&straight=&model=` | not paginated: `{session_key, model_version, straight_id, drivers:[{driver_number, name_acronym, team_name, series:[{lap_number, straight_id, cutoff_distance_m, ci_low, ci_high}]}]}` |

With no `model_result` rows every results endpoint returns an empty list (or
empty `series`); `lap_quality` and `straight` are probed with `to_regclass`, so
the API also starts against a database that predates V4.

Every `/api/*` response carries an ETag (`ShallowEtagHeaderFilter`, body hash);
`If-None-Match` gives 304. Results are immutable per run, so this is sound.

## Model runs

`V6__model_run.sql` adds `model_run(model_version, run_id, started_at, finished_at,
published, sessions_done, note)`. The model writes a row at the start of a run,
writes `model_result`, and sets `published = true` and `finished_at` only after
every session is committed. `ModelRuns.resolve` serves the published run with
the latest `finished_at` (per `model_version` when `model` is given), so a newer
unpublished or single-session run cannot hide it and a partial `--all` run is not
served mid-way. Only when `model_run` has no rows (a database that predates V6)
does it fall back to the newest run in `model_result`. V6 backfills existing runs
as published. The answer is cached for 30 s per requested model, so a newly
published run appears within half a minute. Contract test: `ModelRunsIT`.

`has_results` (`exists` over `model_result` by `session_key`) was checked with
EXPLAIN on 2.1 M rows: an index-only scan of `model_result_idx` that stops at the
first hit (about 1 ms per session; 9 ms worst case for a session without results),
so no extra index was added.

## Outline downsampling

`/circuits/{ck}/outline` is the only code path that reads `location`. It picks
the first `Race` session of the circuit (by `date_start`), then the reference
lap: the fastest non-pit-out lap with `lap_quality.green = true`, or the
fastest non-pit-out lap overall when `lap_quality` is absent or empty for that
session. It reads that lap's samples (`date_start` to `date_start +
lap_duration`), computes cumulative x/y path length over all samples, and keeps
the first sample, the last sample, and every sample at which the path has
advanced at least `api.outline.spacing-units` (default 500) since the last kept
one. Distance `d` and x/y/z are in stored units; OpenF1 stores 1/10 m, so 500
units is about 50 m. Result: `{session_key, driver_number, lap_number, points:[{d,x,y,z}]}`,
cached per circuit in memory (empty outlines are not cached). If the feed is
sparser than the spacing (about 65 m between samples at Monza speeds) every
sample is kept.

## Rate limiting and CORS

Per-client token bucket, `API_RATE_PER_MIN` (default 60) tokens, refilled
continuously; an empty bucket gives 429 with `Retry-After` (seconds). The key is
the socket peer address unless the peer is listed in `API_TRUSTED_PROXIES`
(comma-separated addresses or CIDR ranges, default none); then `X-Forwarded-For`
is read from the right, skipping trusted hops, and the first untrusted address is
the client. A client cannot pick its bucket by sending the header unless it
connects from a trusted proxy. `server.forward-headers-strategy=framework` is set
for scheme and host; it trusts those headers from any peer, which is harmless for
a JSON API but means the API should sit behind the proxy only. Idle buckets
are evicted when the map exceeds 10 000 entries. CORS allows GET/HEAD/OPTIONS
from `API_CORS_ORIGIN` (comma-separated list; default `http://localhost:5173`)
and runs before the limiter so 429s are readable by the browser.

## View

Hash-routed: sessions list, then a session page with the track map (outline,
straights highlighted, selected lap's regimes per bin), driver selector and lap
scrubber, per-straight cut-off chart (driver median and interval as a band),
two-driver comparison and the summary table. Sessions without results show a
banner and empty states instead of charts. Light/dark via CSS variables, usable
at phone width. Regime bins and straights are placed on the outline by their
fraction of the lap (bin count and `start_pct/end_pct`), because outline
distance is in position units, not metres.

Driver selection and straight names: the picker is sorted by lap count (descending, then driver number) and opens on the driver with the most laps that has a straight median in `/summary`; drivers under 75 % of the session maximum are labelled with their lap count and drivers without summary results with "no results". The API labels every curated straight "Straight", so the view takes names from `web/src/content/straight-names.json` (circuit_key, then straight_id; Monza and the Singapore pit straight only) and otherwise shows "Straight N · a–b km", derived from `start_pct`/`end_pct` and the outline length (last outline distance, in decimetres). Straight buttons for which the selected driver has no cut-off rows in `/results` are greyed (still clickable); changing driver selects the first straight that has cut-offs.

The view also has a static "Method log" page at `#/method` (linked from the header and the sessions page). It needs no API: it renders `web/src/content/method-log.json`, a curated record of what was tried, the pre-set check, what was found and what changed, with source links to the repo on GitHub. `docs/method-log.md` is generated from the same file with `node web/scripts/gen-method-log.mjs` (run from the repo root); edit the JSON, not the markdown.

## Running locally

```
# database from docker-compose.yml on :55432, then
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn -B -q -pl api -am package -DskipTests
DB_URL=jdbc:postgresql://localhost:55432/f1battery java -jar api/target/api-*.jar   # :8080

cd web && npm ci && npm run dev        # :5173; VITE_API_BASE overrides http://localhost:8080
npm run build                          # type-check + bundle into web/dist (gitignored)
```

Tests: `mvn -B -q -pl api -am verify`. The integration tests start one
`timescale/timescaledb:2.30.2-pg16` container, run the real `db` migrations
(`spring.flyway.enabled=true` only in the `test` profile), seed one session and
cover every endpoint, pagination, ETag 304, 404 and 429.

## Database role

The API connects as the read-only role `f1_api` (`V7__api_role.sql`: LOGIN, SELECT
on all current and future tables in `public`; password from the Flyway
placeholder `api_db_password`, i.e. `API_DB_PASSWORD`, dev default `f1api`).
`DB_USER` defaults to `f1_api`. With `SPRING_PROFILES_ACTIVE=prod` both the API and
the ingest job refuse to start when `DB_PASSWORD` is unset. See `docs/ops.md`.

## Deferred

Deployment (Phase 1.5 infrastructure), serving `web/dist`, TLS and a real
forwarded-address setup, and running the view against live results (none exist
until Phase 4 writes `model_result`).

## Open decisions

1. Page numbering is zero-based; the contract does not say.
2. `summary` and `regimes` use the pagination envelope; `compare` does not.
3. Regime bins are located on the map by lap fraction; if Phase 4 stores lap
   length per lap, the view could use true distance.
4. Outline spacing is in stored units and assumes 1/10 m; confirm against the
   OpenF1 documentation before quoting metres publicly.
5. Where the view is hosted (static bucket vs served by the API) and the CORS
   origin to configure there.
6. `limit_known = false` rows from `regulation_event` are returned as they
   are; whether the view should say so is undecided.


Units: `location` x/y/z are tenths of a metre (verified against the Monza lap length, see docs/data-quality-notes.md), so the outline's 500-unit spacing is 50 m.

Straight speed profile: `python -m f1battery_model.profile --session <key> --run-id <uuid>` (or `--all-sessions`, from `model/` with the venv active) adds `speed_bin_<n>` (median kph) and `accel_bin_<n>` (median m/s²) rows with `lap_number` 0 per driver per straight to an existing run; bin n is [50n, 50n+50) m from the straight's start. It is a cross-lap aggregate over clean laps at the same 50 m resolution as the regime bins, never a single lap; re-running deletes and rewrites those variables.
