"""Phase 3 physics baseline: per-driver time series on a uniform grid.

One driver's whole telemetry stream is resampled to a 0.25 s grid and
differentiated once, so acceleration near lap boundaries (the straight that
crosses the start/finish line) is not distorted by a per-lap edge. Laps are
cut out of the stream afterwards using the Phase 2 lap bounds.

Conventions
-----------
* ``a`` is longitudinal acceleration in m/s^2 from a Savitzky-Golay fit
  (window 9, polynomial 2, docs/phase3-differentiation.md).
* ``tb`` is the time to the next brake-on sample. Samples with ``tb`` below
  ``GUARD_S`` are not used for acceleration statistics: the smoothing window
  leaks the braking onset backwards (spike/RESULT.md, method note 1).
* ``sin_theta`` is the track gradient (positive uphill) from ``location.z``
  over a 75 m window of travelled distance, never sample to sample.
* Specific excess power ``p = (a + g sin(theta)) v + rho CdA v^3 / (2 m)`` in
  W/kg is the tractive power per unit mass that is not spent on gravity or
  aerodynamic drag.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.signal import savgol_filter

from . import alignment as al

GRID = 0.25            # s, resampling step
SG_WINDOW = 9          # grid samples
SG_POLY = 2
GUARD_S = 1.5          # s before the next brake onset (or run end) that is not trusted
FULL_THROTTLE = 98.0   # percent
BRAKE_ON = 50.0        # brake channel above this is "on"
G = 9.80665            # m/s^2
RHO = 1.2              # kg/m^3, air density (fixed; CdA is reported at this density)
SLOPE_HALF_WINDOW_M = 37.5   # slope is taken over 2 x 37.5 = 75 m of travel
Z_UNIT_M = 0.1         # location.z is in tenths of a metre

# Mass model (docs/phase3-regimes.md, "Assumptions"). The dry minimum is from
# the secondary sources in docs/improvements-2026-10-18.md (not in the Section C
# text we hold); the fuel loads are assumptions, not regulation values.
MASS_DRY_KG = 768.0
FUEL_START_KG = {"Race": 70.0, "Sprint": 23.0}   # burns linearly to 0 over the session
FUEL_CONSTANT_KG = 15.0                          # qualifying-type sessions: flat load

# CdA fit selection
CDA_V_MIN_KPH = 220.0
CDA_V_MAX_KPH = 290.0
CDA_BIN_KPH = 10.0
CDA_BIN_QUANTILE = 0.75
CDA_MIN_SAMPLES = 150
HIGH_GEARS = 2         # top gear and the one below (8-speed box; 8th is only reached above ~290 kph at Monza)


@dataclass
class Trace:
    """One driver's stream on the uniform grid. All arrays have equal length."""
    t: np.ndarray           # s since the first car_data sample
    t0_ns: int              # epoch ns of t == 0
    v: np.ndarray           # m/s
    a: np.ndarray           # m/s^2
    thr: np.ndarray         # percent
    gear: np.ndarray
    brk: np.ndarray         # bool
    tb: np.ndarray          # s to next brake-on sample (inf if none)
    cum: np.ndarray         # m travelled since t == 0 (strictly increasing)
    sin_theta: np.ndarray
    mass: np.ndarray        # kg
    lap_idx: np.ndarray     # row of ``bounds`` (-1: no lap)
    d: np.ndarray           # m since the start of the sample's own lap (NaN: no lap)
    lap_start_cum: np.ndarray   # per bounds row, cum at lap start (NaN if unresolved)
    lap_start_t: np.ndarray     # per bounds row, grid time of lap start
    lap_end_t: np.ndarray
    has_z: bool = True
    extra: dict = field(default_factory=dict)


def next_true_distance(flag: np.ndarray) -> np.ndarray:
    """Seconds (grid steps x GRID) from each sample to the next True sample; inf if none."""
    idx = np.flatnonzero(flag)
    out = np.full(len(flag), np.inf)
    if len(idx) == 0:
        return out
    pos = np.searchsorted(idx, np.arange(len(flag)), side="left")
    ok = pos < len(idx)
    out[ok] = (idx[pos[ok]] - np.arange(len(flag))[ok]) * GRID
    return out


def track_gradient(cum: np.ndarray, z_m: np.ndarray, half_window_m: float = SLOPE_HALF_WINDOW_M) -> np.ndarray:
    """sin(theta) from elevation against travelled distance over a window of 2 x half_window_m."""
    c = cum + 1e-6 * np.arange(len(cum))        # strictly increasing for interpolation
    hi = np.interp(c + half_window_m, c, z_m)
    lo = np.interp(c - half_window_m, c, z_m)
    return (hi - lo) / (2 * half_window_m)


def fuel_mass(session_name: str, frac: np.ndarray) -> np.ndarray:
    """Fuel mass in kg at session fraction ``frac`` in [0, 1] (linear burn for Race / Sprint)."""
    if session_name in FUEL_START_KG:
        return FUEL_START_KG[session_name] * (1.0 - np.clip(frac, 0.0, 1.0))
    return np.full(len(frac), FUEL_CONSTANT_KG)


def build_trace(car: pd.DataFrame, loc: pd.DataFrame, bounds: pd.DataFrame, session_name: str) -> Trace | None:
    """Resample one driver's car_data to the grid and attach laps, distance, slope and mass."""
    if len(car) < 50:
        return None
    ts = al.to_ns(car["ts"])
    keep = np.concatenate([[True], np.diff(ts) > 0])
    car = car[keep]
    ts = ts[keep]
    t0 = int(ts[0])
    ts_s = (ts - t0) * 1e-9
    tg = np.arange(0.0, ts_s[-1], GRID)
    v = np.interp(tg, ts_s, car["speed"].to_numpy(dtype=float)) / 3.6
    thr = np.interp(tg, ts_s, car["throttle"].to_numpy(dtype=float))
    gear = np.round(np.interp(tg, ts_s, car["n_gear"].to_numpy(dtype=float)))
    brk = np.interp(tg, ts_s, car["brake"].to_numpy(dtype=float)) > BRAKE_ON
    a = savgol_filter(v, SG_WINDOW, SG_POLY, deriv=1, delta=GRID)
    tb = next_true_distance(brk)
    cum = np.concatenate([[0.0], np.cumsum(0.5 * (v[1:] + v[:-1]) * GRID)])

    has_z = len(loc) > 10
    if has_z:
        lts = (al.to_ns(loc["ts"]) - t0) * 1e-9
        order = np.argsort(lts)
        zg = np.interp(tg, lts[order], loc["z"].to_numpy(dtype=float)[order] * Z_UNIT_M)
        sin_theta = track_gradient(cum, zg)
    else:
        sin_theta = np.zeros(len(tg))

    n_b = len(bounds)
    st = np.full(n_b, np.nan)
    en = np.full(n_b, np.nan)
    ok = bounds["resolved"].to_numpy()
    st[ok] = (bounds["start_ns"].to_numpy()[ok] - t0) * 1e-9
    en[ok] = (bounds["end_ns"].to_numpy()[ok] - t0) * 1e-9
    lap_idx = np.full(len(tg), -1, dtype=np.int64)
    d = np.full(len(tg), np.nan)
    start_cum = np.full(n_b, np.nan)
    for i in np.flatnonzero(ok):
        if not en[i] > st[i]:
            continue
        i0 = np.searchsorted(tg, st[i], side="left")
        i1 = np.searchsorted(tg, en[i], side="left")
        if i1 <= i0:
            continue
        lap_idx[i0:i1] = i
        start_cum[i] = np.interp(st[i], tg, cum)
        d[i0:i1] = cum[i0:i1] - start_cum[i]

    # Mass: linear fuel burn from the first lap start to the last lap end.
    valid = ok & (en > st)
    if valid.any():
        s0, s1 = np.nanmin(st[valid]), np.nanmax(en[valid])
        frac = (tg - s0) / max(s1 - s0, 1.0)
    else:
        frac = np.zeros(len(tg))
    mass = MASS_DRY_KG + fuel_mass(session_name, frac)
    return Trace(t=tg, t0_ns=t0, v=v, a=a, thr=thr, gear=gear, brk=brk, tb=tb, cum=cum,
                 sin_theta=sin_theta, mass=mass, lap_idx=lap_idx, d=d,
                 lap_start_cum=start_cum, lap_start_t=st, lap_end_t=en, has_z=has_z)


def specific_excess_power(tr: Trace, cda: float, sl: slice | np.ndarray | None = None) -> np.ndarray:
    """p = (a + g sin(theta)) v + rho CdA v^3 / (2 m), W/kg."""
    s = slice(None) if sl is None else sl
    v = tr.v[s]
    return (tr.a[s] + G * tr.sin_theta[s]) * v + 0.5 * RHO * cda * v ** 3 / tr.mass[s]


# ----------------------------------------------------------------- CdA fit

def cda_candidates(tr: Trace, green_laps: np.ndarray, exclude: np.ndarray | None = None) -> np.ndarray:
    """Boolean mask of samples used for the CdA fit.

    Full throttle in the top two gears, speed 220-290 kph (MGU-K power is flat
    below 290 kph, C5.2.8), outside the brake guard, on a green lap, and not
    inside a fitted derate ramp or plateau (``exclude``).
    """
    top = np.nanmax(tr.gear[tr.v * 3.6 > 250]) if (tr.v * 3.6 > 250).any() else np.nanmax(tr.gear)
    kph = tr.v * 3.6
    m = ((tr.thr >= FULL_THROTTLE) & (tr.gear >= top - (HIGH_GEARS - 1)) & (kph >= CDA_V_MIN_KPH) & (kph < CDA_V_MAX_KPH)
         & (tr.tb > GUARD_S) & ~tr.brk)
    # Throttle has to have been full for the previous second (reapplication burst).
    n_prev = int(round(1.0 / GRID))
    full = (tr.thr >= FULL_THROTTLE).astype(np.int8)
    run = np.convolve(full, np.ones(n_prev + 1, dtype=np.int8), mode="full")[:len(full)]
    m &= run >= n_prev + 1
    li = tr.lap_idx
    m &= (li >= 0) & green_laps[np.where(li >= 0, li, 0)]
    if exclude is not None:
        m &= ~exclude
    return m


def fit_cda(tr: Trace, mask: np.ndarray, n_boot: int = 200, seed: int = 0) -> dict:
    """Fit CdA (at rho = RHO) from W = m (a + g sin) v = P - 0.5 rho CdA v^3.

    The tractive power P is not known, so it is the intercept. To keep the fit on
    the full-deploy state, samples are reduced to the upper quantile of W in each
    10 kph bin before the regression (cars in a tow, lifting, or harvesting sit
    below). The spread is a bootstrap over laps (resample laps, redo binning and
    regression). Returns NaNs when too few samples are available.
    """
    idx = np.flatnonzero(mask)
    out = {"n_samples": int(len(idx)), "cda_m2": np.nan, "cda_std_m2": np.nan, "power_kw": np.nan,
           "r2": np.nan, "n_laps": 0}
    if len(idx) < CDA_MIN_SAMPLES:
        return out
    v = tr.v[idx]
    w = tr.mass[idx] * (tr.a[idx] + G * tr.sin_theta[idx]) * v
    lap = tr.lap_idx[idx]
    out["n_laps"] = int(len(np.unique(lap)))

    def one(vv, ww):
        b = np.floor(vv * 3.6 / CDA_BIN_KPH)
        xs, ys = [], []
        for k in np.unique(b):
            sel = b == k
            if sel.sum() >= 10:
                xs.append(np.mean(vv[sel] ** 3))
                ys.append(np.quantile(ww[sel], CDA_BIN_QUANTILE))
        if len(xs) < 3:
            return None
        xs, ys = np.array(xs), np.array(ys)
        slope, icpt = np.polyfit(xs, ys, 1)
        pred = slope * xs + icpt
        ss = ((ys - ys.mean()) ** 2).sum()
        r2 = 1 - ((ys - pred) ** 2).sum() / ss if ss > 0 else np.nan
        return -2 * slope / RHO, icpt, r2

    r = one(v, w)
    if r is None:
        return out
    out["cda_m2"], out["power_kw"], out["r2"] = r[0], r[1] / 1000.0, r[2]
    rng = np.random.default_rng(seed)
    laps = np.unique(lap)
    boots = []
    groups = [np.flatnonzero(lap == l) for l in laps]
    for _ in range(n_boot):
        pick = rng.integers(0, len(laps), len(laps))
        sel = np.concatenate([groups[p] for p in pick])
        rb = one(v[sel], w[sel])
        if rb is not None:
            boots.append(rb[0])
    if len(boots) > 10:
        out["cda_std_m2"] = float(np.std(boots))
    return out
