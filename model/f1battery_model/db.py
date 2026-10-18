"""Database access for the model: connection from DB_URL and per-driver readers.

Telemetry is read one driver at a time so peak memory stays bounded by a single
driver's samples (roughly 30-60k rows per session) instead of a whole session.
"""
from __future__ import annotations

import os
import re
from urllib.parse import quote

import pandas as pd
import psycopg

DEFAULT_URL = "postgresql://localhost:55432/f1battery"
# Development credentials of the docker-compose database; overridable.
DEFAULT_USER = "f1"
DEFAULT_PASSWORD = "f1dev"


def normalise_url(url: str | None) -> str:
    """Turn a JDBC or plain Postgres URL into a libpq connection URI.

    The ingest module is configured with ``jdbc:postgresql://host:port/db``;
    the same DB_URL value is accepted here. Credentials come from DB_USER and
    DB_PASSWORD (defaults match docker-compose.yml) unless the URL embeds them.
    """
    url = url or DEFAULT_URL
    url = re.sub(r"^jdbc:", "", url)
    url = re.sub(r"^postgres://", "postgresql://", url)
    m = re.match(r"^postgresql://(?P<rest>[^/]*)(?P<path>/.*)?$", url)
    if not m:
        raise ValueError(f"unsupported DB_URL: {url!r}")
    rest = m.group("rest")
    if "@" not in rest:
        user = os.environ.get("DB_USER", DEFAULT_USER)
        pw = os.environ.get("DB_PASSWORD", DEFAULT_PASSWORD)
        rest = f"{quote(user)}:{quote(pw)}@{rest}"
    return f"postgresql://{rest}{m.group('path') or ''}"


def connect(url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(normalise_url(url or os.environ.get("DB_URL")))


def _frame(cur: psycopg.Cursor) -> pd.DataFrame:
    cols = [d.name for d in cur.description]
    return pd.DataFrame(cur.fetchall(), columns=cols)


def sessions(conn: psycopg.Connection) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute("SELECT session_key, circuit_key, circuit_short_name, session_name, session_type, "
                    "date_start, date_end FROM session ORDER BY session_key")
        return _frame(cur)


def session_info(conn: psycopg.Connection, session_key: int) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT session_key, circuit_key, circuit_short_name, session_name, session_type, "
                    "date_start, date_end FROM session WHERE session_key = %s", (session_key,))
        row = cur.fetchone()
        if row is None:
            raise KeyError(f"unknown session {session_key}")
        return dict(zip([d.name for d in cur.description], row))


def session_laps(conn: psycopg.Connection, session_key: int) -> pd.DataFrame:
    """All laps of a session, every driver, ordered by driver and lap number."""
    with conn.cursor() as cur:
        cur.execute("SELECT driver_number, lap_number, date_start, lap_duration, is_pit_out_lap "
                    "FROM lap WHERE session_key = %s ORDER BY driver_number, lap_number", (session_key,))
        return _frame(cur)


def session_race_control(conn: psycopg.Connection, session_key: int) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute("SELECT date, category, flag, message FROM race_control "
                    "WHERE session_key = %s ORDER BY date", (session_key,))
        return _frame(cur)


def telemetry_drivers(conn: psycopg.Connection, session_key: int) -> list[int]:
    """Drivers that have car_data rows in the session."""
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT driver_number FROM car_data WHERE session_key = %s "
                    "ORDER BY driver_number", (session_key,))
        return [r[0] for r in cur.fetchall()]


def driver_car_data(conn: psycopg.Connection, session_key: int, driver: int) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute("SELECT ts, speed, throttle, brake, rpm, n_gear FROM car_data "
                    "WHERE session_key = %s AND driver_number = %s ORDER BY ts", (session_key, driver))
        return _frame(cur)


def driver_location(conn: psycopg.Connection, session_key: int, driver: int) -> pd.DataFrame:
    with conn.cursor() as cur:
        cur.execute("SELECT ts, x, y, z FROM location "
                    "WHERE session_key = %s AND driver_number = %s ORDER BY ts", (session_key, driver))
        return _frame(cur)
