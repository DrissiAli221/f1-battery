"""Join and decision rules of the Phase 5 test on a small synthetic frame."""
import numpy as np
import pandas as pd

from f1battery_model import hypothesis_test as ht

T0 = pd.Timestamp("2026-01-01 12:00:00", tz="UTC")


def inputs():
    # One session (1), cars 1 (attacker) and 2 (defender), 100 s laps; straight 7 = 20-60 % of a 4000 m lap.
    laps = pd.DataFrame([(1, d, n, T0 + pd.Timedelta(seconds=100 * (n - 1))) for d in (1, 2) for n in range(1, 8)],
                        columns=["session_key", "driver", "lap", "date_start"])
    cut = pd.DataFrame([(1, 2, 4, 7, 2500.0), (1, 2, 5, 7, 2400.0)],
                       columns=["session_key", "driver", "lap", "straight_id", "value"])
    med = pd.DataFrame([(1, 2, 7, 2450.0, 2440.0, 2460.0)],
                       columns=["session_key", "driver", "straight_id", "median", "ci_low", "ci_high"])
    en = pd.DataFrame([(1, 2, 4, 500.0), (1, 1, 4, 200.0), (1, 2, 5, 100.0)],
                      columns=["session_key", "driver", "lap", "value"])
    lift = pd.DataFrame([(1, 2, 4, b) for b in (20, 21, 22, 23)], columns=["session_key", "driver", "lap", "bin"])
    bin_laps = pd.DataFrame([(1, 2, 4), (1, 2, 5)], columns=["session_key", "driver", "lap"])
    return dict(cut=cut, med=med, en=en, lift_bins=lift, bin_laps=bin_laps,
                lapq=pd.DataFrame([(1, 2, 4000.0)], columns=["session_key", "driver", "lap_len"]),
                laps=laps, win=pd.DataFrame([(1, 7, 20.0, 60.0)], columns=["session_key", "straight_id", "start_pct", "end_pct"]))


def event_rows(rows):
    return pd.DataFrame(rows, columns=["session_key", "lap_number", "attacker", "defender", "event", "t_event",
                                       "approach_straight_id", "pace_delta", "tyre_age_diff", "overtake_available"])


def test_join_values_and_bands():
    ev = event_rows([(1, 5, 1, 2, 1, T0 + pd.Timedelta(seconds=450), 7, -0.2, 1.0, 1)])  # defender lap 5 -> previous lap 4
    out, _ = ht.join_energy(ev, inputs())
    r = out.iloc[0]
    assert r["reason"] == ""
    assert r["cutoff_dev_defender"] == 50.0                      # 2500 - 2450
    assert (r["dev_lo"], r["dev_hi"]) == (40.0, 60.0)            # cut - ci_high, cut - ci_low
    assert r["deploy_rel_diff"] == 300.0                         # defender 500 - attacker 200
    assert r["defender_lift"] == 1.0                             # bins 20-23 = 1000-1200 m, inside 800-2400 m


def test_drop_reasons_first_hit():
    rows = [(1, 5, 1, 2, 1, T0 + pd.Timedelta(seconds=450), 7, -0.2, 1.0, 1),
            (1, 6, 1, 2, 0, T0 + pd.Timedelta(seconds=550), 7, -0.2, 1.0, 0),    # previous lap 5: attacker has no energy
            (1, 5, 1, 2, 0, T0 + pd.Timedelta(seconds=450), 7, np.nan, 1.0, 0),   # no pace delta
            (1, 3, 1, 2, 0, T0 + pd.Timedelta(seconds=250), 7, 0.1, 1.0, 0)]      # previous lap 2: no cut-off
    out, drops = ht.join_energy(event_rows(rows), inputs())
    assert list(out["reason"]) == ["", "no_deploy_energy", "no_pace_delta", "defender_no_cutoff_prev_lap"]
    first = drops.groupby("reason")["first_hit"].sum()
    assert first["defender_no_cutoff_prev_lap"] == 1 and first["no_pace_delta"] == 1


def test_lift_needs_four_consecutive_bins_inside_window():
    assert ht.has_lift_run({20, 21, 22, 23}, 0, 100)
    assert not ht.has_lift_run({20, 21, 23, 24}, 0, 100)
    assert not ht.has_lift_run({20, 21, 22, 23}, 21, 100)       # run cut by the window
    by_lap = {((1, 2), 4): {70, 71, 72, 73}}                    # 3500-3700 m: outside the 800-2400 m straight
    assert not ht.lift_flag(by_lap, (1, 2), 4, 800.0, 2400.0, 4000.0)


def test_wrapping_straight_does_not_join_runs_over_the_line():
    by_lap = {((1, 2), 3): {78, 79}, ((1, 2), 4): {0, 1}}       # 2 bins before the line, 2 after
    assert not ht.lift_flag(by_lap, (1, 2), 4, 3800.0, 4200.0, 4000.0)
    by_lap[((1, 2), 4)] = {0, 1, 2, 3}
    assert ht.lift_flag(by_lap, (1, 2), 4, 3800.0, 4400.0, 4000.0)


def test_single_class_sessions_dropped():
    df = pd.DataFrame({"session_key": [1, 1, 2, 2, 3], "event": [1, 0, 0, 0, 1]})
    assert set(ht.informative_sessions(df)["session_key"]) == {1}


def ors(or_, lo):
    return {"or": or_, "lo": lo, "hi": or_ * 1.5}


def test_decision_rules():
    good = {"point": ors(1.5, 1.1), "lower_edge": ors(1.4, 1.05), "upper_edge": ors(1.6, 1.2)}
    assert ht.decide(200, 400, good, 97.0)["verdict"] == "effect"
    assert ht.decide(200, 400, good, 94.0)["verdict"] == "no effect"             # permutation fails
    weak = dict(good, lower_edge=ors(1.25, 1.05))
    assert ht.decide(200, 400, weak, 99.0)["verdict"] == "no effect"             # OR < 1.3 in one run
    ci = dict(good, upper_edge=ors(1.6, 0.98))
    assert ht.decide(200, 400, ci, 99.0)["verdict"] == "no effect"               # interval includes 1
    assert ht.decide(149, 400, good, 99.0)["verdict"] == "insufficient data"
    assert ht.decide(200, 299, good, 99.0)["verdict"] == "insufficient data"


def test_earlier_cut_or_inverts_deviation_or():
    t = pd.DataFrame([{"term": "cutoff_dev_defender", "or_per_sd": 0.5, "or_lo": 0.4, "or_hi": 0.8}])
    r = ht.earlier_cut_or(t)
    assert (r["or"], r["lo"], r["hi"]) == (2.0, 1.25, 2.5)
