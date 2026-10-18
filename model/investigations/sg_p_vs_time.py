"""Singapore race 11388: specific excess power against time since full throttle, per straight.

Separates a speed-dependent effect (drag term, a speed-based power taper) from a
time- or place-dependent one (deployment profile after corner exit): median p
and speed on a 0.25 s grid of time since the first full-throttle sample of the run.
"""
from __future__ import annotations

import pickle
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
D = pickle.loads((ROOT / "out" / "investigations" / "sg_s3.pkl").read_bytes())
TGRID = np.arange(0, 9.01, 0.25)

if __name__ == "__main__":
    recs = []
    for (drv, lap, sid), tr in D["traces"].items():
        full = tr["thr"] >= 98
        w0 = tr["win"][0]
        idx = np.flatnonzero(full & (tr["d"] >= w0 - 150))
        if not len(idx):
            continue
        i0 = idx[0]
        j = i0
        while j < len(full) - 1 and (full[j + 1] or (j + 2 < len(full) and full[j + 2])):
            j += 1
        end = j - 6     # 1.5 s before throttle release
        for k in range(i0, max(end, i0)):
            recs.append((sid, (k - i0) * 0.25, tr["v"][k], tr["p"][k], tr["a"][k]))
    df = pd.DataFrame(recs, columns=["sid", "t", "v", "p", "a"])
    df = df[df.sid.isin([1, 3, 6])]
    med = df.groupby(["sid", "t"]).agg(p=("p", "median"), v=("v", "median"), n=("p", "size")).reset_index()
    med = med[med.n >= 100]
    print(med.pivot(index="t", columns="sid", values=["v", "p"]).round(0).iloc[::2].to_string())
    fig, ax = plt.subplots(1, 2, figsize=(11, 4))
    for sid, g in med.groupby("sid"):
        ax[0].plot(g.t, g.p, label=f"straight {sid}")
        ax[1].plot(g.v, g.p, label=f"straight {sid}")
    ax[0].set_xlabel("time since full throttle (s)"); ax[1].set_xlabel("speed (kph)")
    for a_ in ax:
        a_.set_ylabel(f"median p (W/kg), CdA {D['cda0']:.2f}"); a_.grid(alpha=0.3); a_.legend(fontsize=8)
    fig.suptitle("Singapore 11388: p against time since full throttle and against speed (all cars, green laps)", fontsize=10)
    fig.tight_layout()
    fig.savefig(ROOT / "out" / "investigations" / "sg_p_time_speed.png", dpi=110)
