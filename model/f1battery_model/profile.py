"""Cross-lap speed and acceleration profile of each straight, per driver (model_result rows).

    python -m f1battery_model.profile --session 11361 --run-id <uuid>
    python -m f1battery_model.profile --all-sessions --run-id <uuid>

Output: for every driver and straight of a session, one row per 50 m bin of the
straight (bin n covers [50 n, 50 n + 50) m from the straight's start), with
lap_number 0 and the straight's id:

* ``speed_bin_<n>``  median over the driver's clean (green) laps of the lap's mean
  speed in the bin, whole kph;
* ``accel_bin_<n>``  median over the same laps of the lap's mean acceleration in
  the bin, m/s^2, 1 decimal.

This is a cross-lap aggregate at the same 50 m resolution as the regime bins; no
single lap and no raw sample is stored (DECISIONS.md D9). A bin needs >= 2 grid
samples in a lap and >= MIN_LAPS_FOR_SUMMARY such laps; only complete 50 m bins
inside the straight window are written. Laps, windows, wrap-around handling,
the grid trace and the acceleration come from the package (pipeline, quality,
straights, physics); no CdA or hinge fit is needed. Re-running with the same
--run-id deletes and rewrites these two variables for the session, so it is
idempotent. The run's model_run row is not touched.
"""
from __future__ import annotations

import argparse
import time

import numpy as np

from . import db, derate, pipeline as pl
from .estimate import MODEL_VERSION, EXCLUDED_SESSIONS, Writer

BIN_M = 50.0
MIN_SAMPLES = 2


def straight_profiles(prep: pl.Prepared) -> dict[int, dict[str, np.ndarray]]:
    """Per straight id: ``speed`` (kph), ``accel`` (m/s^2) medians per bin across green laps, NaN where too few laps."""
    tr = prep.tr
    per: dict[int, list[tuple[np.ndarray, np.ndarray]]] = {}
    for i in np.flatnonzero(prep.green):
        c0 = tr.lap_start_cum[i]
        if not np.isfinite(c0):
            continue
        for sid, s, e, wraps in pl._lap_windows(prep.wins, prep.lap_len[i] / prep.med_len, prep.lap_len[i]):
            # same rule as pipeline.sweep: a wrapping straight needs usable samples from the previous lap
            if wraps and not pl.wrap_ok(prep.tail_ok, prep.lap_no, i):
                continue
            lo = int(np.searchsorted(tr.cum, c0 + s, side="left"))
            hi = int(np.searchsorted(tr.cum, c0 + e, side="right"))
            nb = int((e - s) // BIN_M)
            if nb < 1 or hi - lo < 4:
                continue
            rel = tr.cum[lo:hi] - (c0 + s)
            b = np.floor(rel / BIN_M).astype(int)
            ok = (b >= 0) & (b < nb)
            cnt = np.bincount(b[ok], minlength=nb)
            v = np.bincount(b[ok], tr.v[lo:hi][ok] * 3.6, minlength=nb) / np.maximum(cnt, 1)
            a = np.bincount(b[ok], tr.a[lo:hi][ok], minlength=nb) / np.maximum(cnt, 1)
            v[cnt < MIN_SAMPLES] = np.nan
            a[cnt < MIN_SAMPLES] = np.nan
            per.setdefault(sid, []).append((v, a))
    out = {}
    for sid, laps in per.items():
        nb = min(len(v) for v, _ in laps)
        V = np.array([v[:nb] for v, _ in laps])
        A = np.array([a[:nb] for _, a in laps])
        enough = np.isfinite(V).sum(0) >= pl.MIN_LAPS_FOR_SUMMARY
        with np.errstate(all="ignore"):
            sv, sa = np.nanmedian(V, axis=0), np.nanmedian(A, axis=0)
        sv[~enough], sa[~enough] = np.nan, np.nan
        out[sid] = {"speed": sv, "accel": sa}
    return out


def flatten_bin(speed: np.ndarray, accel: np.ndarray) -> int | None:
    """First bin whose median acceleration is below the cut-off threshold (derate.A_CROSS) above the minimum speed."""
    for n in range(len(accel)):
        if np.isfinite(accel[n]) and accel[n] < derate.A_CROSS and speed[n] > derate.CROSS_V_MIN_KPH:
            return n
    return None


def run_session(conn, session_key: int, run_id: str, log=print) -> dict:
    ctx = pl.session_context(conn, session_key)
    w = Writer(conn, run_id, session_key)
    summary: dict[tuple[int, int], dict] = {}
    with conn.cursor() as cur:
        cur.execute("DELETE FROM model_result WHERE model_version = %s AND run_id = %s::uuid AND session_key = %s "
                    "AND lap_number = 0 AND (variable LIKE 'speed\\_bin\\_%%' OR variable LIKE 'accel\\_bin\\_%%')",
                    (MODEL_VERSION, run_id, session_key))
    for d in ctx.drivers:
        prep = pl.prepare_driver(conn, ctx, d)
        if prep is None:
            continue
        for sid, p in straight_profiles(prep).items():
            for n, (v, a) in enumerate(zip(p["speed"], p["accel"])):
                if np.isfinite(v):
                    w.add(d, 0, sid, f"speed_bin_{n}", round(float(v)))
                    w.add(d, 0, sid, f"accel_bin_{n}", round(float(a), 1))
            summary[(d, sid)] = p
    w.flush()
    conn.commit()
    log(f"{session_key} {ctx.info['circuit_short_name']} {ctx.info['session_name']}: rows {w.total}")
    return {"rows": w.total, "summary": summary}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--session", type=int)
    g.add_argument("--all-sessions", action="store_true")
    ap.add_argument("--run-id", required=True, help="model run to attach the rows to (must already exist)")
    ap.add_argument("--show", default="", help="DRIVER:STRAIGHT,... summaries to print, e.g. 1:2,1:1,1:4")
    a = ap.parse_args()
    t0, total = time.time(), 0
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM model_result WHERE run_id = %s::uuid LIMIT 1", (a.run_id,))
            if cur.fetchone() is None:
                raise SystemExit(f"run {a.run_id} has no model_result rows; pass an existing run id")
            if a.all_sessions:
                cur.execute("SELECT DISTINCT session_key FROM model_result WHERE run_id = %s::uuid ORDER BY 1", (a.run_id,))
                sessions = [r[0] for r in cur.fetchall()]
            else:
                sessions = [a.session]
        want = [tuple(map(int, s.split(":"))) for s in a.show.split(",") if s]
        for sk in sessions:
            if sk in EXCLUDED_SESSIONS:
                continue
            try:
                res = run_session(conn, sk, a.run_id)
            except Exception as e:
                conn.rollback()
                print(f"{sk} FAILED {e!r}")
                continue
            total += res["rows"]
            for d, sid in want:
                p = res["summary"].get((d, sid))
                if p is None:
                    print(f"driver {d} straight {sid}: no profile")
                    continue
                v, ac = p["speed"], p["accel"]
                k = np.flatnonzero(np.isfinite(v))
                f = flatten_bin(v, ac)
                print(f"driver {d} straight {sid}: bins {len(k)}, speed {np.nanmin(v):.0f}-{np.nanmax(v):.0f} kph, "
                      f"flattens at bin {f} ({'-' if f is None else int(f * BIN_M)} m, accel<{derate.A_CROSS})")
                print("  speed", [int(x) if np.isfinite(x) else None for x in v])
                print("  accel", [round(float(x), 1) if np.isfinite(x) else None for x in ac])
    print(f"rows written {total}, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
