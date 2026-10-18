"""One-time raw backup of all 2026 OpenF1 race sessions into data/raw/openf1/ (gitignored).
Usage: python tools/backup_openf1.py [--summary] [--sessions "Race"]  (comma-separated session_name values; default Race)
- Requests gzip transfer (~29x smaller payloads; the API honours Accept-Encoding).
- Rate limit: sleeps 2.2 s between requests (<=27/min, under the 30/min and 3/s free-tier caps).
- Resumable: a request whose file exists is skipped. Retries with exponential backoff on 429/5xx.
- Layout: data/raw/openf1/<session_key>/<endpoint>[_<driver>_w<window-minutes>_<index>].json.gz (gzip bytes exactly as the API sent them), one file per request,
  plus data/raw/openf1/manifest.json with dates and row counts. Phase 1 can ingest from these files.
"""
import json, sys, time, pathlib, urllib.request, urllib.error, gzip, http.client, threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = "https://api.openf1.org/v1"
HOST = "api.openf1.org"
SLEEP = 2.0            # minimum spacing between request STARTS, shared by all workers -> <=30/min
WORKERS = 2            # requests in flight; overlaps server time and transfer, never exceeds the spacing above
_lock = threading.Lock(); _next_start = [0.0]
_local = threading.local()

def _conn():
    c = getattr(_local, "conn", None)
    if c is None:
        c = http.client.HTTPSConnection(HOST, timeout=120); _local.conn = c
    return c

def _wait_slot():
    with _lock:
        now = time.monotonic(); start = max(now, _next_start[0]); _next_start[0] = start + SLEEP
    time.sleep(max(0.0, start - time.monotonic()))
WINDOW = timedelta(hours=3)   # one request per driver per endpoint covers a whole session; gzip keeps it ~600 KB
ROOT = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw" / "openf1"
ROOT.mkdir(parents=True, exist_ok=True)
MANIFEST = ROOT / "manifest.json"
manifest = json.load(open(MANIFEST)) if MANIFEST.exists() else {"created": datetime.now(timezone.utc).isoformat(), "sessions": {}}
requests_made = 0

def save_manifest():
    manifest["updated"] = datetime.now(timezone.utc).isoformat()
    json.dump(manifest, open(MANIFEST, "w"), indent=1)

def load(file):
    """Read a .json or .json.gz file."""
    gz = file.with_suffix(".json.gz") if file.suffix == ".json" else file
    if gz.exists(): return json.loads(gzip.decompress(gz.read_bytes()))
    return json.load(open(file))

def get(path, file):
    """Fetch BASE+path into file (.json.gz on disk; skip if .json or .json.gz exists). Returns row count."""
    global requests_made
    gz = file.with_suffix(".json.gz")
    if file.exists() or gz.exists():
        return len(load(file))
    for attempt in range(8):
        _wait_slot()
        try:
            c = _conn()
            c.request("GET", "/v1" + path, headers={"Accept-Encoding": "gzip", "Host": HOST})
            r = c.getresponse(); raw = r.read()
            if r.status == 404:
                raw = gzip.compress(b"[]"); data = []; break
            if r.status != 200:
                wait = SLEEP * (2 ** attempt)
                print(f"  HTTP {r.status} {path} -> wait {wait:.0f}s", flush=True); time.sleep(wait); continue
            if r.getheader("Content-Encoding") != "gzip": raw = gzip.compress(raw)
            data = json.loads(gzip.decompress(raw))
            break
        except Exception as e:
            _local.conn = None
            print(f"  {e!r} {path} -> retry", flush=True); time.sleep(SLEEP * 3)
    else:
        raise SystemExit(f"gave up: {path}")
    gz.write_bytes(raw)
    with _lock: requests_made += 1
    return len(data)

def iso(t): return t.isoformat().replace("+00:00", "")

VERIFY_WINDOW = timedelta(minutes=20)
RATIO_MIN = 0.9

def count_rows(d, ep, drv):
    return sum(len(load(f)) for f in d.glob(f"{ep}_{drv}_w*_*.json.gz"))

def verify_location(sk, s, d, m, drivers, t0, t_end):
    """A session is only complete if each driver's location rows are within ~10 % of their car_data rows.
    Drivers that fail get ONE re-fetch of location in VERIFY_WINDOW windows (files *_w20_*); if still short,
    the session is marked complete_with_feed_gaps and the per-driver counts are recorded."""
    check = {}
    for drv in drivers:
        car = count_rows(d, "car_data", drv); loc = sum(len(load(f)) for f in d.glob(f"location_{drv}_w180_*.json.gz"))
        entry = {"car_data": car, "location": loc}
        if car and loc < RATIO_MIN * car:
            jobs = []; t = t0; i = 0
            while t < t_end:
                te = min(t + VERIFY_WINDOW, t_end)
                jobs.append((f"/location?session_key={sk}&driver_number={drv}&date>={iso(t)}&date<{iso(te)}",
                             d / f"location_{drv}_w{int(VERIFY_WINDOW.total_seconds() // 60)}_{i:02d}.json"))
                t = te; i += 1
            with ThreadPoolExecutor(max_workers=WORKERS) as ex:
                refetched = sum(ex.map(lambda j: get(*j), jobs))
            entry["location_refetched_w20"] = refetched
            entry["ok"] = refetched >= RATIO_MIN * car
            print(f"  verify {drv}: car {car} loc {loc} -> windowed re-fetch {refetched} {'OK' if entry['ok'] else 'STILL SHORT (feed gap)'}", flush=True)
        else:
            entry["ok"] = True
        check[str(drv)] = entry
    m["location_check"] = check
    m["status"] = "complete" if all(v["ok"] for v in check.values()) else "complete_with_feed_gaps"
    save_manifest()
    return m["status"]

def main():
    if "--summary" in sys.argv:
        for k, v in manifest["sessions"].items():
            bad = [dr for dr, c in v.get("location_check", {}).items() if not c.get("ok")]
            print(k, v.get("name"), v.get("status"), {e: c for e, c in v.get("rows", {}).items()}, ("location gaps: " + ",".join(bad)) if bad else "")
        return
    now = datetime.now(timezone.utc)
    sessions = get("/sessions?year=2026", ROOT / "sessions_2026.json")
    get("/meetings?year=2026", ROOT / "meetings_2026.json")
    names = sys.argv[sys.argv.index("--sessions") + 1].split(",") if "--sessions" in sys.argv else ["Race"]
    races = [s for s in load(ROOT / "sessions_2026.json")
             if s["session_name"] in names and datetime.fromisoformat(s["date_start"]) < now]
    print(f"{len(races)} sessions {names} in 2026 before now", flush=True)
    for s in races:
        sk = s["session_key"]; d = ROOT / str(sk); d.mkdir(exist_ok=True)
        m = manifest["sessions"].setdefault(str(sk), {"name": f'{s["circuit_short_name"]} {s["session_name"]} {s["date_start"][:10]}', "rows": {}})
        if m.get("status") in ("complete", "complete_with_feed_gaps"):
            if "location_check" not in m and m.get("status") == "complete":
                laps = load(d / "laps.json"); t0 = datetime.fromisoformat(s["date_start"]); t1 = datetime.fromisoformat(s["date_end"])
                ends = [datetime.fromisoformat(l["date_start"]) + timedelta(seconds=l["lap_duration"] or 0) for l in laps if l.get("date_start")]
                t_end = min(max(ends) + timedelta(minutes=5), t1 + timedelta(minutes=60)) if ends else t1
                drivers = [x["driver_number"] for x in load(d / "drivers.json")]
                print(f"{sk} {m['name']}: verifying location coverage", flush=True)
                print(f"  -> {verify_location(sk, s, d, m, drivers, t0, t_end)}", flush=True)
            else:
                print(f"{sk} {m['name']}: already {m['status']}", flush=True)
            continue
        print(f"== {sk} {m['name']}", flush=True)
        rows = m["rows"]
        t0 = datetime.fromisoformat(s["date_start"]); t1 = datetime.fromisoformat(s["date_end"])
        # whole-session endpoints
        for ep in ("drivers", "laps", "stints", "pit", "overtakes", "race_control", "intervals", "position",
                   "weather", "session_result", "starting_grid", "team_radio"):
            rows[ep] = get(f"/{ep}?session_key={sk}", d / f"{ep}.json")
        if rows["laps"] == 0:
            m["status"] = "no_data"; save_manifest(); print("  no data (404)", flush=True); continue
        # window end = last lap end + 5 min, capped to date_end + 60 min
        laps = load(d / "laps.json")
        ends = [datetime.fromisoformat(l["date_start"]) + timedelta(seconds=l["lap_duration"] or 0)
                for l in laps if l.get("date_start")]
        t_end = min(max(ends) + timedelta(minutes=5), t1 + timedelta(minutes=60)) if ends else t1
        drivers = [x["driver_number"] for x in load(d / "drivers.json")]
        for ep in ("car_data", "location"):
            jobs = []
            for drv in drivers:
                t = t0; i = 0
                while t < t_end:
                    te = min(t + WINDOW, t_end)
                    jobs.append((f"/{ep}?session_key={sk}&driver_number={drv}&date>={iso(t)}&date<{iso(te)}",
                                 d / f"{ep}_{drv}_w{int(WINDOW.total_seconds() // 60)}_{i:02d}.json"))
                    t = te; i += 1
            with ThreadPoolExecutor(max_workers=WORKERS) as ex:
                total = sum(ex.map(lambda j: get(*j), jobs))
            rows[ep] = total
            print(f"  {ep}: {total} rows over {len(drivers)} drivers", flush=True)
        m["fetched"] = datetime.now(timezone.utc).isoformat(); m["drivers"] = len(drivers)
        m["status"] = "complete"; save_manifest()
        verify_location(sk, s, d, m, drivers, t0, t_end)
        print(f"  done; rows {rows}; requests so far {requests_made}", flush=True)
    save_manifest()
    print("ALL DONE", flush=True)

main()
