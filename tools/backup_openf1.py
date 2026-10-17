"""One-time raw backup of all 2026 OpenF1 race sessions into data/raw/openf1/ (gitignored).
Usage: python tools/backup_openf1.py [--summary]
- Rate limit: sleeps 2.2 s between requests (<=27/min, under the 30/min and 3/s free-tier caps).
- Resumable: a request whose file exists is skipped. Retries with exponential backoff on 429/5xx.
- Layout: data/raw/openf1/<session_key>/<endpoint>[_<driver>][_<window>].json, one file per request,
  plus data/raw/openf1/manifest.json with dates and row counts. Phase 1 can ingest from these files.
"""
import json, sys, time, pathlib, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

BASE = "https://api.openf1.org/v1"
SLEEP = 2.2
WINDOW = timedelta(minutes=30)
ROOT = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw" / "openf1"
ROOT.mkdir(parents=True, exist_ok=True)
MANIFEST = ROOT / "manifest.json"
manifest = json.load(open(MANIFEST)) if MANIFEST.exists() else {"created": datetime.now(timezone.utc).isoformat(), "sessions": {}}
requests_made = 0

def save_manifest():
    manifest["updated"] = datetime.now(timezone.utc).isoformat()
    json.dump(manifest, open(MANIFEST, "w"), indent=1)

def get(path, file):
    """Fetch BASE+path into file (skip if exists). Returns row count."""
    global requests_made
    if file.exists():
        return len(json.load(open(file)))
    for attempt in range(8):
        try:
            with urllib.request.urlopen(BASE + path, timeout=120) as r:
                data = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                data = []; break
            wait = SLEEP * (2 ** attempt)
            print(f"  HTTP {e.code} {path} -> wait {wait:.0f}s", flush=True); time.sleep(wait)
        except Exception as e:
            print(f"  {e!r} {path} -> retry", flush=True); time.sleep(SLEEP * 3)
    else:
        raise SystemExit(f"gave up: {path}")
    json.dump(data, open(file, "w"))
    requests_made += 1
    time.sleep(SLEEP)
    return len(data)

def iso(t): return t.isoformat().replace("+00:00", "")

def main():
    if "--summary" in sys.argv:
        for k, v in manifest["sessions"].items():
            print(k, v.get("name"), v.get("status"), {e: c for e, c in v.get("rows", {}).items()})
        return
    now = datetime.now(timezone.utc)
    sessions = get("/sessions?year=2026", ROOT / "sessions_2026.json")
    races = [s for s in json.load(open(ROOT / "sessions_2026.json"))
             if s["session_name"] == "Race" and datetime.fromisoformat(s["date_start"]) < now]
    print(f"{len(races)} race sessions in 2026 before now", flush=True)
    for s in races:
        sk = s["session_key"]; d = ROOT / str(sk); d.mkdir(exist_ok=True)
        m = manifest["sessions"].setdefault(str(sk), {"name": f'{s["circuit_short_name"]} {s["date_start"][:10]}', "rows": {}})
        if m.get("status") == "complete":
            print(f"{sk} {m['name']}: already complete", flush=True); continue
        print(f"== {sk} {m['name']}", flush=True)
        rows = m["rows"]
        t0 = datetime.fromisoformat(s["date_start"]); t1 = datetime.fromisoformat(s["date_end"])
        # whole-session endpoints
        for ep in ("drivers", "laps", "stints", "pit", "overtakes", "race_control", "intervals", "position"):
            rows[ep] = get(f"/{ep}?session_key={sk}", d / f"{ep}.json")
        if rows["laps"] == 0:
            m["status"] = "no_data"; save_manifest(); print("  no data (404)", flush=True); continue
        # window end = last lap end + 5 min, capped to date_end + 60 min
        laps = json.load(open(d / "laps.json"))
        ends = [datetime.fromisoformat(l["date_start"]) + timedelta(seconds=l["lap_duration"] or 0)
                for l in laps if l.get("date_start")]
        t_end = min(max(ends) + timedelta(minutes=5), t1 + timedelta(minutes=60)) if ends else t1
        drivers = [x["driver_number"] for x in json.load(open(d / "drivers.json"))]
        for ep in ("car_data", "location"):
            total = 0
            for drv in drivers:
                t = t0; i = 0
                while t < t_end:
                    te = min(t + WINDOW, t_end)
                    total += get(f"/{ep}?session_key={sk}&driver_number={drv}&date>={iso(t)}&date<{iso(te)}",
                                 d / f"{ep}_{drv}_{i:02d}.json")
                    t = te; i += 1
            rows[ep] = total
            print(f"  {ep}: {total} rows over {len(drivers)} drivers", flush=True)
        m["status"] = "complete"; m["fetched"] = datetime.now(timezone.utc).isoformat(); m["drivers"] = len(drivers)
        save_manifest()
        print(f"  done; rows {rows}; requests so far {requests_made}", flush=True)
    save_manifest()
    print("ALL DONE", flush=True)

main()
