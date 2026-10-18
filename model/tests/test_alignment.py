"""Alignment rules on a tiny synthetic lap set (10 s laps, constant 36 km/h = 10 m/s)."""
import numpy as np
import pandas as pd

from f1battery_model import alignment as al

T0 = pd.Timestamp("2026-01-01 12:00:00", tz="UTC")


def ts(seconds):
    return T0 + pd.Timedelta(seconds=seconds)


def make_laps(rows):
    """rows: (lap_number, start_s or None, duration or None, out_lap)."""
    return pd.DataFrame({
        "lap_number": [r[0] for r in rows],
        "date_start": pd.to_datetime([None if r[1] is None else ts(r[1]) for r in rows], utc=True),
        "lap_duration": [np.nan if r[2] is None else r[2] for r in rows],
        "is_pit_out_lap": [r[3] for r in rows],
    })


def test_lap_one_without_start_uses_session_start():
    laps = make_laps([(1, None, 12.0, False), (2, 10, 10.0, False)])
    session_start = int(al.to_ns([T0 - pd.Timedelta(seconds=5)])[0])
    b = al.resolve_lap_bounds(laps, session_start, first_sample_ns=int(al.to_ns([ts(1)])[0]))
    assert b["no_start"].tolist() == [True, False]
    assert b["start_ns"].iat[0] == session_start
    assert b["end_ns"].iat[0] == b["start_ns"].iat[1]


def test_lap_one_without_start_falls_back_to_first_sample():
    laps = make_laps([(1, None, 12.0, False), (2, 10, 10.0, False)])
    first = int(al.to_ns([ts(1)])[0])
    b = al.resolve_lap_bounds(laps, None, first)
    assert b["start_ns"].iat[0] == first


def test_missing_start_is_derived_from_previous_lap():
    laps = make_laps([(1, 0, 10.0, False), (2, None, 10.0, False), (3, 20, 10.0, False)])
    b = al.resolve_lap_bounds(laps, None, None)
    assert b["resolved"].all() and b["no_start"].tolist() == [False, True, False]
    assert b["start_ns"].iat[1] == int(al.to_ns([ts(10)])[0])


def test_unresolvable_lap_gets_no_samples():
    laps = make_laps([(1, 0, None, False), (2, None, None, False), (3, 20, 10.0, False)])
    b = al.resolve_lap_bounds(laps, None, None)
    assert b["resolved"].tolist() == [True, False, True]
    assert b["no_start"].tolist() == [False, True, False]
    idx, _ = al.assign_samples(al.to_ns([ts(5), ts(25)]), b)
    assert idx.tolist() == [0, 2]


def test_samples_before_first_and_after_last_lap_have_reasons():
    laps = make_laps([(1, 0, 10.0, False), (2, 10, 10.0, False)])
    b = al.resolve_lap_bounds(laps, None, None)
    idx, reason = al.assign_samples(al.to_ns([ts(-1), ts(0), ts(9.9), ts(10), ts(19.9), ts(20), ts(30)]), b)
    assert idx.tolist() == [-1, 0, 0, 1, 1, -1, -1]
    assert reason.tolist() == [al.NO_LAP_BEFORE, "", "", "", "", al.NO_LAP_AFTER, al.NO_LAP_AFTER]


def test_last_lap_without_duration_takes_no_samples():
    laps = make_laps([(1, 0, 10.0, False), (2, 10, None, False)])
    b = al.resolve_lap_bounds(laps, None, None)
    idx, reason = al.assign_samples(al.to_ns([ts(5), ts(12)]), b)
    assert idx.tolist() == [0, -1] and reason[1] == al.NO_LAP_AFTER


def test_lap_distance_trapezoid_and_head_tail():
    laps = make_laps([(1, 0, 10.0, False), (2, 10, 10.0, False)])
    b = al.resolve_lap_bounds(laps, None, None)
    sample_s = np.arange(0.5, 20.0, 1.0)            # first sample 0.5 s after each lap start
    t = al.to_ns([ts(s) for s in sample_s])
    idx, _ = al.assign_samples(t, b)
    dist, stats = al.lap_distance(t, np.full(len(t), 36.0), idx, b)
    assert np.allclose(stats["lap_length_m"], [100.0, 100.0])      # 10 s x 10 m/s incl. head and tail
    assert np.isclose(stats["max_gap_s"].iat[0], 1.0)
    assert np.isclose(dist[0], 5.0) and np.isclose(dist[9], 95.0)  # head covered at the first sample's speed
    assert np.isclose(dist[10], 5.0)                               # distance restarts on the next lap


def test_in_laps_precede_out_laps():
    assert al.flag_in_laps(np.array([False, False, True, False, True])).tolist() == [False, True, False, True, False]


def test_neutral_windows_closed_unclosed_and_chequered():
    rc = pd.DataFrame({
        "date": pd.to_datetime([ts(100), ts(130), ts(200), ts(210), ts(300), ts(400)], utc=True),
        "message": ["SAFETY CAR DEPLOYED", "SAFETY CAR IN THIS LAP", "VIRTUAL SAFETY CAR DEPLOYED",
                    "VIRTUAL SAFETY CAR ENDING", "FIA STEWARDS: NOTED - RED FLAG INFRINGEMENT",
                    "CHEQUERED FLAG"],
    })
    closed, unclosed = al.neutral_windows(rc)
    assert closed == [(int(al.to_ns([ts(100)])[0]), int(al.to_ns([ts(130)])[0])),
                      (int(al.to_ns([ts(200)])[0]), int(al.to_ns([ts(210)])[0]))]
    assert unclosed == 0
    open_rc = pd.DataFrame({"date": pd.to_datetime([ts(5)], utc=True), "message": ["RED FLAG - RACE SUSPENDED"]})
    assert al.neutral_windows(open_rc) == ([], 1)


def test_slow_lap_uses_reference_median_without_pit_laps():
    dur = np.array([80.0, 80.0, 81.0, 79.0, 120.0, 200.0])
    ref = np.array([True, True, True, True, False, False])   # 120 and 200 are in/out laps
    assert al.flag_slow(dur, ref).tolist() == [False, False, False, False, True, True]
    assert al.flag_slow(np.array([80.0, np.nan, 100.0]), np.array([True, True, True])).tolist() == [False, True, True]


def test_classify_laps_reasons_in_priority_order():
    # 8 laps of 10 s: lap 1 standing start, lap 4 in-lap, lap 5 out-lap, lap 6 inside an SC window,
    # lap 7 slow (untimed samples dense but 20 s), lap 8 is green; lap 2/3 are green.
    laps = make_laps([(1, 0, 10.0, False), (2, 10, 10.0, False), (3, 20, 10.0, False), (4, 30, 10.0, False),
                      (5, 40, 10.0, True), (6, 50, 10.0, False), (7, 60, 20.0, False), (8, 80, 10.0, False)])
    b = al.resolve_lap_bounds(laps, None, None)
    t = al.to_ns([ts(s) for s in np.arange(0.0, 90.0, 0.2)])
    idx, _ = al.assign_samples(t, b)
    _, stats = al.lap_distance(t, np.full(len(t), 36.0), idx, b)
    win = [(int(al.to_ns([ts(52)])[0]), int(al.to_ns([ts(55)])[0]))]
    q = al.classify_laps(b, stats, win, is_race_like=True)
    reasons = [None if pd.isna(r) else r for r in q["reason"]]
    assert reasons == ["standing_start", None, None, "pit", "out_lap", "neutralised", "slow", None]
    assert q["green"].tolist() == [False, True, True, False, False, False, False, True]
    assert q["pit"].tolist()[3] and q["out_lap"].tolist()[4] and q["neutralised"].tolist()[5]


def test_length_outlier_rule():
    length = np.array([100.0, 101.0, 99.0, 100.0, 140.0])
    assert al.flag_length_outliers(length, np.ones(5, dtype=bool)).tolist() == [False, False, False, False, True]


def test_path_length_in_decimetres():
    assert np.isclose(al.path_length_m(np.array([0, 30, 30]), np.array([0, 0, 40])), 7.0)


def test_crossings_and_telemetry_laps():
    # A car on a 100 s loop passing the line (x=0, heading +x) every 100 s; one pass is
    # 40 m off the line (pit lane) and one repeats within 10 s, both ignored or merged.
    t = np.arange(0, 400.0, 1.0)
    x = ((t % 100) - 50) * 100.0          # decimetres, crosses x=0 at t=50, 150, ...
    y = np.where((t > 140) & (t < 160), 600.0, 0.0)   # 60 m off the line at the second pass
    ns = al.to_ns([ts(s) for s in t])
    cr = al.detect_crossings(ns, x, y, np.array([0.0, 0.0]), np.array([1.0, 0.0]))
    assert (cr * 1e-9 - ns[0] * 1e-9).round().tolist() == [50.0, 250.0, 350.0]
    laps = make_laps([(1, 0, 90.0, False), (2, 50, 100.0, False), (3, 250, 100.0, False), (4, 350, None, False)])
    tl = al.telemetry_laps(laps, cr)
    assert tl is not None
    assert (to_s := (al.to_ns(tl["date_start"]) - ns[0]) * 1e-9).round().tolist()[1:] == [50.0, 250.0, 350.0]
    assert al.telemetry_laps(laps, cr[:1]) is None
