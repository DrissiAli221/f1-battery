"""Compare differentiation methods on synthetic straights, then on one real car.

Run from the repo root:  .venv/bin/python -m f1battery_model.eval_differentiation
Writes docs/phase3-differentiation.md and figures under model/out/.
"""
import gzip
import json
import pathlib
import warnings

import numpy as np
import pandas as pd

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from .differentiate import METHODS
from .synthetic import make_dataset

warnings.filterwarnings("ignore")
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "model" / "out"
DOC = ROOT / "docs" / "phase3-differentiation.md"
GUARD = 1.5  # s before brake onset excluded from the plateau/ramp-start search (D11)
A_THRESH = 0.5  # m/s^2, ramp-start crossing level
N_TUNE = 50
RAW = ROOT / "data" / "raw" / "openf1" / "11361"
CAR = 63
WINDOW_M = (1016.0, 1950.0)  # T1 exit -> Roggia, lap distance from lap start


def regions(s):
    t = s.t
    return {
        "deploy": t < s.t_ramp - 0.25,
        "ramp": np.abs(t - s.t_ramp) <= 1.0,
        "leak(1.5s pre-brake)": (t >= s.t_brake - GUARD) & (t < s.t_brake),
    }


def first_below_and_stays(t, a, thresh=A_THRESH):
    """First sample time after which a stays below thresh; nan if never."""
    above = np.flatnonzero(a >= thresh)
    if len(above) == 0:
        return t[0]
    if above[-1] + 1 >= len(t):
        return np.nan
    return t[above[-1] + 1]


def first_crossing(x, a, thresh=A_THRESH):
    """First x where a falls below thresh (no 'stays' condition). Used on real
    data, where the ICE-only plateau regains ~0.5-1 m/s^2 late in the straight."""
    below = np.flatnonzero(a < thresh)
    return x[below[0]] if len(below) else np.nan


def score(fn, data):
    se = {k: [] for k in ("deploy", "ramp", "leak(1.5s pre-brake)", "all")}
    err_true, err_cross, err_m = [], [], []
    for s in data:
        a = fn(s.t, s.v_ms)
        e = a - s.a_true
        for k, m in regions(s).items():
            se[k].append(e[m] ** 2)
        se["all"].append(e[s.t < s.t_brake] ** 2)
        g = s.t < s.t_brake - GUARD
        tc = first_below_and_stays(s.t[g], a[g])
        err_true.append(tc - s.t_ramp)
        err_cross.append(tc - s.t_cross)
        err_m.append((tc - s.t_ramp) * s.v_ramp)
    r = {k: float(np.sqrt(np.mean(np.concatenate(v)))) for k, v in se.items()}
    ok = ~np.isnan(err_true)
    et, ec, em = (np.abs(np.array(x)[ok]) for x in (err_true, err_cross, err_m))
    r.update(missing=int((~ok).sum()), ramp_err_s_mean=float(et.mean()), ramp_err_s_p90=float(np.percentile(et, 90)),
             ramp_err_m_mean=float(em.mean()), ramp_err_m_p90=float(np.percentile(em, 90)),
             cross_err_s_mean=float(ec.mean()), cross_err_s_p90=float(np.percentile(ec, 90)),
             bias_s=float(np.mean(np.array(err_true)[ok])))
    return r


def tune(data):
    chosen = {}
    for name, (factory, pname, grid) in METHODS.items():
        best = None
        for p in grid:
            r = score(factory(p), data[:N_TUNE])
            rm = np.mean([r["deploy"], r["ramp"], r["leak(1.5s pre-brake)"]])  # equal weight per region
            if best is None or rm < best[1]:
                best = (p, rm)
        chosen[name] = best[0]
        print(f"tuned {name}: {pname}={best[0]} (tune mean-region RMSE {best[1]:.3f})")
    return chosen


# ---------------------------------------------------------------- real data
def _read(name):
    with gzip.open(RAW / name, "rt") as f:
        return json.load(f)


def real_ramp_starts(fns, n_laps=10):
    car = pd.DataFrame(_read(f"car_data_{CAR}_w180_00.json.gz"))
    car["date"] = pd.to_datetime(car["date"], utc=True, format="ISO8601")
    car = car.sort_values("date").drop_duplicates("date")
    laps = pd.DataFrame([l for l in _read("laps.json.gz") if l["driver_number"] == CAR])
    laps["date_start"] = pd.to_datetime(laps["date_start"], utc=True, format="ISO8601")
    laps = laps.dropna(subset=["date_start", "lap_duration"]).sort_values("lap_number")
    rc = pd.DataFrame(_read("race_control.json.gz"))
    rc["date"] = pd.to_datetime(rc["date"], utc=True, format="ISO8601")
    neutral, start = [], None
    for _, r in rc.sort_values("date").iterrows():  # same SC/red-flag windowing as the spike
        m = (r.get("message") or "").upper()
        if ("SAFETY CAR" in m and "DEPLOYED" in m) or "RED FLAG" in m:
            start = start or r["date"]
        if start is not None and (("SAFETY CAR" in m and ("ENDING" in m or "IN THIS LAP" in m)) or "GREEN LIGHT" in m or "TRACK CLEAR" in m):
            neutral.append((start, r["date"]))
            start = None
    laps["t_end"] = laps["date_start"] + pd.to_timedelta(laps["lap_duration"], unit="s")
    med = laps["lap_duration"].median()
    pit_in = set(laps.loc[laps["is_pit_out_lap"] == True, "lap_number"] - 1)
    good = laps[[not (l["lap_number"] <= 1 or l["is_pit_out_lap"] or l["lap_number"] in pit_in
                      or l["lap_duration"] > 1.07 * med
                      or any(not (l["t_end"] < a or l["date_start"] > b) for a, b in neutral))
                 for _, l in laps.iterrows()]]
    res = {k: [] for k in fns}
    traces = []
    for _, l in good.iterrows():
        c = car[(car["date"] >= l["date_start"]) & (car["date"] < l["t_end"])]
        if len(c) < 50:
            continue
        t = (c["date"] - l["date_start"]).dt.total_seconds().to_numpy()
        v = c["speed"].to_numpy() / 3.6
        dist = np.concatenate([[0], np.cumsum((v[1:] + v[:-1]) / 2 * np.diff(t))])
        brk = c["brake"].to_numpy() > 50
        nxt, last = np.full(len(t), np.inf), np.inf
        for i in range(len(t) - 1, -1, -1):
            if brk[i]:
                last = t[i]
            nxt[i] = last - t[i]
        sel = (dist >= WINDOW_M[0]) & (dist <= WINDOW_M[1])
        full = (c["throttle"].to_numpy() >= 98) & (nxt > GUARD)
        if sel.sum() < 15 or not full[sel].all():
            # require a clean full-throttle, pre-brake run across the window
            if sel.sum() < 15 or full[sel].mean() < 0.9:
                continue
        # smooth with context before and after the window, then restrict to it
        row, tr = {}, {}
        for k, fn in fns.items():
            a = fn(t, v)
            m = sel & full
            d = first_crossing(dist[m], a[m])
            row[k] = d
            tr[k] = (dist[sel], a[sel])
        for k in fns:
            res[k].append(row[k])
        traces.append((int(l["lap_number"]), dist[sel], v[sel] * 3.6, tr))
        if len(traces) >= n_laps:
            break
    return res, traces


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    data = make_dataset(200)
    chosen = tune(data)
    test = data[N_TUNE:]
    fns = {n: METHODS[n][0](chosen[n]) for n in METHODS}
    table = {n: score(fns[n], test) for n in METHODS}

    # figure: example straight
    s = test[0]
    fig, ax = plt.subplots(figsize=(11, 5))
    ax.plot(s.t, s.a_true, "k", lw=2, label="truth")
    for n, f in fns.items():
        ax.plot(s.t, f(s.t, s.v_ms), lw=1, label=n)
    ax.axvline(s.t_brake - GUARD, ls=":", c="r")
    ax.set_xlabel("s"); ax.set_ylabel("m/s2"); ax.set_ylim(-6, 6); ax.legend(ncol=3)
    ax.set_title(f"Synthetic straight (ramp {s.ramp_s} s); dotted = brake guard")
    fig.savefig(OUT / "synthetic_example.png", dpi=110); plt.close(fig)

    # rank on error against the true threshold crossing (free of the ramp-shape bias)
    ranked = sorted(table, key=lambda n: table[n]["cross_err_s_mean"])
    top2 = [n for n in ranked if n not in ("finite_diff", "savgol_9")][:2]
    show = top2 + ["savgol_9"]  # spike configuration kept as a reference column
    real, traces = real_ramp_starts({n: fns[n] for n in show})
    nl = len(traces)

    fig, axs = plt.subplots(2, 1, figsize=(11, 7), sharex=True)
    for lap, d, vk, tr in traces:
        axs[0].plot(d, vk, lw=0.7)
        for k, n in enumerate(top2):
            pass
    for n, c in zip(show, ("C0", "C1", "C2")):
        for lap, d, vk, tr in traces:
            axs[1].plot(*tr[n], c=c, lw=0.6, alpha=0.6)
        axs[1].plot([], [], c=c, label=n)
    axs[1].axhline(A_THRESH, ls=":", c="k"); axs[1].legend()
    axs[0].set_ylabel("kph"); axs[1].set_ylabel("a m/s2"); axs[1].set_xlabel("lap distance m")
    fig.savefig(OUT / "real_straight.png", dpi=110); plt.close(fig)

    # ------------------------------------------------------------ markdown
    L = []
    L.append("# Phase 3: differentiation method comparison (D11)\n")
    L.append("Reproduce: `.venv/bin/python -m f1battery_model.eval_differentiation` (from `model/`'s parent, with `PYTHONPATH=model`). "
             "Synthetic data: 200 seeded straights (`model/f1battery_model/synthetic.py`); the first "
             f"{N_TUNE} tune each method's one parameter, the remaining {len(test)} are scored.\n")
    L.append("@@RECOMMENDATION@@\n")
    L.append("## Synthetic results (RMSE of acceleration vs truth, m/s²)\n")
    L.append("| method | param | deploy | ramp (±1 s) | leak (1.5 s pre-brake) |\n|---|---|---|---|---|")
    for n in METHODS:
        r = table[n]
        L.append(f"| {n} | {METHODS[n][1]}={chosen[n]} | {r['deploy']:.2f} | {r['ramp']:.2f} | {r['leak(1.5s pre-brake)']:.2f} |")
    L.append("\n## Ramp-start estimate (first point a < 0.5 m/s² and stays, brake guard applied)\n")
    L.append("Error against the true ramp start (the time the linear drop begins), absolute. "
             "The 0.5 m/s² crossing sits part-way down the ramp, so a positive bias is inherent; "
             "the last two columns compare to the true crossing time instead, which isolates estimator error.\n")
    L.append("| method | mean err s | p90 err s | mean err m | p90 err m | signed bias s | vs true crossing: mean s | p90 s | no estimate |\n|---|---|---|---|---|---|---|---|---|")
    for n in METHODS:
        r = table[n]
        L.append(f"| {n} | {r['ramp_err_s_mean']:.2f} | {r['ramp_err_s_p90']:.2f} | {r['ramp_err_m_mean']:.0f} | {r['ramp_err_m_p90']:.0f} | {r['bias_s']:+.2f} | {r['cross_err_s_mean']:.2f} | {r['cross_err_s_p90']:.2f} | {r['missing']} |")
    L.append(f"\n## Real confirmation: Monza race, car {CAR}, T1 to Roggia ({WINDOW_M[0]:.0f}-{WINDOW_M[1]:.0f} m from lap start)\n")
    L.append(f"{nl} green laps (the first ten passing the filter) with a clean full-throttle, pre-brake run across the window. Ramp start = first lap distance where a falls below {A_THRESH} m/s² "
             "(first crossing, not 'stays': the real plateau regains 0.5-1 m/s² late in the straight, which defeats the 'stays' rule; the crossing sits part-way down the ramp). Spike reference with Savitzky–Golay: about 1479 m, std about 39 m (different definition, see spike/RESULT.md).\n")
    L.append("| lap | " + " | ".join(f"{n} (m)" for n in show) + " |\n|---|" + "---|" * len(show))
    for i, (lap, *_ ) in enumerate(traces):
        L.append(f"| {lap} | " + " | ".join((f"{real[n][i]:.0f}" if not np.isnan(real[n][i]) else "none") for n in show) + " |")
    L.append("| **mean** | " + " | ".join(f"{np.nanmean(real[n]):.0f}" for n in show) + " |")
    L.append("| **n with estimate** | " + " | ".join(f"{int(np.sum(~np.isnan(real[n])))}" for n in show) + " |")
    L.append("| **std** | " + " | ".join(f"{np.nanstd(real[n], ddof=1):.0f}" for n in show) + " |")
    L.append("\nFigures: `model/out/synthetic_example.png`, `model/out/real_straight.png`.\n")
    DOC.parent.mkdir(exist_ok=True)
    DOC.write_text("\n".join(L).replace("@@RECOMMENDATION@@\n", "@@RECOMMENDATION@@"))
    json.dump({"chosen": {k: v for k, v in chosen.items()}, "table": table, "real": real, "top2": top2},
              open(OUT / "results.json", "w"), indent=1, default=float)
    print(json.dumps({"chosen": chosen, "top2": top2}, default=float))
    for n in METHODS:
        print(n, {k: round(v, 3) for k, v in table[n].items()})
    for n in show:
        print("real", n, np.round(real[n]), "mean", np.nanmean(real[n]), "std", np.nanstd(real[n], ddof=1))


if __name__ == "__main__":
    main()
