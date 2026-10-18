"""Phase S figure: the apparent super-clip was the smoothing window leaking braking backwards.

Run from the repo root:  .venv/bin/python -I model/investigations/fake_clip_figure.py
Reads the spike cache (Monza race 11361, car 63) and reuses lap_frames/green_laps from
spike/analyze.py (loaded the way spike/deploy_cut.py does). No network access.
Output: web/public/figures/phase-s-fake-clip.png and docs/figures/phase-s-fake-clip.png.

Top panel: smoothed acceleration (Savitzky-Golay window 9, poly 2, 0.25 s grid) with the clip
rule applied without any guard. Bottom panel: same data with the 1.5 s brake-onset guard.
"""
import sys, pathlib, numpy as np

sys.path.insert(0, ".")  # -I removes the script dir; keep cwd for the relative spike path
ROOT = pathlib.Path(".").resolve()
sys.argv = [sys.argv[0], "11361"]
src = open(ROOT / "spike" / "analyze.py").read().split("metrics = {")[0]
src = src.replace("pathlib.Path(__file__).parent", 'pathlib.Path("spike")')
exec(src)  # defines load_driver, green_laps, lap_frames, FULL, TOPGEAR, GUARD

import matplotlib.pyplot as plt  # noqa: E402

D0, D1, EXTRA, NLAPS = 1016.0, 1950.0, 150.0, 6
car, laps = load_driver(63)
frames = lap_frames(car, green_laps(laps))

sel = []  # (frame, brake distance)
for f in frames:
    brk = f[(f["dist"] >= D0) & f["brk"]]
    if brk.empty or brk["dist"].iloc[0] > D1 + 400:
        continue
    sel.append((f, float(brk["dist"].iloc[0])))
    if len(sel) == NLAPS:
        break
assert len(sel) == NLAPS, len(sel)

clip = lambda f: (f["thr"] >= FULL) & (f["gear"] >= TOPGEAR) & (f["a"] < -1.5)
cols = plt.cm.tab10(np.arange(NLAPS))
fig, axs = plt.subplots(2, 1, figsize=(14, 9), sharex=True, dpi=100)
n_before = n_after = 0
for k, (ax, guard) in enumerate(zip(axs, (False, True))):
    for i, (f, db) in enumerate(sel):
        w = f[(f["dist"] >= D0) & (f["dist"] <= db + EXTRA)]
        ax.plot(w["dist"], w["a"], lw=0.9, color=cols[i], alpha=0.8,
                label="Smoothed acceleration, one line per lap (6 laps)" if i == 0 else None)
        m = clip(w) & ((w["tb"] > GUARD) if guard else True)
        # only mark samples on the straight itself, ahead of the brake point
        m = m & (w["dist"] <= db)
        if guard: n_after += int(m.sum())
        else: n_before += int(m.sum())
        ax.scatter(w["dist"][m], w["a"][m], s=16, color="red", zorder=4,
                   label="Meets clip rule (full throttle, gear 7+, a < -1.5 m/s²)" + (": none remain" if guard else "") if i == 0 else None)
        ax.axvline(db, color=cols[i], ls=":", lw=1, alpha=0.7)
        ax.scatter([db], [float(np.interp(db, w["dist"], w["a"]))], marker="v", s=60, color="black", zorder=5,
                   label="Brake onset" if i == 0 else None)
        if guard:
            t0 = w[w["tb"] <= GUARD]
            t0 = t0[t0["dist"] <= db]
            ax.axvspan(t0["dist"].min(), db, color="orange", alpha=0.15, lw=0,
                       label="1.5 s window before brake onset (ignored)" if i == 0 else None)
    ax.axhline(-1.5, color="grey", ls="--", lw=0.8)
    ax.axhline(0, color="black", lw=0.5)
    ax.set_ylabel("Smoothed acceleration (m/s²)")
    ax.set_title("Before the guard" if not guard else "After the 1.5 s guard", loc="left", fontsize=11)
    ax.grid(alpha=0.3); ax.legend(loc="lower left", fontsize=8, framealpha=0.9)
axs[1].set_xlabel("Lap distance (m), Monza T1 to Roggia straight, car 63, race 11361")
fig.suptitle("Phase S: the apparent super-clip was the smoothing window leaking braking backwards", fontsize=13)
fig.tight_layout(rect=(0, 0, 1, 0.97))
for p in ("web/public/figures", "docs/figures"):
    (ROOT / p).mkdir(parents=True, exist_ok=True)
    fig.savefig(ROOT / p / "phase-s-fake-clip.png", dpi=100, facecolor="white")
print("clip-rule samples on the straight: before", n_before, "after", n_after)
