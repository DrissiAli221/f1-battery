#!/usr/bin/env bash
# Daily database backup: pg_dump (custom format) into deploy/oracle/backups, 7-day retention,
# then a copy to the private S3 bucket. Same shape as RCP's deploy/demo/scripts/backup.sh.
set -euo pipefail
umask 077
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need docker date find
cd "$DEPLOY_DIR"

retention="${F1_BACKUP_RETENTION_DAYS:-$(env_get F1_BACKUP_RETENTION_DAYS 7)}"
if [[ ! "$retention" =~ ^[0-9]+$ ]] || (( retention < 1 )); then
    die 'F1_BACKUP_RETENTION_DAYS must be a positive integer'
fi

mkdir -p backups
# Do not overlap runs; the EXIT trap also removes incomplete dumps.
mkdir backups/.backup-lock 2>/dev/null \
    || die 'a backup is running, or backups/.backup-lock needs operator inspection'
partial="$(mktemp "$DEPLOY_DIR/backups/.partial.XXXXXX")"
cleanup() {
    rm -f "$partial"
    rmdir "$DEPLOY_DIR/backups/.backup-lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# -Fc is a consistent snapshot even while the weekly job or the API is running.
dc exec -T db pg_dump -U f1 -d f1battery --format=custom --no-owner --no-acl > "$partial"
[[ -s "$partial" ]] || die 'pg_dump produced an empty file'
# Validate the archive before publishing it or pruning older ones.
dc exec -T db pg_restore --list < "$partial" >/dev/null

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
completed="$DEPLOY_DIR/backups/f1battery-$stamp.dump"
[[ ! -e "$completed" ]] || die 'a backup already exists for this second; retry later'
mv "$partial" "$completed"
find "$DEPLOY_DIR/backups" -type f -name 'f1battery-*.dump' -mtime "+$retention" -exec rm -f {} \;
log "backup saved: $completed"

if offhost_enabled; then
    s3_run s3 cp "/backups/$(basename "$completed")" \
        "s3://$(env_get F1_S3_BUCKET)/db-backups/$(basename "$completed")" --only-show-errors
    log "off-host copy done"
else
    log "WARNING: F1_SKIP_OFFHOST=1, no off-host copy of this backup"
fi
