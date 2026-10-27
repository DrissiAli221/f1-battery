#!/usr/bin/env bash
# Isolated restore test: loads a backup into a throwaway TimescaleDB container with no network
# and prints a few counts. Never touches the live database. Run it on the VM or on a laptop:
#   restore-check.sh /absolute/path/to/f1battery-YYYYMMDDTHHMMSSZ.dump
set -euo pipefail
if [[ $# -ne 1 || ! -s "$1" ]]; then
    echo 'Usage: restore-check.sh /absolute/path/to/f1battery-*.dump' >&2
    exit 1
fi
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
image="timescale/timescaledb:2.30.2-pg16"   # keep equal to compose.yaml
container=""
cleanup() {
    if [[ -n "$container" ]]; then docker rm -fv "$container" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
container="$(docker run -d --rm --network none --memory 768m \
    -e POSTGRES_USER=f1 -e POSTGRES_DB=f1battery \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e TIMESCALEDB_TELEMETRY=off "$image")"
ready=false
for _ in $(seq 1 90); do
    if docker exec "$container" pg_isready -U f1 -d f1battery >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
done
[[ "$ready" == true ]] || die 'isolated PostgreSQL did not become ready'
# TimescaleDB restore protocol: pre_restore, restore, post_restore.
docker exec "$container" psql -U f1 -d f1battery -v ON_ERROR_STOP=1 -c 'SELECT timescaledb_pre_restore();'
docker exec -i "$container" pg_restore -U f1 -d f1battery --no-owner --no-acl --exit-on-error < "$1"
docker exec "$container" psql -U f1 -d f1battery -v ON_ERROR_STOP=1 -c 'SELECT timescaledb_post_restore();'
docker exec "$container" psql -U f1 -d f1battery -v ON_ERROR_STOP=1 -Atc "
SELECT 'flyway migrations: ' || count(*) FROM flyway_schema_history WHERE success;
SELECT 'sessions: ' || count(*) FROM session;
SELECT 'car_data rows: ' || count(*) FROM car_data;
SELECT 'published model runs: ' || count(*) FROM model_run WHERE published;"
echo 'Isolated restore PASS; temporary database removed on exit.'
