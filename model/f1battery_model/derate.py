"""Derate detector: per straight per green lap, a hinge fit to specific excess power.

Why power and not acceleration
------------------------------
Acceleration is not flat during deployment: at full throttle it decays from
about 12 m/s^2 at 180 kph to 1-3 m/s^2 near 290 kph because drag grows with
v^2 and the ratio of tractive force to power falls with speed, with no change in
power delivered. The specific excess power ``p`` (physics.py) removes drag and
slope and is close to constant during deployment (C5.2.8 holds the MGU-K at its
cap below 290 kph), so "flat deploy level, linear ramp, plateau" is a statement
about ``p``. The C5.12.6 limit is also a power rate (kW/s), which divides by the
mass to give W/kg/s, independent of speed. The fit is therefore done on ``p``
against time; the cut-off is reported as a distance and a speed.

Model
-----
    p(t) = p_plateau + delta * h(t)
    h = 1 before t0, 1 - (t - t0)/tau for t0 <= t < t0 + tau, 0 afterwards

* t0 is the ramp start (the cut-off), searched on the 0.25 s grid.
* tau (ramp duration) is searched on a grid; a candidate is feasible only if
  delta/tau <= the event's C5.12.6 rate / mass (the rule limits how fast the
  power may fall; a slower ramp is allowed).
* For fixed (t0, tau) the model is linear in (p_plateau, delta), solved in closed
  form; the pair with the smallest squared error wins.

Detection requires a physically meaningful, well-resolved drop (constants below);
otherwise the straight is "analysable, no ramp detected".
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import physics as ph

DEFAULT_RATE_KW_S = 100.0   # used where regulation_event.derate_rate_kw_per_s is NULL (flagged)

MIN_RUN_S = 4.0             # full-throttle run must last this long (spike)
START_GUARD_S = 1.0         # skip after throttle application (smoothing transient, ~200 kW burst)
END_GUARD_S = ph.GUARD_S    # skip before run end / brake onset (smoothing leak)
MIN_USABLE_S = 2.5          # usable segment needed for a fit
HINGE_V_MIN_KPH = 200.0     # below this p is not flat (gear shifts, traction limit)
TAU_GRID_S = np.arange(0.25, 8.01, 0.25)
MIN_DEPLOY_STEPS = 2        # grid steps of deploy level before t0
MIN_VALID_DEPLOY_S = 1.0    # a reported ramp start needs this much deploy level before it and must not sit at the search boundary
MIN_PLATEAU_STEPS = 4       # grid steps of plateau after the ramp (1 s)

# detection thresholds
DELTA_MIN_KW = 100.0        # drop must be at least 100 kW (C5.12.6 applies above 100 kW ERS-K power)
SSE_RATIO_MAX = 0.5         # hinge must remove at least half of the variance of a constant fit
RAMP_V_MIN_KPH = 210.0      # C5.12.7: the C5.12.6 rate rule does not apply below 210 kph
CROSS_V_MIN_KPH = 250.0     # spike: threshold-crossing estimate only counts above this speed
PLATEAU_A_MAX = 1.0         # m/s^2: plateau = near-zero acceleration (A_CROSS 0.5, plus the 0.5-1 m/s^2 late regain seen at Monza)
A_CROSS = 0.5               # m/s^2, spike threshold for the crossing estimate
CROSS_STEPS = 4


@dataclass
class HingeFit:
    t0_idx: int         # ramp start, index within the fitted segment
    tau_steps: int
    p_deploy: float
    p_plateau: float
    delta: float
    sse: float
    sse_flat: float
    n: int


def fit_hinge(p: np.ndarray, rate_wkg_s: float) -> HingeFit | None:
    """Best feasible hinge for ``p`` sampled on the grid (see module docstring)."""
    n = len(p)
    taus = np.round(TAU_GRID_S / ph.GRID).astype(int)
    k0s = np.arange(MIN_DEPLOY_STEPS, n)
    cand = [(k0, tau) for tau in taus for k0 in k0s if k0 + tau <= n - MIN_PLATEAU_STEPS]
    if not cand:
        return None
    k0 = np.array([c[0] for c in cand])
    tau = np.array([c[1] for c in cand])
    i = np.arange(n)[None, :]
    h = np.clip(1.0 - (i - k0[:, None]) / tau[:, None], 0.0, 1.0)
    S1, S2 = h.sum(1), (h * h).sum(1)
    Sy, Shy = p.sum(), h @ p
    den = n * S2 - S1 ** 2
    ok = den > 1e-9
    delta = np.where(ok, (n * Shy - S1 * Sy) / np.where(ok, den, 1.0), 0.0)
    plateau = (Sy - delta * S1) / n
    resid = p[None, :] - (plateau[:, None] + delta[:, None] * h)
    sse = (resid ** 2).sum(1)
    feasible = ok & (delta > 0) & (delta / (tau * ph.GRID) <= rate_wkg_s)
    if not feasible.any():
        return None
    sse = np.where(feasible, sse, np.inf)
    b = int(np.argmin(sse))
    return HingeFit(int(k0[b]), int(tau[b]), float(plateau[b] + delta[b]), float(plateau[b]), float(delta[b]),
                    float(sse[b]), float(((p - p.mean()) ** 2).sum()), n)


# ---------------------------------------------------------------- runs

def full_throttle_runs(tr: ph.Trace) -> tuple[np.ndarray, np.ndarray]:
    """Start and end (exclusive) grid indices of full-throttle runs; single-step dips are bridged."""
    fl = tr.thr >= ph.FULL_THROTTLE
    # a one-step False between two True values is bridged
    br = fl.copy()
    br[1:-1] |= fl[:-2] & fl[2:]
    d = np.diff(np.concatenate([[0], br.astype(np.int8), [0]]))
    return np.flatnonzero(d == 1), np.flatnonzero(d == -1)


def threshold_crossing(a: np.ndarray, v_kph: np.ndarray) -> int | None:
    """First index with ``a`` below A_CROSS for CROSS_STEPS steps in a row at v > CROSS_V_MIN_KPH (spike definition)."""
    below = a < A_CROSS
    for q in range(len(a) - CROSS_STEPS):
        if below[q:q + CROSS_STEPS].all() and v_kph[q] > CROSS_V_MIN_KPH:
            return q
    return None


def deploy_energy(a: np.ndarray, v: np.ndarray, a_plateau: float, dt: float = ph.GRID) -> float:
    """Relative deploy energy over a phase: sum of (a - a_plateau) * v * dt, in m^2/s^2 (J/kg).

    This is the specific work done by the surplus over the ICE-only plateau
    acceleration; it is a relative measure, not an electrical energy.
    """
    return float(np.sum((a - a_plateau) * v) * dt)


def straight_lap(tr: ph.Trace, lap_row: int, win: tuple[float, float], runs, cda: float,
                 rate_kw_s: float, mass_kg: float | None = None, hinge: bool = True) -> dict | None:
    """Analyse one straight on one lap. ``win`` is the window in lap coordinates (m).

    Returns None when no usable full-throttle run overlaps the window; otherwise a
    dict (``detected`` tells whether a ramp was found).
    """
    c0 = tr.lap_start_cum[lap_row]
    if not np.isfinite(c0):
        return None
    i_lo = int(np.searchsorted(tr.cum, c0 + win[0], side="left"))
    i_hi = int(np.searchsorted(tr.cum, c0 + win[1], side="right"))
    if i_hi - i_lo < 4:
        return None
    rs, re = runs
    ov = np.minimum(re, i_hi) - np.maximum(rs, i_lo)
    if not (ov > 0).any():
        return None
    k = int(np.argmax(ov))
    r0, r1 = int(rs[k]), int(re[k])
    if (r1 - r0) * ph.GRID < MIN_RUN_S:
        return None
    # Spike-equivalent crossing: whole run, no guards (reproduction check only).
    sc = threshold_crossing(tr.a[r0:r1], tr.v[r0:r1] * 3.6)
    spike_d = float(tr.cum[r0 + sc] - c0) if sc is not None else np.nan
    spike_v = float(tr.v[r0 + sc] * 3.6) if sc is not None else np.nan
    spike_idx = r0 + sc if sc is not None else None
    u0 = r0 + int(round(START_GUARD_S / ph.GRID))
    u1 = r1 - int(round(END_GUARD_S / ph.GRID))
    near_brake = np.flatnonzero(tr.tb[u0:max(u1, u0)] <= ph.GUARD_S)
    if len(near_brake):
        u1 = u0 + int(near_brake[0])
    if (u1 - u0) * ph.GRID < MIN_USABLE_S:
        return None
    sl = slice(u0, u1)
    v_kph = tr.v[sl] * 3.6
    out = {"run_start_d": float(tr.cum[r0] - c0), "run_len_m": float(tr.cum[r1 - 1] - tr.cum[r0]),
           "u0": u0, "u1": u1, "r1": r1, "detected": False,
           "cross_spike_d": spike_d, "cross_spike_idx": spike_idx, "cross_spike_v_kph": spike_v}
    # entry speed: 150 m into the full-throttle run
    j = int(np.searchsorted(tr.cum, tr.cum[r0] + 150.0))
    out["entry_kph"] = float(tr.v[min(j, len(tr.v) - 1)] * 3.6)
    cross = threshold_crossing(tr.a[sl], v_kph)
    out["cross_d"] = float(tr.cum[u0 + cross] - c0) if cross is not None else np.nan
    out["cross_v_kph"] = float(v_kph[cross]) if cross is not None else np.nan
    out["cross_idx"] = u0 + cross if cross is not None else None
    if not hinge:
        return out
    # hinge on p for samples at or above the minimum speed
    p = ph.specific_excess_power(tr, cda, sl)
    use = np.flatnonzero(v_kph >= HINGE_V_MIN_KPH)
    if len(use) == 0 or (len(use) * ph.GRID) < MIN_USABLE_S - 1e-9:
        out["fit_ok"] = False
        return out
    f0 = int(use[0])
    pf = p[f0:]
    m = float(np.mean(tr.mass[sl])) if mass_kg is None else mass_kg
    fit = fit_hinge(pf, rate_kw_s * 1000.0 / m)
    out["fit_ok"] = fit is not None
    if fit is None:
        return out
    g0 = u0 + f0
    t0_g = g0 + fit.t0_idx
    end_g = t0_g + fit.tau_steps
    out.update(hinge_d=float(tr.cum[t0_g] - c0), hinge_v_kph=float(tr.v[t0_g] * 3.6), p_deploy=fit.p_deploy,
               p_plateau=fit.p_plateau, delta_wkg=fit.delta, tau_s=fit.tau_steps * ph.GRID,
               sse=fit.sse, n_fit=fit.n, sse_ratio=fit.sse / fit.sse_flat if fit.sse_flat > 0 else np.inf, t0_g=t0_g, end_g=end_g, g0=g0)
    delta_kw = fit.delta * m / 1000.0
    out["delta_kw"] = delta_kw
    out["ramp_rate_kw_s"] = delta_kw / (fit.tau_steps * ph.GRID)
    pl = tr.a[end_g:u1]
    out["plateau_accel"] = float(np.mean(pl)) if len(pl) else np.nan
    detected = (delta_kw >= DELTA_MIN_KW and out["sse_ratio"] <= SSE_RATIO_MAX
                and out["hinge_v_kph"] >= RAMP_V_MIN_KPH and abs(out["plateau_accel"]) <= PLATEAU_A_MAX)
    out["detected"] = bool(detected)
    # Interior ramp start: not pinned at the earliest index the search allows, >= 1 s of deploy level before t0.
    out["hinge_valid"] = bool(fit.t0_idx > MIN_DEPLOY_STEPS and fit.t0_idx * ph.GRID >= MIN_VALID_DEPLOY_S)
    return out
