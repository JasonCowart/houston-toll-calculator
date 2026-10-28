#!/usr/bin/env python3
# Run: Oct 23, 2026, after the TOMTOM_API_KEY secret was added. Oct 28: routing with supporting points.
"""Which TomTom addresses accept our key? Saves only status codes and TomTom's error text
(never the key, never traffic data) to data/tomtom-probe.json."""
import json, os, re, urllib.error, urllib.request
from datetime import datetime, timezone

KEY = os.environ.get("TOMTOM_API_KEY", "").strip()
SITE = "https://jasoncowart.github.io/"
TESTS = [
    ("search v2 (any key should work)", "https://api.tomtom.com/search/2/geocode/Houston.json?limit=1&key={k}", {}),
    ("orbis flow raster tile, key in address", "https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/12/960/1693?apiVersion=2&style=light&key={k}", {}),
    ("orbis flow raster tile, key in header", "https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/12/960/1693?apiVersion=2&style=light", {"TomTom-Api-Key": "{k}"}),
    ("orbis flow raster tile, from our site", "https://api.tomtom.com/maps/orbis/traffic/flow/raster/tile/12/960/1693?apiVersion=2&style=light&key={k}", {"Referer": SITE, "Origin": SITE.rstrip("/")}),
    ("orbis flow vector tile", "https://api.tomtom.com/maps/orbis/traffic/flow/vector/tile/12/960/1693?apiVersion=2&key={k}", {}),
    ("orbis incident details", "https://api.tomtom.com/maps/orbis/traffic/incidents/details?apiVersion=2&bbox=-95.80,29.55,-95.05,30.15&key={k}", {}),
    ("old v4 flow segment data", "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=29.7167,-95.5759&unit=MPH&key={k}", {}),
    ("old v4 flow segment data, from our site", "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=29.7167,-95.5759&unit=MPH&key={k}", {"Referer": SITE, "Origin": SITE.rstrip("/")}),
    ("old v4 flow raster tile", "https://api.tomtom.com/traffic/map/4/tile/flow/relative0/12/960/1693.png?key={k}", {}),
    ("old v5 incident details", "https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=-95.80,29.55,-95.05,30.15&language=en-US&key={k}", {}),
    # The debug view's "second opinion" times: POST the route line as supporting points.
    ("routing with supporting points, from our site",
     "https://api.tomtom.com/routing/1/calculateRoute/29.8559,-95.5641:29.7167,-95.5590/json?traffic=true&routeType=fastest&computeTravelTimeFor=all&routeRepresentation=summaryOnly&departAt=now&key={k}",
     {"Referer": SITE, "Origin": SITE.rstrip("/"), "Content-Type": "application/json",
      "__body": json.dumps({"supportingPoints": [{"latitude": 29.8559, "longitude": -95.5641}, {"latitude": 29.80, "longitude": -95.5636},
                                                 {"latitude": 29.76, "longitude": -95.5581}, {"latitude": 29.7167, "longitude": -95.5590}]})}),
]

def run(url, headers):
    headers = dict(headers)
    body = headers.pop("__body", None)
    req = urllib.request.Request(url.replace("{k}", KEY), data=body.encode() if body else None, method="POST" if body else "GET",
        headers={"User-Agent": "hctra-toll-calculator-probe", **{h: v.replace("{k}", KEY) for h, v in headers.items()}})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            return r.status, r.headers.get("Content-Type", ""), len(body), ""
    except urllib.error.HTTPError as e:
        text = e.read()[:400].decode("utf-8", "replace")
        return e.code, e.headers.get("Content-Type", ""), 0, text
    except Exception as e:  # noqa: BLE001
        return None, "", 0, f"{type(e).__name__}: {e}"

out = {"checked": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "keyPresent": bool(KEY),
       "keyLength": len(KEY), "results": []}
for name, url, headers in TESTS if KEY else []:
    status, ctype, size, err = run(url, headers)
    if KEY:
        err = err.replace(KEY, "[key]")
    err = re.sub(r"key=[A-Za-z0-9]+", "key=[key]", err)
    out["results"].append({"test": name, "status": status, "type": ctype.split(";")[0], "bytes": size, "error": err.strip()})
    print(name, status, err[:120])
json.dump(out, open("data/tomtom-probe.json", "w"), indent=1)
