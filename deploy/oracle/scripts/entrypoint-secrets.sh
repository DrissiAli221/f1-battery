#!/usr/bin/env bash
# Container entrypoint wrapper. Compose secrets are files; the applications read environment
# variables. For every NAME_FILE variable in the list below, export NAME with the file's content,
# then exec the real command. Same idea as RCP's deploy/demo/scripts/entrypoint.sh.
set -euo pipefail
for name in DB_PASSWORD API_DB_PASSWORD; do
    file_var="${name}_FILE"
    path="${!file_var:-}"
    [[ -n "$path" ]] || continue
    if [[ ! -s "$path" ]]; then
        printf 'Missing or empty secret file for %s: %s\n' "$name" "$path" >&2
        exit 1
    fi
    export "$name=$(cat "$path")"
    unset "$file_var"
done
exec "$@"
