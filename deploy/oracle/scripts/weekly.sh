#!/usr/bin/env bash
# Weekly refresh (PLAN.md Phase 1.5), run by f1-weekly.timer on Mondays 04:00 UTC:
#   1. tools/backup_openf1.py  raw JSON for sessions not yet in data/raw/openf1 (resumable)
#   2. ingest                  loads new sessions into Postgres (idempotent, resumable)
#   3. model                   quality, estimate, profile, then publishes the run
#   4. verify                  the run is published and carries the profile rows
#   5. S3 sync                 data/raw/openf1 to the private bucket (no --delete)
# A failure at any step stops the chain with a non-zero exit; the API keeps serving the
# previously published run because publishing is the last model step.
set -euo pipefail
umask 077
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need docker python3 flock
cd "$REPO_DIR"

exec 9> "$DEPLOY_DIR/.weekly.lock"
flock -n 9 || die 'another weekly run is in progress'

log "1/5 raw backup"
mkdir -p "$REPO_DIR/data/raw/openf1"
python3 "$REPO_DIR/tools/backup_openf1.py" --sessions "$BACKUP_SESSIONS"

ingest_src="$(ingest_source)"
log "2/5 ingest --source=$ingest_src"
run_ingest "$ingest_src"

run_id="$(new_uuid)"
log "3/5 model run $run_id"
run_model "$run_id"   # includes step 4 (verify_published_run)

log "5/5 off-host sync"
if offhost_enabled; then
    s3_run s3 sync /data/raw/openf1 "s3://$(env_get F1_S3_BUCKET)/raw/openf1/" --only-show-errors
    log "weekly run complete (run $run_id)"
else
    log "WARNING: F1_SKIP_OFFHOST=1, raw data was NOT copied off the host"
fi
