#!/usr/bin/env bash
# Build web/dist with VITE_SITE_URL set to the CloudFront origin, then publish it: `aws s3 sync --delete`
# to the web bucket and a CloudFront invalidation, both through the `s3` job service. Node runs in a
# throwaway container, so the VM needs no Node install. The API is same-origin (/api via CloudFront),
# hence the empty VITE_API_BASE. The local dist stays for the optional `web-local` container.
set -euo pipefail
umask 022
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
need docker id

site_preflight
site_url="https://$(site_host)"
web="$REPO_DIR/web"
[[ -f "$web/package-lock.json" ]] || die "web/package-lock.json not found"

# Private assets (non-redistributable fonts and images) live in the S3 bucket, not in git:
# web/private-assets.txt lists them and `web/scripts/private-assets.sh push` uploads them once.
if [[ -f "$web/private-assets.txt" ]] && offhost_enabled; then
    log "pulling private assets from s3"
    bucket="$(env_get F1_S3_BUCKET)"
    while IFS= read -r p; do
        [[ -z "$p" || "$p" == \#* ]] && continue
        [[ "$p" == web/public/* ]] || die "private-assets.txt: $p is outside web/public"
        # </dev/null: the compose run inside the loop must not swallow the rest of the list.
        s3_run s3 cp "s3://$bucket/private-assets/$p" "/web/public/${p#web/public/}" --only-show-errors </dev/null
    done < "$web/private-assets.txt"
elif [[ -f "$web/private-assets.txt" ]]; then
    log "WARNING: private assets not pulled (F1_SKIP_OFFHOST=1); the site builds with the OFL fallback fonts"
fi

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

if offhost_enabled; then
    web_bucket="$(env_get F1_WEB_BUCKET)"
    log "syncing web/dist to s3://$web_bucket"
    # Hashed files are immutable; the pages and anything unhashed revalidate.
    s3_run s3 sync /web/dist "s3://$web_bucket" --delete --only-show-errors \
        --exclude "assets/*" --cache-control "no-cache"
    s3_run s3 sync /web/dist/assets "s3://$web_bucket/assets" --delete --only-show-errors \
        --cache-control "public, max-age=31536000, immutable"
    log "invalidating CloudFront $(env_get F1_CF_DISTRIBUTION)"
    s3_run cloudfront create-invalidation --distribution-id "$(env_get F1_CF_DISTRIBUTION)" --paths "/*" \
        --query 'Invalidation.Id' --output text >&2
else
    log "WARNING: F1_SKIP_OFFHOST=1, web/dist was NOT published to S3"
fi
