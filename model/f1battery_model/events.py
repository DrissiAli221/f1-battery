"""Phase 5 event and non-event sets (HYPOTHESIS.md, "Definitions").

Per Race/Sprint session this builds one row per (attacker, defender, lap):
event = 1 for an on-track pass taken from ``overtake``, event = 0 for a close-
following spell without a pass taken from ``interval_sample``. Both sets go
through the same exclusion rules. The energy variables (``cutoff_dev_defender``,
``deploy_rel_diff``, ``defender_lift``) come from ``model_result`` later and are
left as NaN placeholders here.

    python -m f1battery_model.events --session 11361
    python -m f1battery_model.events --all

Output is ``model/out/events/<session>.parquet`` when pyarrow is importable,
otherwise ``.csv``; a ``summary.csv`` with the per-session accounting is
written next to it.
"""
from __future__ import annotations

import argparse
import re
from bisect import bisect_right
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg

from . import alignment as al
from . import db, quality

OUT_DIR = Path(__file__).resolve().parents[1] / "out" / "events"
EXCLUDED_SESSIONS = {11342}          # Hungary race, DECISIONS.md D17
SESSION_NAMES = ("Race", "Sprint")

# Frozen constants of HYPOTHESIS.md.
PIT_BEFORE_S = 120.0                 # pit entry window start, relative to the event
PIT_AFTER_S = 30.0                   # pit entry window end
PENALTY_WINDOW_S = 300.0             # after a PENALTY message
CLOSE_INTERVAL_S = 1.0               # following distance for a non-event / Overtake availability
CLOSE_MIN_SAMPLES = 3                # consecutive close samples for a non-event
NO_PASS_AFTER_S = 30.0               # no overtake of the pair within this time after a non-event
PACE_LAPS = 3                        # previous green laps for the pace delta

NS = 1_000_000_000
_CAR_NUMBER = re.compile(r"\bCAR\s+(\d+)\b")

# Exclusion rules in attribution order: a removed row is credited to the first
# rule it hits in this order. `duplicate` is applied last, on the survivors.
RULES = ["chequered", "neutral_window", "pit", "penalty", "lap1", "restart_lap", "lap_not_green"]
EVENT_RULES = RULES + ["duplicate"]
NONEVENT_RULES = RULES + ["pass_within_30s", "pair_lap_is_event"]

PLACEHOLDERS = ["cutoff_dev_defender", "deploy_rel_diff", "defender_lift"]
COLUMNS = ["session_key", "lap_number", "attacker", "defender", "event", "t_event",
           "approach_straight_id", "pace_delta", "tyre_age_diff", "overtake_available"] + PLACEHOLDERS


@dataclass
class SessionData:
    """Inputs for one session, as plain frames so tests can build them directly."""
    session_key: int
    overtakes: pd.DataFrame          # date, overtaking_driver_number, overtaken_driver_number
    pits: pd.DataFrame               # driver_number, date
    race_control: pd.DataFrame       # date, driver_number, message
    laps: pd.DataFrame               # driver_number, lap_number, date_start, lap_duration
    lap_quality: pd.DataFrame        # driver_number, lap_number, green
    intervals: pd.DataFrame          # driver_number, date, interval
    positions: pd.DataFrame          # driver_number, date, position
    stints: pd.DataFrame             # driver_number, lap_start, lap_end, tyre_age_at_start
    straights: pd.DataFrame = field(default_factory=lambda: pd.DataFrame(columns=["straight_id", "end_pct"]))


def _ns(values) -> np.ndarray:
    return al.to_ns(values) if len(values) else np.empty(0, dtype=np.int64)


class SessionIndex:
    """Lookup structures derived once from ``SessionData``."""

    def __init__(self, data: SessionData):
        self.data = data
        rc = data.race_control.sort_values("date")
        rc_ns = _ns(rc["date"])
        msgs = rc["message"].fillna("").str.upper().tolist()

        self.windows, _ = al.neutral_windows(rc)
        chequered = [t for t, m in zip(rc_ns, msgs) if "CHEQUERED FLAG" in m]
        self.chequered_ns = int(min(chequered)) if chequered else None

        # PENALTY messages: (time, drivers named by the row or by "CAR <n>" in the text).
        self.penalties: list[tuple[int, set[int]]] = []
        drivers_col = rc["driver_number"].tolist() if "driver_number" in rc else [None] * len(rc)
        for t, m, d in zip(rc_ns, msgs, drivers_col):
            if "PENALTY" not in m:
                continue
            named = {int(n) for n in _CAR_NUMBER.findall(m)}
            if d is not None and not pd.isna(d):
                named.add(int(d))
            self.penalties.append((int(t), named))

        # Overtake mode switches in time order: (time, enabled).
        self.overtake_mode = [(int(t), "OVERTAKE ENABLED" in m) for t, m in zip(rc_ns, msgs)
                              if "OVERTAKE ENABLED" in m or "OVERTAKE DISABLED" in m]
        self._mode_times = [t for t, _ in self.overtake_mode]

        self.pit_ns: dict[int, np.ndarray] = {}
        pits = data.pits.dropna(subset=["date"])
        for d, g in pits.groupby("driver_number"):
            self.pit_ns[int(d)] = np.sort(_ns(g["date"]))

        self.lap_start: dict[int, np.ndarray] = {}
        self.lap_num: dict[int, np.ndarray] = {}
        self.lap_dur: dict[int, dict[int, float]] = {}
        laps = data.laps.dropna(subset=["date_start"]).sort_values(["driver_number", "date_start"])
        for d, g in laps.groupby("driver_number"):
            self.lap_start[int(d)] = _ns(g["date_start"])
            self.lap_num[int(d)] = g["lap_number"].to_numpy(dtype=int)
        for d, g in data.laps.groupby("driver_number"):
            self.lap_dur[int(d)] = dict(zip(g["lap_number"].astype(int), g["lap_duration"].astype(float)))

        q = data.lap_quality
        self.green = set(zip(q.loc[q["green"], "driver_number"].astype(int),
                             q.loc[q["green"], "lap_number"].astype(int)))

        # First green lap of each driver that starts after a closed neutralised window.
        self.restart_laps: set[tuple[int, int]] = set()
        for _, end in self.windows:
            for d, starts in self.lap_start.items():
                nums = self.lap_num[d]
                for i in np.flatnonzero(starts >= end):
                    if (d, int(nums[i])) in self.green:
                        self.restart_laps.add((d, int(nums[i])))
                        break

        self.interval_ns: dict[int, np.ndarray] = {}
        self.interval_val: dict[int, np.ndarray] = {}
        iv = data.intervals.sort_values(["driver_number", "date"])
        for d, g in iv.groupby("driver_number"):
            self.interval_ns[int(d)] = _ns(g["date"])
            self.interval_val[int(d)] = g["interval"].to_numpy(dtype=float)

        self.pos_ns: dict[int, np.ndarray] = {}
        self.pos_val: dict[int, np.ndarray] = {}
        ps = data.positions.sort_values(["driver_number", "date"])
        for d, g in ps.groupby("driver_number"):
            self.pos_ns[int(d)] = _ns(g["date"])
            self.pos_val[int(d)] = g["position"].to_numpy(dtype=int)

        ov = data.overtakes
        self.pass_ns: dict[tuple[int, int], np.ndarray] = {}
        if len(ov):
            ov_ns = _ns(ov["date"])
            a = ov["overtaking_driver_number"].to_numpy(dtype=int)
            b = ov["overtaken_driver_number"].to_numpy(dtype=int)
            for x, y, t in zip(a, b, ov_ns):
                self.pass_ns.setdefault((min(x, y), max(x, y)), []).append(int(t))
            self.pass_ns = {k: np.sort(np.array(v, dtype=np.int64)) for k, v in self.pass_ns.items()}

        self.stints = {int(d): g for d, g in data.stints.groupby("driver_number")}

    # ------------------------------------------------------------ lookups

    def lap_at(self, driver: int, t_ns: int) -> int | None:
        """Driver's lap at ``t_ns``: the lap with the latest ``date_start`` not after it."""
        starts = self.lap_start.get(driver)
        if starts is None or len(starts) == 0:
            return None
        i = int(np.searchsorted(starts, t_ns, side="right")) - 1
        return int(self.lap_num[driver][i]) if i >= 0 else None

    def interval_at(self, driver: int, t_ns: int) -> float:
        """Latest interval sample of the driver at or before ``t_ns`` (NaN when none)."""
        ts = self.interval_ns.get(driver)
        if ts is None:
            return np.nan
        i = int(np.searchsorted(ts, t_ns, side="right")) - 1
        return float(self.interval_val[driver][i]) if i >= 0 else np.nan

    def car_ahead(self, driver: int, t_ns: int) -> int | None:
        """The car one position ahead of ``driver`` at ``t_ns`` (latest position rows)."""
        def pos(d):
            ts = self.pos_ns[d]
            i = int(np.searchsorted(ts, t_ns, side="right")) - 1
            return int(self.pos_val[d][i]) if i >= 0 else None
        if driver not in self.pos_ns:
            return None
        p = pos(driver)
        if p is None or p <= 1:
            return None
        for d in self.pos_ns:
            if d != driver and pos(d) == p - 1:
                return d
        return None

    def overtake_enabled(self, t_ns: int) -> bool:
        i = bisect_right(self._mode_times, t_ns) - 1
        return i >= 0 and self.overtake_mode[i][1]

    def pass_within(self, a: int, b: int, t_ns: int, horizon_s: float) -> bool:
        ts = self.pass_ns.get((min(a, b), max(a, b)))
        if ts is None:
            return False
        i = int(np.searchsorted(ts, t_ns, side="right"))     # passes strictly after t
        return i < len(ts) and ts[i] <= t_ns + horizon_s * NS


# ------------------------------------------------------------ exclusions

def exclusion_flags(ix: SessionIndex, a: int, b: int, t_ns: int,
                    lap_a: int | None, lap_b: int | None) -> dict[str, bool]:
    """Evaluate every exclusion rule of HYPOTHESIS.md for the pair at time ``t_ns``.

    A lap that cannot be determined (no lap row at that time) counts as not
    green. Lap 1, restart laps and the green requirement apply to both cars.
    """
    pit = False
    for d in (a, b):
        arr = ix.pit_ns.get(d)
        if arr is not None and len(arr):
            lo = np.searchsorted(arr, t_ns - PIT_BEFORE_S * NS, side="left")
            hi = np.searchsorted(arr, t_ns + PIT_AFTER_S * NS, side="right")
            pit |= bool(hi > lo)
    penalty = any((a in named or b in named)
                  for t, named in ix.penalties if t <= t_ns <= t + PENALTY_WINDOW_S * NS)
    laps = [(a, lap_a), (b, lap_b)]
    return {
        "chequered": ix.chequered_ns is not None and t_ns > ix.chequered_ns,
        "neutral_window": any(s <= t_ns <= e for s, e in ix.windows),
        "pit": pit,
        "penalty": penalty,
        "lap1": any(lap == 1 for _, lap in laps),
        "restart_lap": any(lap is not None and (d, lap) in ix.restart_laps for d, lap in laps),
        "lap_not_green": any(lap is None or (d, lap) not in ix.green for d, lap in laps),
    }


def first_rule(flags: dict[str, bool], order: list[str] = RULES) -> str | None:
    for r in order:
        if flags.get(r):
            return r
    return None


# ------------------------------------------------------------ controls

def green_laps_before(ix: SessionIndex, driver: int, lap: int, n: int = PACE_LAPS) -> list[float]:
    """Durations of the driver's last ``n`` green laps before ``lap`` (most recent first)."""
    durs = ix.lap_dur.get(driver, {})
    out = []
    for k in range(lap - 1, 0, -1):
        if (driver, k) in ix.green and k in durs and np.isfinite(durs[k]):
            out.append(durs[k])
            if len(out) == n:
                break
    return out


def pace_delta(ix: SessionIndex, attacker: int, defender: int, lap_a: int, lap_d: int) -> float:
    """Attacker minus defender median green-lap time over each car's previous 3 green laps (s)."""
    ma, md = green_laps_before(ix, attacker, lap_a), green_laps_before(ix, defender, lap_d)
    if not ma or not md:
        return np.nan
    return float(np.median(ma) - np.median(md))


def tyre_age(ix: SessionIndex, driver: int, lap: int) -> float:
    """Tyre age in laps on ``lap``: age at stint start plus laps run in the stint."""
    g = ix.stints.get(driver)
    if g is None:
        return np.nan
    for r in g.itertuples():
        end = r.lap_end if pd.notna(r.lap_end) else np.inf
        if pd.notna(r.lap_start) and r.lap_start <= lap <= end and pd.notna(r.tyre_age_at_start):
            return float(r.tyre_age_at_start + (lap - r.lap_start))
    return np.nan


def approach_straight(straights: pd.DataFrame, pct: float) -> float:
    """Straight whose ``end_pct`` is the last one at or before ``pct`` (percent of the lap).

    Before the first end the lap wraps to the straight with the largest end.
    """
    if straights is None or len(straights) == 0 or not np.isfinite(pct):
        return np.nan
    s = straights.sort_values("end_pct")
    below = s[s["end_pct"] <= pct]
    row = below.iloc[-1] if len(below) else s.iloc[-1]
    return float(row["straight_id"])


def controls(ix: SessionIndex, attacker: int, defender: int, t_ns: int,
             lap_a: int, lap_d: int, pct: float) -> dict:
    lap_start = None
    if attacker in ix.lap_num:
        hit = np.flatnonzero(ix.lap_num[attacker] == lap_a)
        if len(hit):
            lap_start = ix.lap_start[attacker][hit[0]]
    close = np.nan
    if lap_start is not None:
        close = ix.interval_at(attacker, int(lap_start))
    available = int(ix.overtake_enabled(t_ns) and np.isfinite(close) and close < CLOSE_INTERVAL_S)
    return {
        "approach_straight_id": approach_straight(ix.data.straights, pct),
        "pace_delta": pace_delta(ix, attacker, defender, lap_a, lap_d),
        "tyre_age_diff": tyre_age(ix, attacker, lap_a) - tyre_age(ix, defender, lap_d),
        "overtake_available": available,
    }


# ------------------------------------------------------------ builders

def build_events(ix: SessionIndex, pct_fn=None) -> tuple[pd.DataFrame, dict]:
    """Event rows (event = 1) and the exclusion accounting.

    ``pct_fn(driver, t_ns)`` returns the attacker's position as percent of the
    lap at ``t_ns`` (NaN when unknown); without it the approach straight is NaN.
    """
    ov = ix.data.overtakes.sort_values("date")
    stats = {"raw": len(ov), "hit": {r: 0 for r in EVENT_RULES}, "first": {r: 0 for r in EVENT_RULES}}
    kept = []
    for r in ov.itertuples():
        a, b = int(r.overtaking_driver_number), int(r.overtaken_driver_number)
        t = int(al.to_ns([r.date])[0])
        la, lb = ix.lap_at(a, t), ix.lap_at(b, t)
        flags = exclusion_flags(ix, a, b, t, la, lb)
        for k, v in flags.items():
            stats["hit"][k] += int(v)
        rule = first_rule(flags)
        if rule:
            stats["first"][rule] += 1
            continue
        kept.append((a, b, la, lb, t, r.date))
    rows, seen = [], set()
    for a, b, la, lb, t, date in kept:           # time order: the earliest duplicate wins
        key = (a, b, la)
        if key in seen:
            stats["hit"]["duplicate"] += 1
            stats["first"]["duplicate"] += 1
            continue
        seen.add(key)
        pct = pct_fn(a, t) if pct_fn else np.nan
        rows.append({"session_key": ix.data.session_key, "lap_number": la, "attacker": a, "defender": b,
                     "event": 1, "t_event": date, **controls(ix, a, b, t, la, lb, pct)})
    stats["final"] = len(rows)
    return _frame(rows), stats


def build_nonevents(ix: SessionIndex, event_pairs: set[tuple[int, int, int]], pct_fn=None) -> tuple[pd.DataFrame, dict]:
    """Non-event rows (event = 0): >= 3 consecutive close samples without a pass.

    ``event_pairs`` holds (attacker, defender, lap) of the kept events; a
    pair-lap that already has an event is not also a non-event (the unit of
    analysis is the pair on a lap).
    """
    stats = {"raw": 0, "hit": {r: 0 for r in NONEVENT_RULES}, "first": {r: 0 for r in NONEVENT_RULES}}
    rows = []
    for f in sorted(ix.interval_ns):
        ts, vals = ix.interval_ns[f], ix.interval_val[f]
        run: list[int] = []
        groups: dict[tuple[int, int], list[tuple[int, int]]] = {}    # (leader, lap) -> [(t, lap_leader)]
        for t, v in zip(ts, vals):
            t = int(t)
            if not (np.isfinite(v) and v < CLOSE_INTERVAL_S):
                run = []
                continue
            lead = ix.car_ahead(f, t)
            if lead is None:
                run = []
                continue
            run = run + [lead] if (run and run[-1] == lead) else [lead]
            if len(run) >= CLOSE_MIN_SAMPLES:
                lap = ix.lap_at(f, t)
                groups.setdefault((lead, -1 if lap is None else lap), []).append((t, lap))
        for (lead, _), cands in groups.items():
            stats["raw"] += 1
            outcome, first_hit = None, None
            for t, lap in cands:
                flags = exclusion_flags(ix, f, lead, t, lap, ix.lap_at(lead, t))
                flags["pass_within_30s"] = ix.pass_within(f, lead, t, NO_PASS_AFTER_S)
                flags["pair_lap_is_event"] = (f, lead, lap) in event_pairs or (lead, f, lap) in event_pairs
                if first_hit is None:
                    first_hit = (flags, first_rule(flags, NONEVENT_RULES))
                if not first_rule(flags, NONEVENT_RULES):
                    outcome = (t, lap)
                    break
            for k, v in first_hit[0].items():
                stats["hit"][k] += int(v)
            if outcome is None:
                stats["first"][first_hit[1]] += 1
                continue
            t, lap = outcome
            pct = pct_fn(f, t) if pct_fn else np.nan
            rows.append({"session_key": ix.data.session_key, "lap_number": lap, "attacker": f, "defender": lead,
                         "event": 0, "t_event": pd.Timestamp(t, tz="UTC"),
                         **controls(ix, f, lead, t, lap, ix.lap_at(lead, t), pct)})
    stats["final"] = len(rows)
    return _frame(rows), stats


def _frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    for c in COLUMNS:
        if c not in df:
            df[c] = np.nan
    return df[COLUMNS]


def build_session(data: SessionData, pct_fn=None) -> tuple[pd.DataFrame, dict, dict]:
    ix = SessionIndex(data)
    ev, ev_stats = build_events(ix, pct_fn)
    pairs = set(zip(ev["attacker"].astype(int), ev["defender"].astype(int), ev["lap_number"].astype(int)))
    ne, ne_stats = build_nonevents(ix, pairs, pct_fn)
    out = pd.concat([ev, ne], ignore_index=True)
    for c in PLACEHOLDERS:
        out[c] = np.nan
    return out, ev_stats, ne_stats


# ------------------------------------------------------------ database

def _query(conn: psycopg.Connection, sql: str, params) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])


def load_session(conn: psycopg.Connection, session_key: int) -> SessionData:
    p = (session_key,)
    return SessionData(
        session_key=session_key,
        overtakes=_query(conn, "SELECT date, overtaking_driver_number, overtaken_driver_number "
                               "FROM overtake WHERE session_key = %s ORDER BY date", p),
        pits=_query(conn, "SELECT driver_number, date FROM pit WHERE session_key = %s", p),
        race_control=_query(conn, "SELECT date, driver_number, message FROM race_control "
                                  "WHERE session_key = %s ORDER BY date", p),
        laps=_query(conn, "SELECT driver_number, lap_number, date_start, lap_duration FROM lap "
                          "WHERE session_key = %s", p),
        lap_quality=_query(conn, "SELECT driver_number, lap_number, green FROM lap_quality "
                                 "WHERE session_key = %s", p),
        intervals=_query(conn, "SELECT driver_number, date, interval FROM interval_sample "
                               "WHERE session_key = %s", p),
        positions=_query(conn, "SELECT driver_number, date, position FROM position "
                               "WHERE session_key = %s", p),
        stints=_query(conn, "SELECT driver_number, lap_start, lap_end, tyre_age_at_start FROM stint "
                            "WHERE session_key = %s", p),
        straights=_query(conn, "SELECT s.straight_id, s.end_pct FROM straight s JOIN session x "
                               "ON x.circuit_key = s.circuit_key WHERE x.session_key = %s", p),
    )


class DistanceMapper:
    """Attacker position as percent of the lap, from the Phase 2 alignment.

    Lap distance is the speed integral from the lap start (alignment.lap_distance)
    divided by the integrated length of the same lap. The car_data record of the
    car shares the clock of its ``location`` feed, so the nearest sample in time
    stands for the car's track position at the event.
    """

    def __init__(self, conn: psycopg.Connection, session_key: int):
        info = db.session_info(conn, session_key)
        self.conn, self.key = conn, session_key
        self.is_race_like = info["session_name"] in SESSION_NAMES
        self.start_ns = int(al.to_ns([info["date_start"]])[0]) if info["date_start"] is not None else None
        self.laps = db.session_laps(conn, session_key)
        self.windows, _ = al.neutral_windows(db.session_race_control(conn, session_key))
        self._cache: dict[int, tuple | None] = {}

    def _driver(self, d: int):
        if d not in self._cache:
            laps = self.laps[self.laps["driver_number"] == d]
            car = db.driver_car_data(self.conn, self.key, d)
            if laps.empty or car.empty:
                self._cache[d] = None
            else:
                _, q, ts_ns, lap_idx, dist, _ = quality.align_driver(
                    car, laps, self.windows, self.start_ns, self.is_race_like)
                self._cache[d] = (ts_ns, lap_idx, dist, q["lap_length_m"].to_numpy(dtype=float))
        return self._cache[d]

    def __call__(self, driver: int, t_ns: int) -> float:
        rec = self._driver(driver)
        if rec is None:
            return np.nan
        ts_ns, lap_idx, dist, length = rec
        i = int(np.searchsorted(ts_ns, t_ns))
        cand = [j for j in (i - 1, i) if 0 <= j < len(ts_ns)]
        j = min(cand, key=lambda k: abs(int(ts_ns[k]) - t_ns))
        if abs(int(ts_ns[j]) - t_ns) > 2 * NS or lap_idx[j] < 0:
            return np.nan
        ln = length[lap_idx[j]]
        return float(100.0 * dist[j] / ln) if np.isfinite(ln) and ln > 0 else np.nan


def event_sessions(conn: psycopg.Connection) -> list[int]:
    s = db.sessions(conn)
    s = s[s["session_name"].isin(SESSION_NAMES) & ~s["session_key"].isin(EXCLUDED_SESSIONS)]
    return s["session_key"].tolist()


def write_output(df: pd.DataFrame, session_key: int, out_dir: Path = OUT_DIR) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        import pyarrow  # noqa: F401
        path = out_dir / f"{session_key}.parquet"
        df.to_parquet(path, index=False)
    except ImportError:
        path = out_dir / f"{session_key}.csv"
        df.to_csv(path, index=False)
    return path


def run_session(conn: psycopg.Connection, session_key: int, write: bool = True) -> dict:
    data = load_session(conn, session_key)
    info = db.session_info(conn, session_key)
    if data.laps.empty or data.lap_quality.empty:
        return {"session_key": session_key, "circuit": info["circuit_short_name"], "name": info["session_name"],
                "raw": len(data.overtakes), "no_data": True, "ev": None, "ne": None, "path": None}
    df, ev, ne = build_session(data, DistanceMapper(conn, session_key))
    path = write_output(df, session_key) if write else None
    return {"session_key": session_key, "circuit": info["circuit_short_name"], "name": info["session_name"],
            "raw": ev["raw"], "no_data": False, "ev": ev, "ne": ne, "path": path}


def summary_frame(results: list[dict]) -> pd.DataFrame:
    rows = []
    for r in results:
        row = {"session_key": r["session_key"], "circuit": r["circuit"], "session": r["name"],
               "raw_overtakes": r["raw"]}
        if r["no_data"]:
            rows.append(row)
            continue
        for k in EVENT_RULES:
            row[f"ev_removed_{k}"] = r["ev"]["first"][k]
        row["events"] = r["ev"]["final"]
        row["ne_candidates"] = r["ne"]["raw"]
        for k in NONEVENT_RULES:
            row[f"ne_removed_{k}"] = r["ne"]["first"][k]
        row["non_events"] = r["ne"]["final"]
        rows.append(row)
    df = pd.DataFrame(rows)
    num = [c for c in df.columns if c not in ("circuit", "session")]
    df[num] = df[num].fillna(0).astype(int)
    return df


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true")
    g.add_argument("--session", type=int)
    ap.add_argument("--no-write", action="store_true")
    args = ap.parse_args()
    with db.connect() as conn:
        keys = event_sessions(conn) if args.all else [args.session]
        results = []
        for k in keys:
            r = run_session(conn, k, write=not args.no_write)
            results.append(r)
            print(f"{k} {r['circuit']} {r['name']}: raw {r['raw']}, "
                  + ("no data" if r["no_data"] else f"events {r['ev']['final']}, non-events {r['ne']['final']}"),
                  flush=True)
    summary = summary_frame(results)
    if not args.no_write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        summary.to_csv(OUT_DIR / ("summary.csv" if args.all else f"summary_{args.session}.csv"), index=False)
    pd.set_option("display.width", 250, "display.max_columns", 50)
    print(summary.to_string(index=False))
    ev, ne = int(summary.get("events", pd.Series(dtype=int)).sum()), int(summary.get("non_events", pd.Series(dtype=int)).sum())
    print(f"\nTotals: events {ev} (minimum 150), non-events {ne} (minimum 300) -> "
          + ("sufficient" if ev >= 150 and ne >= 300 else "INSUFFICIENT"))


if __name__ == "__main__":
    main()
