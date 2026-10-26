# Operations

How the backend is packaged and run. Design background: `docs/phase1-ingestion.md`,
`docs/phase6-api-view.md`, `docs/phase7-replay.md`.

## Images

One Dockerfile per runnable module, built from the repository root:

| Image | Dockerfile | Purpose | Port | Size (arm64, local build) |
|---|---|---|---|---|
| ingest | `ingest/Dockerfile` | batch job: loads OpenF1 data into Postgres, then exits | none | about 516 MB |
| api | `api/Dockerfile` | read-only REST API (and SSE live relay when enabled) | 8080 | about 560 MB |
| replay | `replay/Dockerfile` | Phase 7 producer or consumer (`--mode=...`) | none | about 547 MB |

```
docker build -f ingest/Dockerfile -t f1battery-ingest .
docker build -f api/Dockerfile    -t f1battery-api .
docker build -f replay/Dockerfile -t f1battery-replay .
```

All three are multi-stage (Maven build stage, `eclipse-temurin:21-jre` runtime), copy every
module pom so the reactor resolves, build only their module (`-pl <module> -am`), and run as
the non-root user `app`. `.dockerignore` keeps `data/`, `private/`, `.venv/`, `web/node_modules/`,
`web/dist/`, `model/out/`, `spike/cache/`, `out/`, `**/target/` and `.git/` out of the build
context. CI builds all three for `linux/arm64` and `linux/amd64` without pushing.

## Healthchecks

- api: `curl -fsS http://localhost:8080/api/health` (the endpoint is exempt from the rate limit).
- ingest and replay: `java -version`. These are not servers, so the check only proves the
  runtime starts; the job's result is its exit code (ingest: 0 success, 1 a unit failed, 2 bad
  arguments).
- db (compose): `pg_isready`. kafka (compose, `replay` profile): `kafka-broker-api-versions.sh`.

## Database and roles

Image `timescale/timescaledb:2.30.2-pg16` (pinned; `TIMESCALEDB_TELEMETRY=off` in compose and
the same tag in the Testcontainers tests). Migrations are in `db/` and run only from the ingest
job (Flyway) and from the API integration tests.

| Role | Used by | Rights |
|---|---|---|
| `f1` (owner) | ingest, replay producer, model, migrations | full |
| `f1_api` | API | LOGIN, SELECT on all tables in `public`, including future ones (V7) |

The `f1_api` password is the Flyway placeholder `api_db_password`, fed from `API_DB_PASSWORD`
(dev default `f1api`) when the ingest job migrates. It must not contain a single quote. To change
it later: `ALTER ROLE f1_api PASSWORD '...'`.

Migration order: V6 `model_run` (see the model-run contract in `docs/phase6-api-view.md`), V7 `api_role`.

## Environment variables

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `SPRING_PROFILES_ACTIVE` | api, ingest | none | `prod` makes `DB_PASSWORD` mandatory (startup fails without it) |
| `DB_URL` | api, ingest, replay | `jdbc:postgresql://localhost:55432/f1battery` | JDBC URL |
| `DB_USER` | api / ingest, replay | `f1_api` / `f1` | database login |
| `DB_PASSWORD` | all | `f1api` (api), `f1dev` (others), none under `prod` | database password |
| `API_DB_PASSWORD` | ingest (migration) | `f1api` | password given to `f1_api` by V7 |
| `API_CORS_ORIGIN` | api | `http://localhost:5173` | allowed origins, comma-separated |
| `API_RATE_PER_MIN` | api | 60 | per-client token bucket |
| `API_TRUSTED_PROXIES` | api | empty | addresses or CIDRs of reverse proxies whose `X-Forwarded-For` is trusted |
| `API_REPLAY_ENABLED` | api | false | enables `/api/live/{key}` |
| `API_LIVE_MAX_STREAMS` | api | 20 | concurrent live streams; more get 503 |
| `KAFKA_BOOTSTRAP` | api, replay | `localhost:9092` | broker |
| `INGEST_LOCAL_ROOT` | ingest | `data/raw/openf1` | local backup directory |
| `OPENF1_BASE_URL` | ingest | `https://api.openf1.org` | API source base URL |
| `POSTGRES_PASSWORD` | compose db | `f1dev` | owner password |

## Running

```
docker compose up -d db                          # database on 127.0.0.1:55432

# one ingest run from the local backup (mounted read-only), then the container exits
docker compose --profile app run --rm ingest --source=local --year=2026

# or from the live API: Race, Qualifying, Sprint, Sprint Qualifying only; sessions that ended
# less than six hours ago are skipped; 30 requests/min, so a full pull takes hours
docker compose --profile app run --rm ingest --source=api --year=2026

docker compose --profile app up -d --build api   # API on 127.0.0.1:8080
```

Without compose:

```
docker run --rm --network host -e DB_URL=jdbc:postgresql://localhost:55432/f1battery \
  -e DB_USER=f1 -e DB_PASSWORD=f1dev -v "$PWD/data/raw/openf1:/data/raw/openf1:ro" \
  -e INGEST_LOCAL_ROOT=/data/raw/openf1 f1battery-ingest --source=local

docker run -d --network host -e DB_URL=jdbc:postgresql://localhost:55432/f1battery \
  -e SPRING_PROFILES_ACTIVE=prod -e DB_PASSWORD=... f1battery-api

# replay (Kafka from `docker compose --profile replay up -d`)
docker run --rm --network host -e DB_URL=jdbc:postgresql://localhost:55432/f1battery \
  f1battery-replay --mode=producer --session=11361 --speed=20
```

The compose `api` and `ingest` services are under the `app` profile and are not started by a
plain `docker compose up`. The replay container needs the host network because the compose broker
advertises `localhost:9092`.

## Logs and metrics

Logs are `event=... key=value` lines. The ingest job has no web server; at the end of a run it
logs one JSON line `metrics_summary {...}` (units done/skipped/failed, rows changed per table,
HTTP 429 count). The API exposes only `/api/health`.
