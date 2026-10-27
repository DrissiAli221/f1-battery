#!/usr/bin/env bash
# docker compose for the f1-battery stack, with per-image tags exported:
#   scripts/dc.sh ps | logs -f api | --profile jobs run --rm ingest --source=local ...
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
dc "$@"
