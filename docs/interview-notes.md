# Interview notes

Reasoning worth being able to say out loud, collected as the project goes.
Each entry: the question an interviewer might ask, and the honest answer.
Only add an entry once the thing exists and Ali can explain it without notes.

## Data and storage
- **Why Postgres and not MongoDB?** Relational data (car_data → laps → stints,
  overtakes → two drivers), analytical SQL (window functions, group by
  distance bin), identical rows. Documents buy nothing here.
- **Why TimescaleDB, and what would change without it?** It's a Postgres
  extension: hypertables chunk by time and compress old chunks. At ~9M rows
  plain Postgres would cope; I kept it to learn it and measured the difference.
  Gotcha: a unique index on a hypertable must include the time column.
- **Why no Kafka or Spark?** One batch of ~9M rows fetched once in ~25 min.
  Kafka is for continuous multi-producer streams, Spark for data that doesn't
  fit one machine. Adding them would be CV-driven. Kafka appears only in the
  optional replay mode, where there is a real stream.

## Ingestion
- **How is idempotency guaranteed?** Upsert on the natural key
  (session_key, driver_number, date); duplicates from the API are deduped
  before insert; a second full run inserts 0 rows.
- **How does resume work?** Fetches are ~10-minute windows; each window is a
  row in the ingestion log; on restart, skip complete windows.
- **What happens on 429 or 502?** Token-bucket limiter keeps under 3/s and
  30/min; on 429 or 5xx back off exponentially with jitter and retry; the
  window is only marked complete after a successful commit.
- **How do you test without hitting the real API?** WireMock with recorded
  responses, including 429 and 502. Testcontainers runs a real Timescale.
- **Why batch inserts?** Row-by-row JDBC is network-bound; batching or COPY
  turns ~24k rows per car into one round trip per batch.

## Architecture
- **Is this microservices?** No. Two programs sharing one database would be
  the microservices anti-pattern. It's a modular monolith with a batch job:
  one codebase, one schema, two deployables with different lifecycles. No
  network between modules, no distributed transactions, nothing to split
  until there's a reason.
- **How do new races get in?** The ingester is re-runnable: list sessions,
  skip windows already complete in the ingestion log, fetch only the new
  ones. A weekly cron on the server runs it, then the model.
- **Why two runnable modules and a shared db module?** Ingestion is a job,
  the API is a server; they share only the schema. Flyway in one place means
  no drift between Java and Python.
- **Why one versioned results table between Python and Java?** The API never
  needs model internals; model versions can be compared side by side.
- **Why is the API read-only with ETags?** Results are immutable per model
  version, so caching is free and correct.

## Modelling
- **Why is acceleration from 3.7 Hz integer-kph speed noisy, and what did you
  do?** 1 kph quantisation over ~0.27 s gives ~0.4 m/s² noise per sample; a
  short polynomial fit over ~9 samples brings it to ~0.13 m/s², against
  regime signals of several m/s².
- **What is the biggest assumption?** The engine power curve. Total tractive
  power is observed; the split into engine and electric is assumed. Also the
  active-aero mode, which is not published either.
- **Why can't you call it a measurement?** No ground truth. Everything is an
  estimate under stated assumptions, validated indirectly (C5.2.8 taper,
  overtakes).

## Cloud
- **Why Oracle plus a small AWS piece?** Oracle's free ARM tier runs the whole
  thing for nothing; the raw cache in a private S3 bucket is both the backup
  strategy and real AWS use. One deploy path.
- **ARM gotcha:** every image is built arm64 in CI. Oracle reclaims idle free
  instances, so something must keep running.
