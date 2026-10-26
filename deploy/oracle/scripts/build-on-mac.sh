#!/usr/bin/env bash
# Build the four application images on the Mac (arm64, same architecture as the VM) and ship
# them to the VM, so the Maven and pip builds never compete with RCP for the VM's CPU.
#
#   deploy/oracle/scripts/build-on-mac.sh [ssh-host]      # default host: oracle-arm-1
#
# Run it from a clean checkout of the commit you are deploying (the image tags are the hashes of
# the last commit touching each module, the same ones the VM computes after `git pull`), after
# pushing that commit. Then on the VM: F1_BUILD=0 deploy/oracle/scripts/deploy.sh
# (or set F1_BUILD=0 in deploy/oracle/.env for good).
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need docker git ssh
host="${1:-oracle-arm-1}"

[[ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]] \
    || die "working tree has local changes; the VM's image tags come from commits"
if ! git -C "$REPO_DIR" diff --quiet "@{upstream}" -- 2>/dev/null; then
    log "WARNING: HEAD differs from its upstream; the VM will pull the pushed commit, whose tags may not match"
fi

export_images
images=()
# service -> Dockerfile; the replay image is shared by replay-consumer and replay-producer.
build_one() {
    local image="$1" dockerfile="$2"
    if docker image inspect "$image" >/dev/null 2>&1 \
        && [[ "$(docker image inspect -f '{{.Architecture}}' "$image")" == arm64 ]]; then
        log "image $image already built"
    else
        log "building $image (linux/arm64)"
        docker build --platform linux/arm64 -f "$REPO_DIR/$dockerfile" -t "$image" "$REPO_DIR"
    fi
    images+=("$image")
}
build_one "$API_IMAGE" api/Dockerfile
build_one "$INGEST_IMAGE" ingest/Dockerfile
build_one "$MODEL_IMAGE" model/Dockerfile
if [[ "$(env_get F1_REPLAY 1)" == "1" ]]; then
    build_one "$REPLAY_IMAGE" replay/Dockerfile
fi

log "shipping ${#images[@]} images to $host (docker save | ssh docker load)"
docker save "${images[@]}" | ssh "$host" docker load
log "done. On the VM: F1_BUILD=0 /opt/f1-battery/deploy/oracle/scripts/deploy.sh"
