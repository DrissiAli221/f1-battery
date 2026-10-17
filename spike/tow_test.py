"""Tow test. Usage: python tow_test.py SESSION_KEY DRIVER...
Per car and long straight: does the deploy cut-off DISTANCE stay fixed when the entry speed is higher (tow laps),
or does the cut-off SPEED stay fixed (cut follows speed)? Entry speed = speed 150 m into the full-throttle run.
Report slope of cut_distance vs entry_speed (m per kph) and of cut_speed vs entry_speed, with correlations."""
import sys, json, pathlib, numpy as np, pandas as pd
sys.argv_backup = sys.argv; sys.argv = sys.argv[:2]
src = open(pathlib.Path(__file__).parent / "analyze.py").read().split("metrics = {")[0].replace('pathlib.Path(__file__).parent', 'pathlib.Path("spike")')
exec(src)
drivers = [int(x) for x in sys.argv_backup[2:]]
A_CUT = 0.5; res = {}
for d in drivers:
    car, laps = load_driver(d); frames = lap_frames(car, green_laps(laps)); rows = []
    for f in frames:
        ft = (f["thr"] >= FULL).values; i = 0
        while i < len(ft):
            if ft[i]:
                j = i
                while j < len(ft) and ft[j]: j += 1
                if (j - i) * GRID >= 4:
                    seg = f.iloc[i:j]; d0 = seg["dist"].iloc[0]
                    e = seg[seg["dist"] >= d0 + 150]
                    if len(e) == 0: i = j; continue
                    v_entry = e["v"].iloc[0] * 3.6
                    below = seg["a"].values < A_CUT; k = None
                    for q in range(len(seg) - 4):
                        if below[q:q + 4].all() and seg["v"].values[q] * 3.6 > 250: k = q; break
                    if k is not None:
                        rows.append(dict(lap=f["lap"].iloc[0], straight=int(d0 // 300), v_entry=v_entry, cut=seg["dist"].iloc[k], v_cut=seg["v"].iloc[k] * 3.6, v_max=seg["v"].max() * 3.6))
                i = j
            else: i += 1
    c = pd.DataFrame(rows); out = []
    for s_, g in c.groupby("straight"):
        if len(g) < 15 or g["v_entry"].std() < 2: continue
        sd = np.polyfit(g["v_entry"], g["cut"], 1)[0]; rd = np.corrcoef(g["v_entry"], g["cut"])[0, 1]
        sv = np.polyfit(g["v_entry"], g["v_cut"], 1)[0]; rv = np.corrcoef(g["v_entry"], g["v_cut"])[0, 1]
        hi = g[g["v_entry"] >= g["v_entry"].quantile(.8)]; lo = g[g["v_entry"] <= g["v_entry"].quantile(.2)]
        out.append(dict(straight_start_m=int(s_ * 300), n=len(g), v_entry_range=(int(g["v_entry"].min()), int(g["v_entry"].max())),
                        slope_cut_m_per_kph=round(float(sd), 1), r_cut=round(float(rd), 2), slope_vcut_per_kph=round(float(sv), 2), r_vcut=round(float(rv), 2),
                        fast_entry=dict(v_entry=int(hi["v_entry"].mean()), cut=int(hi["cut"].median()), v_cut=int(hi["v_cut"].median())),
                        slow_entry=dict(v_entry=int(lo["v_entry"].mean()), cut=int(lo["cut"].median()), v_cut=int(lo["v_cut"].median()))))
    res[d] = out
    print(f"#{d}")
    for o in out: print("   ", o)
json.dump(res, open(pathlib.Path("spike/out") / sk / "tow_test.json", "w"), indent=1)
