# Phase 1: ingestion design note

The `ingest` module is a Spring Boot job: it loads OpenF1 data into
Postgres/Timescale from either the local raw backup or the live API, then
exits. The same parser and upsert code serves both sources (D9).

## Components

| Package | Role |
|---|---|
| `source` | `OpenF1Source` interface; `LocalBackupSource` (gzipped files under `data/raw/openf1/`); `ApiSource` (HTTP, gzip, retry); `OpenF1Records` (one Java record per endpoint); `Endpoint<T>` (name + record type); `FetchWindow` |
| `ratelimit` | `RateLimiter`, `TokenBucketRateLimiter` (injectable clock and sleeper), `Sleeper` |
| `upsert` | One upserter per table over a shared `BatchUpserter`; `Upserters` bundles them |
| `log` | `IngestionLog`: reads and writes `ingestion_log` |
| root | `IngestOptions`, `IngestService` (the run), `IngestRunner` (arguments and exit code), `IngestConfig` |

## Data flow

```
IngestRunner -> IngestService -> OpenF1Source.fetch -> parsed records
                              -> IngestionLog.isComplete?  (skip if so)
                              -> [transaction] Upserter.upsert + IngestionLog.record
```

Per selected session, in order: the `session` row, `driver` rows, the
session-wide endpoints (laps, stints, pit, overtakes, race_control, intervals,
position, weather, session_result, starting_grid, team_radio), then car_data and
location for each driver, window by window. Each step is one fetch unit.

## Keys and idempotency

Upserts use `INSERT ... ON CONFLICT (natural key)`; the keys are those of
`V1__init.sql` (D12). Before the statement is sent, rows are deduplicated in
memory on the same key (last occurrence wins), so overlapping backup files and
repeated API timestamps never reach the database as conflicts.

- Tables that can change (session, driver, lap, stint, pit, overtake,
  interval_sample, position, weather, session_result, starting_grid,
  team_radio) use `DO UPDATE ... WHERE (columns) IS DISTINCT FROM (excluded)`.
  An unchanged row is not rewritten and is reported as 0 changed, which is what
  makes "the second run inserts 0 rows" measurable (counter
  `ingest.rows.upserted`).
- `car_data`, `location` and `race_control` use `DO NOTHING`.
- `race_control` has no natural key; the in-memory key mirrors the unique
  expression index (session, date, md5(message), coalesce(driver, -1)).
- Rows with a null key component are dropped (none occur in the backup).
- The reported change count is exact with default driver settings. With
  `reWriteBatchedInserts=true` the driver reports "unknown" per statement, which
  is counted as one row each; the default URL does not enable it.

## Resume semantics

`ingestion_log` has one row per unit, keyed by (endpoint, session,
coalesce(driver, -1), window_start, window_label). Before fetching, a unit is skipped if a
row with status `complete` exists. After fetching, the unit's rows and its log
row are written in one transaction. Statuses:

- `complete`: rows were fetched and stored.
- `no_data`: the fetch succeeded (200 with `[]`, or 404) and returned nothing.
  Not skipped on the next run: a session whose feed arrives later is picked up.
- `failed`: an exception; written outside the transaction. Retried next run.

The run continues past a failed unit and exits 1 if any failed (2 for bad
arguments, 0 otherwise).

### Windows

Session-wide endpoints use `window_start = session.date_start` and
`window_end = session.date_end`. Telemetry windows come from the source:

- Local: derived from the file name, without opening the file.
  `car_data_<driver>_w180_00` is the whole session (start = `date_start`, end =
  `date_end`); `w20_<n>` files are 20-minute windows; the unprefixed
  `car_data_<driver>_<n>` files of the first sessions are 30-minute slices.
- API: ten-minute windows (D9), `10_<n>`.

The backup contains whole-session files and windowed re-fetches for the same
driver, which share a start time. `ingestion_log.window_label` (V3) is part of
the key and tells them apart: the file suffix for the current layout
(`w180_00`, `w20_03`), `30_<index>` for the legacy unprefixed files,
`<minutes>_<index>` for the API (`10_04`), and `session` for session-wide
endpoints. Row timestamps are untouched and the overlap is deduplicated by the
upsert.

Coverage rule (`IngestionLog.isComplete`). A unit is done when a `complete` row
exists with the same endpoint, session, driver and `window_label`. In addition, a
row written by the *other* source counts when its window contains the requested
one (`window_start <= start` and `window_end >= end`), whatever its label. A
local whole-session row (`w180_00`) therefore satisfies every ten-minute API
window inside the scheduled session, so the first API run after a local load does
not refetch the season. An API window that runs past the scheduled end (see
below) is not covered and is fetched. Within one source labels stay strict: the
backup's 20-minute files exist because the whole-session responses were
truncated (D13), so they must not be skipped on account of the larger window.

API windows end at `max(date_end, last lap end + 5 min)`. `ApiSource` fetches
the session's laps first (the laps unit reuses that response), so a red-flag
overrun is no longer cut at the scheduled end. Sessions whose `date_end` is less
than six hours before now (or unknown) are skipped with
`event=session_skipped reason="too recent, provisional"`, because a unit marked
complete is never refetched and results are still being revised.

`--source=api` without `--session`/`--sessions` defaults to `Race`, `Qualifying`,
`Sprint` and `Sprint Qualifying`.

## Rate limiting and backoff (API source)

- `TokenBucketRateLimiter` holds two buckets, 3/s and 30/min. A caller reserves
  a token under a lock and sleeps outside it. Clock and sleeper are injected.
- Both buckets bank one token (`ingest.api.minute-burst`, default 1), so
  requests are spaced two seconds apart. A larger burst would allow close to
  twice 30 requests across a minute boundary.
- Every attempt, retries included, takes a permit.
- 429, 5xx and I/O errors retry up to 6 attempts. Delay is
  `min(60 s, 1 s * 2^(attempt-1))` scaled by jitter into [50%, 100%], and at
  least `Retry-After` when the header is present. 404 returns an empty list;
  other 4xx fail at once. The request advertises `Accept-Encoding: gzip`.
- Counters: `ingest.http.429`, `ingest.http.responses{status}`.
- Time filter wire format: OpenF1 documents `date>=2026-03-08T04:10:00Z&date<2026-03-08T04:20:00Z`.
  `java.net.URI` rejects a literal `<` or `>`, so those are sent percent-encoded
  and the `=` of `>=` raw: `date%3E=2026-03-08T04%3A10%3A00Z&date%3C2026-03-08T04%3A20%3A00Z`,
  which decodes to exactly the documented form (`ApiSourceWireMockTest` asserts
  the raw request line). An earlier version sent `date%3E%3D=...`, which decodes
  to `date>==...`; that was a bug. Still untested against the live service (no
  live calls were made).

A full 2026 pull from the API is roughly one request per driver per ten
minutes per telemetry endpoint, about 2 s each; the local source is the normal
path.

## Batching

Batches of 5000 rows through `JdbcTemplate.batchUpdate`. Files are parsed one
file at a time (about 25,000 rows), not one session at a time.

## Metrics and logs

`ingest.rows.upserted{table}`, `ingest.fetch.units{status=done|skipped|failed|dry_run}`,
`ingest.http.429`. The job has no web server and Micrometer has no exporting
registry, so at `run_end` it also logs one JSON line:
`metrics_summary {"event":"run_metrics","sessions":..,"units_done":..,"units_skipped":..,"units_failed":..,"rows_upserted":{"<table>":n,...},"http_429":n}`
(rows are rows actually changed). Log lines are `event=... key=value` (`run_start`,
`session_start`, `session_summary` with rows per endpoint, `unit_failed`,
`retry`, `run_end`). Per-unit lines are at DEBUG.

## Running

```
docker compose up -d db                      # Timescale; credentials as in application.yml
mvn -B -q install -DskipTests -pl db         # ingest resolves the migrations from the db jar
INGEST_LOCAL_ROOT=$PWD/data/raw/openf1 \
mvn -pl ingest spring-boot:run -Dspring-boot.run.arguments="--source=local --year=2026"
```

Options: `--source=local|api` (required), `--year=2026`, `--session=<key>`,
`--sessions=Race,Qualifying,Sprint,Sprint_Qualifying` (match on `session_name`;
`_` or `-` stand for a space so the list survives shell splitting),
`--dry-run` (fetch and count, write nothing),
`--refresh=drivers` (re-fetch the named session-wide endpoint even where the
ingestion log marks it complete; only `drivers` is supported). Environment: `DB_URL`,
`DB_USER`, `DB_PASSWORD`, `INGEST_LOCAL_ROOT`, `OPENF1_BASE_URL`, `API_DB_PASSWORD`
(password given to the read-only `f1_api` role by migration V7). With
`SPRING_PROFILES_ACTIVE=prod` the job refuses to start unless `DB_PASSWORD` is set.
See `docs/ops.md`.

`spring-boot:run` starts in `ingest/`, hence the absolute `INGEST_LOCAL_ROOT`.

### Backfilling driver details (V8)

Migration V8 adds `headshot_url, team_colour, first_name, last_name,
broadcast_name, country_code` to `driver` (DECISIONS.md D24). Existing rows
stay null, and the `drivers` units are already `complete` in `ingestion_log`,
so a plain rerun would skip them. After merging, run once:

```
mvn -pl ingest spring-boot:run -Dspring-boot.run.arguments="--source=local --year=2026 --refresh=drivers"
```

`--refresh=drivers` bypasses the completed-unit skip for the `drivers`
endpoint only, for every selected session (combine with `--session=`). The
upserter's `ON CONFLICT DO UPDATE` fills the new columns of existing rows;
nothing else is re-fetched. Re-running is idempotent.

## Tests

- `TokenBucketRateLimiterTest`: fake clock; burst, spacing, rolling-minute cap,
  refill, concurrency.
- `LocalBackupSourceTest`: fixture under `ingest/src/test/resources/backup/`
  (a handful of real rows from session 11234, plus an empty session 11257).
- `ApiSourceWireMockTest`: 200 (gzip and plain), 404, 429-then-200, 502 twice
  then 200, six failures, `Retry-After`, jitter, 422, limiter spacing and
  window queries; fake clock, no real sleeping.
- `IngestIT` (failsafe, Testcontainers): runs the fixture twice; asserts row
  counts, zero change on run 2, log statuses and that complete units were
  skipped; the coverage rule across sources; the metrics summary line. Needs
  Docker. Testcontainers is pinned to 1.21.4 in the root pom, which works with
  Docker 29 without `-Dapi.version`. The database image is
  `timescale/timescaledb:2.30.2-pg16`.
- `IngestOptionsTest`: API default session names and their overrides.

The fixture files are gzip, which `.gitignore` excludes; a negation for
`ingest/src/test/resources/backup/` was added.

## V3 migration (`V3__ingest_extras.sql`)

- `ingestion_log`: add `window_label text NOT NULL DEFAULT 'session'`; the
  unique index `ingestion_log_uq` is recreated with it as the last key column.
- `interval_sample`: add `gap_to_leader_text text`, `interval_text text`.
  OpenF1 reports lapped cars as text ("+1 LAP"): 82,508 of 490,000+ interval
  rows in the backup. The numeric columns stay null for those rows.
- `session_result (session_key, driver_number) PK`: `position int`,
  `position_label text`, `number_of_laps int`, `points real`, `dnf`, `dns`,
  `dsq boolean`, `duration jsonb`, `gap_to_leader jsonb`.
- `starting_grid (session_key, driver_number) PK`: `position int`,
  `lap_duration double precision`.
- `team_radio (session_key, driver_number, date) PK`: `recording_url text`.

## Decisions the docs did not cover

1. `interval_sample` text columns for lapped gaps (above).
2. `session_result.duration` and `gap_to_leader` as jsonb, because they are a
   scalar in races and a `[Q1,Q2,Q3]` array in qualifying; `position` can be
   null or a code such as `"RT"`.
3. Window identity for overlapping backup files: the `window_label` key column.
4. `no_data` units are retried each run; only `complete` is skipped.
5. `brake` is stored as received. The backup holds 0, 100 and also 104, so it
   is not strictly 0/100; the column is smallint and nothing is clamped.
6. Local source lists only sessions that have a backup directory (practice
   sessions are in `sessions_2026` but not backed up).
7. Per-minute burst of 1 (strict 30/min) rather than a capacity of 30.
8. The API windowed query uses `date>=` and `date<`, encoded as described under
   rate limiting. This is untested against the live service (no live calls were made).
9. `IngestIT` and `MigrationsIT` need `ingest.run-on-startup=false` so the
   runner does not start during context tests.
10. The row counts in DECISIONS.md (exit condition) are not yet recorded; that
    requires a full local run against the database.
