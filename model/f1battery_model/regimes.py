"""Regime labels per 50 m distance bin and the lap-to-lap agreement metric.

Sample labels (priority from the top):

* BRAKE   brake channel on.
* LIFT    throttle below 98 % outside braking. Full-throttle samples in the
          LIFT_BURST_S seconds after a lift that started above LIFT_BURST_MIN_KPH
          are also LIFT: reapplying the throttle triggers a short MGU-K burst
          (about 200 kW, not under driver control; docs/regulations.md) that
          would otherwise read as deployment.
* DEPLOY  full throttle, acceleration above A_DEPLOY.
* PLATEAU full throttle, acceleration within +-A_DEPLOY.
* OTHER   everything else: full-throttle samples inside the brake guard (the
          smoothing window leaks the braking onset backwards) and full-throttle
          samples decelerating by more than A_DEPLOY.

A bin takes the most frequent sample label in it; ties are broken in the order
BRAKE, LIFT, DEPLOY, PLATEAU, OTHER.
"""
from __future__ import annotations

import numpy as np

from . import physics as ph

DEPLOY, PLATEAU, LIFT, BRAKE, OTHER = 0, 1, 2, 3, 4
CODE_NAMES = {DEPLOY: "deploy", PLATEAU: "plateau", LIFT: "lift", BRAKE: "brake", OTHER: "other"}
BIN_M = 50.0
A_DEPLOY = 0.5            # m/s^2 (spike threshold)
LIFT_BURST_S = 1.0
LIFT_BURST_MIN_KPH = 200.0
_TIE_ORDER = [BRAKE, LIFT, DEPLOY, PLATEAU, OTHER]


def sample_labels(tr: ph.Trace) -> np.ndarray:
    """Regime code of every grid sample of the stream."""
    full = tr.thr >= ph.FULL_THROTTLE
    lab = np.full(len(tr.v), OTHER, dtype=np.int8)
    ok = full & ~tr.brk & (tr.tb > ph.GUARD_S)
    lab[ok & (tr.a > A_DEPLOY)] = DEPLOY
    lab[ok & (np.abs(tr.a) <= A_DEPLOY)] = PLATEAU
    lift = ~full & ~tr.brk
    lab[lift] = LIFT
    # Burst after a straight-line lift: extend LIFT over the full-throttle samples that follow.
    n_burst = int(round(LIFT_BURST_S / ph.GRID))
    edge = np.flatnonzero(lift[:-1] & full[1:] & (tr.v[:-1] * 3.6 >= LIFT_BURST_MIN_KPH))
    for e in edge:
        seg = slice(e + 1, min(e + 1 + n_burst, len(lab)))
        m = full[seg] & ~tr.brk[seg]
        lab[seg][m] = LIFT
    lab[tr.brk] = BRAKE
    return lab


def lap_bin_labels(d: np.ndarray, lab: np.ndarray, min_samples: int = 2) -> np.ndarray:
    """Label of each 50 m bin of one lap (array index = bin number); -1 where a bin has too few samples."""
    ok = np.isfinite(d)
    b = (d[ok] // BIN_M).astype(int)
    b = np.clip(b, 0, None)
    n = int(b.max()) + 1 if len(b) else 0
    if n == 0:
        return np.empty(0, dtype=np.int8)
    counts = np.bincount(b * 5 + lab[ok], minlength=n * 5).reshape(n, 5)[:, _TIE_ORDER]
    best = np.array(_TIE_ORDER)[np.argmax(counts, axis=1)]
    best = np.where(counts.sum(1) >= min_samples, best, -1)
    return best.astype(np.int8)


def lap_shares(bins: np.ndarray) -> dict[str, float]:
    """Share of bins per regime over the lap's bins (OTHER and empty bins stay in the denominator)."""
    n = len(bins)
    if n == 0:
        return {}
    return {CODE_NAMES[c]: float((bins == c).sum()) / n for c in (DEPLOY, PLATEAU, LIFT, BRAKE)}


def agreement(bins_per_lap: list[np.ndarray]) -> dict[str, float]:
    """Lap-to-lap agreement on full-throttle bins (spike exit 3).

    For each pair of consecutive green laps, over the bins that are DEPLOY or
    PLATEAU in both laps, the fraction with the same label. Returns the mean and
    minimum over pairs.
    """
    vals = []
    for x, y in zip(bins_per_lap[:-1], bins_per_lap[1:]):
        n = min(len(x), len(y))
        x, y = x[:n], y[:n]
        m = np.isin(x, (DEPLOY, PLATEAU)) & np.isin(y, (DEPLOY, PLATEAU))
        if m.sum():
            vals.append(float((x[m] == y[m]).mean()))
    if not vals:
        return {"mean": np.nan, "min": np.nan, "pairs": 0}
    return {"mean": float(np.mean(vals)), "min": float(np.min(vals)), "pairs": len(vals)}
