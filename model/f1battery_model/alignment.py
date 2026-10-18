"""Lap assignment and lap distance for car_data samples.

Every rule is a separate function so it can be tested and reasoned about on
its own; ``classify_laps`` composes them into the per-lap verdict stored in
``lap_quality``. Times are carried as int64 nanoseconds since the epoch to keep
bisection exact and independent of the pandas datetime resolution.
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

SLOW_LAP_FACTOR = 1.07   # lap_duration above this multiple of the driver's median is not green
MIN_SAMPLES = 50         # fewer car_data samples than this and the lap length is not trusted
MAX_GAP_S = 2.0          # a hole in the telemetry longer than this invalidates the lap length
LENGTH_TOLERANCE = 0.03  # lap length further than this from the driver's median length is inconsistent
MIN_REFERENCE_LAPS = 3   # laps needed for a driver's own median before falling back to all timed laps
LOC_MIN_COVERAGE = 0.8   # location/car_data sample ratio for a lap to enter the path-length cross-check
LOCATION_UNIT_M = 0.1    # OpenF1 location x/y are in decimetres

# Reasons for samples that belong to no lap.
NO_LAP_BEFORE = "before_first_lap"
NO_LAP_AFTER = "after_last_lap"

# "CHEQUERED FLAG" contains the substring "RED FLAG", hence the word boundary.
_RED_FLAG = re.compile(r"\bRED FLAG\b")

_NAT = np.iinfo(np.int64).min


def to_ns(values) -> np.ndarray:
    """Datetime-like (tz-aware or naive, any resolution) to int64 ns; NaT -> sentinel."""
    idx = pd.DatetimeIndex(values)
    out = idx.as_unit("ns").asi8.copy()
    out[idx.isna()] = _NAT
    return out


def is_nat(ns: np.ndarray) -> np.ndarray:
    return ns == _NAT


# ---------------------------------------------------------------- lap bounds

def resolve_lap_bounds(laps: pd.DataFrame, session_start_ns: int | None,
                       first_sample_ns: int | None) -> pd.DataFrame:
    """Start and end time of each lap of one driver.

    A lap runs from its ``date_start`` to the next lap's ``date_start``; the
    last lap ends at ``date_start + lap_duration``, or has zero length when the
    duration is unknown (a retirement lap). Missing starts:

    * lap 1 without ``date_start``: the session start, else the first sample;
    * any other lap: previous start + previous duration when both are known;
    * otherwise the lap is unresolvable (no samples are assigned to it).

    Every lap that needed one of these substitutions has ``no_start`` set.
    Returns one row per lap sorted by lap number with columns lap_number,
    start_ns, end_ns, duration, out_lap, no_start, resolved.
    """
    laps = laps.sort_values("lap_number").reset_index(drop=True)
    n = len(laps)
    start = to_ns(laps["date_start"]) if n else np.empty(0, dtype=np.int64)
    dur = laps["lap_duration"].to_numpy(dtype=float) if n else np.empty(0)
    no_start = is_nat(start).copy()
    for i in np.flatnonzero(no_start):
        if i == 0:
            start[i] = session_start_ns if session_start_ns is not None else (
                first_sample_ns if first_sample_ns is not None else _NAT)
        elif start[i - 1] != _NAT and not np.isnan(dur[i - 1]):
            start[i] = start[i - 1] + int(dur[i - 1] * 1e9)
    resolved = start != _NAT
    end = np.full(n, _NAT, dtype=np.int64)
    for i in range(n):
        if not resolved[i]:
            continue
        nxt = next((j for j in range(i + 1, n) if resolved[j]), None)
        if nxt is not None:
            end[i] = start[nxt]
        elif not np.isnan(dur[i]):
            end[i] = start[i] + int(dur[i] * 1e9)
        else:
            end[i] = start[i]
    return pd.DataFrame({
        "lap_number": laps["lap_number"].to_numpy(),
        "start_ns": start, "end_ns": end, "duration": dur,
        "out_lap": laps["is_pit_out_lap"].fillna(False).astype(bool).to_numpy(),
        "no_start": no_start, "resolved": resolved,
    })


def assign_samples(ts_ns: np.ndarray, bounds: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Lap row (index into ``bounds``) of every sample, by bisection on lap starts.

    Returns ``(lap_idx, reason)``: ``lap_idx`` is -1 for samples that belong to
    no lap and ``reason`` is '' for assigned samples, otherwise NO_LAP_BEFORE
    (before the first lap start) or NO_LAP_AFTER (past the end of the last
    lap, including a last lap with unknown duration).
    """
    ok = np.flatnonzero(bounds["resolved"].to_numpy())
    idx = np.full(len(ts_ns), -1, dtype=np.int64)
    reason = np.full(len(ts_ns), "", dtype=object)
    if len(ok) == 0:
        reason[:] = NO_LAP_BEFORE
        return idx, reason
    starts = bounds["start_ns"].to_numpy()[ok]
    order = np.argsort(starts, kind="stable")
    ok, starts = ok[order], starts[order]
    pos = np.searchsorted(starts, ts_ns, side="right") - 1
    before = pos < 0
    idx[~before] = ok[pos[~before]]
    reason[before] = NO_LAP_BEFORE
    last = ok[-1]
    last_end = bounds["end_ns"].to_numpy()[last]
    after = (idx == last) & (ts_ns >= last_end)
    idx[after] = -1
    reason[after] = NO_LAP_AFTER
    return idx, reason


def lap_distance(ts_ns: np.ndarray, speed_kmh: np.ndarray, lap_idx: np.ndarray,
                 bounds: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
    """Distance from lap start per sample, and per-lap length and largest gap.

    Speed is integrated with the trapezoidal rule between consecutive samples
    of the same lap. The interval between the lap start and its first sample,
    and between its last sample and the lap end, is covered with the nearest
    sample's speed, so the lap length spans the full lap time. Samples without
    a lap get NaN. The returned frame is indexed by ``bounds`` row with columns
    n_samples, lap_length_m, max_gap_s (NaN length/gap for laps without samples).
    """
    n_laps = len(bounds)
    v = pd.Series(speed_kmh, dtype=float).ffill().bfill().to_numpy() / 3.6
    t = (ts_ns - ts_ns[0]) * 1e-9 if len(ts_ns) else np.empty(0)
    dist = np.full(len(ts_ns), np.nan)
    stats = pd.DataFrame({"n_samples": np.zeros(n_laps, dtype=int),
                          "lap_length_m": np.nan, "max_gap_s": np.nan}, index=range(n_laps))
    assigned = lap_idx >= 0
    if not assigned.any():
        return dist, stats
    seg = np.zeros(len(t))
    if len(t) > 1:
        same = (lap_idx[1:] == lap_idx[:-1]) & assigned[1:]
        seg[1:] = np.where(same, 0.5 * (v[1:] + v[:-1]) * np.diff(t), 0.0)
    cum = np.cumsum(seg)
    laps_present, first = np.unique(lap_idx[assigned], return_index=True)
    first = np.flatnonzero(assigned)[first]
    last = np.append(first[1:] - 1, np.flatnonzero(assigned)[-1])
    # Samples are sorted by time, so each lap's samples are contiguous and
    # `first`/`last` delimit them.
    gaps = np.diff(t, prepend=t[0]) if len(t) else np.empty(0)
    for lap, f, l in zip(laps_present, first, last):
        b_start = (bounds["start_ns"].iat[lap] - ts_ns[0]) * 1e-9
        b_end = (bounds["end_ns"].iat[lap] - ts_ns[0]) * 1e-9
        head = max(t[f] - b_start, 0.0)
        tail = max(b_end - t[l], 0.0)
        dist[f:l + 1] = cum[f:l + 1] - cum[f] + v[f] * head
        inner_gap = gaps[f + 1:l + 1].max() if l > f else 0.0
        stats.loc[lap, "n_samples"] = l - f + 1
        stats.loc[lap, "lap_length_m"] = cum[l] - cum[f] + v[f] * head + v[l] * tail
        stats.loc[lap, "max_gap_s"] = max(head, tail, inner_gap)
    return dist, stats


# --------------------------------------------------------------- lap rules

def flag_in_laps(out_lap: np.ndarray) -> np.ndarray:
    """In-laps: the lap immediately before an out-lap (``is_pit_out_lap``).

    Expects laps in lap-number order. The driver entered the pits at the end of
    that lap, so its tail is a pit-lane crawl and its start may include a lift.
    """
    out_lap = np.asarray(out_lap, dtype=bool)
    in_lap = np.zeros_like(out_lap)
    in_lap[:-1] = out_lap[1:]
    return in_lap


def flag_lap_one(lap_number: np.ndarray, is_race_like: bool) -> np.ndarray:
    """Lap 1 of a race or sprint: a standing start, never a clean flying lap."""
    return (np.asarray(lap_number) <= 1) & is_race_like


def neutral_windows(race_control: pd.DataFrame) -> tuple[list[tuple[int, int]], int]:
    """Neutralised periods (safety car, virtual safety car, red flag) in ns.

    A window opens on 'SAFETY CAR ... DEPLOYED' (virtual included) or 'RED
    FLAG' and closes on 'SAFETY CAR ENDING' / 'IN THIS LAP', 'GREEN LIGHT' or
    'TRACK CLEAR'. Stewards' notes that merely mention a safety car or red flag
    (INFRINGEMENT, INCIDENT, STEWARDS, NOTED) are ignored. Returns
    ``(closed_windows, n_unclosed)``: a window still open at the end of the feed
    is not returned, so its laps are left to the lap-duration filter.
    """
    closed: list[tuple[int, int]] = []
    open_at = None
    if race_control.empty:
        return closed, 0
    dates = to_ns(race_control["date"])
    for d, msg in zip(dates, race_control["message"].fillna("").str.upper()):
        if any(w in msg for w in ("INFRINGEMENT", "INCIDENT", "STEWARDS", "NOTED")):
            continue
        if ("SAFETY CAR" in msg and "DEPLOYED" in msg) or _RED_FLAG.search(msg):
            open_at = d if open_at is None else open_at
        if open_at is not None and (("SAFETY CAR" in msg and ("ENDING" in msg or "IN THIS LAP" in msg))
                                    or "GREEN LIGHT" in msg or "TRACK CLEAR" in msg):
            closed.append((int(open_at), int(d)))
            open_at = None
    return closed, int(open_at is not None)


def flag_neutralised(start_ns: np.ndarray, end_ns: np.ndarray,
                     windows: list[tuple[int, int]]) -> np.ndarray:
    """Laps whose [start, end] overlaps a closed neutralisation window."""
    out = np.zeros(len(start_ns), dtype=bool)
    for a, b in windows:
        out |= ~((end_ns < a) | (start_ns > b))
    return out


def flag_slow(duration: np.ndarray, reference_mask: np.ndarray) -> np.ndarray:
    """Laps slower than SLOW_LAP_FACTOR times the driver's reference median.

    The reference median is taken over laps that are timed and not already
    excluded by the pit, lap-1 or neutralisation rules (``reference_mask``), so
    in-laps and slow-down laps do not inflate the threshold. With fewer than
    MIN_REFERENCE_LAPS such laps the median of all timed laps is used. An
    untimed lap is always slow.
    """
    duration = np.asarray(duration, dtype=float)
    timed = ~np.isnan(duration)
    ref = duration[timed & reference_mask]
    if len(ref) < MIN_REFERENCE_LAPS:
        ref = duration[timed]
    if len(ref) == 0:
        return np.ones(len(duration), dtype=bool)
    med = np.median(ref)
    return ~timed | (duration > SLOW_LAP_FACTOR * med)


def flag_length_outliers(length_m: np.ndarray, candidate: np.ndarray) -> np.ndarray:
    """Laps whose integrated length differs from the driver's median by more than LENGTH_TOLERANCE.

    The median is taken over ``candidate`` laps (those passing every other
    rule). A full lap on the same circuit is the same distance to within a
    percent or two, so a larger deviation means the telemetry window does not
    match the lap window (a time-base mismatch, a stop, or a lap-timing error).
    Not applied with fewer than MIN_REFERENCE_LAPS candidates.
    """
    length_m = np.asarray(length_m, dtype=float)
    ref = length_m[candidate & ~np.isnan(length_m)]
    if len(ref) < MIN_REFERENCE_LAPS:
        return np.zeros(len(length_m), dtype=bool)
    med = np.median(ref)
    return np.abs(length_m - med) > LENGTH_TOLERANCE * med


def classify_laps(bounds: pd.DataFrame, stats: pd.DataFrame, windows: list[tuple[int, int]],
                  is_race_like: bool) -> pd.DataFrame:
    """Compose the rules into one verdict per lap (the ``lap_quality`` columns).

    ``reason`` is the first rule that excludes the lap, in this order:
    unresolved, no_start, standing_start, out_lap, pit, neutralised, slow,
    sparse, gap, length. Laps passing all of them are green.
    """
    n = len(bounds)
    out_lap = bounds["out_lap"].to_numpy()
    in_lap = flag_in_laps(out_lap)
    standing = flag_lap_one(bounds["lap_number"].to_numpy(), is_race_like)
    resolved = bounds["resolved"].to_numpy()
    neutral = flag_neutralised(bounds["start_ns"].to_numpy(), bounds["end_ns"].to_numpy(), windows)
    neutral &= resolved
    reference = ~(out_lap | in_lap | standing | neutral | bounds["no_start"].to_numpy())
    slow = flag_slow(bounds["duration"].to_numpy(), reference)
    sparse = stats["n_samples"].to_numpy() < MIN_SAMPLES
    gap = ~(stats["max_gap_s"].fillna(np.inf).to_numpy() <= MAX_GAP_S)
    rules = [("unresolved", ~resolved), ("no_start", bounds["no_start"].to_numpy()),
             ("standing_start", standing), ("out_lap", out_lap), ("pit", in_lap),
             ("neutralised", neutral), ("slow", slow), ("sparse", sparse), ("gap", gap)]
    passing = np.ones(n, dtype=bool)
    for _, mask in rules:
        passing &= ~mask
    length = flag_length_outliers(stats["lap_length_m"].to_numpy(), passing)
    rules.append(("length", length))
    reason = np.full(n, "", dtype=object)
    for name, mask in reversed(rules):
        reason[mask] = name
    return pd.DataFrame({
        "lap_number": bounds["lap_number"].to_numpy(),
        "green": reason == "", "reason": np.where(reason == "", None, reason),
        "n_samples": stats["n_samples"].to_numpy(),
        "lap_length_m": stats["lap_length_m"].to_numpy(),
        "max_gap_s": stats["max_gap_s"].to_numpy(),
        "neutralised": neutral, "pit": in_lap, "out_lap": out_lap,
        "no_start": bounds["no_start"].to_numpy(),
    })


# ------------------------------------------------- location cross-check

def path_length_m(x: np.ndarray, y: np.ndarray) -> float:
    """Length of the (x, y) polyline in metres (location is in decimetres)."""
    if len(x) < 2:
        return 0.0
    return float(np.hypot(np.diff(x.astype(float)), np.diff(y.astype(float))).sum() * LOCATION_UNIT_M)


def location_crosscheck(loc_ts_ns: np.ndarray, x: np.ndarray, y: np.ndarray,
                        bounds: pd.DataFrame, quality: pd.DataFrame) -> dict:
    """Compare location path length with speed-integrated length over green laps.

    Only green laps whose location sample count is at least LOC_MIN_COVERAGE of
    their car_data sample count enter the ratio, so a session with partial
    location coverage still yields a ratio over the covered laps. ``coverage``
    is the location/car_data sample ratio over all assigned laps.
    Returns sums over the laps used; the caller pools drivers.
    """
    used = 0
    loc_len = spd_len = 0.0
    loc_n = car_n = 0
    for i in np.flatnonzero(quality["n_samples"].to_numpy() > 0):
        a, b = bounds["start_ns"].iat[i], bounds["end_ns"].iat[i]
        lo, hi = np.searchsorted(loc_ts_ns, [a, b], side="left")
        n_loc, n_car = hi - lo, int(quality["n_samples"].iat[i])
        loc_n += n_loc
        car_n += n_car
        if quality["green"].iat[i] and n_loc >= LOC_MIN_COVERAGE * n_car:
            loc_len += path_length_m(x[lo:hi], y[lo:hi])
            spd_len += float(quality["lap_length_m"].iat[i])
            used += 1
    return {"laps_used": used, "loc_len_m": loc_len, "speed_len_m": spd_len,
            "loc_samples": loc_n, "car_samples": car_n}
