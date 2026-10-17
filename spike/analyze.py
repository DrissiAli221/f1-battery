"""Phase S analysis. Throwaway. Usage: python analyze.py SESSION_KEY
Reads spike/cache/SESSION_KEY, writes spike/out/SESSION_KEY/*.png and metrics.json."""
import json, sys, pathlib, glob
import numpy as np, pandas as pd
from scipy.signal import savgol_filter
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt

sk = sys.argv[1]
cache = pathlib.Path(__file__).parent / "cache" / sk
out = pathlib.Path(__file__).parent / "out" / sk; out.mkdir(parents=True, exist_ok=True)
sess = json.load(open(cache / "session.json"))[0]
rc = pd.DataFrame(json.load(open(cache / "race_control.json")))
rc["date"] = pd.to_datetime(rc["date"], utc=True, format="ISO8601")
drivers = sorted({int(p.stem.split("_")[1]) for p in cache.glob("laps_*.json")})
if len(sys.argv) > 2: drivers = [int(x) for x in sys.argv[2:]]
GRID = 0.25            # s, uniform resampling step
SG_WIN, SG_POLY = 9, 2 # Savitzky-Golay window (samples) and order
FULL, TOPGEAR = 98, 7  # throttle >= FULL, gear >= TOPGEAR
BIN = 50               # m, distance bin for regime labels
GUARD = 1.5            # s: ignore samples closer than this to the next brake onset (savgol half-window is 1.0 s)

# --- neutralised periods from race_control (SC / VSC / red) ---
neutral = []
start = None
for _, r in rc.sort_values("date").iterrows():
    m = (r.get("message") or "").upper()
    if ("SAFETY CAR" in m and "DEPLOYED" in m) or "RED FLAG" in m:
        start = start or r["date"]
    if start is not None and (("SAFETY CAR" in m and ("ENDING" in m or "IN THIS LAP" in m)) or "GREEN LIGHT" in m or "TRACK CLEAR" in m):
        neutral.append((start, r["date"])); start = None
# unclosed windows (e.g. SC -> red flag -> restart with no "ending" message) are dropped;
# the lap-duration filter catches those laps anyway

def load_driver(d):
    rows = []
    for f in sorted(cache.glob(f"car_{d}_*.json")): rows += json.load(open(f))
    car = pd.DataFrame(rows); car["date"] = pd.to_datetime(car["date"], utc=True, format="ISO8601")
    car = car.sort_values("date").drop_duplicates("date")
    laps = pd.DataFrame(json.load(open(cache / f"laps_{d}.json")))
    laps["date_start"] = pd.to_datetime(laps["date_start"], utc=True, format="ISO8601")
    laps = laps.dropna(subset=["date_start"]).sort_values("lap_number")
    return car, laps

def green_laps(laps):
    ok = laps.copy()
    ok["t_end"] = ok["date_start"] + pd.to_timedelta(ok["lap_duration"], unit="s")
    med = ok["lap_duration"].median()
    pit_in = set(ok.loc[ok["is_pit_out_lap"] == True, "lap_number"] - 1)
    keep = []
    for _, l in ok.iterrows():
        bad = (l["lap_number"] <= 1 or l["is_pit_out_lap"] or l["lap_number"] in pit_in
               or pd.isna(l["lap_duration"]) or l["lap_duration"] > 1.07 * med
               or any(not (l["t_end"] < a or l["date_start"] > b) for a, b in neutral))
        keep.append(not bad)
    return ok[keep]

def lap_frames(car, laps):
    """Per green lap: uniform-grid frame with t, v (m/s), a (m/s2, savgol), a_rm (rolling-mean diff), dist, throttle, gear."""
    frames = []
    for _, l in laps.iterrows():
        c = car[(car["date"] >= l["date_start"]) & (car["date"] < l["t_end"])]
        if len(c) < 50: continue
        t = (c["date"] - l["date_start"]).dt.total_seconds().values
        tg = np.arange(0, t[-1], GRID)
        v = np.interp(tg, t, c["speed"].values) / 3.6
        thr = np.interp(tg, t, c["throttle"].values)
        gear = np.round(np.interp(tg, t, c["n_gear"].values))
        brk = np.interp(tg, t, c["brake"].values) > 50
        # seconds until the next brake-on sample (inf if none)
        nxt = np.full(len(tg), np.inf); last = np.inf
        for i in range(len(tg) - 1, -1, -1):
            if brk[i]: last = tg[i]
            nxt[i] = last - tg[i]
        a = savgol_filter(v, SG_WIN, SG_POLY, deriv=1, delta=GRID)
        a_rm = np.gradient(pd.Series(v).rolling(SG_WIN, center=True, min_periods=1).mean().values, GRID)
        dist = np.concatenate([[0], np.cumsum((v[1:] + v[:-1]) / 2 * GRID)])
        frames.append(pd.DataFrame(dict(lap=l["lap_number"], t=tg, v=v, a=a, a_rm=a_rm, dist=dist, thr=thr, gear=gear, brk=brk, tb=nxt)))
    return frames

metrics = {"session": sess["circuit_short_name"], "drivers": {}}
fig_all, axes_all = plt.subplots(len(drivers), 1, figsize=(14, 3 * len(drivers)), sharex=True)
for ax, d in zip(np.atleast_1d(axes_all), drivers):
    car, laps = load_driver(d); gl = green_laps(laps); frames = lap_frames(car, gl)
    if len(frames) < 5: print(f"driver {d}: only {len(frames)} green laps, skipped"); ax.set_visible(False); continue
    allf = pd.concat(frames)
    m = {"green_laps": len(frames), "laps_total": int(laps["lap_number"].max()),
         "vmax_kph": float(car["speed"].max()), "lap_len_m_median": float(np.median([f["dist"].iloc[-1] for f in frames])),
         "lap_len_m_std": float(np.std([f["dist"].iloc[-1] for f in frames])),
         "noise_raw_minus_sg_a_std_fullthrottle": float(np.std(np.concatenate([(np.gradient(f["v"].values, GRID) - f["a"].values)[(f["thr"] >= FULL).values] for f in frames]))),
         "noise_sg_vs_rm_rms": float(np.sqrt(np.mean((allf["a"] - allf["a_rm"]) ** 2)))}

    # --- Exit 1: taper. Specific excess power p = a*v + k*v^3 (W/kg), k = 0.5*rho*CdA/m assumed (X-mode, CdA~1.0, m~790).
    # Upper envelope (p90 per 10-kph bin) at full throttle, gear>=7. C5.2.8 predicts: flat below 290 kph (P_K capped at 350),
    # then falling at 5 kW/kph (= -6.3 W/kg per kph at 790 kg) from 290 to 340, and -20 kW/kph from 340 to 345.
    K_DRAG = 0.5 * 1.2 * 1.0 / 790
    ft = allf[(allf["thr"] >= FULL) & (allf["gear"] >= TOPGEAR) & (allf["v"] * 3.6 > 220)].copy()
    ft["p"] = ft["a"] * ft["v"] + K_DRAG * ft["v"] ** 3
    ft["vb"] = (ft["v"] * 3.6 // 10 * 10).astype(int)
    env = ft.groupby("vb")["p"].agg(n="size", p90=lambda x: np.percentile(x, 90), p50="median").reset_index()
    env = env[env["n"] >= 30]
    def slope(lo, hi):
        e = env[(env["vb"] >= lo) & (env["vb"] < hi)]
        return float(np.polyfit(e["vb"], e["p90"], 1)[0]) if len(e) >= 3 else None
    m["exit1_envelope"] = env.to_dict("records")
    m["exit1_slope_p90_W_per_kg_per_kph"] = {"230-290": slope(230, 290), "290-340": slope(290, 340), "regulation_290-340": -5000 / 790}
    pred = None
    # --- Exit 2: clip candidates: full throttle, top gear, a < -1.5 for >= 3 grid steps. Repeatability by lap distance.
    segs = []
    for f in frames:
        cand = ((f["thr"] >= FULL) & (f["gear"] >= TOPGEAR) & (f["a"] < -1.5) & (f["tb"] > GUARD)).values
        i = 0
        while i < len(cand):
            if cand[i]:
                j = i
                while j < len(cand) and cand[j]: j += 1
                if j - i >= 3: segs.append((f["lap"].iloc[0], f["dist"].iloc[i], f["dist"].iloc[j - 1], f["v"].iloc[i] * 3.6, float(f["a"].iloc[i:j].mean())))
                i = j
            else: i += 1
    segs = pd.DataFrame(segs, columns=["lap", "d0", "d1", "v0_kph", "a_mean"])
    ung = allf[(allf["thr"] >= FULL) & (allf["gear"] >= TOPGEAR) & (allf["a"] < -1.5)]
    m["exit2_ungated_candidates_time_to_brake_s"] = {"n": int(len(ung)), "p10": float(ung["tb"].quantile(.1)), "p50": float(ung["tb"].median()), "p90": float(ung["tb"].quantile(.9))} if len(ung) else None
    # full-throttle, top-gear, brake-off samples further than GUARD from braking: distribution of acceleration by speed band
    st = allf[(allf["thr"] >= FULL) & (allf["gear"] >= TOPGEAR) & (allf["tb"] > GUARD) & (allf["v"] * 3.6 > 280)]
    m["steady_fullthrottle_accel_by_band"] = {f"{b0}-{b1}": {"n": int(((st["v"]*3.6>=b0)&(st["v"]*3.6<b1)).sum()), "a_p10": float(st[(st["v"]*3.6>=b0)&(st["v"]*3.6<b1)]["a"].quantile(.1)), "a_p50": float(st[(st["v"]*3.6>=b0)&(st["v"]*3.6<b1)]["a"].median()), "a_p90": float(st[(st["v"]*3.6>=b0)&(st["v"]*3.6<b1)]["a"].quantile(.9))} for b0,b1 in [(280,300),(300,320),(320,340),(340,360)] if ((st["v"]*3.6>=b0)&(st["v"]*3.6<b1)).sum()>30}
    m["exit2_n_segments"] = int(len(segs))
    clusters = []
    if len(segs):
        segs["c"] = (segs["d0"] // 100).astype(int)
        for c, g in segs.groupby("c"):
            center = g["d0"].median()
            hits = segs[(segs["d0"] - center).abs() <= 50]["lap"].nunique()
            clusters.append({"dist_m": float(center), "frac_laps": hits / len(frames), "mean_len_m": float((g["d1"] - g["d0"]).mean()), "v0_kph": float(g["v0_kph"].mean()), "a_mean": float(g["a_mean"].mean())})
        clusters = sorted(clusters, key=lambda x: -x["frac_laps"])[:6]
    m["exit2_clusters"] = clusters

    # --- Exit 3: regime labels per 50 m bin; agreement between consecutive green laps.
    def labels(f):
        b = (f["dist"] // BIN).astype(int)
        lab = np.where((f["thr"] >= FULL) & (f["a"] > 0.5), 1, np.where((f["thr"] >= FULL) & (f["a"] < -1.5) & (f["tb"] > GUARD), 2, 0))
        return pd.Series(lab).groupby(b.values).agg(lambda s: s.mode().iloc[0])
    L = [labels(f) for f in frames]
    agr = []
    for x, y in zip(L[:-1], L[1:]):
        j = x.index.intersection(y.index); agr.append(float((x[j] == y[j]).mean()))
    m["exit3_agreement_mean"] = float(np.mean(agr)) if agr else None; m["exit3_agreement_min"] = float(np.min(agr)) if agr else None
    metrics["drivers"][str(d)] = m

    # --- plots
    for f in frames: ax.plot(f["dist"], f["v"] * 3.6, lw=0.4, alpha=0.5, color="k")
    for f in frames:
        cl = f[(f["thr"] >= FULL) & (f["gear"] >= TOPGEAR) & (f["a"] < -1.5) & (f["tb"] > GUARD)]
        ax.scatter(cl["dist"], cl["v"] * 3.6, s=3, color="r")
    ax.set_ylabel(f"#{d} kph"); ax.axhline(290, ls=":", c="b"); ax.axhline(345, ls=":", c="b")
    fig, ax2 = plt.subplots(figsize=(8, 5))
    ax2.scatter(ft["v"] * 3.6, ft["p"], s=2, alpha=0.2, label="full throttle, gear>=7")
    ax2.plot(env["vb"] + 5, env["p90"], "r-o", label="p90 envelope"); ax2.plot(env["vb"] + 5, env["p50"], "g-", label="median")
    vv = np.linspace(230, 360, 200); pk = np.where(vv < 290, 350, np.where(vv < 340, 1800 - 5 * vv, np.where(vv < 345, 6900 - 20 * vv, 0)))
    ax2.plot(vv, (400 + pk) * 1000 / 790, "k--", label="C5.2.8 + 400 kW ICE, 790 kg (assumed)")
    ax2.axvline(290, ls=":", c="b"); ax2.axvline(345, ls=":", c="b"); ax2.set_xlabel("kph"); ax2.set_ylabel("specific excess power W/kg"); ax2.set_ylim(-800, 1200); ax2.legend(); ax2.set_title(f"{sess['circuit_short_name']} #{d}")
    fig.savefig(out / f"accel_vs_speed_{d}.png", dpi=110); plt.close(fig)
axes_all[-1].set_xlabel("lap distance m (red = clip candidate)"); fig_all.tight_layout(); fig_all.savefig(out / "speed_overlay.png", dpi=110)
json.dump(metrics, open(out / "metrics.json", "w"), indent=1)
print(json.dumps(metrics, indent=1))
