"""Download HCTRA's Regional Toll Roads layer into data/toll-roads.geojson.

The site can't load the layer straight from HCTRA's server, so a copy is kept in the
repo and drawn by the app. Runs on GitHub (Actions > Update toll roads).

Usage: python3 tools/fetch_toll_roads.py data/toll-roads.geojson
"""
import json, sys, urllib.parse, urllib.request

LAYER = "https://gismaps.hctra.org/rd/rest/services/ExternalOnlineMap/HCTRASystemMap/MapServer/3"
UA = {"User-Agent": "houston-toll-calculator (GitHub Actions)"}

def get(url, extra=None):
    req = urllib.request.Request(url, headers={**UA, **(extra or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.headers, r.read()

out = sys.argv[1]

# Why the browser couldn't load it: print the cross-origin header HCTRA sends back.
h, body = get(LAYER + "?f=json", {"Origin": "https://jasoncowart.github.io"})
print("Access-Control-Allow-Origin:", h.get("Access-Control-Allow-Origin"))
info = json.loads(body)
print("Layer:", info.get("name"), "| fields:", [f["name"] for f in info.get("fields", [])])
print("Renderer:", json.dumps(info.get("drawingInfo", {}).get("renderer"))[:1500])

features, offset = [], 0
while True:
    q = urllib.parse.urlencode({
        "where": "1=1", "outFields": "*", "outSR": 4326, "f": "geojson",
        "maxAllowableOffset": 0.00003,  # about 3 m: plenty for a map overlay
        "geometryPrecision": 6, "resultOffset": offset, "resultRecordCount": 1000,
    })
    _, body = get(LAYER + "/query?" + q)
    page = json.loads(body)
    if "error" in page:
        raise SystemExit("Query failed: " + json.dumps(page["error"]))
    feats = page.get("features", [])
    features += feats
    print("Fetched", len(feats), "at offset", offset)
    if len(feats) < 1000 and not page.get("exceededTransferLimit"):
        break
    offset += len(feats)

json.dump({"type": "FeatureCollection",
           "source": LAYER, "renderer": info.get("drawingInfo", {}).get("renderer"),
           "features": features}, open(out, "w"), separators=(",", ":"))
print(len(features), "toll road features written to", out)
