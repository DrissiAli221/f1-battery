"""Monza race 11361, reference contrast: where the hinge ramp start falls inside the fitted segment.

Prints, per straight, the share of laps whose ramp start is at the earliest
index the fit allows (derate.MIN_DEPLOY_STEPS), and the plateau acceleration.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from f1battery_model import db, derate, pipeline as pl

ROOT = Path(__file__).resolve().parents[1]
CHECK = json.loads((ROOT / "out" / "phase3_check.json").read_text())
CDA = float(CHECK["cda_monza"][0]["hinge_cda_used_m2"])

if __name__ == "__main__":
    rows = []
    with db.connect() as conn:
        ctx = pl.session_context(conn, 11361)
        for drv in (63, 44, 3, 18, 27):
            prep = pl.prepare_driver(conn, ctx, drv)
            for r in pl.sweep(prep, ctx, CDA):
                if r.get("fit_ok"):
                    rows.append(dict(driver=drv, sid=r["straight_id"], k=r["t0_g"] - r["g0"], det=r["detected"],
                                     pa=r["plateau_accel"], hinge_v=r["hinge_v_kph"], dkw=r["delta_kw"],
                                     fit_start_kph=None))
    df = pd.DataFrame(rows)
    print("CdA", round(CDA, 3))
    print(df.groupby("sid").agg(n=("k", "size"), k_min=("k", lambda k: (k == derate.MIN_DEPLOY_STEPS).mean()),
                                k_med=("k", "median"), det=("det", "mean"), pa=("pa", "median"),
                                v=("hinge_v", "median"), dkw=("dkw", "median")).round(2))
