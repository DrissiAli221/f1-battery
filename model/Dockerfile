# The batch model (quality -> estimate -> profile), run once per refresh as a job.
# Built from the repository root: docker build -f model/Dockerfile -t f1battery-model .
# Dependencies are installed from model/pyproject.toml. The source is then run from /app, not from site-packages, because
# quality.py writes its reports next to the package (/app/out, a tmpfs in compose).
FROM python:3.12-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /src
COPY model/pyproject.toml model/pyproject.toml
COPY model/f1battery_model model/f1battery_model
RUN cd model \
 && pip install . \
 && pip uninstall -y f1battery-model

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    MPLBACKEND=Agg MPLCONFIGDIR=/tmp/mpl HOME=/tmp \
    PATH=/opt/venv/bin:$PATH
RUN groupadd --system app && useradd --system --gid app --no-create-home --shell /usr/sbin/nologin app
COPY --from=build /opt/venv /opt/venv
WORKDIR /app
# --chmod: a clone made under umask 077 has 0600/0700 modes, which `app` could not read.
COPY --chown=app:app --chmod=a+rX model/f1battery_model /app/f1battery_model
COPY model/docker-entrypoint.sh /usr/local/bin/f1-model-run
RUN chmod 0755 /usr/local/bin/f1-model-run && mkdir -p /app/out && chown app:app /app/out
USER app
ENTRYPOINT ["/usr/local/bin/f1-model-run"]
