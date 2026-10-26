#!/usr/bin/env bash
# Build web/dist with VITE_SITE_URL set to the public https origin. Node runs in a throwaway
# container, so the VM needs no Node install. The API is same-origin (/api), hence the empty
# VITE_API_BASE. dist is updated in place because the `web` container bind-mounts the directory.
set -euo pipefail
umask 022
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need docker id

domain="$(env_get F1_DOMAIN)"
[[ -n "$domain" && "$domain" != *example* ]] || die "set F1_DOMAIN in deploy/oracle/.env"
site_url="https://$domain"
web="$REPO_DIR/web"
[[ -f "$web/package-lock.json" ]] || die "web/package-lock.json not found"

mkdir -p "$web/dist"
rm -rf "$web/dist.new"
log "building web for $site_url"
docker run --rm \
    --user "$(id -u):$(id -g)" \
    --memory 1g \
    -e HOME=/tmp \
    -e npm_config_cache=/tmp/npm-cache \
    -e VITE_SITE_URL="$site_url" \
    -e VITE_API_BASE= \
    -v "$web:/app" \
    -w /app \
    node:22-alpine \
    sh -c 'npm ci --no-audit --no-fund && npm run build -- --outDir dist.new --emptyOutDir'

[[ -f "$web/dist.new/index.html" ]] || die "build produced no index.html"
find "$web/dist" -mindepth 1 -delete
cp -a "$web/dist.new/." "$web/dist/"
rm -rf "$web/dist.new" "$web/node_modules"
log "web/dist updated ($(du -sh "$web/dist" | cut -f1))"
