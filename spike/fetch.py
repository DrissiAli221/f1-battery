"""Phase S fetcher. Throwaway. Usage: python fetch.py SESSION_KEY DRIVER [DRIVER...]
Fetches session, race_control, laps per driver, car_data per driver in 10-min windows.
Rate limit: <=3 req/s, <=30 req/min -> we sleep 2.2 s between requests. Caches JSON."""
import json, sys, time, urllib.request, urllib.error, pathlib
from datetime import datetime, timedelta, timezone

BASE = "https://api.openf1.org/v1"
SLEEP = 2.2
session_key = int(sys.argv[1]); drivers = [int(d) for d in sys.argv[2:]]
cache = pathlib.Path(__file__).parent / "cache" / str(session_key); cache.mkdir(parents=True, exist_ok=True)

def get(path, name):
    f = cache / f"{name}.json"
    if f.exists():
        return json.load(open(f))
    for attempt in range(6):
        try:
            with urllib.request.urlopen(BASE + path, timeout=60) as r:
                data = json.load(r); break
        except urllib.error.HTTPError as e:
            if e.code == 404: data = []; break
            wait = SLEEP * (2 ** attempt)
            print(f"  HTTP {e.code} on {path}, backing off {wait:.0f}s", flush=True); time.sleep(wait)
        except Exception as e:
            print(f"  {e!r} on {path}, retrying", flush=True); time.sleep(SLEEP * 2)
    else:
        raise SystemExit(f"gave up on {path}")
    json.dump(data, open(f, "w")); time.sleep(SLEEP)
    print(f"  {name}: {len(data)} rows", flush=True)
    return data

sess = get(f"/sessions?session_key={session_key}", "session")[0]
t0 = datetime.fromisoformat(sess["date_start"]); t1 = datetime.fromisoformat(sess["date_end"])
print(sess["circuit_short_name"], sess["session_name"], t0, t1)
get(f"/race_control?session_key={session_key}", "race_control")
for d in drivers:
    get(f"/laps?session_key={session_key}&driver_number={d}", f"laps_{d}")
    t = t0; i = 0
    while t < t1:
        te = min(t + timedelta(minutes=10), t1)
        get(f"/car_data?session_key={session_key}&driver_number={d}&date>={t.isoformat()}&date<{te.isoformat()}", f"car_{d}_{i:02d}")
        t = te; i += 1
print("done")
