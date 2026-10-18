"""Per-driver pipeline shared by the Phase 3 reproduction check and the Phase 4 estimator.

For one session and one driver: align laps (Phase 2 rules), build the grid
trace, fit CdA (physics.py), run the derate detector on every straight of every
green lap (derate.py), label regimes (regimes.py) and compute the relative
deploy energy. One driver at a time keeps memory bounded.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import alignment as al
from . import db, derate, physics as ph, quality, regimes, straights

BOOTSTRAP_N = 1000
MIN_LAPS_FOR_SUMMARY = 3
ENERGY_REF_MIN_LAPS = 5
CDA_GRID = (0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6)   # m^2, hinge CdA search grid
CDA_FALLBACK = 0.9       # only if no analysable straight exists in the whole session


@dataclass
class SessionContext:
    info: dict
    laps: pd.DataFrame
    neutral: list
    start_ns: int | None
    rate_kw_s: float
    rate_default: bool
    is_race_like: bool
    drivers: list[int]
    boundary_source: str


def session_context(conn, session_key: int) -> SessionContext:
    info = db.session_info(conn, session_key)
    laps = db.session_laps(conn, session_key)
    neutral, _ = al.neutral_windows(db.session_race_control(conn, session_key))
    with conn.cursor() as cur:
        cur.execute("SELECT derate_rate_kw_per_s FROM regulation_event WHERE session_key = %s", (session_key,))
        row = cur.fetchone()
        cur.execute("SELECT DISTINCT boundary_source FROM lap_quality WHERE session_key = %s", (session_key,))
        sources = [r[0] for r in cur.fetchall()]
    rate = row[0] if row and row[0] is not None else None
    start = info["date_start"]
    return SessionContext(
        info=info, laps=laps, neutral=neutral,
        start_ns=int(al.to_ns([start])[0]) if start is not None else None,
        rate_kw_s=float(rate) if rate is not None else derate.DEFAULT_RATE_KW_S,
        rate_default=rate is None,
        is_race_like=info["session_name"] in ("Race", "Sprint"),
        drivers=db.telemetry_drivers(conn, session_key),
        boundary_source=",".join(s for s in sources if s) or "laps")


@dataclass
class DriverResult:
    session_key: int
    driver: int
    n_green: int
    cda: dict                             # regression fit (physics.fit_cda) plus cda_profile_m2 and cda_used_m2
    straight_laps: pd.DataFrame           # one row per analysable (lap, straight)
    lap_bins: dict[int, np.ndarray]       # lap_number -> regime codes per 50 m bin
    agreement: dict
    rate_kw_s: float
    rate_default: bool
    notes: list[str] = field(default_factory=list)


@dataclass
class Prepared:
    tr: ph.Trace
    runs: tuple
    green: np.ndarray
    lap_len: np.ndarray
    lap_no: np.ndarray
    med_len: float
    wins: list


def _lap_windows(wins: list, scale: float, lap_len: float):
    """Straight windows of a lap in that lap's own coordinates; wrapping ones start before the line."""
    out = []
    for sid, s, e in wins:
        s, e = s * scale, e * scale
        out.append((sid, s - lap_len, e - lap_len, True) if e > lap_len else (sid, s, e, False))
    return out


def prepare_driver(conn, ctx: SessionContext, driver: int) -> Prepared | None:
    sk = ctx.info["session_key"]
    laps = ctx.laps[ctx.laps["driver_number"] == driver]
    if laps.empty:
        return None
    if ctx.boundary_source != "laps":
        raise NotImplementedError(f"session {sk}: boundaries from {ctx.boundary_source}; only lap-table boundaries are supported")
    car = db.driver_car_data(conn, sk, driver)
    loc = db.driver_location(conn, sk, driver)
    bounds, q, *_ = quality.align_driver(car, laps, ctx.neutral, ctx.start_ns, ctx.is_race_like)
    green = q["green"].to_numpy(dtype=bool)
    if not green.any():
        return None
    tr = ph.build_trace(car, loc, bounds, ctx.info["session_name"])
    if tr is None:
        return None
    lap_len = q["lap_length_m"].to_numpy(dtype=float)
    med_len = float(np.median(lap_len[green]))
    return Prepared(tr, derate.full_throttle_runs(tr), green, lap_len, q["lap_number"].to_numpy(),
                    med_len, straights.straight_windows(conn, sk, med_len))


def sweep(prep: Prepared, ctx: SessionContext, cda: float, hinge: bool = True) -> list[dict]:
    """Analyse every straight of every green lap with the given CdA."""
    rows = []
    for i in np.flatnonzero(prep.green):
        for sid, s, e, wraps in _lap_windows(prep.wins, prep.lap_len[i] / prep.med_len, prep.lap_len[i]):
            # A straight across the line needs the previous lap's tail to be a clean green lap too.
            if wraps and not (i > 0 and prep.green[i - 1] and prep.lap_no[i - 1] == prep.lap_no[i] - 1):
                continue
            r = derate.straight_lap(prep.tr, i, (s, e), prep.runs, cda, ctx.rate_kw_s, hinge=hinge)
            if r is not None:
                r.update(lap_row=int(i), lap_number=int(prep.lap_no[i]), straight_id=int(sid))
                rows.append(r)
    return rows


def cda_profile(prep: Prepared, ctx: SessionContext, grid=CDA_GRID) -> tuple[np.ndarray, np.ndarray]:
    """Total squared hinge residual and sample count for each CdA in ``grid``.

    The CdA that makes specific excess power flattest before the cut-off is the
    one that minimises the pooled residual; this is how the hinge CdA is chosen
    (see docs/phase3-regimes.md for why the speed-range regression is not used).
    """
    sse, n = np.zeros(len(grid)), np.zeros(len(grid))
    for k, cda in enumerate(grid):
        for r in sweep(prep, ctx, cda):
            if "sse" in r:
                sse[k] += r["sse"]
                n[k] += r["n_fit"]
    return sse, n


def profile_argmin(sse: np.ndarray, n: np.ndarray, grid=CDA_GRID) -> float:
    """Minimum of the pooled RMS residual over the grid, refined by a parabola through the three lowest-neighbour points."""
    if not (n > 0).all():
        return float("nan")
    rms = np.sqrt(sse / n)
    k = int(np.argmin(rms))
    if 0 < k < len(grid) - 1:
        x, y = np.asarray(grid[k - 1:k + 2]), rms[k - 1:k + 2]
        c = np.polyfit(x, y, 2)
        if c[0] > 0:
            return float(np.clip(-c[1] / (2 * c[0]), x[0], x[-1]))
    return float(grid[k])


def _exclusion(tr: ph.Trace, rows: list[dict]) -> np.ndarray:
    ex = np.zeros(len(tr.v), dtype=bool)
    for r in rows:
        if r.get("detected"):
            ex[r["t0_g"]:r["r1"]] = True
        elif r.get("cross_idx") is not None:
            ex[r["cross_idx"]:r["r1"]] = True
    return ex


def analyse_driver(prep: Prepared, ctx: SessionContext, driver: int, cda_hinge: float,
                   cda_profile_car: float = float("nan"), with_regimes: bool = True) -> DriverResult:
    tr, green = prep.tr, prep.green
    notes: list[str] = []
    if not tr.has_z:
        notes.append("no location z: slope term set to 0")
    rows = sweep(prep, ctx, cda_hinge)
    cand = ph.cda_candidates(tr, green, _exclusion(tr, rows))
    cda = ph.fit_cda(tr, cand, seed=driver)
    cda["cda_profile_m2"] = cda_profile_car
    cda["cda_used_m2"] = cda_hinge
    df = pd.DataFrame(rows)

    # Relative deploy energy on the deploy phase, referenced to the car's own plateau acceleration.
    if len(df):
        e_av, e_v = [], []
        for r in df.itertuples():
            end = int(r.end_g) if bool(r.detected) else int(r.u1)
            sl = slice(int(r.u0), end)
            e_av.append(float(np.sum(tr.a[sl] * tr.v[sl]) * ph.GRID))
            e_v.append(float(np.sum(tr.v[sl]) * ph.GRID))
        df["energy_a_v"], df["energy_v"] = e_av, e_v
        det = df[df["detected"].astype(bool)]
        glob_ref = float(det["plateau_accel"].median()) if len(det) else 0.0
        refs = {int(sid): (float(g["plateau_accel"].median()) if len(g) >= ENERGY_REF_MIN_LAPS else glob_ref)
                for sid, g in det.groupby("straight_id")}
        df["a_ref"] = df["straight_id"].map(refs).fillna(glob_ref)
        df["energy_rel"] = df["energy_a_v"] - df["a_ref"] * df["energy_v"]

    lap_bins: dict[int, np.ndarray] = {}
    agr = {"mean": np.nan, "min": np.nan, "pairs": 0}
    if with_regimes:
        lab = regimes.sample_labels(tr)
        for i in np.flatnonzero(green):
            m = tr.lap_idx == i
            lap_bins[int(prep.lap_no[i])] = regimes.lap_bin_labels(tr.d[m], lab[m])
        agr = regimes.agreement([lap_bins[k] for k in sorted(lap_bins)])
    return DriverResult(ctx.info["session_key"], driver, int(green.sum()), cda, df, lap_bins, agr,
                        ctx.rate_kw_s, ctx.rate_default, notes)


def process_session(conn, ctx: SessionContext, drivers: list[int] | None = None, with_regimes: bool = True):
    """Yield a DriverResult per driver. Two passes: the CdA profile of every driver, then the analysis.

    The hinge CdA is the session-wide minimiser of the pooled residual (all drivers),
    so a car's fitted cut-off does not depend on that car's own noisy CdA.
    """
    drivers = ctx.drivers if drivers is None else drivers
    profiles: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    for d in drivers:
        prep = prepare_driver(conn, ctx, d)
        if prep is not None:
            profiles[d] = cda_profile(prep, ctx)
    if not profiles:
        return
    sse = sum(p[0] for p in profiles.values())
    n = sum(p[1] for p in profiles.values())
    pooled = profile_argmin(sse, n)
    if not np.isfinite(pooled):
        pooled = CDA_FALLBACK
    for d in profiles:
        prep = prepare_driver(conn, ctx, d)
        yield analyse_driver(prep, ctx, d, pooled, profile_argmin(*profiles[d]), with_regimes)


# ------------------------------------------------------------- summaries

def bootstrap_median(x: np.ndarray, n: int = BOOTSTRAP_N, seed: int = 0) -> tuple[float, float]:
    """95 % interval of the median by resampling laps."""
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    if len(x) < 2:
        return np.nan, np.nan
    rng = np.random.default_rng(seed)
    med = np.median(x[rng.integers(0, len(x), (n, len(x)))], axis=1)
    return float(np.percentile(med, 2.5)), float(np.percentile(med, 97.5))


def summarise_straights(res: DriverResult) -> pd.DataFrame:
    """Per straight: detection fraction, median/std/CI of cut-off distance, median cut-off speed, entry speed, plateau accel."""
    df = res.straight_laps
    out = []
    if df is None or not len(df):
        return pd.DataFrame()
    for sid, g in df.groupby("straight_id"):
        det = g[g["detected"].astype(bool)]
        row = {"straight_id": int(sid), "laps_analysed": len(g), "laps_detected": len(det),
               "detect_fraction": len(det) / len(g)}
        if len(det) >= MIN_LAPS_FOR_SUMMARY:
            lo, hi = bootstrap_median(det["hinge_d"].to_numpy(), seed=res.driver * 1000 + int(sid))
            row.update(cutoff_median_m=float(det["hinge_d"].median()), cutoff_ci_low=lo, cutoff_ci_high=hi,
                       cutoff_std_m=float(det["hinge_d"].std(ddof=1)), cutoff_speed_median_kph=float(det["hinge_v_kph"].median()),
                       entry_kph_median=float(det["entry_kph"].median()),
                       plateau_accel_median=float(det["plateau_accel"].median()))
        cs = g["cross_spike_d"].dropna()
        if len(cs) >= MIN_LAPS_FOR_SUMMARY:
            row.update(spike_cross_median_m=float(cs.median()), spike_cross_std_m=float(cs.std(ddof=1)),
                       spike_cross_fraction=len(cs) / len(g), spike_cross_speed_kph=float(g["cross_spike_v_kph"].median()))
        cr = g["cross_d"].dropna()
        if len(cr) >= MIN_LAPS_FOR_SUMMARY:
            row.update(cross_median_m=float(cr.median()), cross_std_m=float(cr.std(ddof=1)),
                       cross_fraction=len(cr) / len(g), cross_speed_median_kph=float(g["cross_v_kph"].median()))
        out.append(row)
    return pd.DataFrame(out)
