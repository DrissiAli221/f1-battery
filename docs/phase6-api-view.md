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
| `GET /sessions/{key}/summary?model=` | one item per driver: `straights[]` (`cutoff_distance_median_m`, `ci_low`, `ci_high`, from `lap_number = 0`) and `regime_shares` averaged over green laps (all laps if the session has no `lap_quality` rows) |
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

The view was rebuilt on the D25 stack (React 18, Vite, TypeScript, Tailwind for
layout and styling, GSAP 3.13 with DrawSVG and MotionPath for the track map,
Motion for UI transitions, d3-scale with hand-written SVG charts) and the PRNDL
look (D27). Every dependency is pinned to an exact version.

**Routes.** Hash routing is kept (`web/src/lib/router.ts`): the bundle can sit on
any static host without rewrite rules, and there are only a few routes. `#/`
landing, `#/sessions` index (filter `?type=`), `#/session/<key>` explorer,
`#/findings`, `#/method`, `#/live` and `#/live/<key>`. Explorer state lives in
the query string (`?driver=&compare=&straight=&lap=`) so a view can be shared;
updates use `replaceState`, so scrubbing laps does not fill the history. Pages
other than the landing are code-split.

**Tokens.** All colours, fonts, radii and the container width are custom
properties in `web/src/styles/tokens.css`; `web/tailwind.config.ts` maps the
Tailwind theme onto them. The page background is the `--page-bg` alias (one line
to change). Regime colours: deploy `#A8F04A`, plateau `#FFD84D`, lift `#9E5BFF`,
brake `#FF8AE0`. Team colours are never tokens; they come from `team_colour` in
the API. Fonts: Geist and Geist Mono (body, every number), Orbitron only for short
uppercase titles and labels, never for dates or numbers.

**Explorer.** Header with session meta and team-filled driver cards (headshots
load at runtime from `headshot_url`; the code shows if an image fails). The
primary driver is chosen from drivers with a median in `/summary`; the default is
the race or sprint winner (most laps, then earliest end of the last lap, from the
lap table, since the API has no classification) or the fastest lap in qualifying.
Below it, in separate full-width sections: the track map (outline rotated to fill
the frame; regimes of the shown lap along the line; per straight the primary
driver's median tick and range band on the inner edge and the compared driver's
hollow tick on the outer edge; a chevron at the shown lap's cut; one label on the
selected straight), the distance strip sharing the map's cursor, the lap
scrubber with play, the selected straight's numbers and every-lap strip, cut-off
by lap, and the ranked summary (ten rows, expandable; click a row to select the
driver). Model distances (cut-offs, regime bins) are placed on the outline at the
same metre value from the start/finish line; the outline length is its last
distance in decimetres / 10, closed back to the first point.

**Requests.** All drivers' laps come from one paged `/laps` request rather than
one per driver; each driver's cut-offs from one `/results` request. GET responses
are kept in memory for the page's lifetime (they are immutable per model run).
While the scrubber plays, regime requests wait for the pause so playback stays
inside the per-IP rate limit; the map label says which lap its colours belong to.

**Findings.** `web/src/content/findings.json` is generated from the outputs of
`model/f1battery_model/hypothesis_test.py` with
`node web/scripts/gen-findings.mjs <run_id> <model_version>` (from the repo root,
after the test has run); it holds aggregates only. The spot checks, limits and
wording live in `web/src/content/findings-notes.json`, curated from
`docs/findings.md`.

Straight names: the API labels every curated straight "Straight", so the view takes names from `web/src/content/straight-names.json` (circuit_key, then straight_id; Monza and the Singapore pit straight only) and otherwise shows "Straight N · a–b km", derived from `start_pct`/`end_pct` and the outline length.

The "Method log" page at `#/method` needs no API: it renders `web/src/content/method-log.json`, a curated record of what was tried, the pre-set check, what was found and what changed, with source links to the repo on GitHub. `docs/method-log.md` is generated from the same file with `node web/scripts/gen-method-log.mjs` (run from the repo root); edit the JSON, not the markdown.

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
3. Regime bins and cut-offs are placed on the outline at their metre value,
   while straights are placed by fraction of the outline. The model measures
   both on each driver's own integrated lap, so a 1-2 % length difference moves
   marks by 60-100 m against their straight. The view treats a mark just before
   a straight's start as outside it (no "metres before" text) rather than
   wrapping. Exposing `lap_quality.lap_length_m` on `/laps` would let the view
   scale model metres to the outline exactly.
4. Outline spacing is in stored units and assumes 1/10 m; confirm against the
   OpenF1 documentation before quoting metres publicly.
5. Where the view is hosted (static bucket vs served by the API) and the CORS
   origin to configure there.
6. `limit_known = false` rows from `regulation_event` are returned as they
   are; whether the view should say so is undecided.


Units: `location` x/y/z are tenths of a metre (verified against the Monza lap length, see docs/data-quality-notes.md), so the outline's 500-unit spacing is 50 m.
