"""Phase 3 reproduction check (PLAN.md Phase 3 exit condition).

    python -m f1battery_model.check_phase3 [--plateau-a-max X] [--out model/out/phase3_check.json]

Runs the pipeline on Monza race 11361 (drivers 63, 44, 3, 18, 27) and on every
driver of Singapore race 11388 and compares with the spike (spike/out/*/deploy_cut.json):

* Monza T1->Roggia (straight 2) and Lesmo->Ascari (straight 4): median cut-off from
  the spike-equivalent threshold crossing within +-60 m of the spike, per driver.
  The hinge ramp start is reported separately (it is expected to be earlier).
* Singapore: no detected ramp on any straight for at least 90 % of laps.
* Lap-to-lap regime agreement on full-throttle bins at least 0.80 (mean per driver).

Nothing is written to the database.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import db, derate, pipeline as pl

REPO = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[1] / "out" / "phase3_check.json"
MONZA, SINGAPORE = 11361, 11388
MONZA_DRIVERS = [63, 44, 3, 18, 27]
TOLERANCE_M = 60.0
SINGAPORE_MAX_DETECT = 0.10
AGREEMENT_MIN = 0.80
# (label, our straight id, spike straight start range in m)
# 2026 power-unit supply by team (public information; used only to group the CdA table).
PU_MAKER = {"Mercedes": "Mercedes", "McLaren": "Mercedes", "Williams": "Mercedes", "Alpine": "Mercedes",
            "Ferrari": "Ferrari", "Haas F1 Team": "Ferrari", "Cadillac": "Ferrari",
            "Red Bull Racing": "Red Bull Ford", "Racing Bulls": "Red Bull Ford",
            "Aston Martin": "Honda", "Audi": "Audi"}
MONZA_STRAIGHTS = [("T1->Roggia", 2, (980, 1040)), ("Lesmo->Ascari", 4, (2870, 2910))]


def spike_reference(session: int) -> dict:
    return json.loads((REPO / "spike" / "out" / str(session) / "deploy_cut.json").read_text())


def run_session(session: int, drivers: list[int] | None):
    """All drivers are always processed so the pooled hinge CdA is the one Phase 4 would use."""
    results = []
    with db.connect() as conn:
        ctx = pl.session_context(conn, session)
        teams = dict(conn.execute("SELECT driver_number, team_name FROM driver WHERE session_key = %s", (session,)).fetchall())
        for r in pl.process_session(conn, ctx, None):
            results.append(r)
    if drivers is not None:
        results = [r for r in results if r.driver in drivers]
    return ctx, results, teams


def cda_table(results, teams) -> list[dict]:
    out = []
    for r in results:
        c = r.cda
        out.append({"driver": r.driver, "team": teams.get(r.driver), "pu": PU_MAKER.get(teams.get(r.driver)),
                    "regression_cda_m2": c["cda_m2"], "regression_std_m2": c["cda_std_m2"], "regression_r2": c["r2"],
                    "regression_samples": c["n_samples"], "profile_cda_m2": c["cda_profile_m2"], "hinge_cda_used_m2": c["cda_used_m2"]})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plateau-a-max", type=float, default=None, help="override derate.PLATEAU_A_MAX (sensitivity only)")
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args()
    if a.plateau_a_max is not None:
        derate.PLATEAU_A_MAX = a.plateau_a_max
    t0 = time.time()
    report: dict = {"plateau_a_max": derate.PLATEAU_A_MAX, "detect": {"delta_min_kw": derate.DELTA_MIN_KW,
                    "sse_ratio_max": derate.SSE_RATIO_MAX, "ramp_v_min_kph": derate.RAMP_V_MIN_KPH}}

    # ---- Monza
    ctx, res, teams = run_session(MONZA, None)
    report["cda_monza"] = cda_table(res, teams)
    res = [r for r in res if r.driver in MONZA_DRIVERS]
    spike = spike_reference(MONZA)
    report["monza"] = {"rate_kw_s": ctx.rate_kw_s, "rate_default": ctx.rate_default, "drivers": {}}
    ok_monza = True
    for r in res:
        summ = pl.summarise_straights(r).set_index("straight_id")
        d = {"green_laps": r.n_green, "cda": {k: (None if v is None or (isinstance(v, float) and not np.isfinite(v)) else v)
                                              for k, v in r.cda.items()},
             "agreement": r.agreement, "straights": {}}
        for label, sid, (lo, hi) in MONZA_STRAIGHTS:
            ref = next(s for s in spike[str(r.driver)]["straights"] if lo <= s["straight_start_m"] <= hi)
            row = summ.loc[sid]
            diff = float(row["spike_cross_median_m"] - ref["cut_median_m"])
            passed = bool(abs(diff) <= TOLERANCE_M)
            ok_monza &= passed
            det = r.straight_laps[r.straight_laps.straight_id == sid]
            d["straights"][label] = {
                "straight_id": sid, "spike_median_m": ref["cut_median_m"], "spike_std_m": ref["cut_std_m"],
                "spike_frac": ref["frac_with_cut"],
                "pipeline_spike_crossing_median_m": float(row["spike_cross_median_m"]),
                "pipeline_spike_crossing_std_m": float(row["spike_cross_std_m"]),
                "pipeline_spike_crossing_frac": float(row["spike_cross_fraction"]),
                "diff_m": diff, "within_tolerance": passed,
                "guarded_crossing_median_m": None if pd.isna(row.get("cross_median_m")) else float(row["cross_median_m"]),
                "guarded_crossing_frac": None if pd.isna(row.get("cross_fraction")) else float(row["cross_fraction"]),
                "hinge_start_median_m": float(row["cutoff_median_m"]), "hinge_start_std_m": float(row["cutoff_std_m"]),
                "hinge_ci": [float(row["cutoff_ci_low"]), float(row["cutoff_ci_high"])],
                "hinge_speed_kph": float(row["cutoff_speed_median_kph"]), "hinge_detect_frac": float(row["detect_fraction"]),
                "ramp_rate_kw_s_median": float(det.loc[det.detected.astype(bool), "ramp_rate_kw_s"].median()),
                "ramp_tau_s_median": float(det.loc[det.detected.astype(bool), "tau_s"].median()),
                "hinge_minus_crossing_m": float(row["cutoff_median_m"] - row["spike_cross_median_m"])}
        report["monza"]["drivers"][str(r.driver)] = d
    report["monza"]["pass"] = bool(ok_monza)

    # ---- Singapore
    ctx, res, teams = run_session(SINGAPORE, None)
    report["cda_singapore"] = cda_table(res, teams)
    report["singapore"] = {"rate_kw_s": ctx.rate_kw_s, "rate_default": ctx.rate_default, "drivers": {}}
    tot: dict[int, list[int]] = {}
    tot5: dict[int, list[int]] = {}
    for r in res:
        summ = pl.summarise_straights(r)
        d = {"green_laps": r.n_green, "agreement": r.agreement, "cda": {k: float(v) for k, v in r.cda.items() if isinstance(v, (float, np.floating)) and np.isfinite(v)},
             "straights": {}}
        for _, row in summ.iterrows():
            sid = int(row["straight_id"])
            d["straights"][str(sid)] = {"laps": int(row["laps_analysed"]), "detected": int(row["laps_detected"]),
                                        "fraction": float(row["detect_fraction"])}
            t = tot.setdefault(sid, [0, 0])
            t[0] += int(row["laps_detected"]); t[1] += int(row["laps_analysed"])
            if r.driver in MONZA_DRIVERS:
                t = tot5.setdefault(sid, [0, 0])
                t[0] += int(row["laps_detected"]); t[1] += int(row["laps_analysed"])
        report["singapore"]["drivers"][str(r.driver)] = d
    report["singapore"]["pooled_by_straight"] = {str(k): {"detected": v[0], "analysed": v[1], "fraction": v[0] / v[1]} for k, v in sorted(tot.items())}
    report["singapore"]["pooled_by_straight_spike_drivers"] = {str(k): {"detected": v[0], "analysed": v[1], "fraction": v[0] / v[1]} for k, v in sorted(tot5.items())}
    worst = max(v[0] / v[1] for v in tot.values())
    report["singapore"]["max_straight_fraction"] = worst
    report["singapore"]["pass"] = bool(worst <= SINGAPORE_MAX_DETECT)

    # ---- sensitivity of the hinge ramp start to the CdA used (Monza, two drivers)
    sens = {}
    with db.connect() as conn:
        ctx = pl.session_context(conn, MONZA)
        for drv in (63, 44):
            prep = pl.prepare_driver(conn, ctx, drv)
            for cda in (0.4, 0.7, 1.0, 1.3, 1.6):
                rows = pl.sweep(prep, ctx, cda)
                for _, sid, _ in MONZA_STRAIGHTS:
                    g = [r for r in rows if r["straight_id"] == sid and "hinge_d" in r]
                    det = [r for r in g if r["detected"]]
                    sens.setdefault(f"{drv}", {}).setdefault(str(sid), {})[str(cda)] = {
                        "hinge_median_m": float(np.median([r["hinge_d"] for r in det])) if det else None,
                        "detect_fraction": len(det) / len(g) if g else None}
    report["cda_sensitivity"] = sens

    # ---- agreement
    agr = {"monza": {k: v["agreement"]["mean"] for k, v in report["monza"]["drivers"].items()},
           "singapore": {k: v["agreement"]["mean"] for k, v in report["singapore"]["drivers"].items()}}
    report["agreement"] = agr
    report["agreement_min_of_means"] = float(min(min(agr["monza"].values()), min(agr["singapore"].values())))
    report["agreement_pass"] = bool(report["agreement_min_of_means"] >= AGREEMENT_MIN)
    report["overall_pass"] = bool(report["monza"]["pass"] and report["singapore"]["pass"] and report["agreement_pass"])
    report["seconds"] = time.time() - t0
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(report, indent=1, default=float))
    print(json.dumps({k: report[k] for k in ("overall_pass", "agreement_pass", "agreement_min_of_means", "seconds")}))
    print("monza pass:", report["monza"]["pass"], " singapore pass:", report["singapore"]["pass"],
          " singapore worst straight:", round(worst, 3))
    for dn, d in report["monza"]["drivers"].items():
        for lab, s in d["straights"].items():
            print(f"  monza {dn:>3} {lab:<13} spike {s['spike_median_m']:>5} pipeline-crossing {s['pipeline_spike_crossing_median_m']:7.1f} "
                  f"diff {s['diff_m']:+5.1f}  hinge {s['hinge_start_median_m']:7.1f} (CI {s['hinge_ci'][0]:.0f}..{s['hinge_ci'][1]:.0f}) "
                  f"detect {s['hinge_detect_frac']:.2f}")
    print("  singapore pooled:", {k: round(v["fraction"], 3) for k, v in report["singapore"]["pooled_by_straight"].items()})
    print("  singapore spike-drivers pooled:", {k: round(v["fraction"], 3) for k, v in report["singapore"]["pooled_by_straight_spike_drivers"].items()})


if __name__ == "__main__":
    main()
