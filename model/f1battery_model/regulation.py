"""Load docs/regulation-events.csv into ``regulation_event`` (upsert).

The CSV is the curated source (values and issue numbers cited in
docs/regulations.md); empty cells become NULL and ``limit_known`` is taken from
the file, never inferred.
"""
from __future__ import annotations

import csv
from pathlib import Path

import psycopg

from . import db

REPO_ROOT = Path(__file__).resolve().parents[2]
CSV_PATH = REPO_ROOT / "docs" / "regulation-events.csv"

_UPSERT = """
INSERT INTO regulation_event
    (session_key, issue_in_force, race_recharge_mj, quali_recharge_mj, derate_rate_kw_per_s, limit_known)
VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT (session_key) DO UPDATE SET
    issue_in_force = EXCLUDED.issue_in_force,
    race_recharge_mj = EXCLUDED.race_recharge_mj,
    quali_recharge_mj = EXCLUDED.quali_recharge_mj,
    derate_rate_kw_per_s = EXCLUDED.derate_rate_kw_per_s,
    limit_known = EXCLUDED.limit_known
"""


def _num(cell: str, cast):
    cell = (cell or "").strip()
    return cast(cell) if cell else None


def read_rows(path: Path = CSV_PATH) -> list[tuple]:
    rows = []
    with open(path, newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append((
                int(r["session_key"]), int(r["issue_in_force"]),
                _num(r["race_recharge_mj"], str), _num(r["quali_recharge_mj"], str),
                _num(r["derate_rate_kw_per_s"], int),
                r["limit_known"].strip().lower() == "true",
            ))
    return rows


def load(conn: psycopg.Connection, path: Path = CSV_PATH) -> int:
    rows = read_rows(path)
    with conn.cursor() as cur:
        cur.executemany(_UPSERT, rows)
    conn.commit()
    return len(rows)


if __name__ == "__main__":
    with db.connect() as c:
        print(f"regulation_event: {load(c)} rows upserted")
