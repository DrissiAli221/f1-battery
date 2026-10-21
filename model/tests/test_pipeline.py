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
