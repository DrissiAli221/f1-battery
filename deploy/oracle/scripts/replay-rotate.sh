#!/usr/bin/env bash
# Always-on replay feed: plays the recorded sessions one after another, forever, so the Replay
# feed page has a session to show without anyone choosing one on the VM. Run by
# systemd/f1-replay-producer.service.
#
#   REPLAY_SESSIONS  all | race | <comma-separated session keys>   (default race: session_name = Race)
#   REPLAY_SPEED     replay speed multiplier                       (default 20)
#   REPLAY_GAP_S     pause between two sessions, seconds           (default 10)
#   REPLAY_SESSION_KEY  the session the always-on replay-consumer serves; other sessions get a
#                    temporary consumer for the length of their run (the consumer is what turns
#                    telemetry.N into regime-state.N, which the API streams).
#
# Values come from the environment first, then deploy/oracle/.env. The session list is read from
# the database on every cycle, so a newly ingested race joins the rotation without a restart.
# One failing session is logged and skipped; the loop itself only ends when systemd stops it.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need docker

SELECTION="${REPLAY_SESSIONS:-$(env_get REPLAY_SESSIONS race)}"
SPEED="${REPLAY_SPEED:-$(env_get REPLAY_SPEED 20)}"
GAP_S="${REPLAY_GAP_S:-$(env_get REPLAY_GAP_S 10)}"
BASE_KEY="${REPLAY_SESSION_KEY:-$(env_get REPLAY_SESSION_KEY 11361)}"
CONSUMER_NAME="f1-replay-rotation-consumer"

[[ "$GAP_S" =~ ^[0-9]+$ ]] || die "REPLAY_GAP_S must be a whole number of seconds, got: $GAP_S"
[[ "$SPEED" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "REPLAY_SPEED must be a positive number, got: $SPEED"
[[ "$BASE_KEY" =~ ^[0-9]+$ ]] || die "REPLAY_SESSION_KEY must be a session key, got: $BASE_KEY"

# Only a validated selection is ever put into SQL.
case "$SELECTION" in
    all) FILTER="" ;;
    race) FILTER="and s.session_name = 'Race'" ;;
    *)
        [[ "$SELECTION" =~ ^[0-9]+(,[0-9]+)*$ ]] \
            || die "REPLAY_SESSIONS must be all, race or a comma list of session keys, got: $SELECTION"
        FILTER="and s.session_key in ($SELECTION)"
        ;;
esac

# Sessions with model results, oldest first (a session without results is not selectable on the site).
list_sessions() {
    psql_scalar "select s.session_key from session s
                 where exists (select 1 from model_result r where r.session_key = s.session_key) $FILTER
                 order by s.date_start, s.session_key"
}

stop_consumer() { docker rm -f "$CONSUMER_NAME" >/dev/null 2>&1 || true; }
trap stop_consumer EXIT
trap 'exit 143' TERM INT

play() {
    local key="$1" started=0
    log "now playing $key (speed ${SPEED}x)"
    if [[ "$key" != "$BASE_KEY" ]]; then
        stop_consumer
        if dc --profile replay-run run -d --rm -T --name "$CONSUMER_NAME" replay-consumer \
            --mode=consumer --session="$key" >/dev/null; then
            started=1
        else
            log "WARN: could not start the consumer for $key; playing without it"
        fi
    fi
    # The entrypoint wrapper (DB password from the secret file) stays: only the command is replaced.
    if ! dc --profile replay-run run --rm -T replay-producer \
        --mode=producer --session="$key" --speed="$SPEED"; then
        log "WARN: producer for session $key failed; continuing with the next session"
    fi
    if [[ "$started" == 1 ]]; then
        sleep 5 # let the consumer publish the last states before it stops
        stop_consumer
    fi
}

log "replay rotation: sessions=$SELECTION speed=${SPEED}x gap=${GAP_S}s"
while true; do
    if ! keys="$(list_sessions)"; then
        log "WARN: could not read the session list; retrying in 30 s"
        sleep 30
        continue
    fi
    if [[ -z "$keys" ]]; then
        log "WARN: no sessions match REPLAY_SESSIONS=$SELECTION; retrying in 60 s"
        sleep 60
        continue
    fi
    while IFS= read -r key; do
        [[ "$key" =~ ^[0-9]+$ ]] || continue
        play "$key"
        sleep "$GAP_S"
    done <<< "$keys"
done
