"""Specific excess power against speed on each Singapore straight (race 11388).

If the straight-3 "drop" is a fixed-place energy decision, p at a given speed
differs between straights; if it is speed-dependent (drag model, power taper),
the p(v) curves coincide. Full throttle for at least 1 s, more than 1.5 s
before brake onset or throttle release.
"""
from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
D = pickle.loads((ROOT / "out" / "investigations" / "sg_s3.pkl").read_bytes())
BINS = np.arange(200, 320, 10)


def usable(tr: dict) -> np.ndarray:
    full = tr["thr"] >= 98
    n = len(full)
    ok = np.zeros(n, bool)
    # full throttle for the previous 4 steps and the next 6 steps (1.5 s)
    for i in range(4, n - 6):
        ok[i] = full[i - 4:i + 7].all() and tr["tb"][i] > 1.5
    return ok


def table() -> pd.DataFrame:
    recs = []
    for (drv, lap, sid), tr in D["traces"].items():
        ok = usable(tr)
        for v, p, a, d in zip(tr["v"][ok], tr["p"][ok], tr["a"][ok], tr["d"][ok]):
            recs.append((drv, lap, sid, v, p, a, d))
    return pd.DataFrame(recs, columns=["driver", "lap", "sid", "v", "p", "a", "d"])


if __name__ == "__main__":
    df = table()
    df["vb"] = pd.cut(df.v, BINS, right=False, labels=BINS[:-1])
    out = df.groupby(["sid", "vb"], observed=True).p.median().unstack(0).round(0)
    print("median p (W/kg) by speed bin, all cars, CdA %.2f" % D["cda0"])
    print(out)
    print(df.groupby(["sid", "vb"], observed=True).size().unstack(0))
    df.to_pickle(ROOT / "out" / "investigations" / "sg_pv.pkl")
