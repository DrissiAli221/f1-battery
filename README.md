<img alt="F1 Battery: four driver posters with the car, number and team colour, and the notice that values are estimates, not measurements" src="docs/figures/readme/banner.webp" width="100%">

# f1-battery

Estimates where electrical deployment ends on each straight from public 2026 telemetry, then tests one pre-registered question against real overtakes.

Phases 0 to 6 are built and the findings are written (2026-10-18). The optional Phase 7 live replay (Kafka) is built. Not deployed yet.

**Estimates, not measurements.** F1 does not publish battery or active-aero data for 2026, so this project never measures battery state and never reports a state of charge. The 2026 cars split power between engine and motor, and the FIA rules state how much electric power a car may use at each speed (Section C, Article C5.2.8), so the hidden state is partly constrained. That makes an estimate worth attempting and an honest test possible. Several per-race estimators exist (DECISIONS.md D1); this adds a season-wide pipeline and a pre-registered test against overtakes.

## What one estimate is

Each estimate is the distance into a straight where deployment appears to end, with an interval across laps. Below: Singapore race (session 11388), straight 3, the median cut-off for two drivers with 95% intervals. Estimates under stated assumptions, not measurements.

<img alt="Singapore race, straight 3: the real session map with Alonso (ALO, 404 m) and Leclerc (LEC, 498 m) tags and each driver's median cut-off with its 95 percent interval" src="docs/figures/readme/estimate.webp" width="100%">

## The explorer

A read-only Spring Boot API and a React app with track maps, per-driver cut-offs, lap review, the findings and a method log.

<table>
  <tr>
    <td width="50%">
      <img alt="Home: pick a 2026 race from the race-card grid" src="docs/figures/readme/home.webp">
      <p><b>Races.</b> Pick a 2026 session.</p>
    </td>
    <td width="50%">
      <img alt="Session page: Singapore, driver, straight, track map and median cut-off estimate with 95 percent interval" src="docs/figures/readme/session.webp">
      <p><b>Session.</b> One driver on one straight: the estimated cut-off and its interval.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img alt="Findings page: verdict no effect, 364 passes tested, odds ratio 0.92, 19 sessions, permutation p 0.208" src="docs/figures/readme/findings.webp">
      <p><b>Findings.</b> The frozen result, spot checks and limits.</p>
    </td>
    <td width="50%">
      <img alt="Replay page: Monza lap review with the track map coloured by regime" src="docs/figures/readme/replay.webp">
      <p><b>Replay.</b> Review a recorded lap, or follow the optional live feed.</p>
    </td>
  </tr>
</table>

## The result

<img alt="Forest plot of three odds ratios, all below the pre-registered 1.3 threshold; verdict no detectable effect; permutation p 0.208" src="docs/figures/readme/result.webp" width="100%">

The question, frozen on 2026-10-18 ([HYPOTHESIS.md](HYPOTHESIS.md)): does a defender's energy management before an attack predict being passed? Produced by `model/f1battery_model/hypothesis_test.py` from model run `proxy-0.1`.

| | |
|---|---|
| Passes tested | 364, against 1,324 non-passes |
| Sessions in the model | 19 |
| Odds ratio per 1 SD earlier defender cut-off (point run) | 0.92 [0.81–1.04] |
| Permutation p (two-sided, 1,000 shuffles) | 0.208 |
| Verdict | **no detectable effect** |

No effect means none detectable with this estimator and sample, not proof of absence. The permutation control failed and three of the four testable spot checks failed; both are reported, not tuned away. Full write-up: [docs/findings.md](docs/findings.md).

## Architecture at a glance

<img alt="Pipeline from OpenF1 through ingest, Postgres with TimescaleDB, the Python estimator, a versioned model run, the read-only API and the web app, with an optional Kafka replay lane" src="docs/figures/readme/pipeline.webp" width="100%">

- **One interface between Java and Python.** The model writes one versioned results table; the API reads it. Schema lives in Flyway migrations ([D4](DECISIONS.md)).
- **Ingestion is rerunnable.** Upserts on natural keys mean a second full run inserts 0 rows ([phase1-ingestion.md](docs/phase1-ingestion.md)).
- **The API is read-only.** The `f1_api` role has SELECT only; it is rate limited and serves derived aggregates, never raw samples.
- **Kafka is optional,** behind a Compose profile and an API flag ([phase7-replay.md](docs/phase7-replay.md)).
- **Planned hosting:** Oracle Cloud ARM free tier plus a private S3 backup. None of it is deployed.

## Quick start

Requires Docker, Java 21, Node and Python 3.12+. Raw OpenF1 data is never committed, so ingest needs the local backup at `data/raw/openf1/` or the live API (`--source=api`). Create `.venv` from `model/pyproject.toml`.

```bash
docker compose up -d db                                   # 1. TimescaleDB on 127.0.0.1:55432
mvn -B -q install -DskipTests -pl db                      # 2. ingest (idempotent)
INGEST_LOCAL_ROOT=$PWD/data/raw/openf1 \
mvn -pl ingest spring-boot:run -Dspring-boot.run.arguments="--source=local --year=2026"
cd model                                                  # 3. model: align laps, write estimates
../.venv/bin/python -m f1battery_model.quality --all
../.venv/bin/python -m f1battery_model.straights
../.venv/bin/python -m f1battery_model.regulation
PYTHONPATH=. ../.venv/bin/python -m f1battery_model.estimate --all; cd ..
JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn -B -q -pl api -am package -DskipTests      # 4. API
DB_URL=jdbc:postgresql://localhost:55432/f1battery java -jar api/target/api-*.jar
cd web && npm ci && npm run dev                           # 5. web
```

| Service | Port | What |
|---|---|---|
| db | 55432 | PostgreSQL 16 + TimescaleDB |
| api | 8080 | read-only Spring Boot API |
| web | 5173 | React app (`VITE_API_BASE` overrides the API URL) |
| kafka | 9092 | optional, replay profile |
| replay | `/api/live/{key}` | optional SSE stream |

Live replay commands: [docs/phase7-replay.md](docs/phase7-replay.md).

| Check | What it runs |
|---|---|
| `mvn -B -q -pl api -am verify` | API integration tests (Testcontainers, needs Docker) |
| `cd web && npm run build` | type-check, lint, bundle |
| `cd model && ../.venv/bin/python -m pytest tests` | model tests |

## Data and limits

| | |
|---|---|
| Source | [OpenF1](https://openf1.org/) free tier (non-commercial) plus [FastF1](https://docs.fastf1.dev/); 2026 loaded through Singapore, 48 of 50 sessions with data |
| Excluded | Hungary race 11342 (timestamps off by 3–6 min, D17); Sakhir and Jeddah have no usable data |
| Ground truth | None public. Spot checks are the only anchors; three of four testable ones failed |
| Drag area | Not identifiable; sits at a grid bound in 16 of 45 sessions, so relative deploy energy inherits it |
| Telemetry | 3.7 Hz, integer speeds: tens of metres of lap-to-lap scatter |
| Selection and limits | Only passes with a detected defender cut-off on the previous lap enter the test; per-event energy limits are not public, the 100 kW/s derate is assumed |

A caught artifact (smoothing "super-clip" segments, a failed hinge-ramp detector) is in [docs/method-log.md](docs/method-log.md).

## Project status

<img alt="The method log phase board: nine recorded entries across phases 1 to 6, with outcomes such as artifact removed, retained, 3 failed and no effect" src="docs/figures/readme/phases.webp" width="100%">

| Phase | State |
|---|---|
| 0–3 Setup, ingestion, alignment, regimes | built |
| 4–5 Estimator (proxy mode), event sets | built |
| 6 API and view | built |
| Hypothesis and findings | frozen |
| 7 Live replay with Kafka | optional |
| 1.5 Deployment | not deployed |

## Docs

| File | Purpose |
|---|---|
| [PLAN.md](PLAN.md) | Phases and exit conditions |
| [HYPOTHESIS.md](HYPOTHESIS.md) | Pre-registered test, frozen before Phase 4 output existed |
| [DECISIONS.md](DECISIONS.md) | Decision log: what was chosen and why |
| [docs/findings.md](docs/findings.md) | The test result, every number reproducible from a committed script |
| [docs/method-log.md](docs/method-log.md) | Each estimator attempt and what its check showed |
| [docs/spot-checks.md](docs/spot-checks.md) | Pre-registered external checks |
| [docs/regulations.md](docs/regulations.md) | FIA energy limits per event, cited |
| [docs/data-quality-notes.md](docs/data-quality-notes.md) | Known problems in the raw feed |
| [docs/api-contract.md](docs/api-contract.md) | API endpoints |
| [AGENTS.md](AGENTS.md) | Working rules for AI agents in this repo |
| [spike/](spike/) | Feasibility spike scripts and result |

## Licence and credits

Private, non-commercial project. Data from [OpenF1](https://openf1.org/) under its non-commercial terms; raw and per-sample data are never committed or redistributed, and the public API serves derived aggregates only. Not affiliated with Formula 1, the FIA or FOM. Team and driver imagery, logos and the typefaces used in the web app belong to their owners, are used privately and for non-commercial study, and are credited in the app footer; texture, mask and typeface sources are listed in [web/public/assets/ASSETS.md](web/public/assets/ASSETS.md). The images in this README are rendered from the web app and contain such material. No licence is granted for it.
