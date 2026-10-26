#!/usr/bin/env bash
# One full model refresh. Optional argument: the run id (a uuid), so the caller can look the run
# up afterwards; one is generated when it is omitted. DB_URL, DB_USER and DB_PASSWORD come from
# the environment (compose passes the password through a secret file).
#
#   1. quality   lap_quality for every session (estimate only sees sessions with green laps),
#                then straights and regulation (inputs of the estimator and the profile)
#   2. estimate  per-straight results, run registered in model_run but NOT yet published
#   3. profile   cross-lap speed/acceleration bins, attached to the same run
#   4. publish   mark the run published, so the API never serves a run without its profiles
# Any failing step stops the script (set -e) and leaves the run unpublished.
set -euo pipefail
cd /app

run_id="${1:-}"
if [[ -z "$run_id" ]]; then
    run_id="$(python -c 'import uuid; print(uuid.uuid4())')"
fi
if [[ ! "$run_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "run id must be a lowercase uuid, got: $run_id" >&2
    exit 2
fi
echo "RUN_ID=$run_id"

python -m f1battery_model.quality --all
# Straight definitions and regulation events are inputs of the estimator and the profile; both are
# idempotent upserts (the quick start runs them in this order too).
python -m f1battery_model.straights
python -m f1battery_model.regulation

if python -m f1battery_model.estimate --help 2>&1 | grep -q -- '--no-publish'; then
    python -m f1battery_model.estimate --all --run-id "$run_id" --no-publish
    python -m f1battery_model.profile --all-sessions --run-id "$run_id"
    python -m f1battery_model.estimate --register-existing-run "$run_id" --publish
else
    # Older estimator without the run lifecycle: it writes results only, nothing to publish.
    python -m f1battery_model.estimate --all --run-id "$run_id"
    python -m f1battery_model.profile --all-sessions --run-id "$run_id"
fi
echo "model run $run_id finished"
