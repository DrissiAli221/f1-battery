"""Per-session alignment and data-quality pass.

For every driver: assign car_data samples to laps, integrate lap distance,
classify laps, cross-check against ``location`` and upsert ``lap_quality``.
The session report summarises the outcome (docs/phase2-alignment.md).

    python -m f1battery_model.quality --session 11361
    python -m f1battery_model.quality --all
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg

from . import alignment as al
from . import db

OUT_DIR = Path(__file__).resolve().parents[1] / "out" / "quality"
RATIO_TOLERANCE = 0.02       # |location/speed path length - 1| above this flags the session
LENGTH_EXCLUDED_TOLERANCE = 0.10  # share of otherwise-green laps removed by the length rule that flags a session
MOVING_KPH = 30              # a sample above this speed counts as the car moving
NO_LAP_TOLERANCE = 0.05      # share of moving samples without a lap above this flags the session
LENGTH_TRIGGER = 0.10        # length-rule losses above this share trigger a telemetry-boundary re-run

_UPSERT = """
INSERT INTO lap_quality (session_key, driver_number, lap_number, green, reason, n_samples,
                         lap_length_m, max_gap_s, neutralised, pit, out_lap, no_start, boundary_source)
VALUES (%(session_key)s, %(driver_number)s, %(lap_number)s, %(green)s, %(reason)s, %(n_samples)s,
        %(lap_length_m)s, %(max_gap_s)s, %(neutralised)s, %(pit)s, %(out_lap)s, %(no_start)s, %(boundary_source)s)
ON CONFLICT (session_key, driver_number, lap_number) DO UPDATE SET
    green = EXCLUDED.green, reason = EXCLUDED.reason, n_samples = EXCLUDED.n_samples,
    lap_length_m = EXCLUDED.lap_length_m, max_gap_s = EXCLUDED.max_gap_s,
    neutralised = EXCLUDED.neutralised, pit = EXCLUDED.pit,
    out_lap = EXCLUDED.out_lap, no_start = EXCLUDED.no_start,
    boundary_source = EXCLUDED.boundary_source
"""


def align_driver(car: pd.DataFrame, laps: pd.DataFrame, windows, session_start_ns, is_race_like):
    """Run the full alignment for one driver.

    Returns ``(bounds, quality, ts_ns, lap_idx, dist, reason)`` where the last
    four are per-sample arrays aligned with ``car``.
    """
    ts_ns = al.to_ns(car["ts"]) if len(car) else np.empty(0, dtype=np.int64)
    first = int(ts_ns[0]) if len(ts_ns) else None
    bounds = al.resolve_lap_bounds(laps, session_start_ns, first)
    lap_idx, reason = al.assign_samples(ts_ns, bounds)
    if len(ts_ns):
        dist, stats = al.lap_distance(ts_ns, car["speed"].to_numpy(dtype=float), lap_idx, bounds)
    else:
        dist, stats = np.empty(0), pd.DataFrame({"n_samples": np.zeros(len(bounds), dtype=int),
                                                 "lap_length_m": np.nan, "max_gap_s": np.nan})
    quality = al.classify_laps(bounds, stats, windows, is_race_like)
    return bounds, quality, ts_ns, lap_idx, dist, reason


def _run(conn: psycopg.Connection, session_key: int, line=None) -> tuple[dict, pd.DataFrame]:
    """One alignment pass over a session.

    ``line`` is None for lap-table boundaries, or ``(P, u, source)`` to derive
    each driver's boundaries from start/finish-line crossings in ``location``
    (drivers whose crossing count does not match their lap rows keep the lap table).
    """
    info = db.session_info(conn, session_key)
    is_race_like = info["session_name"] in ("Race", "Sprint")
    start = info["date_start"]
    session_start_ns = int(al.to_ns([start])[0]) if start is not None else None
    all_laps = db.session_laps(conn, session_key)
    windows, n_unclosed = al.neutral_windows(db.session_race_control(conn, session_key))
    tele = db.telemetry_drivers(conn, session_key)
    lap_drivers = sorted(all_laps["driver_number"].unique().tolist())

    n_samples = no_lap = no_lap_moving = n_moving = 0
    n_tele_drivers = 0
    no_lap_reasons: Counter = Counter()
    lap_reasons: Counter = Counter()
    dts: list[np.ndarray] = []
    max_gap = 0.0
    n_laps = n_green = n_neutral = 0
    ratio_sum = {"loc": 0.0, "spd": 0.0, "laps": 0, "loc_n": 0, "car_n": 0}
    per_driver_ratio: dict[int, float] = {}
    rows = []

    for d in tele:
        laps = all_laps[all_laps["driver_number"] == d]
        if laps.empty:
            # Telemetry for a driver with no lap rows: every sample is unassigned.
            car = db.driver_car_data(conn, session_key, d)
            n_samples += len(car)
            no_lap += len(car)
            mv = int((car["speed"].to_numpy(dtype=float) > MOVING_KPH).sum())
            no_lap_moving += mv
            n_moving += mv
            no_lap_reasons["driver_without_laps"] += len(car)
            continue
        car = db.driver_car_data(conn, session_key, d)
        loc = db.driver_location(conn, session_key, d)
        source = "laps"
        if line is not None and len(loc):
            tl = al.telemetry_laps(laps, al.detect_crossings(al.to_ns(loc["ts"]), loc["x"].to_numpy(dtype=float),
                                                             loc["y"].to_numpy(dtype=float), line[0], line[1]))
            if tl is not None:
                laps, source = tl, "telemetry"
                n_tele_drivers += 1
        bounds, q, ts_ns, lap_idx, dist, reason = align_driver(car, laps, windows, session_start_ns, is_race_like)
        n_samples += len(car)
        no_lap += int((lap_idx < 0).sum())
        mov = car['speed'].to_numpy(dtype=float) > MOVING_KPH
        no_lap_moving += int(((lap_idx < 0) & mov).sum())
        n_moving += int(mov.sum())
        no_lap_reasons.update(Counter(reason[lap_idx < 0].tolist()))
        if len(ts_ns) > 1:
            dt = np.diff(ts_ns) * 1e-9
            dts.append(dt.astype(np.float32))
            max_gap = max(max_gap, float(dt.max()))
        n_laps += len(q)
        n_green += int(q["green"].sum())
        n_neutral += int(q["neutralised"].sum())
        lap_reasons.update(Counter(q.loc[~q["green"], "reason"].tolist()))
        q["boundary_source"] = source
        q.insert(0, "driver_number", d)
        q.insert(0, "session_key", session_key)
        rows.append(q)
        if len(loc):
            x = al.to_ns(loc["ts"])
            r = al.location_crosscheck(x, loc["x"].to_numpy(dtype=float), loc["y"].to_numpy(dtype=float), bounds, q)
            ratio_sum["loc"] += r["loc_len_m"]
            ratio_sum["spd"] += r["speed_len_m"]
            ratio_sum["laps"] += r["laps_used"]
            ratio_sum["loc_n"] += r["loc_samples"]
            ratio_sum["car_n"] += r["car_samples"]
            if r["speed_len_m"] > 0:
                per_driver_ratio[d] = r["loc_len_m"] / r["speed_len_m"]
        else:
            ratio_sum["car_n"] += int(q["n_samples"].sum())

    if rows:
        allq = pd.concat(rows, ignore_index=True)
        lengths = allq.loc[allq["green"], "lap_length_m"]
    else:
        allq = pd.DataFrame()
        lengths = pd.Series(dtype=float)
    dt_all = np.concatenate(dts) if dts else np.empty(0, dtype=np.float32)
    rate = 1.0 / dt_all[dt_all > 0] if len(dt_all) else np.empty(0)
    ratio = float(np.median(list(per_driver_ratio.values()))) if per_driver_ratio else None
    cov = (ratio_sum["loc_n"] / ratio_sum["car_n"]) if ratio_sum["car_n"] else None
    report = {
        "session_key": session_key, "circuit": info["circuit_short_name"], "session_name": info["session_name"],
        "n_drivers": len(rows), "drivers_without_car_data": sorted(set(lap_drivers) - set(tele)),
        "drivers_without_laps": sorted(set(tele) - set(lap_drivers)),
        "n_laps": n_laps, "green_laps": n_green,
        "green_fraction": n_green / n_laps if n_laps else None,
        "non_green_reasons": dict(lap_reasons),
        "neutralised_laps": n_neutral, "neutral_windows": len(windows), "neutral_windows_unclosed": n_unclosed,
        "n_samples": n_samples, "samples_no_lap": no_lap,
        "samples_no_lap_fraction": no_lap / n_samples if n_samples else None,
        "samples_no_lap_moving": no_lap_moving,
        "samples_moving": n_moving,
        "samples_no_lap_moving_fraction": no_lap_moving / n_moving if n_moving else None,
        "boundary_source": "telemetry" if n_tele_drivers else "laps", "telemetry_drivers": n_tele_drivers,
        "line_reference_session": line[2] if line is not None else None,
        "samples_no_lap_reasons": dict(no_lap_reasons),
        "sample_rate_hz": {k: float(v) for k, v in zip(("median", "p10", "p90"),
                           np.percentile(rate, [50, 10, 90]))} if len(rate) else None,
        "max_gap_s": max_gap,
        "location_coverage": cov, "location_speed_ratio": ratio,
        "location_speed_ratio_laps": ratio_sum["laps"],
        "green_lap_length_m": {"median": float(lengths.median()), "std": float(lengths.std())} if len(lengths) > 1 else None,
    }
    flags = []
    if ratio is not None and abs(ratio - 1) > RATIO_TOLERANCE:
        flags.append(f"location/speed path-length ratio {ratio:.3f} outside +-{RATIO_TOLERANCE:.0%}")
    if ratio is None:
        flags.append("no location cross-check possible")
    if cov is not None and cov < al.LOC_MIN_COVERAGE:
        flags.append(f"location coverage {cov:.2f} of car_data samples")
    mf = report["samples_no_lap_moving_fraction"]
    if mf and mf > NO_LAP_TOLERANCE:
        flags.append(f"{mf:.1%} of moving samples (> {MOVING_KPH} km/h) have no lap")
    n_len = lap_reasons.get("length", 0)
    if n_len and n_len / (n_len + n_green) > LENGTH_EXCLUDED_TOLERANCE:
        flags.append(f"{n_len} of {n_len + n_green} otherwise-green laps have an inconsistent length "
                     "(telemetry window does not match the lap window)")
    report["flags"] = flags
    return report, allq


_LINE_CACHE: dict[int, tuple | None] = {}


def reference_line(conn: psycopg.Connection, circuit_key: int, session_key: int):
    """Start/finish line (P, u, source_session) for a circuit, from trusted lap starts.

    Candidates are the other sessions on the circuit (qualifying first), then the
    session itself. The first one whose lap-start positions cluster within
    LINE_MAX_SPREAD_DM is used; a session with a wandering lap clock does not.
    Lap starts are those of non-out laps from lap 2 on, positioned from
    ``location``. Returns None when no candidate qualifies.
    """
    if circuit_key not in _LINE_CACHE:
        ss = db.sessions(conn)
        same = ss[ss["circuit_key"] == circuit_key]
        order = sorted(same["session_key"], key=lambda k: (same.set_index("session_key").loc[k, "session_name"] != "Qualifying", k))
        _LINE_CACHE[circuit_key] = {k: _line_from_session(conn, k) for k in order}
    cands = _LINE_CACHE[circuit_key]
    for k, ref in cands.items():
        if k != session_key and ref is not None:
            return ref
    return cands.get(session_key)


def _line_from_session(conn: psycopg.Connection, session_key: int):
    laps = db.session_laps(conn, session_key)
    if laps.empty:
        return None
    pts, hdg = [], []
    for d, g in laps.groupby("driver_number"):
        loc = db.driver_location(conn, session_key, d)
        g = g[(g["lap_number"] >= 2) & ~g["is_pit_out_lap"].fillna(False).astype(bool) & g["date_start"].notna()]
        if len(loc) < 100 or g.empty:
            continue
        t, x, y = al.to_ns(loc["ts"]), loc["x"].to_numpy(dtype=float), loc["y"].to_numpy(dtype=float)
        st = al.to_ns(g["date_start"])
        x0, y0 = al.locate_at(t, x, y, st)
        x1, y1 = al.locate_at(t, x, y, st + 1_000_000_000)
        xm, ym = al.locate_at(t, x, y, st - 1_000_000_000)
        pts.append(np.column_stack([x0, y0]))
        hdg.append(np.column_stack([x1 - xm, y1 - ym]))
    if not pts:
        return None
    ref = al.line_reference(np.vstack(pts), np.vstack(hdg))
    if ref is None or ref[2] > al.LINE_MAX_SPREAD_DM:
        return None
    return ref[0], ref[1], session_key


def process_session(conn: psycopg.Connection, session_key: int, write: bool = True) -> dict:
    """Align a session with the lap table; switch to telemetry boundaries when that fails.

    The lap-table pass is judged by the location/speed ratio and the share of
    laps removed by the length rule. If either fails (ratio off by more than
    RATIO_TOLERANCE, or more than LENGTH_TRIGGER of the candidate laps), the
    session is re-run with boundaries from start/finish-line crossings, and the
    telemetry result replaces it only if it yields more green laps. The report keeps the lap-table numbers under
    ``lap_table_pass``.
    """
    rep, allq = _run(conn, session_key)
    n_len = rep["non_green_reasons"].get("length", 0)
    ratio = rep["location_speed_ratio"]
    bad = (ratio is not None and abs(ratio - 1) > RATIO_TOLERANCE) or \
          (n_len and n_len / (n_len + rep["green_laps"]) > LENGTH_TRIGGER)
    if bad:
        info = db.session_info(conn, session_key)
        line = reference_line(conn, info["circuit_key"], session_key)
        if line is not None:
            rep2, allq2 = _run(conn, session_key, line)
            # Keep the telemetry result only when it recovers laps; otherwise the
            # lap table is not the cause and its numbers stand.
            rep["telemetry_pass"] = {"green_laps": rep2["green_laps"], "telemetry_drivers": rep2["telemetry_drivers"],
                                     "line_reference_session": line[2]}
            if rep2["telemetry_drivers"] and rep2["green_laps"] > rep["green_laps"]:
                rep2["lap_table_pass"] = {"green_laps": rep["green_laps"], "n_laps": rep["n_laps"],
                                          "length_excluded": n_len, "location_speed_ratio": ratio}
                rep, allq = rep2, allq2
        else:
            rep["flags"].append("lap-table pass failed and no start/finish reference line is available")
    if write and len(allq):
        recs = allq.astype(object).where(allq.notna(), None).to_dict("records")
        with conn.cursor() as cur:
            cur.executemany(_UPSERT, recs)
        conn.commit()
    return rep


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--session", type=int)
    g.add_argument("--all", action="store_true")
    ap.add_argument("--no-write", action="store_true", help="do not upsert lap_quality")
    args = ap.parse_args()
    with db.connect() as conn:
        if args.session:
            print(json.dumps(process_session(conn, args.session, not args.no_write), indent=2, default=str))
            return
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        for s in db.sessions(conn)["session_key"]:
            rep = process_session(conn, int(s), not args.no_write)
            (OUT_DIR / f"{s}.json").write_text(json.dumps(rep, indent=2, default=str))
            gf = rep["green_fraction"]
            print(f"{s} {rep['circuit']:<18} {rep['session_name']:<17} drivers={rep['n_drivers']:>2} "
                  f"laps={rep['n_laps']:>4} green={gf if gf is None else round(gf, 3)} "
                  f"src={rep['boundary_source']} "
                  f"nolap={rep['samples_no_lap_fraction'] if rep['samples_no_lap_fraction'] is None else round(rep['samples_no_lap_fraction'], 3)} "
                  f"moving={rep['samples_no_lap_moving_fraction'] if rep['samples_no_lap_moving_fraction'] is None else round(rep['samples_no_lap_moving_fraction'], 3)} "
                  f"ratio={rep['location_speed_ratio'] if rep['location_speed_ratio'] is None else round(rep['location_speed_ratio'], 3)} "
                  f"{'FLAG ' + '; '.join(rep['flags']) if rep['flags'] else ''}", flush=True)


if __name__ == "__main__":
    main()
