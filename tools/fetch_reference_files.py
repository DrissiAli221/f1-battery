"""Download small public reference files into data/reference/ (gitignored). Resumable.
- FIA race director's competition notes per 2026 event (URLs in docs/reference-urls.txt, one per line, '#' comments)
- FIA Section B/C regulation PDFs (same list)
- TracingInsights/2026 curated circuit sections and corner files (raw GitHub, small JSON)
Usage: python tools/fetch_reference_files.py
"""
import pathlib, urllib.request, time, sys, json
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "reference"; OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (f1-battery personal project; polite fetch)"}

def fetch(url, dest):
    if dest.exists(): return "cached"
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            dest.write_bytes(r.read())
        time.sleep(1.0); return "ok"
    except Exception as e:
        return f"FAILED {e}"

for line in (ROOT / "docs" / "reference-urls.txt").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#"): continue
    url = line.split()[0]; name = url.rsplit("/", 1)[-1]
    sub = "fia" if "fia.com" in url else "other"
    print(f"{fetch(url, OUT / sub / name):8s} {name}", flush=True)

# TracingInsights sections and corners: list the directories via the GitHub API, fetch each small JSON
import urllib.error
for d in ("sections", "corners"):
    api = f"https://api.github.com/repos/TracingInsights/2026/contents/{d}"
    try:
        with urllib.request.urlopen(urllib.request.Request(api, headers=UA), timeout=60) as r:
            items = json.load(r)
    except urllib.error.HTTPError as e:
        print(f"{d}: GitHub API {e.code} (directory may not exist at top level; check DATA_REFERENCE.md)"); continue
    for it in items:
        if it.get("type") == "file":
            print(f"{fetch(it['download_url'], OUT / 'tracinginsights' / d / it['name']):8s} {d}/{it['name']}", flush=True)
print("done")
