"""Event/non-event extraction on a small synthetic session.

Two cars (1 and 2), 100 s laps, ten laps each starting at T0 + 100 * (lap - 1).
All laps are green unless a test says otherwise.
"""
import numpy as np
import pandas as pd

from f1battery_model import events as ev

T0 = pd.Timestamp("2026-01-01 12:00:00", tz="UTC")


def ts(s):
    return T0 + pd.Timedelta(seconds=s)


def frame(rows, cols):
    return pd.DataFrame(rows, columns=cols)


def make(overtakes=(), pits=(), rc=(), not_green=(), intervals=(), positions=None, stints=None):
    laps = frame([(d, n, ts(100 * (n - 1)), 90.0 + d) for d in (1, 2) for n in range(1, 11)],
                 ["driver_number", "lap_number", "date_start", "lap_duration"])
    lq = frame([(d, n, (d, n) not in set(not_green)) for d in (1, 2) for n in range(1, 11)],
               ["driver_number", "lap_number", "green"])
    if positions is None:
        positions = [(1, ts(0), 2), (2, ts(0), 1)]
    if stints is None:
        stints = [(1, 1, 10, 0), (2, 1, 10, 3)]
    return ev.SessionData(
        session_key=1,
        overtakes=frame([(ts(t), a, b) for t, a, b in overtakes],
                        ["date", "overtaking_driver_number", "overtaken_driver_number"]),
        pits=frame([(d, ts(t)) for d, t in pits], ["driver_number", "date"]),
        race_control=frame([(ts(t), d, m) for t, d, m in rc], ["date", "driver_number", "message"]),
        laps=laps, lap_quality=lq,
        intervals=frame([(d, ts(t), v) for d, t, v in intervals], ["driver_number", "date", "interval"]),
        positions=frame(positions, ["driver_number", "date", "position"]),
        stints=frame(stints, ["driver_number", "lap_start", "lap_end", "tyre_age_at_start"]),
        straights=frame([(1, 20.0), (2, 60.0)], ["straight_id", "end_pct"]),
    )


def events(**kw):
    return ev.build_events(ev.SessionIndex(make(**kw)))


def test_clean_overtake_is_kept_and_lap_is_attackers_lap():
    df, st = events(overtakes=[(250, 1, 2)])
    assert st["final"] == 1
    assert df["lap_number"].iat[0] == 3 and df["event"].iat[0] == 1


def test_pit_window_is_asymmetric():
    # Pit 120 s before and 30 s after are inside; 121 s before / 31 s after are outside.
    for pit_t, removed in [(130, True), (129, False), (280, True), (281, False)]:
        _, st = events(overtakes=[(250, 1, 2)], pits=[(2, pit_t)])
        assert (st["first"]["pit"] == 1) is removed, pit_t


def test_penalty_window_by_text_and_by_row_driver():
    _, st = events(overtakes=[(250, 1, 2)], rc=[(100, None, "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 2 (XXX)")])
    assert st["hit"]["penalty"] == 1
    _, st = events(overtakes=[(250, 1, 2)], rc=[(100, 1, "TIME PENALTY")])
    assert st["hit"]["penalty"] == 1
    _, st = events(overtakes=[(250, 1, 2)], rc=[(100, None, "TIME PENALTY FOR CAR 7 (XXX)")])
    assert st["hit"]["penalty"] == 0          # other car
    _, st = events(overtakes=[(450, 1, 2)], rc=[(100, None, "TIME PENALTY FOR CAR 2 (XXX)")])
    assert st["hit"]["penalty"] == 0          # more than 300 s later


def test_after_chequered_flag():
    _, st = events(overtakes=[(250, 1, 2), (950, 1, 2)], rc=[(900, None, "CHEQUERED FLAG")])
    assert st["first"]["chequered"] == 1 and st["final"] == 1


def test_closed_neutral_window_only():
    rc = [(200, None, "SAFETY CAR DEPLOYED"), (240, None, "SAFETY CAR IN THIS LAP")]
    _, st = events(overtakes=[(220, 1, 2)], rc=rc)
    assert st["hit"]["neutral_window"] == 1
    _, st = events(overtakes=[(220, 1, 2)], rc=rc[:1])     # never closed: not a window
    assert st["hit"]["neutral_window"] == 0


def test_lap_one_and_non_green_lap_of_either_driver():
    _, st = events(overtakes=[(50, 1, 2)])
    assert st["first"]["lap1"] == 1
    _, st = events(overtakes=[(250, 1, 2)], not_green=[(2, 3)])
    assert st["first"]["lap_not_green"] == 1       # defender's lap
    _, st = events(overtakes=[(250, 1, 2)], not_green=[(1, 3)])
    assert st["first"]["lap_not_green"] == 1       # attacker's lap


def test_first_green_lap_after_window_is_excluded():
    rc = [(150, None, "SAFETY CAR DEPLOYED"), (190, None, "SAFETY CAR IN THIS LAP")]
    # Laps 2 (100-200) overlaps the window and is not green; lap 3 is the restart lap.
    kw = dict(rc=rc, not_green=[(1, 2), (2, 2)])
    _, st = events(overtakes=[(250, 1, 2), (350, 1, 2)], **kw)
    assert st["first"]["restart_lap"] == 1 and st["final"] == 1


def test_duplicates_collapse_to_one_row_per_pair_and_lap():
    df, st = events(overtakes=[(250, 1, 2), (260, 1, 2), (270, 2, 1)])
    assert st["final"] == 2 and st["first"]["duplicate"] == 1   # (1,2,3) twice, (2,1,3) distinct
    assert df.loc[df["attacker"] == 1, "t_event"].iat[0] == ts(250)


def test_controls():
    ix = ev.SessionIndex(make(
        overtakes=[(250, 1, 2)],
        rc=[(0, None, "OVERTAKE ENABLED")],
        intervals=[(1, 199, 0.8)]))
    df, _ = ev.build_events(ix, pct_fn=lambda d, t: 65.0)
    r = df.iloc[0]
    assert r["pace_delta"] == -1.0                      # durations 91 vs 92
    assert r["tyre_age_diff"] == (2 - 0) - (2 + 3)      # lap 3: ages 2 and 5
    assert r["overtake_available"] == 1
    assert r["approach_straight_id"] == 2               # last end_pct <= 65 is 60


def test_overtake_available_needs_enabled_and_close():
    for rc, iv, want in [([(0, None, "OVERTAKE ENABLED"), (100, None, "OVERTAKE DISABLED")], 0.8, 0),
                         ([(0, None, "OVERTAKE ENABLED")], 1.4, 0),
                         ([], 0.8, 0)]:
        df, _ = ev.build_events(ev.SessionIndex(make(overtakes=[(250, 1, 2)], rc=rc, intervals=[(1, 199, iv)])))
        assert df["overtake_available"].iat[0] == want


def test_approach_straight_wraps_before_first_end():
    s = frame([(1, 20.0), (2, 60.0)], ["straight_id", "end_pct"])
    assert ev.approach_straight(s, 5.0) == 2
    assert np.isnan(ev.approach_straight(s, np.nan))


# ------------------------------------------------------------ non-events

def close_run(follower=1, start=210, n=3, step=4, value=0.6):
    return [(follower, start + i * step, value) for i in range(n)]


def nonevents(events_pairs=frozenset(), **kw):
    ix = ev.SessionIndex(make(**kw))
    return ev.build_nonevents(ix, set(events_pairs))


def test_three_close_samples_make_a_nonevent():
    df, st = nonevents(intervals=close_run())
    assert st["final"] == 1
    r = df.iloc[0]
    assert (r["attacker"], r["defender"], r["event"], r["lap_number"]) == (1, 2, 0, 3)
    assert r["t_event"] == ts(218)                       # third sample


def test_two_samples_or_a_gap_above_one_second_is_not_enough():
    assert nonevents(intervals=close_run(n=2))[1]["final"] == 0
    iv = close_run(n=4)
    iv[2] = (1, 218, 1.2)
    assert nonevents(intervals=iv)[1]["final"] == 0


def test_pass_within_30_s_removes_nonevent_but_not_later_pass():
    _, st = nonevents(intervals=close_run(), overtakes=[(240, 1, 2)])
    assert st["first"]["pass_within_30s"] == 1 and st["final"] == 0
    _, st = nonevents(intervals=close_run(), overtakes=[(245, 2, 1)])    # reverse order counts too
    assert st["first"]["pass_within_30s"] == 1
    _, st = nonevents(intervals=close_run(), overtakes=[(300, 1, 2)])
    assert st["final"] == 1


def test_follower_must_have_the_same_car_ahead_for_all_samples():
    pos = [(1, ts(0), 2), (2, ts(0), 1), (3, ts(0), 3), (3, ts(215), 1), (2, ts(215), 3)]
    assert nonevents(intervals=close_run(), positions=pos)[1]["final"] == 0


def test_nonevent_uses_the_same_exclusions():
    assert nonevents(intervals=close_run(start=10))[1]["first"]["lap1"] == 1
    assert nonevents(intervals=close_run(), not_green=[(1, 3)])[1]["first"]["lap_not_green"] == 1
    assert nonevents(intervals=close_run(), pits=[(2, 200)])[1]["first"]["pit"] == 1
    assert nonevents(intervals=close_run(), rc=[(150, None, "TIME PENALTY FOR CAR 1")])[1]["first"]["penalty"] == 1
    assert nonevents(intervals=close_run(), rc=[(100, None, "CHEQUERED FLAG")])[1]["first"]["chequered"] == 1


def test_at_most_one_nonevent_per_pair_and_lap_and_not_when_pair_lap_is_event():
    df, st = nonevents(intervals=close_run(n=6))
    assert st["final"] == 1
    _, st = nonevents(intervals=close_run(), events_pairs={(1, 2, 3)})
    assert st["first"]["pair_lap_is_event"] == 1 and st["final"] == 0


def test_build_session_frame_columns_and_placeholders():
    out, e, n = ev.build_session(make(overtakes=[(250, 1, 2)], intervals=close_run(start=410)))
    assert list(out.columns) == ev.COLUMNS
    assert out["event"].tolist() == [1, 0]
    assert out[ev.PLACEHOLDERS].isna().all().all()
