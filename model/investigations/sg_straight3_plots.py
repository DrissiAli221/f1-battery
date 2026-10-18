"""Straight 3 at Singapore (race 11388): flagged vs not-flagged laps against distance.

Panels: speed, throttle, gear, rpm, acceleration, specific excess power,
gradient and path curvature (from location x/y). Medians and 10-90 % bands on
a 5 m distance grid; vertical lines at the section window, the median ramp
start and the median ramp end of flagged laps.
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
FIG = ROOT / "out" / "investigations"
D = pickle.loads((ROOT / "out" / "investigations" / "sg_s3.pkl").read_bytes())
GRID = np.arange(850, 1800, 5.0)
SID = 3


def curvature(x: np.ndarray, y: np.ndarray, d: np.ndarray) -> np.ndarray:
    """Signed curvature (1/m) of the x/y path (location units are 0.1 m), smoothed over ~40 m."""
    xs, ys = x / 10.0, y / 10.0
    k = 9
    ker = np.ones(k) / k
    xs = np.convolve(xs, ker, mode="same")
    ys = np.convolve(ys, ker, mode="same")
    h = np.unwrap(np.arctan2(np.gradient(ys), np.gradient(xs)))
    return np.gradient(h) / np.maximum(np.gradient(d), 1e-3)


def rows() -> pd.DataFrame:
    df = pd.DataFrame(D["rows"])
    return df[(df.cda == D["cda0"]) & (df.straight_id == SID)].set_index(["driver", "lap_number"])


def on_grid(key, tr: dict) -> dict:
    out = {c: np.interp(GRID, tr["d"], tr[c], left=np.nan, right=np.nan)
           for c in ("v", "thr", "gear", "rpm", "a", "p", "sin")}
    out["kappa"] = np.interp(GRID, tr["d"], curvature(tr["x"], tr["y"], tr["d"]), left=np.nan, right=np.nan)
    return out


def main() -> None:
    r = rows()
    grids = {True: [], False: []}
    for (drv, lap, sid), tr in D["traces"].items():
        if sid != SID or (drv, lap) not in r.index:
            continue
        rr = r.loc[(drv, lap)]
        if not bool(rr.get("fit_ok", False)):
            continue
        grids[bool(rr["detected"])].append(on_grid((drv, lap), tr))
    det = r[r.detected.astype(bool)]
    t0 = float(det.hinge_d.median())
    win = next(tr["win"] for (d_, l_, s_), tr in D["traces"].items() if s_ == SID)
    panels = [("v", "speed (kph)"), ("thr", "throttle (%)"), ("gear", "gear"), ("rpm", "rpm"),
              ("a", "acceleration (m/s$^2$)"), ("p", f"p (W/kg), CdA {D['cda0']:.2f}"),
              ("sin", "sin(gradient)"), ("kappa", "path curvature (1/m)")]
    fig, axs = plt.subplots(len(panels), 1, figsize=(9, 2.0 * len(panels)), sharex=True)
    col = {True: "#c0392b", False: "#2c7fb8"}
    for ax, (c, lab) in zip(axs, panels):
        for flag in (False, True):
            m = np.array([g[c] for g in grids[flag]])
            med = np.nanmedian(m, 0)
            lo, hi = np.nanpercentile(m, [10, 90], axis=0)
            ax.plot(GRID, med, color=col[flag], lw=1.4,
                    label=f"{'flagged' if flag else 'not flagged'} (n={len(m)})")
            ax.fill_between(GRID, lo, hi, color=col[flag], alpha=0.15, lw=0)
        for xv in win:
            ax.axvline(xv, color="k", ls=":", lw=0.8)
        ax.axvline(t0, color="#c0392b", ls="--", lw=0.8)
        ax.set_ylabel(lab, fontsize=8)
        ax.grid(alpha=0.3)
    axs[0].legend(fontsize=8, loc="lower right")
    axs[-1].set_xlabel("lap distance (m); dotted: section window; dashed: median ramp start of flagged laps")
    fig.suptitle("Singapore 11388, straight 3: flagged vs not-flagged laps (all cars)", fontsize=10)
    fig.tight_layout()
    fig.savefig(FIG / "sg_s3_flagged_vs_not.png", dpi=110)
    print("ramp start median", t0, "window", win)


if __name__ == "__main__":
    main()
