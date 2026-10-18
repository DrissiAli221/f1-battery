"""Synthetic full-throttle straights with known acceleration, for comparing
differentiation methods (docs/phase3-differentiation.md).

Each straight has a deploy phase whose acceleration decays with speed, a
linear derate ramp (C5.12.6) to an ICE-only plateau, and a brake-onset step.
Speed is sampled at irregular intervals and rounded to integer kph, the
dominant noise source in the real telemetry.
"""
from dataclasses import dataclass

import numpy as np

KPH = 3.6
DT_FINE = 0.002  # s, integration step of the truth model
BRAKE_ACCEL = -40.0  # m/s^2, step at brake onset
POST_BRAKE = 1.0  # s of braking kept after onset (what a smoother would see)
# Sampling interval distribution measured on the Monza car_data: median 0.24 s,
# p10 0.16 s, p90 0.36 s; lognormal sigma follows from (p90/p10) = exp(2*1.2816*s).
DT_MEDIAN = 0.24
DT_SIGMA = np.log(0.36 / 0.16) / (2 * 1.2816)
GAP_PROB = 0.012
GAP_S = 1.0


@dataclass
class Straight:
    t: np.ndarray  # sample times, s
    v_ms: np.ndarray  # integer-kph speed in m/s
    a_true: np.ndarray  # true acceleration at the sample times
    t_ramp: float  # true ramp start, s
    ramp_s: float  # ramp duration, s
    t_brake: float  # brake onset, s
    v_ramp: float  # true speed at ramp start, m/s
    t_cross: float  # first time the true acceleration drops below 0.5 and stays (before brake)


def _truth(rng):
    v0 = rng.uniform(200, 250) / KPH
    a0 = rng.uniform(3.0, 4.0)
    decay = rng.uniform(80.0, 140.0)  # m/s of speed gain over which deploy acceleration falls to zero
    ramp_s = rng.choice([2.5, 5.0])
    t_ramp = rng.uniform(3.5, 7.0)
    plateau = rng.uniform(-0.3, 0.3)
    hold = rng.uniform(1.5, 3.5)  # plateau length before braking
    t_brake = t_ramp + ramp_s + hold
    n = int((t_brake + POST_BRAKE) / DT_FINE) + 1
    tf = np.arange(n) * DT_FINE
    a = np.empty(n)
    v = np.empty(n)
    v[0] = v0
    a_ramp0 = None
    for i in range(n):
        t = tf[i]
        if t >= t_brake:
            a[i] = BRAKE_ACCEL
        elif t >= t_ramp:
            if a_ramp0 is None:
                a_ramp0 = a_deploy
            a[i] = a_ramp0 + (plateau - a_ramp0) * min((t - t_ramp) / ramp_s, 1.0)
        else:
            a_deploy = max(a0 * (1 - (v[i] - v0) / decay), 0.0)
            a[i] = a_deploy
        if i + 1 < n:
            v[i + 1] = max(v[i] + a[i] * DT_FINE, 0.0)
    return tf, v, a, t_ramp, ramp_s, t_brake


def make_straight(rng) -> Straight:
    tf, v, a, t_ramp, ramp_s, t_brake = _truth(rng)
    t = [rng.uniform(0, 0.2)]
    while True:
        step = DT_MEDIAN * np.exp(DT_SIGMA * rng.standard_normal())
        if rng.random() < GAP_PROB:
            step = GAP_S
        if t[-1] + step > tf[-1]:
            break
        t.append(t[-1] + step)
    t = np.asarray(t)
    v_s = np.round(np.interp(t, tf, v) * KPH) / KPH
    a_s = np.interp(t, tf, a)
    fine_before = tf < t_brake
    below = a[fine_before] < 0.5
    # last index where a >= 0.5 before the brake; the crossing is the sample after it
    idx = np.flatnonzero(~below)
    t_cross = float(tf[idx[-1] + 1]) if len(idx) else 0.0
    return Straight(t, v_s, a_s, t_ramp, ramp_s, t_brake, float(np.interp(t_ramp, tf, v)), t_cross)


def make_dataset(n=200, seed=20261018):
    rng = np.random.default_rng(seed)
    return [make_straight(rng) for _ in range(n)]
