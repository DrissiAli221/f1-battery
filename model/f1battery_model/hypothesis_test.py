"""Phase 5: the pre-registered test (HYPOTHESIS.md), sensitivities and the power-unit comparison.

The test is implemented as frozen: logistic regression of event on the energy
variables and controls, run for point estimates and for both edges of the
cut-off bootstrap band, with a within-session permutation control and the
decision rules applied literally. Everything not in HYPOTHESIS.md is labelled
a sensitivity and reported separately.

Run: ``cd model && PYTHONPATH=. ../.venv/bin/python -m f1battery_model.hypothesis_test``
Outputs go to ``model/out/findings/`` (tables as CSV/JSON, ``tables.md``, figures).
The module name avoids pytest collection.
"""
from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats as sps

from . import db

RUN_ID = "6f9df732-b7d1-42b5-b084-a2dc08f91662"
MODEL_VERSION = "proxy-0.1"
EVENTS_DIR = Path(__file__).resolve().parents[1] / "out" / "events"
OUT_DIR = Path(__file__).resolve().parents[1] / "out" / "findings"

BIN_M = 50.0              # regime bin width (regimes.BIN_M)
LIFT_CODE = 2.0           # regime_bin value for LIFT
LIFT_MIN_BINS = 4         # lift run needed to set defender_lift (4 x 50 m ~ 2.4 s at 300 kph)
N_PERM = 1000
N_BOOT = 1000
SEED = 20261018

# Frozen decision constants (HYPOTHESIS.md).
MIN_EVENTS = 150
MIN_NON_EVENTS = 300
MIN_OR = 1.3

MAIN = ["cutoff_dev_defender", "deploy_rel_diff", "defender_lift"]
CONTINUOUS = ["cutoff_dev_defender", "deploy_rel_diff", "pace_delta", "tyre_age_diff", "lap_number"]
CONTROLS = ["pace_delta", "tyre_age_diff", "lap_number", "overtake_available"]
TERMS = MAIN + CONTROLS

# team_name -> power-unit maker (as supplied for Phase 5).
MAKER = {
    "Mercedes": "Mercedes", "McLaren": "Mercedes", "Williams": "Mercedes", "Alpine": "Mercedes",
    "Ferrari": "Ferrari", "Haas F1 Team": "Ferrari", "Haas": "Ferrari", "Cadillac": "Ferrari",
    "Aston Martin": "Honda", "Audi": "Audi",
    "Red Bull Racing": "Red Bull Ford", "Racing Bulls": "Red Bull Ford",
}
MAKERS = ["Mercedes", "Ferrari", "Honda", "Audi", "Red Bull Ford"]

# Drop reasons in first-hit order.
REASONS = ["no_approach_straight", "defender_lap_unknown", "defender_no_cutoff_prev_lap",
           "defender_no_median", "no_deploy_energy", "no_regime_bins", "no_pace_delta", "no_tyre_age"]


# ------------------------------------------------------------------ inputs

def load_events(events_dir: Path = EVENTS_DIR) -> pd.DataFrame:
    files = sorted(p for p in events_dir.glob("*.csv") if p.stem.isdigit())
    if not files:
        raise FileNotFoundError(f"no event files in {events_dir}; run python -m f1battery_model.events --all")
    df = pd.concat([pd.read_csv(p) for p in files], ignore_index=True)
    df["t_event"] = pd.to_datetime(df["t_event"], utc=True, format="mixed")
    return df


def _q(conn, sql, params=()) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])


def load_inputs(conn, sessions: list[int], run_id: str = RUN_ID) -> dict[str, pd.DataFrame]:
    """Everything the join needs, restricted to ``sessions``."""
    base = "FROM model_result WHERE model_version = %s AND run_id = %s AND session_key = ANY(%s)"
    p = (MODEL_VERSION, run_id, sessions)
    cut = _q(conn, "SELECT session_key, driver_number AS driver, lap_number AS lap, straight_id, value "
                   + base + " AND variable = 'cutoff_distance_m' AND lap_number > 0", p)
    med = _q(conn, "SELECT session_key, driver_number AS driver, straight_id, value AS median, ci_low, ci_high "
                   + base + " AND variable = 'cutoff_distance_median_m' AND lap_number = 0", p)
    en = _q(conn, "SELECT session_key, driver_number AS driver, lap_number AS lap, value "
                  + base + " AND variable = 'deploy_energy_rel_lap'", p)
    lift_bins = _q(conn, "SELECT session_key, driver_number AS driver, lap_number AS lap, "
                         "substring(variable from 'regime_bin_(\\d+)')::int AS bin "
                         + base + " AND variable LIKE 'regime_bin_%%' AND value = %s", p + (LIFT_CODE,))
    bin_laps = _q(conn, "SELECT session_key, driver_number AS driver, lap_number AS lap "
                        + base + " AND variable = 'regime_share_lift'", p)
    cda = _q(conn, "SELECT session_key, value AS cda FROM model_result WHERE model_version = %s AND run_id = %s "
                   "AND variable = 'session_cda_m2'", (MODEL_VERSION, run_id))
    lapq = _q(conn, "SELECT session_key, driver_number AS driver, "
                    "percentile_cont(0.5) WITHIN GROUP (ORDER BY lap_length_m) AS lap_len "
                    "FROM lap_quality WHERE session_key = ANY(%s) AND green GROUP BY 1, 2", (sessions,))
    laps = _q(conn, "SELECT session_key, driver_number AS driver, lap_number AS lap, date_start "
                    "FROM lap WHERE session_key = ANY(%s) AND date_start IS NOT NULL", (sessions,))
    win = _q(conn, "SELECT x.session_key, s.straight_id, s.start_pct, s.end_pct FROM straight s "
                   "JOIN session x ON x.circuit_key = s.circuit_key WHERE x.session_key = ANY(%s)", (sessions,))
    meta = _q(conn, "SELECT session_key, circuit_short_name AS circuit, session_name FROM session "
                    "WHERE session_key = ANY(%s)", (sessions,))
    drivers = _q(conn, "SELECT session_key, driver_number AS driver, team_name FROM driver "
                       "WHERE session_key = ANY(%s)", (sessions,))
    laps["date_start"] = pd.to_datetime(laps["date_start"], utc=True)
    return dict(cut=cut, med=med, en=en, lift_bins=lift_bins, bin_laps=bin_laps, cda=cda, lapq=lapq,
                laps=laps, win=win, meta=meta, drivers=drivers)


# ------------------------------------------------------------------ join

def defender_lap(events: pd.DataFrame, laps: pd.DataFrame) -> pd.Series:
    """Defender's lap number at ``t_event``: latest ``date_start`` not after it (NaN when none)."""
    out = pd.Series(np.nan, index=events.index, dtype=float)
    ev = events[["session_key", "defender", "t_event"]].copy()
    ev["_i"] = ev.index
    for (sk, d), g in ev.groupby(["session_key", "defender"]):
        lp = laps[(laps["session_key"] == sk) & (laps["driver"] == d)].sort_values("date_start")
        if lp.empty:
            continue
        m = pd.merge_asof(g.sort_values("t_event"), lp[["date_start", "lap"]], left_on="t_event",
                          right_on="date_start", direction="backward")
        out.loc[m["_i"].to_numpy()] = m["lap"].to_numpy()
    return out


def has_lift_run(bins: set[int], lo: int, hi: int, min_len: int = LIFT_MIN_BINS) -> bool:
    """True when ``bins`` holds ``min_len`` consecutive bin numbers inside [lo, hi]."""
    run = 0
    for n in range(lo, hi + 1):
        run = run + 1 if n in bins else 0
        if run >= min_len:
            return True
    return False


def lift_flag(lift_by_lap: dict, key: tuple, lap: int, start_m: float, end_m: float, lap_len: float) -> bool:
    """Run of >= LIFT_MIN_BINS lift bins within the straight window on lap ``lap``.

    ``lift_by_lap`` maps ((session, driver), lap) to the set of bin numbers labelled lift;
    ``key`` is (session, driver). A straight across the line is split: its tail (from
    ``start_m``) lies in ``lap - 1`` and its head (to ``end_m - lap_len``) in ``lap``; a run
    must lie within one lap, so it is never joined over the line. A bin counts when its
    centre is inside the window.
    """
    def bins_of(l):
        return lift_by_lap.get((key, l), set())
    if end_m <= lap_len:
        lo, hi = int(np.ceil(start_m / BIN_M - 0.5)), int(np.floor(end_m / BIN_M - 0.5))
        return has_lift_run(bins_of(lap), lo, hi)
    head_hi = int(np.floor((end_m - lap_len) / BIN_M - 0.5))
    tail_lo = int(np.ceil(start_m / BIN_M - 0.5))
    tail_hi = int(np.floor(lap_len / BIN_M - 0.5))
    return has_lift_run(bins_of(lap), 0, head_hi) or has_lift_run(bins_of(lap - 1), tail_lo, tail_hi)


def join_energy(events: pd.DataFrame, inp: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fill the three NaN placeholders of the event frame and the band columns.

    Returns (frame, drops). ``frame`` has a ``reason`` column ('' for rows kept); ``drops``
    lists the reasons by first hit and by any hit, split by event / non-event.
    Previous lap = lap - 1 of each car's own lap at ``t_event`` (attacker: the stored
    lap; defender: looked up from the lap table, so a lapped car is not mis-indexed).
    """
    ev = events.copy()
    ev["defender_lap"] = defender_lap(ev, inp["laps"])
    ev["prev_a"] = ev["lap_number"] - 1
    ev["prev_d"] = ev["defender_lap"] - 1

    cut = inp["cut"].rename(columns={"driver": "defender", "lap": "prev_d", "straight_id": "approach_straight_id",
                                     "value": "cutoff_d"})
    ev = ev.merge(cut, on=["session_key", "defender", "prev_d", "approach_straight_id"], how="left")
    med = inp["med"].rename(columns={"driver": "defender", "straight_id": "approach_straight_id"})
    ev = ev.merge(med, on=["session_key", "defender", "approach_straight_id"], how="left")
    en_d = inp["en"].rename(columns={"driver": "defender", "lap": "prev_d", "value": "en_d"})
    en_a = inp["en"].rename(columns={"driver": "attacker", "lap": "prev_a", "value": "en_a"})
    ev = ev.merge(en_d, on=["session_key", "defender", "prev_d"], how="left")
    ev = ev.merge(en_a, on=["session_key", "attacker", "prev_a"], how="left")

    # Lift flag: needs the defender's lap to have regime bins at all.
    bl = inp["bin_laps"]
    have_bins = set(zip(bl["session_key"], bl["driver"], bl["lap"]))
    lift_by_lap: dict[tuple, set[int]] = {}
    for s, d, l, b in inp["lift_bins"][["session_key", "driver", "lap", "bin"]].itertuples(index=False):
        lift_by_lap.setdefault(((s, d), l), set()).add(b)
    win = {(r.session_key, r.straight_id): (r.start_pct, r.end_pct) for r in inp["win"].itertuples()}
    lap_len = {(r.session_key, r.driver): r.lap_len for r in inp["lapq"].itertuples()}
    lifts = []
    for r in ev.itertuples():
        sid, pd_ = r.approach_straight_id, r.prev_d
        w = win.get((r.session_key, sid)) if pd.notna(sid) else None
        ll = lap_len.get((r.session_key, r.defender))
        if w is None or ll is None or pd.isna(pd_) or (r.session_key, r.defender, int(pd_)) not in have_bins:
            lifts.append(np.nan)
            continue
        a, b = w
        start_m, end_m = a / 100 * ll, (b + (100.0 if b < a else 0.0)) / 100 * ll
        lifts.append(float(lift_flag(lift_by_lap, (r.session_key, r.defender), int(pd_), start_m, end_m, ll)))
    ev["defender_lift"] = lifts

    ev["cutoff_dev_defender"] = ev["cutoff_d"] - ev["median"]
    ev["dev_lo"] = ev["cutoff_d"] - ev["ci_high"]       # band edges: the median is only known to its CI
    ev["dev_hi"] = ev["cutoff_d"] - ev["ci_low"]
    ev["deploy_rel_diff"] = ev["en_d"] - ev["en_a"]

    checks = {
        "no_approach_straight": ev["approach_straight_id"].isna(),
        "defender_lap_unknown": ev["defender_lap"].isna(),
        "defender_no_cutoff_prev_lap": ev["cutoff_d"].isna(),
        "defender_no_median": ev["median"].isna(),
        "no_deploy_energy": ev["en_d"].isna() | ev["en_a"].isna(),
        "no_regime_bins": ev["defender_lift"].isna(),
        "no_pace_delta": ev["pace_delta"].isna(),
        "no_tyre_age": ev["tyre_age_diff"].isna(),
    }
    reason = pd.Series("", index=ev.index)
    for k in REASONS:
        reason = reason.where(reason != "", np.where(checks[k], k, ""))
    ev["reason"] = reason
    rows = []
    for k in REASONS:
        for e in (1, 0):
            m = ev["event"] == e
            rows.append({"reason": k, "event": e, "first_hit": int(((ev["reason"] == k) & m).sum()),
                         "any_hit": int((checks[k] & m).sum())})
    drops = pd.DataFrame(rows)
    return ev.drop(columns=["prev_a", "prev_d", "cutoff_d", "median", "en_d", "en_a"]), drops


# ------------------------------------------------------------------ model

def design(df: pd.DataFrame, terms: list[str], dev_col: str = "cutoff_dev_defender") -> tuple[np.ndarray, list[str], dict]:
    """Design matrix: constant, terms (continuous ones standardised), session dummies.

    ``dev_col`` selects which deviation column plays ``cutoff_dev_defender``
    (point estimate or a band edge). Returns (X, names, sd) with sd per standardised term.
    """
    cols, names, sd = [], [], {}
    for t in terms:
        v = df[dev_col if t == "cutoff_dev_defender" else t].to_numpy(dtype=float)
        if t in CONTINUOUS:
            s = v.std(ddof=1)
            sd[t] = float(s)
            v = (v - v.mean()) / s
        cols.append(v)
        names.append(t)
    sess = pd.get_dummies(df["session_key"].astype(int), prefix="session", drop_first=True).astype(float)
    X = np.column_stack([np.ones(len(df))] + cols + [sess.to_numpy()])
    return X, ["const"] + names + list(sess.columns), sd


def informative_sessions(df: pd.DataFrame) -> pd.DataFrame:
    """Drop sessions that hold only events or only non-events.

    Their fixed-effect coefficient runs to -inf or +inf (perfect separation), the fit does
    not converge, and they carry no information on the other coefficients.
    """
    n = df.groupby("session_key")["event"].agg(["sum", "count"])
    ok = n.index[(n["sum"] > 0) & (n["sum"] < n["count"])]
    return df[df["session_key"].isin(ok)]


FALLBACKS = [0]   # number of fits that needed the BFGS fallback


def fit_logit(y: np.ndarray, X: np.ndarray, start=None):
    import statsmodels.api as sm
    try:
        with warnings.catch_warnings():
            from statsmodels.tools.sm_exceptions import ConvergenceWarning
            warnings.simplefilter("error", ConvergenceWarning)
            r = sm.Logit(y, X).fit(disp=0, maxiter=200, start_params=start)
        if not r.mle_retvals.get("converged", True):
            raise RuntimeError("no convergence")
        return r
    except Exception:
        FALLBACKS[0] += 1
        return sm.Logit(y, X).fit(disp=0, maxiter=500, method="bfgs", start_params=start)


def run_model(df: pd.DataFrame, terms: list[str] = TERMS, dev_col: str = "cutoff_dev_defender") -> dict:
    X, names, sd = design(df, terms, dev_col)
    y = df["event"].to_numpy(dtype=float)
    r = fit_logit(y, X)
    ci = np.asarray(r.conf_int())
    rows = []
    for i, n in enumerate(names):
        if n == "const" or n.startswith("session_"):
            continue
        rows.append({"term": n, "coef": float(r.params[i]), "se": float(r.bse[i]),
                     "or_per_sd": float(np.exp(r.params[i])), "or_lo": float(np.exp(ci[i, 0])),
                     "or_hi": float(np.exp(ci[i, 1])), "p": float(r.pvalues[i]),
                     "unit": "per 1 SD" if n in sd else "binary (1 vs 0)", "sd": sd.get(n, np.nan)})
    return {"table": pd.DataFrame(rows), "llf": float(r.llf), "k": len(names), "n": len(df),
            "n_events": int(y.sum()), "params": r.params, "names": names, "sd": sd}


def earlier_cut_or(table: pd.DataFrame) -> dict:
    """OR per 1 SD in the direction earlier cut -> more likely passed (inverse of the deviation OR)."""
    r = table[table["term"] == "cutoff_dev_defender"].iloc[0]
    return {"or": 1.0 / r["or_per_sd"], "lo": 1.0 / r["or_hi"], "hi": 1.0 / r["or_lo"]}


def permutation_control(df: pd.DataFrame, n_perm: int = N_PERM, seed: int = SEED) -> dict:
    """Permute the three main variables jointly across rows within each session and refit.

    The permuted column block keeps each row's controls and outcome. The observed
    ``cutoff_dev_defender`` coefficient is ranked against the permuted ones, two-sided
    on |coef| (the frozen "more extreme than 95 %") and one-sided in the hypothesised
    direction (more negative = earlier cut -> passed).
    """
    rng = np.random.default_rng(seed)
    X, names, _ = design(df, TERMS)
    y = df["event"].to_numpy(dtype=float)
    base = fit_logit(y, X)
    j = names.index("cutoff_dev_defender")
    obs = float(base.params[j])
    main_idx = [names.index(m) for m in MAIN]
    groups = [np.flatnonzero((df["session_key"] == s).to_numpy()) for s in df["session_key"].unique()]
    coefs = np.empty(n_perm)
    fails = 0
    for b in range(n_perm):
        Xp = X.copy()
        for g in groups:
            perm = rng.permutation(g)
            Xp[np.ix_(g, main_idx)] = X[np.ix_(perm, main_idx)]
        try:
            coefs[b] = fit_logit(y, Xp, start=base.params).params[j]
        except Exception:
            coefs[b] = np.nan
            fails += 1
    ok = coefs[~np.isnan(coefs)]
    return {"observed": obs, "n_perm": int(len(ok)), "failed_fits": fails,
            "pct_abs": float((np.abs(ok) < abs(obs)).mean() * 100),
            "pct_one_sided": float((ok > obs).mean() * 100),       # share of permutations less extreme in the earlier-cut direction
            "perm_p_two_sided": float((np.abs(ok) >= abs(obs)).mean()),
            "perm_mean": float(ok.mean()), "perm_sd": float(ok.std(ddof=1)),
            "perm_abs_q95": float(np.quantile(np.abs(ok), 0.95)), "coefs": ok}


# ------------------------------------------------------------------ decision rules

def decide(n_events: int, n_non_events: int, runs: dict[str, dict], perm_pct_abs: float) -> dict:
    """HYPOTHESIS.md decision rules, literally.

    ``runs`` maps run name to ``earlier_cut_or`` output. Vocabulary: "effect", "no effect",
    "insufficient data". Permutation passes when the observed coefficient is more extreme
    than 95 % of the permutations.
    """
    if n_events < MIN_EVENTS or n_non_events < MIN_NON_EVENTS:
        return {"verdict": "insufficient data", "min_sample_ok": False, "per_run": {}, "perm_ok": None}
    per_run = {k: bool(v["or"] >= MIN_OR and v["lo"] > 1.0) for k, v in runs.items()}
    perm_ok = perm_pct_abs > 95.0
    verdict = "effect" if all(per_run.values()) and perm_ok else "no effect"
    return {"verdict": verdict, "min_sample_ok": True, "per_run": per_run, "perm_ok": bool(perm_ok)}


# ------------------------------------------------------------------ sensitivities (not pre-registered)

def lr_test(full: dict, restricted: dict) -> dict:
    stat = 2 * (full["llf"] - restricted["llf"])
    df = full["k"] - restricted["k"]
    return {"stat": float(stat), "df": int(df), "p": float(sps.chi2.sf(stat, df)),
            "llf_full": full["llf"], "llf_restricted": restricted["llf"]}


def sensitivities(df: pd.DataFrame, meta: pd.DataFrame, cda: pd.DataFrame, joined: pd.DataFrame) -> dict:
    out = {}
    no_deploy = [t for t in TERMS if t != "deploy_rel_diff"]
    out["a_no_deploy"] = run_model(df, no_deploy)
    edge = set(cda.loc[(cda["cda"] <= 0.4 + 1e-6) | (cda["cda"] >= 1.6 - 1e-6), "session_key"])
    ev_sessions = set(df["session_key"])
    d_edge = df[df["session_key"].isin(edge)]
    out["cda_edge_sessions_total"] = len(edge)
    out["cda_edge_sessions_with_events"] = sorted(edge & set(joined["session_key"]))
    j_edge = joined[joined["session_key"].isin(edge)]
    out["cda_edge_counts_before_dropping"] = {"events": int(j_edge["event"].sum()),
                                              "non_events": int((j_edge["event"] == 0).sum()),
                                              "events_all": int(joined["event"].sum()),
                                              "non_events_all": int((joined["event"] == 0).sum())}
    out["cda_edge_sessions_in_event_set"] = sorted(edge & ev_sessions)
    out["cda_edge_counts"] = {"events": int(d_edge["event"].sum()),
                              "non_events": int((d_edge["event"] == 0).sum()),
                              "events_all": int(df["event"].sum()),
                              "non_events_all": int((df["event"] == 0).sum())}
    out["a2_excluding_edge"] = run_model(df[~df["session_key"].isin(edge)], TERMS)
    races = meta.loc[meta["session_name"] == "Race", "session_key"]
    out["b_races_only"] = run_model(df[df["session_key"].isin(races)], TERMS)
    out["c_pace_only"] = run_model(df, ["pace_delta"])
    out["c_controls_only"] = run_model(df, CONTROLS)
    out["c_full"] = run_model(df, TERMS)
    out["lr_energy_vs_controls"] = lr_test(out["c_full"], out["c_controls_only"])
    out["lr_energy_vs_pace_only"] = lr_test(out["c_full"], out["c_pace_only"])
    return out


# ------------------------------------------------------------------ power-unit maker comparison

def maker_cells(cut: pd.DataFrame, drivers: pd.DataFrame, meta: pd.DataFrame, n_boot: int = N_BOOT,
                seed: int = SEED) -> pd.DataFrame:
    """Median primary cut-off per (session, straight, maker) with a lap bootstrap interval.

    Laps of all the maker's cars are pooled and resampled with replacement. Laps of one car
    are correlated, so the interval describes lap scatter, not car-to-car spread; the car
    count is reported next to it.
    """
    d = drivers.assign(maker=drivers["team_name"].map(MAKER))
    x = cut.merge(d[["session_key", "driver", "maker"]], on=["session_key", "driver"], how="inner")
    x = x.dropna(subset=["maker"])
    rng = np.random.default_rng(seed)
    rows = []
    for (sk, sid, mk), g in x.groupby(["session_key", "straight_id", "maker"]):
        v = g["value"].to_numpy(dtype=float)
        if len(v) < 10:
            continue
        idx = rng.integers(0, len(v), size=(n_boot, len(v)))
        meds = np.median(v[idx], axis=1)
        rows.append({"session_key": int(sk), "straight_id": int(sid), "maker": mk, "median_m": float(np.median(v)),
                     "ci_low": float(np.quantile(meds, 0.025)), "ci_high": float(np.quantile(meds, 0.975)),
                     "n_laps": len(v), "n_cars": int(g["driver"].nunique())})
    out = pd.DataFrame(rows)
    return out.merge(meta, on="session_key", how="left")


def maker_season_table(cells: pd.DataFrame) -> pd.DataFrame:
    """Race sessions: per maker, mean offset from the all-maker mean of the cell medians, and the
    share of (session, straight) cells where the maker's median is the earliest of those present."""
    c = cells[cells["session_name"] == "Race"].copy()
    c = c[c.groupby(["session_key", "straight_id"])["maker"].transform("nunique") >= 3]
    c["offset_m"] = c["median_m"] - c.groupby(["session_key", "straight_id"])["median_m"].transform("mean")
    c["earliest"] = c["median_m"] == c.groupby(["session_key", "straight_id"])["median_m"].transform("min")
    t = c.groupby("maker").agg(cells=("offset_m", "size"), mean_offset_m=("offset_m", "mean"),
                               sd_offset_m=("offset_m", "std"), share_earliest=("earliest", "mean"))
    return t.reindex([m for m in MAKERS if m in t.index]).reset_index()


def maker_figure(cells: pd.DataFrame, session_key: int, straights: pd.DataFrame, title: str, path: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    c = cells[cells["session_key"] == session_key]
    sids = sorted(c["straight_id"].unique())
    fig, axes = plt.subplots(1, len(sids), figsize=(3.0 * len(sids) + 1, 3.8), squeeze=False, sharey=False)
    colors = {"Mercedes": "#1f77b4", "Ferrari": "#d62728", "Honda": "#2ca02c", "Audi": "#7f7f7f",
              "Red Bull Ford": "#9467bd"}
    for ax, sid in zip(axes[0], sids):
        g = c[c["straight_id"] == sid].set_index("maker").reindex(MAKERS).dropna(subset=["median_m"])
        x = np.arange(len(g))
        ax.errorbar(x, g["median_m"], yerr=[g["median_m"] - g["ci_low"], g["ci_high"] - g["median_m"]], fmt="o",
                    capsize=3, color="black", ecolor="black")
        for xi, (mk, row) in zip(x, g.iterrows()):
            ax.plot(xi, row["median_m"], "o", color=colors[mk], ms=8)
        ax.set_xticks(x, [m.replace(" ", "\n") for m in g.index], fontsize=7)
        lab = straights.loc[straights["straight_id"] == sid, "label"]
        ax.set_title(f"straight {sid}" + (f"\n{lab.iat[0]}" if len(lab) and isinstance(lab.iat[0], str) else ""),
                     fontsize=8)
        ax.set_ylabel("median cut-off distance (m)" if ax is axes[0][0] else "")
    fig.suptitle(title + "  (median primary cut-off, 95 % lap-bootstrap interval)", fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


# ------------------------------------------------------------------ report

def fmt_table(t: pd.DataFrame) -> str:
    lines = ["| term | unit | OR | 95 % CI | p |", "|---|---|---|---|---|"]
    for r in t.itertuples():
        lines.append(f"| {r.term} | {r.unit} | {r.or_per_sd:.3f} | [{r.or_lo:.3f}, {r.or_hi:.3f}] | {r.p:.3g} |")
    return "\n".join(lines)


def md_df(df: pd.DataFrame, floatfmt="{:.1f}") -> str:
    cols = list(df.columns)
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in df.itertuples(index=False):
        out.append("| " + " | ".join(floatfmt.format(v) if isinstance(v, (float, np.floating)) else str(v)
                                     for v in r) + " |")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run-id", default=RUN_ID)
    ap.add_argument("--n-perm", type=int, default=N_PERM)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    events = load_events()
    sessions = sorted(events["session_key"].unique().tolist())
    with db.connect() as conn:
        inp = load_inputs(conn, sessions, a.run_id)
        all_sessions = _q(conn, "SELECT DISTINCT session_key FROM model_result WHERE model_version = %s AND run_id = %s",
                          (MODEL_VERSION, a.run_id))["session_key"].tolist()
        cut_all = _q(conn, "SELECT session_key, driver_number AS driver, lap_number AS lap, straight_id, value "
                           "FROM model_result WHERE model_version = %s AND run_id = %s AND "
                           "variable = 'cutoff_distance_m' AND lap_number > 0", (MODEL_VERSION, a.run_id))
        drivers_all = _q(conn, "SELECT session_key, driver_number AS driver, team_name FROM driver")
        meta_all = _q(conn, "SELECT session_key, circuit_short_name AS circuit, session_name FROM session")
        straights = _q(conn, "SELECT x.session_key, s.straight_id, s.label FROM straight s "
                             "JOIN session x ON x.circuit_key = s.circuit_key")

    joined, drops = join_energy(events, inp)
    complete = joined[joined["reason"] == ""].copy()
    kept = informative_sessions(complete).copy()
    single = sorted(set(complete["session_key"]) - set(kept["session_key"]))
    n_ev, n_ne = int(kept["event"].sum()), int((kept["event"] == 0).sum())
    summary = {"events_before": int(joined["event"].sum()), "non_events_before": int((joined["event"] == 0).sum()),
               "events_complete": int(complete["event"].sum()),
               "non_events_complete": int((complete["event"] == 0).sum()),
               "single_class_sessions_removed": str(single),
               "events_after": n_ev, "non_events_after": n_ne, "sessions_in_model": int(kept["session_key"].nunique())}
    drops.to_csv(a.out / "drops.csv", index=False)
    kept.to_csv(a.out / "analysis_frame.csv", index=False)

    # Frozen test: point, lower band edge, upper band edge.
    runs, tables = {}, {}
    for name, col in [("point", "cutoff_dev_defender"), ("lower_edge", "dev_lo"), ("upper_edge", "dev_hi")]:
        m = run_model(kept, TERMS, col)
        tables[name] = m["table"]
        runs[name] = earlier_cut_or(m["table"])
        m["table"].to_csv(a.out / f"model_{name}.csv", index=False)
    perm = permutation_control(kept, a.n_perm)
    np.save(a.out / "perm_coefs.npy", perm["coefs"])
    verdict = decide(n_ev, n_ne, runs, perm["pct_abs"])

    sens = sensitivities(kept, inp["meta"], inp["cda"], joined)
    for k in ("a_no_deploy", "a2_excluding_edge", "b_races_only", "c_pace_only", "c_controls_only"):
        sens[k]["table"].to_csv(a.out / f"sens_{k}.csv", index=False)

    # Power-unit comparison over all modelled sessions.
    cells = maker_cells(cut_all, drivers_all, meta_all)
    cells.to_csv(a.out / "maker_by_session.csv", index=False)
    season = maker_season_table(cells)
    season.to_csv(a.out / "maker_season.csv", index=False)
    for key, circuit in [("monza", "Monza"), ("baku", "Baku")]:
        m = meta_all[(meta_all["circuit"] == circuit) & (meta_all["session_name"] == "Race")]
        if m.empty:
            continue
        sk = int(m["session_key"].iat[0])
        maker_figure(cells, sk, straights[straights["session_key"] == sk], f"{circuit} {sk}",
                     a.out / f"maker_{key}_{sk}.png")

    # Permutation figure.
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(5.5, 3.4))
    ax.hist(perm["coefs"], bins=40, color="#999999")
    ax.axvline(perm["observed"], color="#d62728", label="observed")
    ax.set_xlabel("coefficient of cutoff_dev_defender (log-odds per SD)")
    ax.set_ylabel("permutations")
    ax.legend()
    fig.tight_layout()
    fig.savefig(a.out / "permutation.png", dpi=140)
    plt.close(fig)

    summary["bfgs_fallbacks"] = FALLBACKS[0]
    result = {"summary": summary, "runs": runs, "verdict": verdict,
              "permutation": {k: v for k, v in perm.items() if k != "coefs"},
              "sens": {k: ({kk: vv for kk, vv in v.items() if kk not in ("table", "params", "names")}
                           if isinstance(v, dict) and "table" in v else v) for k, v in sens.items()}}
    (a.out / "results.json").write_text(json.dumps(result, indent=2, default=str))

    # Markdown fragments for docs/findings.md.
    ses = joined.merge(inp["meta"], on="session_key")
    md = []
    md.append("## drops\n\n" + md_df(drops, "{:.0f}"))
    md.append("## sample\n\n" + md_df(pd.DataFrame([summary]), "{:.0f}"))
    for name in ("point", "lower_edge", "upper_edge"):
        md.append(f"## model_{name}\n\n" + fmt_table(tables[name]))
    md.append("## earlier_cut_or\n\n" + md_df(pd.DataFrame(runs).T.reset_index().rename(columns={"index": "run"}), "{:.3f}"))
    md.append("## permutation\n\n" + json.dumps({k: v for k, v in perm.items() if k != "coefs"}, indent=2))
    md.append("## verdict\n\n" + json.dumps(verdict, indent=2))
    for k in ("a_no_deploy", "a2_excluding_edge", "b_races_only", "c_pace_only", "c_controls_only"):
        md.append(f"## sens_{k} (n={sens[k]['n']}, events={sens[k]['n_events']})\n\n" + fmt_table(sens[k]["table"]))
    md.append("## sens_misc\n\n" + json.dumps({k: sens[k] for k in ("cda_edge_sessions_total", "cda_edge_sessions_with_events",
                                                                    "cda_edge_sessions_in_event_set",
                                                                    "cda_edge_counts_before_dropping", "cda_edge_counts", "lr_energy_vs_controls",
                                                                    "lr_energy_vs_pace_only")}, indent=2, default=str))
    md.append("## maker_season\n\n" + md_df(season, "{:.2f}"))
    for key, circuit in [("monza", "Monza"), ("baku", "Baku")]:
        m = meta_all[(meta_all["circuit"] == circuit) & (meta_all["session_name"] == "Race")]
        if len(m):
            c = cells[cells["session_key"] == int(m["session_key"].iat[0])]
            c = c.merge(straights.drop_duplicates(["session_key", "straight_id"]), on=["session_key", "straight_id"], how="left")
            md.append(f"## maker_{key}\n\n" + md_df(c[["straight_id", "label", "maker", "median_m", "ci_low", "ci_high",
                                                         "n_laps", "n_cars"]].sort_values(["straight_id", "maker"]), "{:.0f}"))
    (a.out / "tables.md").write_text("\n\n".join(md) + "\n")
    print("\n\n".join(md))


if __name__ == "__main__":
    main()
