"""Straight 3 at Singapore (race 11388): how the flag share depends on the plateau-acceleration
limit and the CdA, and on traffic.

Panels: (1) plateau acceleration of laps that pass every other detection test,
split by gap to the car ahead at the section start; (2) flag share against the
plateau limit for CdA -0.2 / session / +0.2 m^2; (3) flag share per car in
clean air (gap ahead > 2 s).
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
OUT = ROOT / "out" / "investigations"
D = pickle.loads((OUT / "sg_s3.pkl").read_bytes())
CTX = pd.read_pickle(OUT / "sg_s3_context.pkl")
LIMITS = np.arange(0.4, 2.01, 0.05)

if __name__ == "__main__":
    df = pd.DataFrame(D["rows"])
    df = df[(df.straight_id == 3) & df.fit_ok.fillna(False).astype(bool)].copy()
    df["base"] = (df.delta_kw >= 100) & (df.sse_ratio <= 0.5) & (df.hinge_v_kph >= 210)
    fig, ax = plt.subplots(1, 3, figsize=(15, 4))
    s0 = df[df.cda == D["cda0"]].merge(CTX[["driver", "lap", "gap_ws_s"]], left_on=["driver", "lap_number"],
                                       right_on=["driver", "lap"])
    b = s0[s0.base]
    bins = np.arange(0, 3.01, 0.1)
    ax[0].hist(b.loc[b.gap_ws_s >= 1, "plateau_accel"], bins, alpha=0.6, label="gap ahead >= 1 s")
    ax[0].hist(b.loc[b.gap_ws_s < 1, "plateau_accel"], bins, alpha=0.6, label="gap ahead < 1 s")
    ax[0].axvline(1.0, color="k", ls="--", lw=0.8)
    ax[0].set_xlabel("plateau acceleration (m/s$^2$)"); ax[0].set_ylabel("laps")
    ax[0].set_title(f"laps passing drop/variance/speed tests: {b.shape[0]} of {s0.shape[0]}", fontsize=9)
    ax[0].legend(fontsize=8)
    for cda, g in df.groupby("cda"):
        share = [((g.plateau_accel.abs() <= L) & g.base).mean() for L in LIMITS]
        ax[1].plot(LIMITS, share, label=f"CdA {cda:.2f}")
    ax[1].axvline(1.0, color="k", ls="--", lw=0.8); ax[1].axhline(0.10, color="grey", ls=":", lw=0.8)
    ax[1].set_xlabel("plateau acceleration limit (m/s$^2$)"); ax[1].set_ylabel("share of laps flagged")
    ax[1].legend(fontsize=8); ax[1].grid(alpha=0.3)
    cl = s0[s0.gap_ws_s > 2].groupby("driver").detected.agg(["mean", "size"])
    cl = cl[cl["size"] >= 5].sort_values("mean")
    ax[2].bar([str(d) for d in cl.index], cl["mean"])
    ax[2].set_xlabel("car"); ax[2].set_ylabel("share flagged, clean air (gap ahead > 2 s)")
    for a_ in ax:
        a_.tick_params(labelsize=8)
    fig.suptitle("Singapore 11388, straight 3: the flag is set by the plateau-acceleration limit", fontsize=10)
    fig.tight_layout()
    fig.savefig(OUT / "sg_s3_threshold.png", dpi=110)
    for L in (0.5, 0.8, 0.9, 1.0, 1.1, 1.2):
        print(L, {round(c, 2): round(((g.plateau_accel.abs() <= L) & g.base).mean(), 3) for c, g in df.groupby("cda")})
    print(cl.round(2).T.to_string())
