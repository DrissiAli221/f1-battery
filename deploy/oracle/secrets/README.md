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

An INI file for an IAM user that can only write to the private backup bucket. Create the user
and a policy limited to `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on that one bucket, then
write the file from your own terminal (not from a chat or a repo):

```ini
[default]
aws_access_key_id = <access key id>
aws_secret_access_key = <secret access key>
```

If you use a profile name other than `default`, set `AWS_PROFILE` in `.env`.

```sh
install -m 600 /dev/stdin secrets/aws_credentials   # paste, then Ctrl-D
```

Rotating a password: change the file, then `ALTER ROLE ... PASSWORD` inside the database (the
files are read at container start, they do not change the database), and `scripts/dc.sh up -d
--force-recreate api`.
