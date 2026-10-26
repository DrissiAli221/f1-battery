"""Phase 4 estimator (proxy mode, D10): write per-straight, per-lap and per-driver results to model_result.

    python -m f1battery_model.estimate --all [--run-id UUID] [--no-publish]
    python -m f1battery_model.estimate --session 11361 [--run-id UUID] [--publish]
    python -m f1battery_model.estimate --register-existing-run UUID [--publish]

Run lifecycle (table ``model_run``, created by the ingester's migration V6): a row is
inserted unpublished when the run starts, ``sessions_done`` is updated after every
session, and ``finished_at`` is set at the end. Only an ``--all`` run that finished
with zero failed sessions is marked ``published`` (unless ``--no-publish``); the API
serves the latest published run, so a partial or single-session run never hides the
others. A ``--session`` run is published only with an explicit ``--publish``. The
process exits non-zero when any session failed. Re-using a ``--run-id`` resets that
run to unpublished while it is recomputed.

Primary cut-off: the threshold-crossing estimator that reproduced the spike
(derate.threshold_crossing on the whole full-throttle run). Experimental,
prefixed ``hinge_``: the ramp start of the power hinge fit. Hungary race 11342
is excluded (DECISIONS.md D17). Re-running with the same --run-id upserts the
same rows. All outputs are proxies, not state of charge.

Units: distances in metres from the start/finish line of the lap the straight is
attributed to (negative before the line, only the straight across it); speeds in
kph; accelerations m/s^2; deploy_energy_rel in J/kg (m^2/s^2) relative to the
car's own fitted plateau power; hinge_rate in W/kg/s.
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid

import numpy as np
import pandas as pd

from . import db, pipeline as pl, regimes

MODEL_VERSION = "proxy-0.2"   # 0.1: the frozen findings run (docs/findings.md); 0.2: D33 wrapping-straight gate
EXCLUDED_SESSIONS = {11342}
BATCH = 5000

_UPSERT = """
INSERT INTO model_result (model_version, run_id, session_key, driver_number, lap_number, straight_id,
                          variable, value, ci_low, ci_high)
SELECT %s, %s::uuid, %s, d, l, s, v, x, lo, hi
FROM unnest(%s::int[], %s::int[], %s::smallint[], %s::text[], %s::float8[], %s::float8[], %s::float8[])
     AS t(d, l, s, v, x, lo, hi)
ON CONFLICT (model_version, run_id, session_key, driver_number, lap_number, (coalesce(straight_id, -1)), variable)
DO UPDATE SET value = EXCLUDED.value, ci_low = EXCLUDED.ci_low, ci_high = EXCLUDED.ci_high, created_at = now()
"""


def _f(x):
    return None if x is None or not np.isfinite(x) else float(x)


class Writer:
    def __init__(self, conn, run_id: str, session_key: int):
        self.conn, self.run_id, self.sk = conn, run_id, session_key
        self.rows: list[tuple] = []
        self.total = 0

    def add(self, driver, lap, straight, var, value, lo=None, hi=None):
        value = _f(value)
        if value is None:
            return
        self.rows.append((driver, lap, straight, var, value, _f(lo) if lo is not None else None,
                          _f(hi) if hi is not None else None))
        if len(self.rows) >= BATCH:
            self.flush()

    def flush(self):
        if not self.rows:
            return
        cols = list(zip(*self.rows))
        with self.conn.cursor() as cur:
            cur.execute(_UPSERT, (MODEL_VERSION, self.run_id, self.sk, list(cols[0]), list(cols[1]), list(cols[2]),
                                  list(cols[3]), list(cols[4]), list(cols[5]), list(cols[6])))
        self.total += len(self.rows)
        self.rows = []


def write_driver(w: Writer, res: pl.DriverResult) -> None:
    d = res.driver
    df = res.straight_laps
    lap_energy: dict[int, float] = {}
    if df is not None and len(df):
        for r in df.itertuples():
            lap, sid = int(r.lap_number), int(r.straight_id)
            has_cross = r.cross_spike_d == r.cross_spike_d
            w.add(d, lap, sid, "cutoff_detected", 1.0 if has_cross else 0.0)
            if has_cross:
                w.add(d, lap, sid, "cutoff_distance_m", r.cross_spike_d)
                w.add(d, lap, sid, "cutoff_speed_kph", r.cross_spike_v_kph)
                w.add(d, lap, sid, "plateau_accel_ms2", r.cross_plateau_accel)
            w.add(d, lap, sid, "entry_speed_kph", r.entry_kph)
            w.add(d, lap, sid, "deploy_energy_rel", r.energy_rel)
            if r.energy_rel == r.energy_rel:
                lap_energy[lap] = lap_energy.get(lap, 0.0) + float(r.energy_rel)
            if getattr(r, "fit_ok", False) and hasattr(r, "hinge_d") and r.hinge_d == r.hinge_d:
                ok = bool(r.detected) and bool(r.hinge_valid)
                w.add(d, lap, sid, "hinge_detected", 1.0 if ok else 0.0)
                if ok:   # pinned-at-boundary fits are not measurements: other hinge_* stay NULL (no row)
                    w.add(d, lap, sid, "hinge_cutoff_distance_m", r.hinge_d)
                    w.add(d, lap, sid, "hinge_cutoff_speed_kph", r.hinge_v_kph)
                    w.add(d, lap, sid, "hinge_rate_w_per_kg_s", r.delta_wkg / r.tau_s)
    for lap, bins in res.lap_bins.items():
        sh = regimes.lap_shares(bins)
        for name, v in sh.items():
            w.add(d, lap, None, f"regime_share_{name}", v)
        if lap in lap_energy:
            w.add(d, lap, None, "deploy_energy_rel_lap", lap_energy[lap])
        for n, code in enumerate(bins):
            if code in (regimes.DEPLOY, regimes.PLATEAU, regimes.LIFT, regimes.BRAKE):
                w.add(d, lap, None, f"regime_bin_{n}", float(code))
    # per driver per session (lap 0)
    if df is not None and len(df):
        for sid, g in df.groupby("straight_id"):
            sid = int(sid)
            n = len(g)
            cs = g["cross_spike_d"].dropna()
            w.add(d, 0, sid, "cutoff_detect_fraction", len(cs) / n)
            if len(cs) >= pl.MIN_LAPS_FOR_SUMMARY:
                lo, hi = pl.bootstrap_median(cs.to_numpy(), seed=d * 1000 + sid)
                w.add(d, 0, sid, "cutoff_distance_median_m", cs.median(), lo, hi)
                w.add(d, 0, sid, "cutoff_distance_std_m", cs.std(ddof=1))
                w.add(d, 0, sid, "cutoff_speed_median_kph", g["cross_spike_v_kph"].median())
            if "hinge_d" in g:
                gh = g[g["hinge_d"].notna()].copy()
                gh["detected"] = gh["detected"].astype(bool) & gh["hinge_valid"].astype(bool)
                if len(gh):
                    det = gh[gh["detected"].astype(bool)]
                    w.add(d, 0, sid, "ramp_detect_fraction", len(det) / len(gh))
                    if len(det) >= pl.MIN_LAPS_FOR_SUMMARY:
                        lo, hi = pl.bootstrap_median(det["hinge_d"].to_numpy(), seed=d * 1000 + sid + 7)
                        w.add(d, 0, sid, "hinge_cutoff_distance_median_m", det["hinge_d"].median(), lo, hi)


def run_session(conn, session_key: int, run_id: str, log=print) -> int:
    ctx = pl.session_context(conn, session_key)
    w = Writer(conn, run_id, session_key)
    t = time.time()
    cda = None
    n_drv = 0
    for res in pl.process_session(conn, ctx):
        write_driver(w, res)
        cda = res.cda["cda_used_m2"]
        n_drv += 1
    if cda is not None:
        w.add(0, 0, None, "session_cda_m2", cda)
    w.flush()
    conn.commit()
    log(f"{session_key} {ctx.info['circuit_short_name']:<18} {ctx.info['session_name']:<17} drivers={n_drv:>2} "
        f"rows={w.total:>8} cda={cda if cda is None else round(cda, 2)} rate_default={ctx.rate_default} {time.time() - t:.1f}s")
    return w.total


RUN_TABLE_MISSING = ("table model_run does not exist: run the ingester once so that its migrations "
                     "(V6__model_run.sql) are applied, then repeat this command")


def require_run_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('model_run') IS NOT NULL")
        ok = cur.fetchone()[0]
    conn.rollback()
    if not ok:
        raise SystemExit(f"error: {RUN_TABLE_MISSING}")


def start_run(conn, run_id: str, note: str) -> None:
    """Insert (or reset) the run row as unpublished and commit it, so it survives per-session rollbacks."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO model_run (model_version, run_id, started_at, finished_at, published, sessions_done, note) "
            "VALUES (%s, %s::uuid, now(), NULL, false, 0, %s) "
            "ON CONFLICT (model_version, run_id) DO UPDATE SET started_at = now(), finished_at = NULL, "
            "published = false, sessions_done = 0, note = EXCLUDED.note",
            (MODEL_VERSION, run_id, note))
    conn.commit()


def set_sessions_done(conn, run_id: str, done: int) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE model_run SET sessions_done = %s WHERE model_version = %s AND run_id = %s::uuid",
                    (done, MODEL_VERSION, run_id))
    conn.commit()


def finish_run(conn, run_id: str, publish: bool) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE model_run SET finished_at = now(), published = %s "
                    "WHERE model_version = %s AND run_id = %s::uuid", (publish, MODEL_VERSION, run_id))
    conn.commit()


def register_existing_run(conn, run_id: str, publish: bool) -> None:
    """Create the model_run row of a run computed before the table existed, without recomputing it."""
    with conn.cursor() as cur:
        cur.execute("SELECT min(created_at), max(created_at), count(DISTINCT session_key) FROM model_result "
                    "WHERE model_version = %s AND run_id = %s::uuid", (MODEL_VERSION, run_id))
        first, last, n = cur.fetchone()
        if not n:
            conn.rollback()
            raise SystemExit(f"error: no model_result rows for {MODEL_VERSION} run {run_id}")
        cur.execute(
            "INSERT INTO model_run (model_version, run_id, started_at, finished_at, published, sessions_done, note) "
            "VALUES (%s, %s::uuid, %s, %s, %s, %s, 'registered after the fact; timestamps are min/max created_at') "
            "ON CONFLICT (model_version, run_id) DO UPDATE SET started_at = EXCLUDED.started_at, "
            "finished_at = EXCLUDED.finished_at, published = EXCLUDED.published, "
            "sessions_done = EXCLUDED.sessions_done, note = EXCLUDED.note",
            (MODEL_VERSION, run_id, first, last, publish, n))
    conn.commit()
    print(f"registered run {run_id}: {n} sessions, {first} .. {last}, published={publish}")


def green_sessions(conn) -> list[int]:
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT session_key FROM lap_quality WHERE green ORDER BY 1")
        return [r[0] for r in cur.fetchall()]


def execute(conn, a: argparse.Namespace, log=print) -> int:
    """Run the estimator for ``a`` on an open connection; returns the process exit code."""
    require_run_table(conn)
    run_id = a.run_id or str(uuid.uuid4())
    t0 = time.time()
    total = done = 0
    failures: list = []
    sessions = green_sessions(conn) if a.all else [a.session]
    conn.rollback()
    log(f"run_id {run_id} model_version {MODEL_VERSION}, {len(sessions)} sessions")
    start_run(conn, run_id, "--all" if a.all else f"--session {a.session}")
    for sk in sessions:
        if sk in EXCLUDED_SESSIONS:
            log(f"{sk} skipped (D17)")
            continue
        try:
            total += run_session(conn, sk, run_id)
            done += 1
            set_sessions_done(conn, run_id, done)
        except Exception as e:  # keep going; report at the end
            conn.rollback()
            failures.append((sk, repr(e)))
            log(f"{sk} FAILED {e!r}")
    if a.all:
        publish = not a.no_publish and not failures and done > 0
    else:
        publish = bool(a.publish) and not failures and done > 0
        if a.publish:
            log("WARNING: publishing a --session run: the API will serve only the sessions of this run")
    finish_run(conn, run_id, publish)
    log(f"rows written {total}, {time.time() - t0:.0f}s, sessions done {done}, failures {failures}, published {publish}")
    return 1 if failures else 0


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true")
    g.add_argument("--session", type=int)
    g.add_argument("--register-existing-run", metavar="UUID", help="insert the model_run row of an existing run, no recompute")
    ap.add_argument("--run-id", default=None, help="reuse a run id to re-run idempotently")
    ap.add_argument("--publish", action="store_true", help="mark the run published (required for --session and --register-existing-run)")
    ap.add_argument("--no-publish", action="store_true", help="with --all: leave the finished run unpublished")
    a = ap.parse_args(argv)
    if a.publish and a.no_publish:
        ap.error("--publish and --no-publish are mutually exclusive")
    if a.register_existing_run:
        uuid.UUID(a.register_existing_run)
    return a


def main(argv=None) -> None:
    a = parse_args(argv)
    with db.connect() as conn:
        if a.register_existing_run:
            require_run_table(conn)
            register_existing_run(conn, a.register_existing_run, a.publish)
            return
        code = execute(conn, a)
    sys.exit(code)


if __name__ == "__main__":
    main()
