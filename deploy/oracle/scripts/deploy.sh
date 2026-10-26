#!/usr/bin/env bash
# Update a running deployment: git pull, build only images whose inputs changed (tags are the
# last commit touching the module), back up the database, `compose up -d`, health check.
# Safe to re-run. Roll back by checking out the previous commit and running this again: the old
# images are still on disk under their own tags.
set -euo pipefail
umask 077
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need docker git curl
cd "$REPO_DIR"

[[ -f "$ENV_FILE" ]] || die "deploy/oracle/.env is missing; run scripts/bootstrap.sh first"
domain="$(env_get F1_DOMAIN)"
[[ -n "$domain" ]] || die "F1_DOMAIN is not set in deploy/oracle/.env"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    die "working tree has local changes; commit or discard them (image tags come from commits)"
fi
branch="${F1_BRANCH:-deploy}"
if [[ "$(git rev-parse --abbrev-ref HEAD)" != "$branch" ]]; then
    log "switching to $branch"
    git switch "$branch"
fi
log "pulling $branch"
# umask 022 for git only (this script runs under 077; see bootstrap.sh).
(umask 022 && git pull --ff-only origin "$branch")
log "at $(git rev-parse --short HEAD)"

offhost_preflight
render_caddy_site
sync_trusted_proxies

# Back up first, but only when a database exists to back up.
if [[ -n "$(dc ps -q db 2>/dev/null || true)" ]]; then
    log "database backup before deploy"
    "$LIB_DIR/backup.sh"
else
    log "no running database container; skipping the pre-deploy backup"
fi

# One image at a time: a Maven build peaks above 1 GB and shares the VM with RCP. With
# F1_BUILD=0 (images loaded by scripts/build-on-mac.sh) this only checks they are present.
while read -r svc; do
    build_service "$svc"
done < <(app_services)

# The web build is skipped when neither web/ nor the domain changed.
web_stamp="$(image_tag web)@$domain"
if [[ ! -f "$REPO_DIR/web/dist/index.html" || "$(cat "$DEPLOY_DIR/.web-built" 2>/dev/null || true)" != "$web_stamp" ]]; then
    "$LIB_DIR/build-web.sh"
    printf '%s' "$web_stamp" > "$DEPLOY_DIR/.web-built"
else
    log "web/dist is current ($web_stamp)"
fi

log "compose up"
dc pull --quiet --ignore-buildable
dc up -d --remove-orphans

# Health: wait for the api container's own check, then ask it directly.
log "waiting for api"
ok=0
for _ in $(seq 1 60); do
    if dc exec -T api curl -fsS http://localhost:8080/api/health >/dev/null 2>&1; then
        ok=1
        break
    fi
    sleep 5
done
if [[ "$ok" != 1 ]]; then
    dc logs --tail 50 api >&2 || true
    die "api did not become healthy within 5 minutes"
fi
log "api healthy: $(dc exec -T api curl -fsS http://localhost:8080/api/health)"

# Through Caddy: informational, because RCP's Caddyfile import is a separate step.
if curl -fsS --max-time 10 "https://$domain/api/health" >/dev/null 2>&1; then
    log "public check OK: https://$domain/api/health"
else
    log "WARNING: https://$domain/api/health did not answer (DNS, TLS, or the Caddy import is not in place yet)"
fi

git rev-parse HEAD > "$DEPLOY_DIR/.deployed-commit"
log "tip: docker builder prune frees build cache (README, pre-deploy cleanup); not done automatically"
log "deploy complete"
