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

import psycopg

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
    out = []
    for label, start, end in sections:
        if label == "Straight":
            out.append((len(out) + 1, float(start), float(end), label))
    return out


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
    nominal track length. Empty when the circuit has no sections file.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT s.straight_id, s.start_pct, s.end_pct FROM straight s "
                    "JOIN session x ON x.circuit_key = s.circuit_key "
                    "WHERE x.session_key = %s ORDER BY s.straight_id", (session_key,))
        return [(sid, a / 100.0 * lap_length_m, b / 100.0 * lap_length_m) for sid, a, b in cur.fetchall()]


if __name__ == "__main__":
    with db.connect() as c:
        for circuit, n in load(c).items():
            print(f"{circuit}: {n} straights")
        print("no sections file:", ", ".join(CIRCUITS_WITHOUT_SECTIONS))
