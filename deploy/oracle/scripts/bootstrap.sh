#!/usr/bin/env bash
# First deploy on the VM (Ubuntu ARM64, user ubuntu, Docker + Compose already installed by RCP's
# bootstrap). Safe to re-run: every step checks before it acts, ingest and the model are
# idempotent, and a full API ingest resumes where it stopped.
#
#   F1_REPO_URL=https://github.com/<you>/f1-battery.git deploy/oracle/scripts/bootstrap.sh
#     (from anywhere: clones to /opt/f1-battery and continues from there)
#   /opt/f1-battery/deploy/oracle/scripts/bootstrap.sh
#     (from an existing clone)
set -euo pipefail
umask 077

TARGET="${F1_ROOT:-/opt/f1-battery}"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 1. get the code to /opt/f1-battery and continue from the clone ---------------------------
if [[ "$(cd "$SELF_DIR/../../.." && pwd)" != "$TARGET" ]]; then
    command -v git >/dev/null 2>&1 || { echo 'git is required' >&2; exit 1; }
    if [[ ! -d "$TARGET/.git" ]]; then
        : "${F1_REPO_URL:?set F1_REPO_URL to the repository URL}"
        if [[ ! -w "$(dirname "$TARGET")" ]]; then
            sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0750 "$TARGET"
        fi
        git clone "$F1_REPO_URL" "$TARGET"
    fi
    exec "$TARGET/deploy/oracle/scripts/bootstrap.sh" "$@"
fi

# shellcheck source=lib.sh
source "$SELF_DIR/lib.sh"
need docker git curl openssl python3 id
docker compose version >/dev/null 2>&1 || die "docker compose plugin not found"
cd "$DEPLOY_DIR"

# --- 2. configuration and secrets ---------------------------------------------------------------
mkdir -p secrets backups "$REPO_DIR/data/raw/openf1" "$REPO_DIR/data/reference" "$REPO_DIR/web/dist"
chmod 700 secrets
for name in postgres_password api_password; do
    if [[ ! -s "secrets/$name" ]]; then
        log "generating secrets/$name"
        # hex: no quote characters (the f1_api password is a Flyway placeholder, docs/ops.md)
        openssl rand -hex 24 > "secrets/$name"
    fi
    chmod 600 "secrets/$name"
done
if [[ ! -s secrets/aws_credentials ]]; then
    log "WARNING: secrets/aws_credentials is missing; off-host copies cannot run until it exists (secrets/README.md)"
else
    chmod 600 secrets/aws_credentials
fi

if [[ ! -f "$ENV_FILE" ]]; then
    cp .env.example "$ENV_FILE"
    chmod 600 "$ENV_FILE"
fi
env_set F1_UID "$(id -u)"
env_set F1_GID "$(id -g)"
domain="$(env_get F1_DOMAIN)"
if [[ -z "$domain" || "$domain" == *example* ]]; then
    die "edit deploy/oracle/.env (F1_DOMAIN, F1_S3_BUCKET, AWS_REGION), then run this script again"
fi

sync_trusted_proxies

# The model needs the curated straight definitions, which are not in git (data/ is ignored).
sections="$REPO_DIR/data/reference/tracinginsights/sections"
[[ -d "$sections" ]] || die "missing $sections: copy it from your laptop (README, 'Data to copy')"

free_kb="$(df -Pk /var/lib/docker | awk 'NR==2 {print $4}')"
(( free_kb > 6 * 1024 * 1024 )) || log "WARNING: under 6 GB free in /var/lib/docker; image builds may fail"

# --- 3. images, one at a time -------------------------------------------------------------------
for svc in api ingest replay-consumer model; do
    build_service "$svc"
done
dc pull --quiet db kafka web

# --- 4. database up, migrated, then the rest of the stack ---------------------------------------
dc up -d db
log "waiting for the database"
for _ in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q db)" 2>/dev/null || true)" == healthy ]] && break
    sleep 5
done
[[ "$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q db)")" == healthy ]] || die "database is not healthy"

if [[ -f "$REPO_DIR/data/raw/openf1/manifest.json" ]]; then
    ingest_src=local
else
    ingest_src=api
    log "no raw backup in data/raw/openf1: ingesting from the OpenF1 API (30 requests/minute; this takes hours and resumes if re-run)"
fi
# Flyway runs when the ingest application starts (it owns the migrations, creating the f1_api
# role the API logs in with), so a dry run is enough to migrate before the API starts.
log "migrating the database"
dc --profile jobs run --rm -T ingest "--source=$ingest_src" "--year=$INGEST_YEAR" --dry-run \
    || log "WARNING: dry-run failed; the full ingest below migrates the schema anyway"

"$SELF_DIR/build-web.sh"
printf '%s' "$(image_tag web)@$domain" > "$DEPLOY_DIR/.web-built"

dc up -d --remove-orphans

# --- 5. data and model --------------------------------------------------------------------------
log "ingest --source=$ingest_src (long: run inside tmux or systemd-run if your SSH session may drop)"
run_ingest "$ingest_src"

run_id="$(new_uuid)"
log "model run $run_id"
run_model "$run_id"

# --- 6. what is left for the operator -----------------------------------------------------------
cat >&2 <<NEXT

Stack is up. Remaining manual steps (README.md, sections 'Caddy' and 'Timers'):
  1. DNS: A record for $domain -> this VM's public IPv4.
  2. RCP: mount deploy/oracle/caddy into its Caddy, add F1_DOMAIN, import the site file,
     recreate its caddy container.
  3. Check:   curl -fsS https://$domain/api/health
  4. Timers:  sudo install -m 644 $DEPLOY_DIR/systemd/f1-*.{service,timer} /etc/systemd/system/
              sudo systemctl daemon-reload && sudo systemctl enable --now f1-backup.timer f1-weekly.timer
  5. Run the first backup and confirm the object arrives in the S3 bucket.
NEXT
