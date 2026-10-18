# Phase 7: optional live replay with Kafka

Re-emits one recorded session at a chosen speed onto Kafka; a consumer keeps a running regime
estimate per driver; the API relays it to the browser, which draws one moving dot per driver.
Everything here is opt-in: with Kafka absent, ingestion, the model, the API and the view behave
exactly as before.

## Architecture

```
Postgres car_data + location
   -> ReplayProducer (paced, --speed)          key = driver_number
   -> topic telemetry.<session_key>            3 partitions, 6 h / 512 MiB retention
   -> RegimeConsumer (window per driver)
   -> topic regime-state.<session_key>         1 partition, compacted, key = driver_number
   -> API  GET /api/live/{session_key}         SSE, one Kafka consumer per connection
   -> view #/live/<session_key>                EventSource, dots + table
```

- **Producer.** A reader thread streams `car_data`, each row joined to the latest `location` row at or
  before it (within 2 s; the two feeds do not share timestamps), through a server-side cursor into a bounded queue (20 000 samples), so
  memory is constant. The main thread publishes each sample when it is due: the first sample
  anchors the schedule, sample `t` is due at `anchor + (t - t0) / speed`. Absolute targets avoid
  drift; a stall over 5 s re-anchors instead of bursting. Progress is logged every 60 s of
  session time.
- **Consumer.** Keeps five samples per driver, labels the middle one (acceleration is a centred
  difference over the five samples) and publishes the state at most every 250 ms of wall time per
  driver. Metrics (records consumed / produced) are logged every 10 s.
- **API.** Each SSE connection opens its own Kafka consumer (unique group id, manual
  assignment, no commits). It reads the state topic from the beginning up to the end offsets seen
  at connect time, sends the last record per driver, then follows new records. Events: `status`
  (`connected`, `no-topic`) and `state` (the JSON record). The whole feature is behind
  `api.replay.enabled` (env `API_REPLAY_ENABLED`, default false). When disabled,
  `GET /api/live/{key}` answers 404 with `{"error":"replay disabled"}` and no Kafka client is
  created.
- **View.** Probes the endpoint when the EventSource errors: a 404 shows "Replay is not enabled on
  this server" with the instruction to enable it.

State record: `{session_key, driver_number, ts, x, y, speed, regime, lap_distance_est}`. `regime`
is `deploy`, `plateau`, `lift`, `brake` or `other` (full throttle while decelerating, as in the
batch labeller).

## Why Kafka here and not in ingestion

D8 keeps ingestion as a batch job: about 9 M rows per pass, one producer, one consumer, run once
and verified by counts. A broker there adds a hop and an operational dependency without adding a
capability; a file or a direct insert does the same job and is easier to re-run and verify.

A replay is the opposite shape: a continuous stream with a meaningful time axis, several keys
(drivers) interleaved, real-time pacing, and independent readers that start at different moments
(the regime consumer, any number of browsers, a late joiner who needs the current state). That is
what a partitioned, replayable, log-based broker provides: per-key ordering, consumers that track
their own offsets, a compacted topic that doubles as "latest state per key", and decoupling of the
producer's clock from each reader. This is the single place in the project where that fits.

## Running it

```sh
docker compose up -d db
docker compose --profile replay up -d            # adds Kafka on 127.0.0.1:9092
mvn -B -q -pl replay -am package -DskipTests

# 20x real time, two drivers, Monza race
java -jar replay/target/replay-0.1.0-SNAPSHOT.jar --mode=producer --session=11361 --speed=20 --drivers=1,63
java -jar replay/target/replay-0.1.0-SNAPSHOT.jar --mode=consumer --session=11361

API_REPLAY_ENABLED=true API_CORS_ORIGIN=http://localhost:4173 \
  java -jar api/target/api-0.1.0-SNAPSHOT.jar
# open  http://localhost:4173/#/live/11361
```

Re-running a session appends to the existing topics; delete them first for a clean replay
(`kafka-topics.sh --bootstrap-server localhost:9092 --delete --topic telemetry.11361`, and the same for
`regime-state.11361`).

Environment: `KAFKA_BOOTSTRAP` (default `localhost:9092`) for producer, consumer and API;
`DB_URL`, `DB_USER`, `DB_PASSWORD` for the producer. Omit `--drivers` for all cars and `--speed`
for real time. Stop everything with `docker compose --profile replay stop kafka`; the data volume
is `f1battery_kafka`.

## Limitations

- The consumer's regime is a simplified labeller. It reuses the rules of
  `model/f1battery_model/regimes.py` (brake, then lift below 98 % throttle, then deploy / plateau
  at |a| 0.5 m/s^2) but not the Savitzky-Golay acceleration, the brake guard or the post-lift burst
  extension. The batch model stays authoritative; live labels will differ in places.
- `lap_distance_est` is the running integral of speed since the consumer first saw the driver. It
  is not anchored to the start/finish line and drifts with speed error, so it is not a lap
  position. The view places a dot at `(lap_distance_est * 10) mod outline length` along the
  reference outline (outline distances are in 1/10 m), which gives correct pace and wrap-around
  but an approximate and slowly drifting position. Cars that started the consumer mid-lap are
  offset by a constant. The `x`, `y` fields are in the record but not used for placement, because
  drawing raw positions would publish raw samples (D9).
- One broker, replication factor 1, no authentication: a local demo, not a deployment target.
- Publishing the live feed beyond localhost would serve near-raw speed values; D9 restricts public
  deploys to derived outputs, so the replay profile is for local use only.
- `docker compose --profile replay` needs about 400 MB for the image plus a small volume.

## Open decisions

1. Whether to anchor `lap_distance_est` using the `lap` table (lap start timestamps) or project
   `x, y` onto the outline server-side, which would fix the position drift.
2. Whether the live consumer should reuse the Python regime code through a shared specification
   or stay a separate simplified implementation.
3. Whether D8 should record this phase explicitly as the sole accepted use of Kafka.
4. Whether the replay profile may ever be exposed publicly (see D9).


Runtime note: the replay jar targets Java 21; on a machine whose default `java` is older, run it with the JDK 21 binary (for example `$(/usr/libexec/java_home -v 21)/bin/java -jar ...`), otherwise it fails with `UnsupportedClassVersionError`.
