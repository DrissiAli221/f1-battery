"""model_run lifecycle and exit code of the estimator CLI.

The lifecycle tests run against the real database but inside a throw-away schema
that holds its own ``model_run`` and ``model_result`` tables, the only entry on the
search_path (public is excluded, so real tables are unreachable); nothing in the real schema is read or written. ``run_session`` and
the session discovery are replaced by stubs, so no telemetry is processed.
"""
from __future__ import annotations

import uuid

import pytest

from f1battery_model import db, estimate

MODEL_RUN_DDL = """
CREATE TABLE model_run (model_version text NOT NULL, run_id uuid NOT NULL, started_at timestamptz NOT NULL,
    finished_at timestamptz, published boolean NOT NULL DEFAULT false, sessions_done int, note text,
    PRIMARY KEY (model_version, run_id))
"""
MODEL_RESULT_DDL = """
CREATE TABLE model_result (model_version text, run_id uuid, session_key int, created_at timestamptz DEFAULT now())
"""


def args(*argv):
    return estimate.parse_args(list(argv))


@pytest.fixture
def conn():
    try:
        c = db.connect()
    except Exception as e:  # database not reachable: skip rather than fail
        pytest.skip(f"database unavailable: {e}")
    schema = "t_" + uuid.uuid4().hex[:12]
    with c.cursor() as cur:
        cur.execute(f"CREATE SCHEMA {schema}")
        cur.execute(f"SET search_path TO {schema}")
        cur.execute(MODEL_RUN_DDL)
        cur.execute(MODEL_RESULT_DDL)
    c.commit()
    yield c
    c.rollback()
    with c.cursor() as cur:
        cur.execute(f"DROP SCHEMA {schema} CASCADE")
    c.commit()
    c.close()


def row(conn, run_id):
    with conn.cursor() as cur:
        cur.execute("SELECT published, sessions_done, finished_at IS NOT NULL, started_at IS NOT NULL, note "
                    "FROM model_run WHERE run_id = %s::uuid", (run_id,))
        return cur.fetchone()


def stub(monkeypatch, sessions, failing=()):
    monkeypatch.setattr(estimate, "green_sessions", lambda c: list(sessions))

    def fake(conn, sk, run_id, log=print):
        if sk in failing:
            raise RuntimeError("boom")
        return 10
    monkeypatch.setattr(estimate, "run_session", fake)


@pytest.mark.db
def test_all_run_is_published_when_clean(conn, monkeypatch):
    stub(monkeypatch, [1, 2, 3])
    rid = str(uuid.uuid4())
    assert estimate.execute(conn, args("--all", "--run-id", rid), log=lambda *_: None) == 0
    assert row(conn, rid) == (True, 3, True, True, "--all")


@pytest.mark.db
def test_failed_session_blocks_publication_and_exit_code(conn, monkeypatch):
    stub(monkeypatch, [1, 2, 3], failing={2})
    rid = str(uuid.uuid4())
    assert estimate.execute(conn, args("--all", "--run-id", rid), log=lambda *_: None) == 1
    assert row(conn, rid)[:3] == (False, 2, True)


@pytest.mark.db
def test_no_publish_flag(conn, monkeypatch):
    stub(monkeypatch, [1])
    rid = str(uuid.uuid4())
    assert estimate.execute(conn, args("--all", "--no-publish", "--run-id", rid), log=lambda *_: None) == 0
    assert row(conn, rid)[0] is False


@pytest.mark.db
def test_session_run_is_unpublished_unless_explicit(conn, monkeypatch):
    stub(monkeypatch, [])
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    logs: list = []
    assert estimate.execute(conn, args("--session", "7", "--run-id", a), log=logs.append) == 0
    assert row(conn, a)[0] is False
    assert estimate.execute(conn, args("--session", "7", "--run-id", b, "--publish"), log=logs.append) == 0
    assert row(conn, b)[0] is True
    assert any("WARNING" in str(m) for m in logs)


@pytest.mark.db
def test_rerun_resets_published_flag(conn, monkeypatch):
    stub(monkeypatch, [1])
    rid = str(uuid.uuid4())
    estimate.execute(conn, args("--all", "--run-id", rid), log=lambda *_: None)
    estimate.start_run(conn, rid, "rerun")
    assert row(conn, rid)[:3] == (False, 0, False)


@pytest.mark.db
def test_missing_table_gives_clear_error(conn, monkeypatch):
    stub(monkeypatch, [1])
    with conn.cursor() as cur:
        cur.execute("DROP TABLE model_run")
    conn.commit()
    with pytest.raises(SystemExit) as e:
        estimate.execute(conn, args("--all"), log=lambda *_: None)
    assert "ingester" in str(e.value)


@pytest.mark.db
def test_register_existing_run(conn):
    rid = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute("INSERT INTO model_result VALUES (%s, %s::uuid, 1, '2026-01-01T00:00Z'), "
                    "(%s, %s::uuid, 2, '2026-01-02T00:00Z'), (%s, %s::uuid, 2, '2026-01-03T00:00Z')",
                    (estimate.MODEL_VERSION, rid) * 3)
    conn.commit()
    estimate.register_existing_run(conn, rid, publish=True)
    with conn.cursor() as cur:
        cur.execute("SELECT published, sessions_done, started_at, finished_at FROM model_run WHERE run_id = %s::uuid", (rid,))
        pub, n, t0, t1 = cur.fetchone()
    assert (pub, n) == (True, 2)
    assert t0.day == 1 and t1.day == 3
    with pytest.raises(SystemExit):
        estimate.register_existing_run(conn, str(uuid.uuid4()), publish=True)


def test_main_exits_non_zero_on_failure(monkeypatch):
    """No database: main() must turn a failed-session return code into the process exit status."""
    class Conn:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(estimate.db, "connect", lambda: Conn())
    monkeypatch.setattr(estimate, "execute", lambda conn, a: 1)
    with pytest.raises(SystemExit) as e:
        estimate.main(["--all"])
    assert e.value.code == 1
    monkeypatch.setattr(estimate, "execute", lambda conn, a: 0)
    with pytest.raises(SystemExit) as e:
        estimate.main(["--all"])
    assert e.value.code == 0


def test_cli_argument_rules():
    with pytest.raises(SystemExit):
        args("--all", "--publish", "--no-publish")
    with pytest.raises(SystemExit):
        args()
    assert args("--register-existing-run", "6f9df732-b7d1-42b5-b084-a2dc08f91662", "--publish").publish
