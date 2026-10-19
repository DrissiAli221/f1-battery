# Backend audit (2026-10-19)

Read-only review of the backend after Phases 0–7. Full test suite passes
(66 tests, ~30 s). Findings ranked by severity; the fix list at the end is
what was accepted (DECISIONS.md D23).

## Plan vs built
| Phase | Status | Gap |
|---|---|---|
| S | met | 1/3 exit conditions, proxy mode (D10) |
| 0 | met locally | CI has never run (Actions billing: 35 of 35 runs "not started") |
| 1 | partly | Local load and idempotency met; WireMock tests pass but never assert the raw `date>=` wire format; Actuator/Micrometer counters are not observable (`web-application-type: none`, no registry); `meetings` not ingested; "CI green" not met |
| 1.5 | not met | No deploy script, cron, S3 sync, metrics summary or Oracle config |
| 2 | met | D17 |
| 3 | not met as written | Singapore criterion failed, recorded honestly (D18, D19) |
| 4 | partly | 29 car-sessions with telemetry but no `model_result` rows, unexplained in docs |
| 5 | met | D20 |
| 6 | partly | Built and working locally; not deployed |
| 7 | met locally | No Dockerfile for `replay` |

## Ingestion
- Upsert keys match the schema; in-memory dedupe is per unit, cross-unit
  overlap relies on `DO NOTHING`; corrections from OpenF1 are never applied.
- One transaction per unit for upsert plus log; a mid-unit failure rolls the
  unit back and records `failed`. If the drivers upsert fails, telemetry
  still runs for drivers absent from `driver`.
- Units marked `complete` are never refetched, so provisional data fetched
  soon after a session (results, late corrections) stays stale.
- **API windows end at the scheduled `date_end`** (`ApiSource`): a red-flag
  overrun is dropped and marked complete. Same truncation the backup tool
  fixed (D13).
- `--source=api` ingests practice and future sessions unless `--sessions`
  is given; local and API units carry different labels, so the first API run
  would re-pull the whole season (~20k requests, ~11 h) into compressed
  chunks.
- Rate limiter and backoff correct; timezones sound; w180/w20 overlap handled.

## API
- Read-only (GET only), parameterised SQL, size capped at 1000. The API
  connects as the `f1` superuser.
- ETag is a body hash, correct with filters, saves bandwidth not DB work.
- `ModelRuns.resolve` scans 2.1 M rows per request (~130 ms) and serves the
  newest run: a single-session `estimate.py --session` run hides every other
  session, and `--all` commits per session so a partial run is served mid-way.
- Rate limit keyed on the socket peer; behind a proxy all users share one
  bucket.
- Live SSE: unbounded `newCachedThreadPool`, one thread and consumer per
  client, nothing closes streams on shutdown; forwards `ts, x, y, speed`
  verbatim (raw telemetry, guarded only by the enable flag).

## Schema
- `model_result_idx` is near-redundant with the unique index; no index for
  `has_results`; no `model_run` table; no foreign keys from `model_result`
  and `lap_quality`, so results for drivers absent from `driver` vanish from
  the summary silently.
- All 40 chunks per hypertable compressed; re-ingest decompresses affected
  batches and stays bloated until the policy runs; new races land in fresh
  chunks. Image tag `latest-pg16` floats.

## Ops
- **Dockerfiles broken**: root pom lists `replay` but neither Dockerfile
  copies `replay/pom.xml` ("Child module replay does not exist"). No
  `.dockerignore` (~840 MB context). Images run as root, no HEALTHCHECK.
- CI never ran; when it does it lacks the `api.version` workaround, builds
  only the ingest image under QEMU, and has no Python job.
- Dev passwords are fallback defaults; logs are key=value, not JSON.

## Tests
Covered: limiter, WireMock status paths, local source, two-run idempotence,
migrations, API endpoints, rate-limit filter, replay, Python units.
Most valuable missing: API source end to end (discovery, overrun, 500 then
resume, raw query string); compressed-chunk re-ingest and mid-unit rollback;
`ModelRuns` contract (a partial or single-session run must not hide others).

## Python
Unpinned deps; `pytest` undeclared; `requires-python>=3.12` with a 3.14
venv; `estimate.py` exits 0 on session failures; the new-run hazard is
undocumented.

## Accepted fixes (D23)
1. Dockerfiles: copy `replay/pom.xml`, `.dockerignore`, non-root user, HEALTHCHECK. S
2. `ApiSource`: window end = max(date_end, last lap end + 5 min); skip sessions that ended < 6 h ago. M
3. `model_run` table with a published flag written after a full run; API serves the published run; `estimate.py` exits non-zero on failure. M
4. CI: `api.version` workaround, both images, pytest job, native arm runner where available. S/M
5. `server.forward-headers-strategy` with trusted proxies. S
6. Bounded SSE executor, strip raw fields from the live feed, local-only guard. S/M
7. API source defaults `--sessions` to the four modelled names; a unit completed by either source counts as done. S
8. Pin `timescale/timescaledb:2.30.2-pg16`, telemetry off. S
9. Read-only DB role for the API; fail fast without `DB_PASSWORD` outside dev. S
10. Phase 1.5: deploy script, cron chain, S3 sync, run-end metrics summary. L (needs the server)
