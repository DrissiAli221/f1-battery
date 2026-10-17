"""Deploy cut-off repeatability. Usage: python deploy_cut.py SESSION_KEY DRIVER...
For each green lap, find full-throttle runs >= 4 s; within each, the first distance where smoothed accel drops below A_CUT
(and stays below for >= 1 s) = deploy cut-off. Cluster by straight (run start distance // 300 m). Report per-straight
median cut distance, std across laps, fraction of laps with a cut, and regime agreement restricted to full-throttle bins."""
import sys, json, pathlib, numpy as np, pandas as pd
sys.argv_backup = sys.argv; sys.argv = sys.argv[:2]
src = open(pathlib.Path(__file__).parent / "analyze.py").read().split("metrics = {")[0].replace('pathlib.Path(__file__).parent', 'pathlib.Path("spike")')
exec(src)
drivers = [int(x) for x in sys.argv_backup[2:]]
A_CUT = 0.5
res = {}
for d in drivers:
    car, laps = load_driver(d); frames = lap_frames(car, green_laps(laps))
    cuts = []
    for f in frames:
        ft = (f["thr"] >= FULL).values
        i = 0
        while i < len(ft):
            if ft[i]:
                j = i
                while j < len(ft) and ft[j]: j += 1
                if (j - i) * GRID >= 4:
                    seg = f.iloc[i:j]
                    vmax_i = seg["v"].values.argmax()
                    below = (seg["a"].values < A_CUT)
                    k = None
                    for q in range(len(seg) - 4):
                        if below[q:q + 4].all() and seg["v"].values[q] * 3.6 > 250: k = q; break
                    cuts.append(dict(lap=f["lap"].iloc[0], straight=int(seg["dist"].iloc[0] // 300), run_start=seg["dist"].iloc[0],
                                     run_len=seg["dist"].iloc[-1] - seg["dist"].iloc[0], cut=None if k is None else seg["dist"].iloc[k],
                                     v_at_cut=None if k is None else seg["v"].iloc[k] * 3.6, v_max=seg["v"].max() * 3.6, t_full=(j - i) * GRID))
                i = j
            else: i += 1
    c = pd.DataFrame(cuts)
    out = []
    for s_, g in c.groupby("straight"):
        if len(g) < 0.5 * len(frames): continue
        gc = g.dropna(subset=["cut"])
        out.append(dict(straight_start_m=int(g["run_start"].median()), run_len_m=int(g["run_len"].median()), laps=len(g), frac_with_cut=round(len(gc) / len(g), 2),
                        cut_median_m=None if not len(gc) else int(gc["cut"].median()), cut_std_m=None if not len(gc) else round(float(gc["cut"].std()), 1),
                        cut_iqr_m=None if not len(gc) else int(gc["cut"].quantile(.75) - gc["cut"].quantile(.25)),
                        v_at_cut=None if not len(gc) else int(gc["v_at_cut"].median()), v_max=int(g["v_max"].median())))
    # agreement restricted to full-throttle bins
    def labels(f):
        b = (f["dist"] // BIN).astype(int)
        lab = np.where((f["thr"] >= FULL) & (f["a"] > A_CUT), 1, np.where(f["thr"] >= FULL, 2, 0))
        return pd.Series(lab).groupby(b.values).agg(lambda s: s.mode().iloc[0])
    L = [labels(f) for f in frames]; agr = []
    for x, y in zip(L[:-1], L[1:]):
        j = x.index.intersection(y.index); mask = (x[j] > 0) & (y[j] > 0)
        if mask.sum(): agr.append(float((x[j][mask] == y[j][mask]).mean()))
    res[d] = dict(green_laps=len(frames), straights=out, agreement_fullthrottle_mean=round(float(np.mean(agr)), 3), agreement_fullthrottle_min=round(float(np.min(agr)), 3))
    print(f"#{d} green {len(frames)} agree(full-throttle bins) mean {np.mean(agr):.2f} min {np.min(agr):.2f}")
    for o in out: print("   ", o)
json.dump(res, open(pathlib.Path("spike/out") / sk / "deploy_cut.json", "w"), indent=1)
