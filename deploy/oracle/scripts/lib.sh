#!/usr/bin/env bash
# Shared helpers, sourced by the other scripts. No secrets are read or printed here.
# shellcheck shell=bash

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$LIB_DIR/.." && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"
ENV_FILE="$DEPLOY_DIR/.env"

# Sessions loaded by every ingest run (DECISIONS.md / PLAN.md Phase 1.5). Underscores are
# accepted by the ingester in place of spaces.
INGEST_SESSIONS="Race,Qualifying,Sprint,Sprint_Qualifying"
# The same list for tools/backup_openf1.py, which wants the real session names.
BACKUP_SESSIONS="Race,Qualifying,Sprint,Sprint Qualifying"
INGEST_YEAR=2026

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

need() {
    local c
    for c in "$@"; do
        command -v "$c" >/dev/null 2>&1 || die "required command not found: $c"
    done
}

# env_get KEY [DEFAULT]: read a value from deploy/oracle/.env without sourcing it.
env_get() {
    local key="$1" def="${2:-}" line=""
    if [[ -f "$ENV_FILE" ]]; then
        line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
        line="${line#*=}"
        line="${line%\"}"
        line="${line#\"}"
    fi
    if [[ -n "$line" ]]; then printf '%s' "$line"; else printf '%s' "$def"; fi
}

# env_set KEY VALUE: add or replace KEY in .env (kept 0600).
env_set() {
    local key="$1" value="$2" tmp
    tmp="$(mktemp "$DEPLOY_DIR/.env.XXXXXX")"
    if [[ -f "$ENV_FILE" ]]; then
        grep -v -E "^${key}=" "$ENV_FILE" > "$tmp" || true
    fi
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$ENV_FILE"
}

# image_tag PATH...: short hash of the last commit that touched any of the paths. An image is
# rebuilt only when its inputs changed, because its tag (and so the image name) changes then.
image_tag() {
    local tag
    tag="$(git -C "$REPO_DIR" log -1 --format=%h -- "$@")"
    [[ -n "$tag" ]] || die "no git history for: $*"
    printf '%s' "$tag"
}

export_images() {
    API_IMAGE="f1battery-api:$(image_tag api db pom.xml)"
    INGEST_IMAGE="f1battery-ingest:$(image_tag ingest db pom.xml)"
    REPLAY_IMAGE="f1battery-replay:$(image_tag replay db pom.xml)"
    MODEL_IMAGE="f1battery-model:$(image_tag model)"
    export API_IMAGE INGEST_IMAGE REPLAY_IMAGE MODEL_IMAGE
}

image_for_service() {
    case "$1" in
        api) printf '%s' "$API_IMAGE" ;;
        ingest) printf '%s' "$INGEST_IMAGE" ;;
        replay-consumer) printf '%s' "$REPLAY_IMAGE" ;;
        model) printf '%s' "$MODEL_IMAGE" ;;
        *) die "no image mapping for service $1" ;;
    esac
}

# dc ARGS...: docker compose for this stack with the image tags exported.
dc() {
    export_images
    local profile=()
    # The replay profile (kafka, replay-consumer, replay-producer) is on unless F1_REPLAY=0.
    if [[ "$(env_get F1_REPLAY 1)" == "1" ]]; then profile=(--profile replay); fi
    docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml" "${profile[@]}" "$@"
}

# app_services: the images the current profile set needs.
app_services() {
    printf '%s\n' api ingest model
    if [[ "$(env_get F1_REPLAY 1)" == "1" ]]; then printf '%s\n' replay-consumer; fi
}

# build_enabled: F1_BUILD=0 (environment or .env) means the images were built elsewhere and
# loaded with scripts/build-on-mac.sh; the VM then only checks that they are present.
build_enabled() {
    [[ "${F1_BUILD:-$(env_get F1_BUILD 1)}" != "0" ]]
}

# build_service SERVICE: build one image (skipped when this commit's tag already exists).
build_service() {
    local svc="$1" image
    export_images
    image="$(image_for_service "$svc")"
    if docker image inspect "$image" >/dev/null 2>&1; then
        log "image $image already built"
        return 0
    fi
    if ! build_enabled; then
        die "image $image is not loaded and F1_BUILD=0: run scripts/build-on-mac.sh on your Mac at this commit, or unset F1_BUILD to build here"
    fi
    log "building $image"
    dc build "$svc"
}

# render_caddy_site: caddy/f1-battery.caddy (template) -> caddy/sites/f1-battery.caddy with the
# domain from .env written literally. RCP's Caddy mounts caddy/sites/, so RCP needs no f1 variable.
render_caddy_site() {
    local domain out
    domain="$(env_get F1_DOMAIN)"
    [[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "F1_DOMAIN is not a plain hostname: $domain"
    out="$DEPLOY_DIR/caddy/sites"
    mkdir -p "$out"
    sed "s/__F1_DOMAIN__/$domain/g" "$DEPLOY_DIR/caddy/f1-battery.caddy" > "$out/f1-battery.caddy.new"
    chmod 644 "$out/f1-battery.caddy.new"
    chmod 755 "$out"
    mv "$out/f1-battery.caddy.new" "$out/f1-battery.caddy"
    log "rendered caddy/sites/f1-battery.caddy for $domain"
}

# Keep API_TRUSTED_PROXIES equal to RCP's edge subnet so Caddy (and only the edge network)
# is trusted for X-Forwarded-For; the rate limit is then per visitor, not per Caddy.
sync_trusted_proxies() {
    local net subnet
    net="$(env_get EDGE_NETWORK rcp-demo_edge)"
    docker network inspect "$net" >/dev/null 2>&1 \
        || die "docker network $net not found: start RCP's stack (its Caddy owns 80/443) first"
    subnet="$(docker network inspect "$net" --format '{{(index .IPAM.Config 0).Subnet}}')"
    [[ "$subnet" =~ ^[0-9.]+/[0-9]+$ ]] || die "unexpected subnet for $net: $subnet"
    if [[ "$(env_get API_TRUSTED_PROXIES)" != "$subnet" ]]; then
        log "API_TRUSTED_PROXIES -> $subnet"
        env_set API_TRUSTED_PROXIES "$subnet"
    fi
}

offhost_enabled() {
    [[ "$(env_get F1_SKIP_OFFHOST 0)" != "1" ]]
}

# offhost_preflight: refuse to deploy without an off-host copy path unless that was chosen on
# purpose. The database is rebuildable only from the raw JSON that the bucket holds.
offhost_preflight() {
    if offhost_enabled && [[ ! -s "$DEPLOY_DIR/secrets/aws_credentials" ]]; then
        die "no off-host backup configured: either create deploy/oracle/secrets/aws_credentials (see secrets/README.md) or set F1_SKIP_OFFHOST=1 in deploy/oracle/.env on purpose (backups then stay on this VM)"
    fi
}

# s3_run ARGS...: run the aws CLI in the `s3` job service (credentials from the secret file).
s3_run() {
    local bucket
    bucket="$(env_get F1_S3_BUCKET)"
    [[ -n "$bucket" ]] || die "F1_S3_BUCKET is not set in deploy/oracle/.env (or set F1_SKIP_OFFHOST=1)"
    [[ -s "$DEPLOY_DIR/secrets/aws_credentials" ]] \
        || die "secrets/aws_credentials is missing (or set F1_SKIP_OFFHOST=1)"
    dc --profile jobs run --rm -T s3 "$@"
}

new_uuid() { cat /proc/sys/kernel/random/uuid; }

UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

# psql_scalar SQL: one value from the database, through the db container (local socket).
psql_scalar() {
    dc exec -T db psql -U f1 -d f1battery -v ON_ERROR_STOP=1 -Atc "$1"
}

# verify_published_run RUN_ID: the model run is published and carries the profile rows.
verify_published_run() {
    local run_id="$1" row profile
    [[ "$run_id" =~ $UUID_RE ]] || die "not a run id: $run_id"
    row="$(psql_scalar "SELECT published::int || '|' || coalesce(sessions_done, 0) FROM model_run WHERE run_id = '$run_id'")"
    [[ -n "$row" ]] || die "model_run has no row for $run_id"
    [[ "$row" == 1\|* ]] || die "run $run_id is not published (model_run says: $row)"
    [[ "${row#1|}" -gt 0 ]] || die "run $run_id published with no sessions"
    profile="$(psql_scalar "SELECT count(*) FROM model_result WHERE run_id = '$run_id' AND variable ~ '^speed_bin_'")"
    [[ "$profile" -gt 0 ]] || die "run $run_id has no straight-profile rows (profile.py did not write)"
    log "run $run_id published: sessions_done=${row#1|}, profile rows=$profile"
}

# ingest_source: api (default, per PLAN.md) or local; set F1_INGEST_SOURCE=local in .env to
# load from the raw backup that backup_openf1.py just refreshed, which avoids a second pass
# over the 30 requests/minute OpenF1 limit.
ingest_source() {
    env_get F1_INGEST_SOURCE api
}

run_ingest() {
    local source="$1"
    dc --profile jobs run --rm -T ingest \
        "--source=$source" "--year=$INGEST_YEAR" "--sessions=$INGEST_SESSIONS"
}

run_model() {
    local run_id="$1"
    dc --profile jobs run --rm -T model "$run_id"
    verify_published_run "$run_id"
}
