import numpy as np
import pandas as pd

from f1battery_model import alignment as al
from f1battery_model import pipeline as pl


def _q(**cols):
    n = len(next(iter(cols.values())))
    base = {"neutralised": [False] * n, "pit": [False] * n, "max_gap_s": [0.3] * n, "n_samples": [200] * n}
    base.update(cols)
    return pd.DataFrame(base)


def test_out_lap_and_slow_lap_tails_are_usable():
    # qualifying: out-lap, flying lap, cool-down lap; neither end is green
    q = _q(green=[False, True, False])
    bounds = pd.DataFrame({"resolved": [True, True, True]})
    assert pl.tail_usable(q, bounds).tolist() == [True, True, True]


def test_tail_rejected_for_gap_neutralised_in_lap_sparse_or_unresolved():
    q = _q(green=[False] * 5,
           max_gap_s=[al.MAX_GAP_S + 0.1, 0.3, 0.3, 0.3, np.nan],
           neutralised=[False, True, False, False, False],
           pit=[False, False, True, False, False],
           n_samples=[200, 200, 200, al.MIN_SAMPLES - 1, 200])
    bounds = pd.DataFrame({"resolved": [True] * 5})
    assert pl.tail_usable(q, bounds).tolist() == [False] * 5
    assert pl.tail_usable(_q(green=[False]), pd.DataFrame({"resolved": [False]})).tolist() == [False]


def test_wrap_ok_needs_a_consecutive_usable_previous_row():
    tail = np.array([True, True, False, True])
    lap_no = np.array([1, 2, 3, 5])
    assert not pl.wrap_ok(tail, lap_no, 0)          # no previous row
    assert pl.wrap_ok(tail, lap_no, 1)              # lap 1's tail serves lap 2
    assert pl.wrap_ok(tail, lap_no, 2)              # lap 2's tail serves lap 3
    assert not pl.wrap_ok(tail, lap_no, 3)          # lap 4 is missing: not consecutive


# ---------------------------------------------------------------- the gate in use

from types import SimpleNamespace

from f1battery_model import physics as ph
from f1battery_model import profile


def _prepared(n_laps=4, lap_s=20.0, v=70.0):
    """A synthetic driver: constant speed at full throttle, lap 1 an out-lap, the rest green.

    Straight 1 runs from 200 m before the line to 300 m after it, so its window starts in the
    previous lap.
    """
    per = int(lap_s / ph.GRID)
    n = n_laps * per
    t = np.arange(n) * ph.GRID
    vv = np.full(n, v)
    cum = np.concatenate([[0.0], np.cumsum(0.5 * (vv[1:] + vv[:-1]) * ph.GRID)])[:n]
    lap_idx = np.repeat(np.arange(n_laps), per)
    lap_len = lap_s * v
    start_cum = np.arange(n_laps) * lap_len
    tr = ph.Trace(t=t, t0_ns=0, v=vv, a=np.zeros(n), thr=np.full(n, 100.0), gear=np.full(n, 8.0),
                  brk=np.zeros(n, dtype=bool), tb=np.full(n, np.inf), cum=cum, sin_theta=np.zeros(n),
                  mass=np.full(n, 800.0), lap_idx=lap_idx, d=cum - start_cum[lap_idx],
                  lap_start_cum=start_cum, lap_start_t=np.arange(n_laps) * lap_s,
                  lap_end_t=np.arange(1, n_laps + 1) * lap_s)
    green = np.array([False] + [True] * (n_laps - 1))
    wins = [(1, lap_len - 200.0, lap_len + 300.0)]     # straight_windows form: end beyond the lap length
    return pl.Prepared(tr, derate.full_throttle_runs(tr), green, np.full(n_laps, lap_len),
                       np.arange(1, n_laps + 1), lap_len, wins, np.ones(n_laps, dtype=bool))


from f1battery_model import derate  # noqa: E402  (after _prepared for readability)

CTX = SimpleNamespace(rate_kw_s=100.0)


def test_sweep_strict_gate_skips_the_lap_after_the_out_lap_and_the_relaxed_gate_keeps_it():
    prep = _prepared()
    strict = pl.sweep(prep, CTX, 1.0, strict_wrap=True)
    relaxed = pl.sweep(prep, CTX, 1.0)
    assert [r["lap_number"] for r in strict] == [3, 4]
    assert [r["lap_number"] for r in relaxed] == [2, 3, 4]
    assert [r["prev_green"] for r in relaxed] == [False, True, True]
    # distances are measured from lap 2's own line crossing (the run here spans the whole trace,
    # so the spike crossing sits at its start, 1,400 m before that line)
    assert relaxed[0]["cross_spike_d"] == -1400.0


def test_cda_profile_pools_only_strict_rows(monkeypatch):
    prep = _prepared()
    seen = []
    orig = pl.sweep

    def spy(*a, **k):
        seen.append(k.get("strict_wrap", False))
        return orig(*a, **k)

    monkeypatch.setattr(pl, "sweep", spy)
    pl.cda_profile(prep, CTX, grid=(0.8, 1.0))
    assert seen and all(seen)


def test_straight_profile_of_the_wrapping_straight_needs_the_relaxed_gate():
    prep = _prepared()
    out = profile.straight_profiles(prep)
    assert 1 in out and np.isfinite(out[1]["speed"]).any()       # 3 laps: medians exist
    prep.tail_ok[0] = False                                         # the out-lap's tail unusable: 2 laps left
    out = profile.straight_profiles(prep)
    assert 1 in out and not np.isfinite(out[1]["speed"]).any()


def test_tail_usable_accepts_a_length_outlier_previous_lap():
    q = pd.DataFrame({"neutralised": [False], "pit": [False], "max_gap_s": [0.3], "n_samples": [200],
                      "green": [False], "reason": ["length"]})
    assert pl.tail_usable(q, pd.DataFrame({"resolved": [True]})).tolist() == [True]
