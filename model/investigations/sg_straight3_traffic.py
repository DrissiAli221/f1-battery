"""Straight 3 at Singapore (race 11388): traffic, tow and Overtake context per analysed lap.

* Track position from location x/y projected on a reference lap polyline;
  every car is on the same timestamps, so the time gap to the nearest car
  ahead on track at a given point is t_self - t_other(same track position,
  most recent pass).
* Gap at the straight start (window start) and at the median ramp start.
* Car behind: the same quantity seen from the car behind (defender test).
* interval_sample.interval (official gap to the car ahead in position) at the lap start.
* Lift point: distance of throttle release before the section end, and the time
  from throttle release to brake on (lift-and-coast).
Output: model/out/investigations/sg_s3_context.pkl and a printed summary.
"""
from __future__ import annotations

import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from f1battery_model import alignment as al, db

SESSION = 11388
ROOT = Path(__file__).resolve().parents[1]
D = pickle.loads((ROOT / "out" / "investigations" / "sg_s3.pkl").read_bytes())
REF = (63, 20)   # reference lap for the track polyline


def main() -> None:
    with db.connect() as conn:
        loc = pd.read_sql if False else None
        with conn.cursor() as cur:
            cur.execute("SELECT driver_number, ts, x, y FROM location WHERE session_key = %s ORDER BY driver_number, ts", (SESSION,))
            loc = pd.DataFrame(cur.fetchall(), columns=["drv", "ts", "x", "y"])
            cur.execute("SELECT driver_number, lap_number, date_start, lap_duration FROM lap WHERE session_key = %s", (SESSION,))
            laps = pd.DataFrame(cur.fetchall(), columns=["drv", "lap", "start", "dur"])
            cur.execute("SELECT driver_number, date, interval FROM interval_sample WHERE session_key = %s ORDER BY date", (SESSION,))
            ivl = pd.DataFrame(cur.fetchall(), columns=["drv", "date", "interval"])
    loc["t"] = al.to_ns(loc["ts"]) * 1e-9
    laps["t0"] = al.to_ns(laps["start"]) * 1e-9
    # reference polyline
    lr = laps[(laps.drv == REF[0]) & (laps.lap == REF[1])].iloc[0]
    rl = loc[(loc.drv == REF[0]) & (loc.t >= lr.t0) & (loc.t < lr.t0 + lr.dur)]
    px, py = rl.x.to_numpy(float) / 10, rl.y.to_numpy(float) / 10
    seg = np.hypot(np.diff(px), np.diff(py))
    s_ref = np.concatenate([[0], np.cumsum(seg)])
    L = s_ref[-1] + np.hypot(px[0] - px[-1], py[0] - py[-1])
    # densify
    sd = np.arange(0, s_ref[-1], 1.0)
    dx, dy = np.interp(sd, s_ref, px), np.interp(sd, s_ref, py)
    tree = cKDTree(np.c_[dx, dy])
    prog = {}
    for drv, g in loc.groupby("drv"):
        dist, idx = tree.query(np.c_[g.x.to_numpy(float) / 10, g.y.to_numpy(float) / 10])
        s = sd[idx]
        ds = np.diff(s)
        ds = np.where(ds < -L / 2, ds + L, np.where(ds > L / 2, ds - L, ds))
        S = np.concatenate([[s[0]], s[0] + np.cumsum(ds)])
        S = np.maximum.accumulate(S)
        off = dist > 30          # pit lane / off the reference path
        prog[drv] = (g.t.to_numpy(), S, off)

    def t_at(drv, P):
        """Time when ``drv`` was at unwrapped progress P (NaN outside its range)."""
        t, S, _ = prog[drv]
        u, k = np.unique(S, return_index=True)
        return np.interp(P, u, t[k], left=np.nan, right=np.nan)

    def gap_ahead(drv, t):
        """(time gap s, car) to the nearest car ahead on track at time t."""
        tt, S, off = prog[drv]
        i = np.searchsorted(tt, t)
        if i <= 0 or i >= len(tt) or off[min(i, len(off) - 1)]:
            return np.nan, None
        P = np.interp(t, tt, S)
        best, who = np.inf, None
        for o in prog:
            if o == drv:
                continue
            to, So, offo = prog[o]
            j = np.searchsorted(to, t)
            if j <= 0 or j >= len(to) or offo[j]:
                continue
            Po = np.interp(t, to, So)
            # most recent pass of the same track position by o
            k = np.floor((Po - P) / L)
            tp = t_at(o, P + k * L)
            if np.isfinite(tp) and t - tp >= 0 and t - tp < best:
                best, who = t - tp, o
        return best, who

    rows = pd.DataFrame(D["rows"])
    rows = rows[(rows.cda == D["cda0"]) & (rows.straight_id == 3) & rows.fit_ok.fillna(False).astype(bool)]
    ramp_med = float(rows.loc[rows.detected.astype(bool), "hinge_d"].median())
    out = []
    for r in rows.itertuples():
        tr = D["traces"].get((r.driver, r.lap_number, 3))
        if tr is None:
            continue
        tabs = tr["t_ns"] * 1e-9
        t_ws = float(np.interp(tr["win"][0], tr["d"], tabs))
        t_rs = float(np.interp(ramp_med, tr["d"], tabs))
        g_ws, who = gap_ahead(r.driver, t_ws)
        g_rs, _ = gap_ahead(r.driver, t_rs)
        # car behind: who has this car as nearest ahead
        g_beh = np.nan
        for o in prog:
            if o == r.driver:
                continue
            tto, So, _ = prog[o]
            tt, S, _ = prog[r.driver]
            P = np.interp(t_ws, tt, S)
            Po = np.interp(t_ws, tto, So)
            k = np.floor((P - Po) / L)   # o reaches P + ... ; time o needs to reach our position
            tp = t_at(o, P - k * L)
            if np.isfinite(tp) and tp >= t_ws:
                g_beh = np.nanmin([g_beh, tp - t_ws]) if np.isfinite(g_beh) else tp - t_ws
        lap = laps[(laps.drv == r.driver) & (laps.lap == r.lap_number)]
        lt0 = float(lap.t0.iloc[0]) if len(lap) else np.nan
        iv = ivl[ivl.drv == r.driver]
        ivt = al.to_ns(iv["date"]) * 1e-9
        j = np.searchsorted(ivt, lt0) - 1
        interval = float(iv["interval"].iloc[j]) if j >= 0 else np.nan
        # throttle release and brake on, relative to the section
        d, thr = tr["d"], tr["thr"]
        k_in = np.flatnonzero((d > ramp_med) & (thr < 98))
        lift_d = float(d[k_in[0]]) if len(k_in) else np.nan
        k_b = np.flatnonzero((d > ramp_med) & (tr["tb"] <= 0))
        brake_d = float(d[k_b[0]]) if len(k_b) else np.nan
        coast_s = float((np.interp(brake_d, d, tabs) - np.interp(lift_d, d, tabs))) if np.isfinite(lift_d + brake_d) else np.nan
        out.append(dict(driver=r.driver, lap=r.lap_number, detected=bool(r.detected), plateau_accel=r.plateau_accel,
                        gap_ws_s=g_ws, car_ahead=who, gap_ramp_s=g_rs, gap_behind_s=g_beh, interval_lapstart=interval,
                        lift_d=lift_d, brake_d=brake_d, coast_s=coast_s, vmax=float(np.nanmax(tr["v"])),
                        hinge_d=r.hinge_d, delta_kw=r.delta_kw, run_len_m=r.run_len_m))
    ctx = pd.DataFrame(out)
    ctx.to_pickle(ROOT / "out" / "investigations" / "sg_s3_context.pkl")
    ctx["tow1"] = ctx.gap_ws_s < 1.0
    ctx["attacked1"] = ctx.gap_behind_s < 1.0
    ctx["coast"] = ctx.coast_s > 0.3
    print("laps", len(ctx), "L", round(L))
    for c in ("tow1", "attacked1", "coast"):
        print(c, ctx.groupby(c).detected.agg(["mean", "count"]).round(3).to_dict())
    print(ctx.groupby("detected")[["gap_ws_s", "gap_ramp_s", "gap_behind_s", "interval_lapstart", "lift_d", "brake_d", "coast_s", "vmax"]].median().round(2))
    print("corr plateau_accel:", ctx[["plateau_accel", "gap_ws_s", "coast_s", "lift_d", "vmax"]].corr(method="spearman").plateau_accel.round(2).to_dict())


if __name__ == "__main__":
    main()
