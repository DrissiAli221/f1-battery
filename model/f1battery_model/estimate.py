"""Phase 4 estimator (proxy mode, D10): write per-straight, per-lap and per-driver results to model_result.

    python -m f1battery_model.estimate --all [--run-id UUID]
    python -m f1battery_model.estimate --session 11361 [--run-id UUID]

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
import time
import uuid

import numpy as np
import pandas as pd

from . import db, pipeline as pl, regimes

MODEL_VERSION = "proxy-0.1"
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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true")
    g.add_argument("--session", type=int)
    ap.add_argument("--run-id", default=None, help="reuse a run id to re-run idempotently")
    a = ap.parse_args()
    run_id = a.run_id or str(uuid.uuid4())
    t0 = time.time()
    total = 0
    failures = []
    with db.connect() as conn:
        if a.all:
            with conn.cursor() as cur:
                cur.execute("SELECT DISTINCT session_key FROM lap_quality WHERE green ORDER BY 1")
                sessions = [r[0] for r in cur.fetchall()]
        else:
            sessions = [a.session]
        print(f"run_id {run_id} model_version {MODEL_VERSION}, {len(sessions)} sessions")
        for sk in sessions:
            if sk in EXCLUDED_SESSIONS:
                print(f"{sk} skipped (D17)")
                continue
            try:
                total += run_session(conn, sk, run_id)
            except Exception as e:  # keep going; report at the end
                conn.rollback()
                failures.append((sk, repr(e)))
                print(f"{sk} FAILED {e!r}")
    print(f"rows written {total}, {time.time() - t0:.0f}s, failures {failures}")


if __name__ == "__main__":
    main()
