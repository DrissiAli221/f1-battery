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
MOVING_KPH = 10              # a sample above this speed counts as the car moving
NO_LAP_TOLERANCE = 0.05      # share of samples without a lap above this flags the session

_UPSERT = """
INSERT INTO lap_quality (session_key, driver_number, lap_number, green, reason, n_samples,
                         lap_length_m, max_gap_s, neutralised, pit, out_lap, no_start)
VALUES (%(session_key)s, %(driver_number)s, %(lap_number)s, %(green)s, %(reason)s, %(n_samples)s,
        %(lap_length_m)s, %(max_gap_s)s, %(neutralised)s, %(pit)s, %(out_lap)s, %(no_start)s)
ON CONFLICT (session_key, driver_number, lap_number) DO UPDATE SET
    green = EXCLUDED.green, reason = EXCLUDED.reason, n_samples = EXCLUDED.n_samples,
    lap_length_m = EXCLUDED.lap_length_m, max_gap_s = EXCLUDED.max_gap_s,
    neutralised = EXCLUDED.neutralised, pit = EXCLUDED.pit,
    out_lap = EXCLUDED.out_lap, no_start = EXCLUDED.no_start
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


def process_session(conn: psycopg.Connection, session_key: int, write: bool = True) -> dict:
    info = db.session_info(conn, session_key)
    is_race_like = info["session_name"] in ("Race", "Sprint")
    start = info["date_start"]
    session_start_ns = int(al.to_ns([start])[0]) if start is not None else None
    all_laps = db.session_laps(conn, session_key)
    windows, n_unclosed = al.neutral_windows(db.session_race_control(conn, session_key))
    tele = db.telemetry_drivers(conn, session_key)
    lap_drivers = sorted(all_laps["driver_number"].unique().tolist())

    n_samples = no_lap = no_lap_moving = 0
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
            no_lap_moving += int((car["speed"].to_numpy(dtype=float) > MOVING_KPH).sum())
            no_lap_reasons["driver_without_laps"] += len(car)
            continue
        car = db.driver_car_data(conn, session_key, d)
        bounds, q, ts_ns, lap_idx, dist, reason = align_driver(car, laps, windows, session_start_ns, is_race_like)
        n_samples += len(car)
        no_lap += int((lap_idx < 0).sum())
        no_lap_moving += int(((lap_idx < 0) & (car['speed'].to_numpy(dtype=float) > MOVING_KPH)).sum())
        no_lap_reasons.update(Counter(reason[lap_idx < 0].tolist()))
        if len(ts_ns) > 1:
            dt = np.diff(ts_ns) * 1e-9
            dts.append(dt.astype(np.float32))
            max_gap = max(max_gap, float(dt.max()))
        n_laps += len(q)
        n_green += int(q["green"].sum())
        n_neutral += int(q["neutralised"].sum())
        lap_reasons.update(Counter(q.loc[~q["green"], "reason"].tolist()))
        q.insert(0, "driver_number", d)
        q.insert(0, "session_key", session_key)
        rows.append(q)
        loc = db.driver_location(conn, session_key, d)
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
        if write:
            recs = allq.astype(object).where(allq.notna(), None).to_dict("records")
            with conn.cursor() as cur:
                cur.executemany(_UPSERT, recs)
            conn.commit()
        lengths = allq.loc[allq["green"], "lap_length_m"]
    else:
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
        "samples_no_lap_moving_fraction": no_lap_moving / n_samples if n_samples else None,
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
    if report["samples_no_lap_fraction"] and report["samples_no_lap_fraction"] > NO_LAP_TOLERANCE:
        flags.append(f"{report['samples_no_lap_fraction']:.1%} of samples have no lap")
    n_len = lap_reasons.get("length", 0)
    if n_len and n_len / (n_len + n_green) > LENGTH_EXCLUDED_TOLERANCE:
        flags.append(f"{n_len} of {n_len + n_green} otherwise-green laps have an inconsistent length "
                     "(telemetry window does not match the lap window)")
    report["flags"] = flags
    return report


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
                  f"nolap={rep['samples_no_lap_fraction'] if rep['samples_no_lap_fraction'] is None else round(rep['samples_no_lap_fraction'], 3)} "
                  f"moving={rep['samples_no_lap_moving_fraction'] if rep['samples_no_lap_moving_fraction'] is None else round(rep['samples_no_lap_moving_fraction'], 3)} "
                  f"ratio={rep['location_speed_ratio'] if rep['location_speed_ratio'] is None else round(rep['location_speed_ratio'], 3)} "
                  f"{'FLAG ' + '; '.join(rep['flags']) if rep['flags'] else ''}", flush=True)


if __name__ == "__main__":
    main()
