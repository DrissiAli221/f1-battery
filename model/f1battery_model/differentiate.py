"""Acceleration-from-speed estimators behind one signature: accel(t, v_ms) -> a.

Inputs are irregular sample times (s) and speed (m/s); the output is the
acceleration estimate at the same times. Methods that need a uniform grid
resample to GRID seconds, differentiate, and interpolate back.
"""
import warnings

import numpy as np
from scipy.signal import savgol_filter

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from pynumdiff import kalman_smooth, total_variation_regularization

GRID = 0.25  # s, resampling step (as in the spike)


def _on_grid(t, v, fn):
    tg = np.arange(t[0], t[-1], GRID)
    if len(tg) < 5:
        return np.gradient(v, t)
    ag = fn(np.interp(tg, t, v), tg)
    return np.interp(t, tg, ag)


def finite_difference(t, v_ms):
    """Central differences on the raw, irregular samples."""
    return np.gradient(v_ms, t)


def savgol(window, poly=2):
    """Savitzky-Golay on the 0.25 s grid; window in grid samples (odd)."""
    def f(t, v_ms):
        def g(vg, tg):
            w = min(window, len(vg) - (1 - len(vg) % 2))
            return savgol_filter(vg, w, poly, deriv=1, delta=GRID)
        return _on_grid(t, v_ms, g)
    return f


def kalman_rts(log_qr, order=2):
    """PyNumDiff RTS smoother, constant-acceleration model (order=2), run on the
    raw irregular sample times. log_qr is log(process/measurement noise)."""
    def f(t, v_ms):
        _, dx = kalman_smooth.rtsdiff(v_ms, t, order, log_qr, forwardbackward=True)
        return dx
    return f


def tv_velocity(gamma, iters=10):
    """Chartrand total-variation regularised derivative (PyNumDiff
    iterative_velocity) on the 0.25 s grid."""
    def f(t, v_ms):
        def g(vg, tg):
            _, dx = total_variation_regularization.iterative_velocity(vg, GRID, iters, gamma)
            return dx
        return _on_grid(t, v_ms, g)
    return f


# name -> (factory, parameter name, tuning grid)
METHODS = {
    "finite_diff": (lambda p: finite_difference, "-", [None]),
    "savgol_9": (lambda p: savgol(9), "-", [None]),
    "savgol_wide": (savgol, "window", [11, 13, 15, 17, 21, 25, 31]),
    # order=1: acceleration is a random walk (constant-acceleration model for a
    # speed signal); order=2 additionally smooths the jerk.
    "kalman_rts_o1": (lambda p: kalman_rts(p, 1), "log_qr", [-6, -4, -2, 0, 2, 4, 6]),
    "kalman_rts_o2": (lambda p: kalman_rts(p, 2), "log_qr", [-6, -4, -2, 0, 2, 4, 6]),
    "tv_chartrand": (tv_velocity, "gamma", [0.1, 0.3, 1.0, 3.0, 10.0, 30.0]),
}
