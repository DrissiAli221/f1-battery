"""Singapore race 11388, straight 3: extract per-lap detector rows and traces.

Read-only use of the f1battery_model pipeline. For every driver, runs the derate
sweep at the session hinge CdA and at +-0.2 m^2, and stores the samples of every straight (time, distance, speed, throttle, gear, rpm, acceleration, p, x, y)
for each analysed lap. Output: model/out/investigations/sg_s3.pkl
"""
from __future__ import annotations

import json
import pickle
from pathlib import Path

import numpy as np

from f1battery_model import alignment as al, db, derate, physics as ph, pipeline as pl

SESSION = 11388
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "investigations" / "sg_s3.pkl"
CHECK = json.loads((ROOT / "out" / "phase3_check.json").read_text())
CDA0 = float(CHECK["cda_singapore"][0]["hinge_cda_used_m2"])
CDAS = (round(CDA0 - 0.2, 4), CDA0, round(CDA0 + 0.2, 4))
PAD_M = 150.0   # samples kept before / after the section window


def main() -> None:
    rows_all, traces = [], {}
    with db.connect() as conn:
        ctx = pl.session_context(conn, SESSION)
        for drv in ctx.drivers:
            prep = pl.prepare_driver(conn, ctx, drv)
            if prep is None:
                continue
            tr = prep.tr
            car = db.driver_car_data(conn, SESSION, drv)
            loc = db.driver_location(conn, SESSION, drv)
            ts = (al.to_ns(car["ts"]) - tr.t0_ns) * 1e-9
            rpm = np.interp(tr.t, ts, car["rpm"].to_numpy(dtype=float))
            lts = (al.to_ns(loc["ts"]) - tr.t0_ns) * 1e-9
            o = np.argsort(lts)
            x = np.interp(tr.t, lts[o], loc["x"].to_numpy(dtype=float)[o])
            y = np.interp(tr.t, lts[o], loc["y"].to_numpy(dtype=float)[o])
            for cda in CDAS:
                for r in pl.sweep(prep, ctx, cda):
                    r = {k: v for k, v in r.items() if np.isscalar(v) or v is None}
                    r.update(driver=drv, cda=cda)
                    rows_all.append(r)
            # every straight window per green lap, in lap coordinates
            for i in np.flatnonzero(prep.green):
                for sid, s, e, wraps in pl._lap_windows(prep.wins, prep.lap_len[i] / prep.med_len, prep.lap_len[i]):
                    c0 = tr.lap_start_cum[i]
                    if not np.isfinite(c0):
                        continue
                    i0 = int(np.searchsorted(tr.cum, c0 + s - PAD_M))
                    i1 = int(np.searchsorted(tr.cum, c0 + e + PAD_M))
                    sl = slice(i0, i1)
                    traces[(drv, int(prep.lap_no[i]), int(sid))] = dict(
                        win=(s, e), t_ns=tr.t0_ns + (tr.t[sl] * 1e9).astype(np.int64), d=tr.cum[sl] - c0,
                        v=tr.v[sl] * 3.6, a=tr.a[sl], thr=tr.thr[sl], gear=tr.gear[sl], rpm=rpm[sl],
                        p=ph.specific_excess_power(tr, CDA0, sl), sin=tr.sin_theta[sl], x=x[sl], y=y[sl],
                        mass=float(tr.mass[sl].mean()), tb=tr.tb[sl])
            print(drv, flush=True)
    OUT.write_bytes(pickle.dumps({"cdas": CDAS, "cda0": CDA0, "rows": rows_all, "traces": traces}))


if __name__ == "__main__":
    main()
