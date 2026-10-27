#!/usr/bin/env bash
# On-demand replay controller: replays a session while someone is watching it. Run by
# systemd/f1-replay-producer.service.
#
# The API is read-only and starts nothing. Opening the Replay feed for a session holds an SSE
# stream, which the API records; this script reads that demand (GET /api/live/demand, reachable
# only inside the VM network: Caddy answers 404 for it) every 10 s and runs a replay pair per
# wanted session:
#
#   f1-replay-<key>-consumer   telemetry.<key> -> regime-state.<key> (what the API streams)
#   f1-replay-<key>-producer   re-emits the recorded session onto telemetry.<key> at REPLAY_SPEED
#
# At most REPLAY_MAX_SESSIONS pairs run at once (a pair is about 512 MB: producer 320 + consumer 192).
# A pair whose session has had no demand for REPLAY_IDLE_S is removed. A producer that reaches the
# end of the recording while the session is still wanted is started again from the first sample.
# Before every start of a pair the session's topics are deleted (telemetry.<key>, regime-state.<key>)
# so the new pass is not appended to an old one. Topics of a running pair are never touched.
# One session that keeps failing is logged and left alone for 60 s before the next attempt.
#
#   REPLAY_MAX_SESSIONS  most pairs at once         (default 3; keep equal to API_REPLAY_MAX_SESSIONS)
#   REPLAY_IDLE_S        seconds without demand     (default 300)
#   REPLAY_SPEED         speed multiplier, 1 = real time  (default 1)
#
# Values come from the environment first, then deploy/oracle/.env. On stop (and on exit) every
# f1-replay-* container is removed.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need docker

MAX="${REPLAY_MAX_SESSIONS:-$(env_get REPLAY_MAX_SESSIONS 3)}"
IDLE_S="${REPLAY_IDLE_S:-$(env_get REPLAY_IDLE_S 300)}"
SPEED="${REPLAY_SPEED:-$(env_get REPLAY_SPEED 1)}"
POLL_S="${REPLAY_POLL_S:-10}"
BACKOFF_S=60
MIN_RUN_S=30 # a producer that ends sooner than this failed; it did not finish the recording

[[ "$MAX" =~ ^[1-9][0-9]*$ ]] || die "REPLAY_MAX_SESSIONS must be a positive whole number, got: $MAX"
[[ "$IDLE_S" =~ ^[0-9]+$ ]] || die "REPLAY_IDLE_S must be a whole number of seconds, got: $IDLE_S"
[[ "$SPEED" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "REPLAY_SPEED must be a positive number, got: $SPEED"

# Per-session state lives in variables named <FIELD>_<key> (portable: no associative arrays, so the
# script also runs under macOS bash 3.2 for testing). Fields, all epoch seconds:
#   LAST_WANTED  last demand (or discovery of a pair after a controller restart)
#   PRODUCER_AT  when the current producer was started
#   BACKOFF_UNTIL  no start is attempted before this
get() { local n="$1_$2"; printf '%s' "${!n:-0}"; }
put() { printf -v "$1_$2" '%s' "$3"; }

cleanup() {
    local ids
    ids="$(docker ps -aq --filter 'name=^f1-replay-' 2>/dev/null || true)"
    if [[ -n "$ids" ]]; then
        # shellcheck disable=SC2086
        docker rm -f $ids >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT
trap 'exit 143' TERM INT

now() { date +%s; }

# wanted_keys: session keys with demand, longest-wanted first (the API sorts them).
wanted_keys() {
    local body
    body="$(dc exec -T api curl -fsS --max-time 5 http://localhost:8080/api/live/demand)" || return 1
    grep -o '"session_key":[0-9]*' <<< "$body" | cut -d: -f2 || true
}

# running_keys: keys that have a replay container, one per line.
running_keys() {
    docker ps --filter 'name=^f1-replay-' --format '{{.Names}}' \
        | sed -nE 's/^f1-replay-([0-9]+)-(producer|consumer)$/\1/p' | sort -u
}

container_up() { [[ -n "$(docker ps -q --filter "name=^$1\$")" ]]; }

kafka_topics() { dc exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 "$@"; }

# reset_topics KEY: delete telemetry.KEY and regime-state.KEY (a topic that does not exist is
# fine), then wait up to 20 s until both are gone from the topic list. Only call it while no pair
# of KEY is running. Returns 1 if they are still listed.
reset_topics() {
    local key="$1" topic i
    for topic in "telemetry.$key" "regime-state.$key"; do
        kafka_topics --delete --topic "$topic" >/dev/null 2>&1 || true
    done
    for ((i = 0; i < 10; i++)); do
        if ! kafka_topics --list 2>/dev/null | grep -qxE "(telemetry|regime-state)\.$key"; then return 0; fi
        sleep 2
    done
    log "WARN: topics of session $key are still listed after 20 s"
    return 1
}

stop_pair() {
    log "stopping replay for $1"
    docker rm -f "f1-replay-$1-producer" "f1-replay-$1-consumer" >/dev/null 2>&1 || true
    put PRODUCER_AT "$1" 0
}

start_consumer() {
    local key="$1"
    container_up "f1-replay-$key-consumer" && return 0
    docker rm -f "f1-replay-$key-consumer" >/dev/null 2>&1 || true
    dc --profile replay-run run -d --rm -T --name "f1-replay-$key-consumer" replay-consumer \
        --mode=consumer --session="$key" >/dev/null
}

start_producer() {
    local key="$1"
    docker rm -f "f1-replay-$key-producer" >/dev/null 2>&1 || true
    # The entrypoint wrapper (DB password from the secret file) stays: only the command is replaced.
    dc --profile replay-run run -d --rm -T --name "f1-replay-$key-producer" replay-producer \
        --mode=producer --session="$key" --speed="$SPEED" >/dev/null
    put PRODUCER_AT "$key" "$(now)"
}

fail_session() {
    local key="$1"
    log "WARN: replay for session $key failed to start; retrying in ${BACKOFF_S} s"
    put BACKOFF_UNTIL "$key" $(($(now) + BACKOFF_S))
    docker rm -f "f1-replay-$key-producer" "f1-replay-$key-consumer" >/dev/null 2>&1 || true
}

tick() {
    local t key wanted running pairs
    t="$(now)"
    if ! wanted="$(wanted_keys)"; then
        log "WARN: could not read /api/live/demand; leaving the running replays as they are"
        return 0
    fi
    for key in $wanted; do put LAST_WANTED "$key" "$t"; done
    running="$(running_keys)"

    # Pairs that outlived a controller restart count as wanted from now on, then idle out normally.
    for key in $running; do
        [[ "$(get LAST_WANTED "$key")" != 0 ]] || put LAST_WANTED "$key" "$t"
    done

    # Idle pairs go; a producer that finished while the session is still wanted is started again.
    pairs=0
    for key in $running; do
        if (( t - $(get LAST_WANTED "$key") >= IDLE_S )); then
            stop_pair "$key"
            continue
        fi
        pairs=$((pairs + 1))
        if ! container_up "f1-replay-$key-producer" && (( t >= $(get BACKOFF_UNTIL "$key") )) \
            && grep -qx "$key" <<< "$wanted"; then
            if (( t - $(get PRODUCER_AT "$key") < MIN_RUN_S )); then
                fail_session "$key"
                pairs=$((pairs - 1))
            else
                log "replay for $key reached the end while wanted; starting it again"
                # The consumer goes too: its output topic is deleted, then both come back fresh.
                docker rm -f "f1-replay-$key-consumer" >/dev/null 2>&1 || true
                if ! { reset_topics "$key" && start_consumer "$key" && start_producer "$key"; }; then
                    fail_session "$key"
                    pairs=$((pairs - 1))
                fi
            fi
        fi
    done

    # New pairs for wanted sessions, longest-wanted first, up to the cap.
    for key in $wanted; do
        grep -qx "$key" <<< "$running" && continue
        ((pairs < MAX)) || break
        (( t >= $(get BACKOFF_UNTIL "$key") )) || continue
        if (( t - $(get PRODUCER_AT "$key") < MIN_RUN_S )); then # just ran and died
            fail_session "$key"
            continue
        fi
        log "starting replay for session $key (speed ${SPEED}x, $((pairs + 1))/$MAX)"
        if reset_topics "$key" && start_consumer "$key" && start_producer "$key"; then
            pairs=$((pairs + 1))
        else
            fail_session "$key"
        fi
    done
}

log "replay controller: max=$MAX idle=${IDLE_S}s speed=${SPEED}x"
cleanup # a previous run killed hard may have left containers behind
# The compose replay-consumer used to run always; it would hold a stale topic. Remove a leftover one.
legacy="$(docker ps -aq --filter 'label=com.docker.compose.service=replay-consumer' \
    --filter 'label=com.docker.compose.oneoff=False' 2>/dev/null || true)"
if [[ -n "$legacy" ]]; then
    log "removing the always-on compose replay-consumer (the controller runs one per session)"
    # shellcheck disable=SC2086
    docker rm -f $legacy >/dev/null 2>&1 || true
fi
while true; do
    tick || log "WARN: controller pass failed; continuing"
    sleep "$POLL_S"
done
