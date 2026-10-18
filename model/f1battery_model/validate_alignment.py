"""Phase 2 validation: reproduce the spike's Monza lap length and straight window.

    python -m f1battery_model.validate_alignment [--session 11361 --driver 63]
"""
from __future__ import annotations

import argparse

import numpy as np

from . import alignment as al
from . import db, quality, straights


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", type=int, default=11361)
    ap.add_argument("--driver", type=int, default=63)
    a = ap.parse_args()
    with db.connect() as conn:
        info = db.session_info(conn, a.session)
        laps = db.session_laps(conn, a.session)
        laps = laps[laps["driver_number"] == a.driver]
        windows, _ = al.neutral_windows(db.session_race_control(conn, a.session))
        car = db.driver_car_data(conn, a.session, a.driver)
        start_ns = int(al.to_ns([info["date_start"]])[0])
        bounds, q, ts, idx, dist, _ = quality.align_driver(
            car, laps, windows, start_ns, info["session_name"] in ("Race", "Sprint"))
        g = q[q["green"]]
        print(f"session {a.session} driver {a.driver}: {len(g)} green laps of {len(q)}")
        full = g["lap_length_m"].to_numpy()
        print(f"lap length (full lap, start to end): median {np.median(full):.1f} m  std {full.std():.1f} m")
        # Spike convention: distance accumulated up to the last sample of the lap.
        last = [dist[(idx == i)][-1] for i in g.index if (idx == i).any()]
        print(f"lap length (to last sample, spike convention): median {np.median(last):.1f} m  std {np.std(last):.1f} m")
        L = float(np.median(full))
        for sid, s, e in straights.straight_windows(conn, a.session, L):
            print(f"straight {sid}: {s:7.0f} - {e:7.0f} m")


if __name__ == "__main__":
    main()
