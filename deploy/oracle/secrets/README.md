# Secrets

Files in this directory are bind-mounted into the containers (`/run/secrets/<name>`). Only this
README is tracked; everything else is ignored by git and excluded from Docker build contexts.
Never put a value in `compose.yaml`, `.env`, a build argument, a unit file, or a commit.

The directory is mode `0700`, each file `0600`, owned by the VM user (`ubuntu`). The containers
run as that user's UID/GID (`F1_UID`/`F1_GID` in `.env`), which is what keeps 0600 readable.

| File | Created by | Used by | Contents |
|---|---|---|---|
| `postgres_password` | `scripts/bootstrap.sh` (`openssl rand -hex 24`) | db, ingest, model | password of the owner role `f1` |
| `api_password` | `scripts/bootstrap.sh` (`openssl rand -hex 24`) | api, replay-producer, ingest | password of the read-only role `f1_api` (set by migration V7; must not contain a single quote, which hex guarantees) |
| `aws_credentials` | you, by hand | `s3` job (raw sync, database dumps) | an AWS shared-credentials file, see below |

## aws_credentials

An INI file for the IAM user `f1-battery-vm` created by `infra/aws-f1` (least privilege: the data
bucket paths, the web bucket sync, one CloudFront invalidation). Take the key id from
`terraform output vm_access_key_id` and the secret from `terraform output -raw vm_secret_access_key`,
then write the file from your own terminal (not from a chat or a repo):

```ini
[default]
aws_access_key_id = <access key id>
aws_secret_access_key = <secret access key>
```

If you use a profile name other than `default`, set `AWS_PROFILE` in `.env`.

```sh
install -m 600 /dev/stdin secrets/aws_credentials   # paste, then Ctrl-D
```

## Rotating a password

> **Changing `api_password` (or `postgres_password`) does nothing to the database by itself.**
> The files are only read when a container starts; the role's password lives inside Postgres
> (V7 set it once). After changing the file you must run `ALTER ROLE f1_api PASSWORD '<new>'`
> (or `ALTER ROLE f1 ...`) in the database, or the api fails with
> `password authentication failed`:
>
> ```sh
> scripts/dc.sh exec -T db psql -U f1 -d f1battery -c "ALTER ROLE f1_api PASSWORD '$(cat secrets/api_password)'"
> scripts/dc.sh up -d --force-recreate api
> ```
>
> Do the `ALTER ROLE` first for `api_password`, then recreate `api` (and `replay-producer` on its
> next run uses the file too). For `postgres_password` the db container's own environment does
> not change the existing cluster either: `ALTER ROLE f1 ...` with the old password still
> valid, then recreate every service that reads the file.
