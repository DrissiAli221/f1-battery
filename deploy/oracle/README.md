# f1-battery on the Oracle ARM VM

Production deployment of f1-battery next to RCP on the existing Oracle Cloud Always Free ARM
VM. It follows the pattern of RCP's [`deploy/demo`](../../../RCP/deploy/demo/README.md) and
[`infra/oracle-demo`](../../../RCP/infra/oracle-demo/README.md): Ubuntu ARM64, user `ubuntu`,
app root `/opt/f1-battery`, images built on the VM from source (no registry), secrets as 0700
files bind-mounted into the containers, systemd timers instead of cron, a memory limit on every
service, local backups with 7-day retention plus an off-host copy, and Caddy as the only thing
on ports 80/443.

**Status: not yet executed; prepared only.** Nothing in this folder has been run on the VM, the
Compose file has not been rendered with `docker compose config` (Docker was not running when it
was written), and no image has been built. Treat the first deploy as a rehearsal and read each
step before running it.

## What runs

| Service | Image | Role | Exposed |
|---|---|---|---|
| `db` | `timescale/timescaledb:2.30.2-pg16` | Postgres 16 + TimescaleDB | internal network only |
| `kafka` (replay) | `apache/kafka:3.8.0` | KRaft single node, advertises `kafka:9092`, 384 MB heap | internal network only |
| `api` | built from `api/Dockerfile` | read-only Spring Boot API, `prod` profile, SSE replay relay | RCP's `edge` network as `f1-api:8080` |
| `replay-consumer` (replay) | built from `replay/Dockerfile` | regime consumer for one session (`telemetry.N` to `regime-state.N`) | none |
| `web` | `caddy:2.10.2-alpine` | static file server for `web/dist` | RCP's `edge` network as `f1-web:8080` |
| `ingest` (jobs) | built from `ingest/Dockerfile` | run-once loader; owns the Flyway migrations | none, outbound to OpenF1 |
| `model` (jobs) | built from `model/Dockerfile` | run-once: quality, estimate, profile, publish | none |
| `replay-producer` (replay) | same image as the consumer | run-once: re-emits a recorded session onto Kafka | none |
| `s3` (jobs) | `amazon/aws-cli` | off-host copies, no host install of the AWS CLI | outbound to S3 |

Nothing is published on the host. The only public path is RCP's Caddy:
`https://<F1_DOMAIN>/` goes to `f1-web`, `/api/*` to `f1-api` (`/api/live/*` unbuffered for SSE).

Networks: `database` and `kafka` are `internal: true`; `egress` is the outbound-only network for
the two jobs that call the internet; `edge` is RCP's existing network, joined as an external
network.

## The VM as surveyed

Read-only survey of the real VM (host `rcpdemo`): Ubuntu 24.04.5 LTS aarch64, kernel 6.17
(oracle), **1 CPU (`nproc` = 1), 5903 MB RAM, no swap**, load average about 2.5 on that single CPU
(RCP's drill timer fires every minute), `/` 48 GB with 36 GB free. Docker 29.8.2, Compose v5.6.0.
RCP's project is `rcp-demo` (networks `rcp-demo_edge`, `_database`, `_drill`; containers
`rcp-demo-{control-plane,caddy,drill,alloy,postgres}-1`). Its alloy (monitoring profile) is
running. Caddy 2.10.2 publishes 80/443 with `admin off`. The host firewall allows SSH only plus
Docker-forwarded 80/443. `/opt` is root-owned 755 and `/opt/rcp` is `ubuntu` 750, so
`/opt/f1-battery` is created the same way (`sudo install -d -o ubuntu -g ubuntu -m 750`).

Consequences: a single CPU already loaded at 2.5 means Maven builds and the model compete with
RCP for CPU, not only memory; all f1 jobs get a low CPU weight (`cpu_shares: 256`) so RCP wins
contention, but builds run in the Docker daemon and are not niced, so expect slow builds and some
latency on RCP while they run. There is no swap, so memory pressure ends in the OOM killer.

## Memory budget

Limits are `mem_limit` ceilings in `compose.yaml`, not measured usage. RCP's limits are the real
ones: control-plane 1024, caddy 128, drill 64, alloy 384, postgres 512 = **2112 MB**. Its measured
usage is about 850 MB, so ceilings overstate what is used, but a JVM can grow to its ceiling.

f1 limits (JVMs use `MaxRAMPercentage` 60 for the api, 45 for the consumer, 60 for ingest; Kafka
heap `-Xms128m -Xmx384m`):

| Service | Limit | Profile |
|---|---|---|
| db | 640 MB | always |
| api | 448 MB | always |
| web | 32 MB | always |
| **f1 base** | **1120 MB** | |
| kafka | 640 MB | `replay` |
| replay-consumer | 192 MB | `replay` |
| **f1 with replay** | **1952 MB** | |
| jobs, one at a time | ingest 640, model 1536, replay-producer 320 (`replay`), s3 256 | on demand |

The weekly run is ingest then model, never both; the biggest job is the model at 1536 MB.

| Option | RCP | f1 steady | Steady total | Peak (model running) | Fits |
|---|---|---|---|---|---|
| **A. Resize to 2 OCPU / 12 GB (recommended)**, replay on | 2112 | 1952 | 4064 MB | 5600 MB | comfortably |
| **B. Stay on 1 / 6 GB, replay off** | 2112 | 1120 | 3232 MB | 4768 MB of 5903 | yes, no swap; run the model at night |
| **C. Stay on 1 / 6 GB, replay on, 4 GB swapfile** | 2112 | 1952 | 4064 MB | 5600 MB of 5903 + 4096 swap | tight; risky for RCP latency |

Per-option setup, all through `.env` and the swap file, with no edits to `compose.yaml`:

- **A.** Resize the instance (shape VM.Standard.A1.Flex, in the console or through RCP's Terraform
  root; stop the instance if asked), then deploy with the defaults (`F1_REPLAY=1`,
  `API_REPLAY_ENABLED=true`). Before resizing, check the Always Free allowance in the Oracle
  console (Governance, Limits, Quotas and Usage, or Billing, Free Tier usage). The sources
  disagree: RCP's `infra/oracle-demo/README.md` says 2 OCPU / 12 GB account-wide (1,500
  OCPU-hours and 9,000 GB-hours a month), Oracle's current page says 4 OCPU / 24 GB, and the
  allowance covers every Always Free instance and retained boot volume on the account. Do not
  resize past what the console shows.
- **B.** In `.env` set `F1_REPLAY=0` and `API_REPLAY_ENABLED=false`. Kafka, the consumer and the
  producer do not start and are not built; the live view shows "Replay is not enabled". Run the
  weekly job at night (the timer is 04:00 UTC; RCP's backup is 03:00). Change to A or C later by
  flipping the two variables and running `scripts/deploy.sh`.
- **C.** Keep `F1_REPLAY=1`, and add swap first:

  ```sh
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf && sudo sysctl --system
  ```

  The weekly and backup units already run at `Nice=10` and idle I/O class for the host-side steps,
  and containers have a low CPU weight, but swapping a JVM on a block volume stalls everything,
  RCP included, and a model run in swap can take far longer. Treat C as a stopgap and watch RCP's
  health while the jobs run (`docker stats`, `vmstat 5`). `bootstrap.sh` prints a warning when RAM
  is under 10 GB.

Disk is not the constraint (36 GB free), but the Docker build cache is already 3.36 GB (2.81 GB
reclaimable) and a first build adds roughly 3 GB for the Java and model images.

### Pre-deploy cleanup (needs your approval; no script does it)

```sh
docker system df
docker builder prune            # reclaims about 2.81 GB of build cache; asks before acting
```

This only clears cache and can slow the next RCP rebuild once; it removes no containers, volumes
or images in use. `deploy.sh` never prunes on its own.

## Prerequisites

1. **Branches merged to `main`.** This folder was written against `main` plus the Docker fixes in
   PR #2 (all modules copied, non-root, pinned TimescaleDB). The deployment also depends on code
   that is on other branches at the time of writing; the scripts fail or misbehave without it:
   - `fix/api-hardening`: the `prod` profile (`DB_PASSWORD` mandatory), `API_TRUSTED_PROXIES`,
     `API_LIVE_MAX_STREAMS`, the read-only `f1_api` role (V7), and `model_run` (V6).
   - `fix/model-run-lifecycle`: `estimate --no-publish`, `--register-existing-run`, runs
     published only when complete (the model entrypoint falls back to the old behaviour when the
     flag is missing, but then there is no safe publish step).
   - The web rebuild with `VITE_SITE_URL` (`feat/web-v2`, not pushed when this was written).
     `scripts/build-web.sh` sets it; an older web tree simply ignores it.
   - `fix/ingest-api-source`: the `--source=api` path used by the weekly job.
2. **The VM is bootstrapped as RCP's is** (surveyed: Docker 29.8.2, Compose v5.6.0): Docker Engine and the Compose plugin installed, the
   `ubuntu` user in the `docker` group, RCP's firewall service running. Only 80/443 are open
   (plus restricted SSH); this deployment opens nothing new, so no firewall change is needed. Do
   not open 5432, 9092 or 8080.
3. **RCP's stack is running** (its Caddy owns 80/443 and creates the `rcp-demo_edge` network).
4. **A hostname** on the domain you already use: an `A` record for `f1.<your-domain>` pointing at
   the VM's public IPv4 (no AAAA unless IPv6 routing works). Placeholder below: `F1_DOMAIN`.
5. **A private S3 bucket** with all public access blocked, an IAM user limited to that bucket
   (see `secrets/README.md`), and a lifecycle rule that expires `db-backups/` after 14 days. This
   is the off-host copy: Oracle may reclaim idle Always Free instances, and the database is
   rebuildable only from the raw JSON that this bucket holds (D9).
6. **Data that is not in git** (the repository ignores `data/`), copied once from your laptop:

   ```sh
   rsync -a data/raw/openf1/ ubuntu@<vm>:/opt/f1-battery/data/raw/openf1/                  # skips hours of API ingest
   rsync -a data/reference/tracinginsights/ ubuntu@<vm>:/opt/f1-battery/data/reference/tracinginsights/   # straight definitions the model needs
   ```

   `bootstrap.sh` refuses to continue without `data/reference/tracinginsights/sections`. The
   raw backup is optional; without it the first ingest runs from the OpenF1 API at 30
   requests/minute, which takes hours.

## Caddy: one proxy owns 80/443

Only one Caddy can bind 80 and 443, and RCP's already does, so f1-battery cannot run its own.
Two options:

- **(a) Join RCP's `edge` network and import a site block into RCP's Caddyfile. Chosen.**
- (b) Move Caddy out of RCP's compose into a shared stack that both projects join.

(a) is recommended: RCP is the live, already-verified deployment and (a) changes it by four lines,
all reversible; its certificates, volumes and firewall rules stay where they are. (b) means
moving `caddy_data` (issued certificates, ACME account), re-wiring RCP's `depends_on`, its `drill`
network and its health route, which is more change to a working system for no benefit with two
projects. Revisit (b) only if a third project arrives.

Costs of (a): RCP's Caddy restarts whenever the f1 site block changes (RCP sets `admin off`, so
there is no live reload), and f1 depends on RCP's `edge` network existing, so RCP's stack must be
up before f1's. The f1 containers reach Caddy only through the aliases `f1-api` and `f1-web`.

### Changes to RCP (made once, by hand; this repository does not edit RCP)

`caddy/f1-battery.caddy` in this folder is the site block. In RCP's `deploy/demo`:

1. `compose.yaml`, service `caddy`:

   ```yaml
       environment:
         F1_DOMAIN: ${F1_DOMAIN:?Set F1_DOMAIN in .env}      # next to RCP_API_DOMAIN and ACME_EMAIL
       volumes:
         - /opt/f1-battery/deploy/oracle/caddy:/etc/caddy/sites:ro    # next to the Caddyfile mount
   ```

2. `.env` (RCP's): `F1_DOMAIN=f1.<your-domain>`.
3. `Caddyfile`, at the end:

   ```
   import /etc/caddy/sites/*.caddy
   ```

4. Recreate Caddy (a plain `restart` would not re-read the mounts; expect a few seconds of
   downtime for RCP's API):

   ```sh
   cd /opt/rcp/deploy/demo && docker compose up -d --force-recreate caddy
   ```

Do this after DNS points at the VM and after the f1 stack is up. With the import in place but
the f1 stack down, Caddy still starts (it only fails to reach the upstream for that hostname).
The block's default `f1-battery.invalid` is used if `F1_DOMAIN` is unset; it never matches a real
request.

Caddy sets `X-Forwarded-For` to the real client. `API_TRUSTED_PROXIES` is set by
`scripts/deploy.sh` to the exact subnet of the `edge` network (the compose default is Docker's
`172.16.0.0/12`), so the API's rate limit applies per visitor and not to Caddy as a whole.

## First deploy

On the VM, as `ubuntu`, after the prerequisites:

```sh
sudo install -d -o ubuntu -g ubuntu -m 750 /opt/f1-battery
git clone <repository url> /opt/f1-battery
/opt/f1-battery/deploy/oracle/scripts/bootstrap.sh
```

(`F1_REPO_URL=<url> bootstrap.sh` run from any other copy of the script also clones to
`/opt/f1-battery` and continues from there.)

The script creates
`secrets/` (0700) with generated `postgres_password` and `api_password` (0600), creates `.env`
from `.env.example` and stops so you can set `F1_DOMAIN`, `F1_S3_BUCKET`, `AWS_REGION`. Then:

1. Put `secrets/aws_credentials` in place (`secrets/README.md`) and edit `.env`.
2. Run the script again. It builds the four images one at a time (the `api`, `ingest`,
   `replay-consumer`, `model` services), pulls the three public images, starts the database,
   runs the migrations through an ingest dry run, builds `web/dist`, brings the stack up, runs
   the ingest (from the raw backup if `data/raw/openf1/manifest.json` exists, else from the API),
   runs the model, and checks that the run is published with its profile rows.
3. Run it inside `tmux`: the API ingest takes hours. Re-running is safe; ingest and the model
   are idempotent and resume.
4. Apply the RCP changes above, then check:

   ```sh
   curl -fsS https://<F1_DOMAIN>/api/health
   scripts/dc.sh ps
   ```

5. Install the timers (see below), run the backup once by hand, and confirm the object in S3.

Use `scripts/dc.sh` for any Compose command: it exports the image tags the scripts derive from
git (`scripts/dc.sh logs -f api`, `scripts/dc.sh ps`).

Approximate image build cost: each Java image is about 0.5 GB and its Maven stage needs more than
1 GB of memory while building; the model image is about 0.7 GB. Keep 6 GB free in
`/var/lib/docker` (the bootstrap warns) and watch `df -h` on the boot volume next to RCP.

## Updates

```sh
/opt/f1-battery/deploy/oracle/scripts/deploy.sh
```

Pulls (fast-forward only, clean tree required), refreshes `API_TRUSTED_PROXIES`, takes a
database backup, builds only images whose inputs changed (an image tag is the hash of the last
commit touching its module, so unchanged modules are skipped), rebuilds `web/dist` when `web/`
or the domain changed, runs `compose up -d`, and waits for `/api/health` inside the api
container. Then it tries the public URL and warns (not fails) if that does not answer.
Rollback: on the VM, `git reset --hard <previous commit>` in `/opt/f1-battery` (not `deploy.sh`,
which pulls) and `scripts/dc.sh up -d`; the previous images are still on disk under their own
tags (`docker image ls 'f1battery-*'`), so nothing is rebuilt. Re-run `scripts/build-web.sh` if
`web/` differed. Schema migrations are forward-only; restore from a backup if one
must be undone.

## Backups and restore

- `scripts/backup.sh` (timer `f1-backup.timer`, daily 02:00 UTC): `pg_dump --format=custom`
  from the db container into `deploy/oracle/backups/f1battery-<UTC stamp>.dump`, validated with
  `pg_restore --list`, renamed into place, files older than 7 days deleted (only after a good
  new dump), then copied to `s3://<bucket>/db-backups/`. Directory lock, 0600 files.
- The dump holds the telemetry hypertables, so it is large. Measure the first one
  (`ls -lh backups/`); seven of them plus RCP's must fit the boot volume. The S3 lifecycle rule
  bounds the bucket.
- The weekly job also syncs `data/raw/openf1/` to `s3://<bucket>/raw/openf1/` (never with
  `--delete`). Raw JSON is the root of the rebuild path: the database and all results can be
  recomputed from it (D9). Also copy `data/reference/tracinginsights/` to `s3://<bucket>/reference/`
  once from your laptop, since it is not in git.
- Verify a dump without touching the live database:

  ```sh
  scripts/restore-check.sh /opt/f1-battery/deploy/oracle/backups/f1battery-<stamp>.dump
  ```

  It restores into a throwaway TimescaleDB container with no network, using
  `timescaledb_pre_restore()` / `timescaledb_post_restore()`, and prints row counts. Run it
  after the first backup and now and then; a backup that has never been restored is a hope.
- Restore into the live database (disaster): bring the stack up with an empty database, run
  `timescaledb_pre_restore()`, `pg_restore --no-owner --no-acl -d f1battery`, then
  `timescaledb_post_restore()`, as `restore-check.sh` does. The cheaper path is usually to
  recreate from raw: `bootstrap.sh` with `data/raw/openf1` restored from S3 (`aws s3 sync` from
  your laptop, then `rsync` to the VM) ingests locally in a fraction of the API time.
- Keep one copy off the VM that is not Oracle: the S3 bucket is that copy. Check its newest
  object's age now and then.

## Timers

```sh
sudo install -m 644 /opt/f1-battery/deploy/oracle/systemd/f1-backup.service \
                    /opt/f1-battery/deploy/oracle/systemd/f1-backup.timer \
                    /opt/f1-battery/deploy/oracle/systemd/f1-weekly.service \
                    /opt/f1-battery/deploy/oracle/systemd/f1-weekly.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/f1-*.service /etc/systemd/system/f1-*.timer
sudo systemctl daemon-reload
sudo systemctl enable --now f1-backup.timer f1-weekly.timer
sudo systemctl start f1-backup.service && sudo journalctl -u f1-backup.service -n 30 --no-pager
systemctl list-timers 'f1-*'
```

Same style as RCP's units (oneshot, `Persistent=true`, `RandomizedDelaySec`, `UMask=0077`). They
run as `ubuntu` rather than root so the repo files stay owned by the deploying user.

## The weekly job

`f1-weekly.timer`, Mondays 04:00 UTC (a missed run is caught up at boot), runs
`scripts/weekly.sh`, which stops at the first failing step:

1. `tools/backup_openf1.py --sessions "Race,Qualifying,Sprint,Sprint Qualifying"` on the host
   (Python standard library only): fetches raw JSON for sessions not yet on disk, resumable.
2. `ingest --source=api --year=2026 --sessions=Race,Qualifying,Sprint,Sprint_Qualifying`
   (OpenF1, 30 requests/minute; sessions that ended under six hours ago are skipped). Set
   `F1_INGEST_SOURCE=local` in `.env` to load from the files step 1 just wrote instead of
   calling the API a second time.
3. `model <run_id>`: `quality --all` (fills `lap_quality`, which `estimate` needs), `estimate
   --all --no-publish`, `profile --all-sessions --run-id`, then publishes the run. The API
   serves the previous published run until the new one is complete.
4. Verifies `model_run` has this run published with `sessions_done > 0` and `speed_bin_*` rows.
5. `aws s3 sync data/raw/openf1` to the bucket.

Run it by hand: `sudo systemctl start f1-weekly.service`, or `scripts/weekly.sh`. Watch with
`journalctl -fu f1-weekly.service`. The `quality --all` step reprocesses every session, so
expect the model step to take a while; measure it on the first run.

## Replay and Kafka

- `kafka`: single node, KRaft (broker and controller in one process), replication factor 1, no
  authentication, advertised as `kafka:9092`, heap `-Xms128m -Xmx384m`, on the internal `kafka`
  network (not reachable from `edge`, the host, or the internet).
- Topics, created by the replay module (auto-create is off):
  `telemetry.<session_key>` (3 partitions, 6 h and 512 MiB retention) and
  `regime-state.<session_key>` (1 partition, compacted, so a late browser gets the latest state
  per driver). Broker-wide default retention is 6 h.
- The API relays `regime-state.<key>` to browsers over SSE at `/api/live/<key>`
  (`API_REPLAY_ENABLED=true`, at most `API_LIVE_MAX_STREAMS` concurrent streams, then 503).
- `replay-consumer` runs always, for the session in `REPLAY_SESSION_KEY` (default 11361). Feed
  it with the producer, which reads `car_data`/`location` as the read-only `f1_api` role:

  ```sh
  scripts/dc.sh run --rm replay-producer                      # .env session, 20x
  scripts/dc.sh run --rm replay-producer --mode=producer --session=11361 --speed=10   # override
  ```

  Re-running appends to the topics; delete them first for a clean replay:
  `scripts/dc.sh exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --delete --topic telemetry.11361`
  (and `regime-state.11361`). To serve another session, change `REPLAY_SESSION_KEY` in `.env`,
  then `scripts/dc.sh up -d replay-consumer` and run the producer. After a session finishes
  the compacted state topic keeps the last positions, so the view shows the end state until the
  next replay is started.
- **Disable it** (frees 832 MB of limits): set `F1_REPLAY=0` and `API_REPLAY_ENABLED=false` in `.env`
  (the view then shows "Replay is not enabled on this server"), then `scripts/deploy.sh`, and
  `docker stop f1-battery-kafka-1 f1-battery-replay-consumer-1` once (`--remove-orphans` does not
  see profiled services). Everything else
  is unaffected; the replay is opt-in by design.
- **Policy flag.** `docs/phase7-replay.md` limits the replay to local use because the state
  records carry `x`, `y` and `speed` near-raw, and D9 allows only derived outputs on the public
  deploy ("Open decisions" item 4 there). Serving it publicly needs that decision recorded; the
  deployment makes it possible, it does not make the decision.

## Troubleshooting

- `network rcp-demo_edge not found`: RCP's stack is not up, or its project name differs. Check
  `docker network ls` and set `EDGE_NETWORK` in `.env`.
- `api` restarts with a message about `DB_PASSWORD`: the `prod` profile needs the password; check
  `secrets/api_password` is non-empty and `scripts/dc.sh logs api`.
- `password authentication failed for user f1_api`: the role is created by migration V7 with the
  password from the day the ingest first ran. If the file was regenerated afterwards, set it in
  the database: `ALTER ROLE f1_api PASSWORD '<content of secrets/api_password>'`.
- API starts but every page errors: migrations have not run (the ingest job owns Flyway). Run
  `scripts/dc.sh --profile jobs run --rm ingest --source=local --dry-run`.
- 502 from the site: `scripts/dc.sh ps`; Caddy reaches `f1-api:8080` and `f1-web:8080` over `edge`.
  `docker exec <rcp caddy container> wget -qO- http://f1-api:8080/api/health` tests the path.
- Everyone shares one rate limit: `API_TRUSTED_PROXIES` does not include Caddy's address. Run
  `deploy.sh` (it rewrites it from the `edge` subnet) and check the value in `.env`.
- Live view says "connected" but nothing moves: the consumer is on another session, or the
  producer has not run. `scripts/dc.sh logs replay-consumer`.
- Out of memory: `docker stats --no-stream`, `dmesg | grep -i oom`; confirm the 12 GB resize.
- Model fails with "model_run does not exist": run the ingest once so V6 is applied.
- Model fails reading straights: `data/reference/tracinginsights/sections` is missing.
- Disk full: `docker image prune -a` removes unused older f1 images, `docker builder prune`
  clears build caches, `ls -lh backups/` for dump sizes.
- A stale `backups/.backup-lock` after a crash needs inspection before removal, as in RCP.

## Not covered or not verified

Not executed on a VM; no image built; `docker compose config` not run. Unverified assumptions to
check on the first deploy: that the ingest `--dry-run` runs Flyway before it exits; the
`amazon/aws-cli:2.17.0` tag; the `caddy file-server` flags in the `web` container; that the
`model` entrypoint's `--register-existing-run --publish` step behaves as the lifecycle branch
documents; the model's runtime and memory on the full dataset; and the size of a database dump.
