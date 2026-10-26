#!/usr/bin/env bash
# Push or pull the non-redistributable web assets listed in web/private-assets.txt
# to or from a private S3 folder. Usage: private-assets.sh push|pull
# Needs the aws CLI with credentials from the environment or a profile, and F1_S3_BUCKET.
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root; list paths are repo-relative
LIST=web/private-assets.txt
PREFIX=private-assets

cmd="${1:-}"
case "$cmd" in push | pull) ;; *)
  echo "usage: $0 push|pull" >&2
  exit 2
  ;;
esac
: "${F1_S3_BUCKET:?F1_S3_BUCKET is not set (name of the private bucket)}"
command -v aws >/dev/null || { echo "aws CLI not found" >&2; exit 1; }

files=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  files+=("$line")
done <"$LIST"

if [[ "$cmd" == push ]]; then
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || { echo "missing locally: $f" >&2; exit 1; }
  done
  # one-file-at-a-time sync keeps paths exactly as listed
  for f in "${files[@]}"; do
    aws s3 cp --only-show-errors "$f" "s3://$F1_S3_BUCKET/$PREFIX/$f"
    echo "pushed $f"
  done
else
  for f in "${files[@]}"; do
    mkdir -p "$(dirname "$f")"
    aws s3 cp --only-show-errors "s3://$F1_S3_BUCKET/$PREFIX/$f" "$f" || { echo "failed to fetch $f from s3://$F1_S3_BUCKET/$PREFIX/" >&2; exit 1; }
    echo "pulled $f"
  done
fi
