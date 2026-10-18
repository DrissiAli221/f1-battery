"""Straight sections per circuit from the curated TracingInsights files.

Each file is a list of ``[label, start_pct, end_pct]``; the sections labelled
"Straight" are numbered 1..n in file order and stored in ``straight`` keyed by
OpenF1 ``circuit_key``. Percentages are fractions of the lap (0-100) measured
from the start/finish line, the same origin as the integrated lap distance.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg

from . import alignment as al
from . import db

REPO_ROOT = Path(__file__).resolve().parents[2]
SECTIONS_DIR = Path(os.environ.get("F1B_SECTIONS_DIR",
                                   REPO_ROOT / "data" / "reference" / "tracinginsights" / "sections"))

# TracingInsights file stem -> OpenF1 circuit_short_name (session.circuit_short_name).
SECTION_FILE_TO_CIRCUIT = {
    "albert-park-circuit": "Melbourne",
    "bahrain-international-circuit": "Sakhir",
    "jeddah-corniche-circuit": "Jeddah",
    "miami-international-autodrome": "Miami",
    "canada": "Montreal",
    "circuit-de-monaco": "Monte Carlo",
    "circuit-de-barcelona-catalunya": "Catalunya",
    "red-bull-ring": "Spielberg",
    "silverstone": "Silverstone",
    "circuit-de-spa-francorchamps": "Spa-Francorchamps",
    "hungary": "Hungaroring",
    "circuit-zandvoort": "Zandvoort",
    "monza": "Monza",
    "baku-city-circuit": "Baku",
    "marina-bay-street-circuit": "Singapore",
}
# Files present but for circuits that are not on the 2026 session table.
UNUSED_SECTION_FILES = [
    "autodrome-hermanos-rodriguez", "circuit-of-the-americas", "emilia",
    "interlagos-circuit", "lusail-international-circuit", "yas-marina-circuit",
]
# 2026 circuits (OpenF1 circuit_short_name) without a sections file.
CIRCUITS_WITHOUT_SECTIONS = ["Shanghai", "Suzuka", "Madring", "Kuala Lumpur"]


def parse_sections(path: Path) -> list[tuple[int, float, float, str]]:
    """Straight sections of one file as ``(straight_id, start_pct, end_pct, label)``."""
    with open(path) as fh:
        sections = json.load(fh)
    runs = [(float(a), float(b)) for label, a, b in sections if label == "Straight"]
    return _number(_merge_wrap(runs, 0.0, 100.0), "Straight")


def _merge_wrap(runs: list[tuple[float, float]], lo: float, hi: float, eps: float = 0.01):
    """Join a straight ending at ``hi`` with one starting at ``lo`` into one wrapping entry.

    The merged entry has start_pct > end_pct (it crosses the start/finish line)
    and is placed first; the other straights keep their order.
    """
    if len(runs) >= 2 and runs[0][0] <= lo + eps and runs[-1][1] >= hi - eps:
        return [(runs[-1][0], runs[0][1])] + runs[1:-1]
    return runs


def _number(runs, label):
    return [(i + 1, a, b, label) for i, (a, b) in enumerate(runs)]


DERIVE_MIN_KPH = 200
DERIVE_MIN_THROTTLE = 98
DERIVE_MIN_S = 4.0


def derive_straights(conn: psycopg.Connection, circuit_key: int):
    """Straights from the circuit's fastest green lap: full-throttle runs of >= 4 s above 200 km/h.

    The reference lap is the fastest green lap in ``lap_quality`` over all
    sessions of the circuit. Positions are percent of that lap's integrated
    length. A run that is already on at the lap start and one still on at the lap
    end are one straight crossing the line (start_pct > end_pct); the 4 s test
    applies to their combined duration. Returns ``(rows, reference)`` where
    reference is ``(session_key, driver_number, lap_number)``, or ``(None, None)``.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT q.session_key, q.driver_number, q.lap_number, l.date_start, l.lap_duration, q.lap_length_m "
                    "FROM lap_quality q JOIN lap l USING (session_key, driver_number, lap_number) "
                    "JOIN session s USING (session_key) "
                    "WHERE s.circuit_key = %s AND q.green AND l.lap_duration IS NOT NULL "
                    "ORDER BY l.lap_duration LIMIT 1", (circuit_key,))
        row = cur.fetchone()
    if row is None:
        return None, None
    sk, drv, lap, start, dur, length = row
    end = start + pd.Timedelta(seconds=dur)
    with conn.cursor() as cur:
        cur.execute("SELECT ts, speed, throttle FROM car_data WHERE session_key = %s AND driver_number = %s "
                    "AND ts >= %s AND ts < %s ORDER BY ts", (sk, drv, start, end))
        car = pd.DataFrame(cur.fetchall(), columns=["ts", "speed", "throttle"])
    ts = al.to_ns(car["ts"])
    bounds = pd.DataFrame({"start_ns": [int(al.to_ns([start])[0])], "end_ns": [int(al.to_ns([end])[0])],
                           "resolved": [True]})
    dist, _ = al.lap_distance(ts, car["speed"].to_numpy(dtype=float), np.zeros(len(car), dtype=np.int64), bounds)
    t = (ts - ts[0]) * 1e-9
    on = ((car["throttle"].to_numpy(dtype=float) >= DERIVE_MIN_THROTTLE)
          & (car["speed"].to_numpy(dtype=float) > DERIVE_MIN_KPH))
    edges = np.flatnonzero(np.diff(np.concatenate([[0], on.astype(int), [0]])))
    runs = list(zip(edges[::2], edges[1::2] - 1))          # inclusive sample index ranges
    wrap = None
    if len(runs) >= 2 and runs[0][0] == 0 and runs[-1][1] == len(on) - 1:
        wrap = (runs[-1], runs[0])
        runs = runs[1:-1]
    out = []
    if wrap:
        d = (t[wrap[1][1]] - t[wrap[1][0]]) + (t[wrap[0][1]] - t[wrap[0][0]])
        if d >= DERIVE_MIN_S:
            out.append((dist[wrap[0][0]] / length * 100, dist[wrap[1][1]] / length * 100))
    for a, b in runs:
        if t[b] - t[a] >= DERIVE_MIN_S:
            out.append((dist[a] / length * 100, dist[b] / length * 100))
    return _number([(round(a, 2), round(b, 2)) for a, b in out], "derived"), (sk, drv, lap)


def derive_missing(conn: psycopg.Connection) -> dict[str, tuple]:
    """Fill ``straight`` for the circuits without a sections file; returns circuit -> (n, reference lap)."""
    done = {}
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT circuit_short_name, circuit_key FROM session")
        keys = dict(cur.fetchall())
    for circuit in CIRCUITS_WITHOUT_SECTIONS:
        rows, ref = derive_straights(conn, keys[circuit])
        if rows is None:
            continue
        with conn.cursor() as cur:
            cur.execute("DELETE FROM straight WHERE circuit_key = %s", (keys[circuit],))
            cur.executemany("INSERT INTO straight (circuit_key, straight_id, start_pct, end_pct, label) "
                            "VALUES (%s, %s, %s, %s, %s)", [(keys[circuit], *r) for r in rows])
        done[circuit] = (len(rows), ref)
    conn.commit()
    return done


def load(conn: psycopg.Connection, sections_dir: Path = SECTIONS_DIR) -> dict[str, int]:
    """Upsert the straights of every mapped circuit; returns circuit -> straight count."""
    counts = {}
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT circuit_short_name, circuit_key FROM session")
        keys = dict(cur.fetchall())
        for stem, circuit in SECTION_FILE_TO_CIRCUIT.items():
            if circuit not in keys:
                continue
            rows = parse_sections(sections_dir / f"{stem}.json")
            cur.execute("DELETE FROM straight WHERE circuit_key = %s", (keys[circuit],))
            cur.executemany(
                "INSERT INTO straight (circuit_key, straight_id, start_pct, end_pct, label) "
                "VALUES (%s, %s, %s, %s, %s)",
                [(keys[circuit], sid, a, b, lab) for sid, a, b, lab in rows])
            counts[circuit] = len(rows)
    conn.commit()
    return counts


def straight_windows(conn: psycopg.Connection, session_key: int,
                     lap_length_m: float) -> list[tuple[int, float, float]]:
    """Absolute lap-distance windows ``(straight_id, start_m, end_m)`` for a session's circuit.

    The percentages are scaled by the lap length measured for the same car and
    lap, so the windows follow that lap's integrated distance rather than the
    nominal track length. A straight crossing the start/finish line (start_pct >
    end_pct) gets ``end_m`` beyond the lap length (end_m - lap_length_m is where it
    ends after the line); use ``window_mask`` to test distances against it.
    Empty when the circuit has no straights.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT s.straight_id, s.start_pct, s.end_pct FROM straight s "
                    "JOIN session x ON x.circuit_key = s.circuit_key "
                    "WHERE x.session_key = %s ORDER BY s.straight_id", (session_key,))
        return [(sid, a / 100.0 * lap_length_m, (b + (100.0 if b < a else 0.0)) / 100.0 * lap_length_m)
                for sid, a, b in cur.fetchall()]


def window_mask(dist_m: np.ndarray, start_m: float, end_m: float, lap_length_m: float) -> np.ndarray:
    """Samples whose lap distance lies in a window from ``straight_windows`` (wrap-aware)."""
    d = np.asarray(dist_m, dtype=float)
    if end_m <= lap_length_m:
        return (d >= start_m) & (d <= end_m)
    return (d >= start_m) | (d <= end_m - lap_length_m)


if __name__ == "__main__":
    with db.connect() as c:
        for circuit, n in load(c).items():
            print(f"{circuit}: {n} straights")
        for circuit, (n, ref) in derive_missing(c).items():
            print(f"{circuit}: {n} derived straights from session/driver/lap {ref}")
