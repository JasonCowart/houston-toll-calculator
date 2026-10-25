#!/usr/bin/env python3
"""Download TxDOT's statewide "Texas Toll Roads" layer (all toll roads and managed lanes in Texas,
every agency) into data/toll-roads.geojson, the toll road lines drawn on the map.

Runs on GitHub (Actions > Update Texas toll roads); the build workspace can't reach ArcGIS.
Lines are simplified to about 15 m and coordinates rounded to about 1 m to keep the file small.

Usage: python3 tools/fetch_tx_toll_roads.py data/toll-roads.geojson
"""
import json, sys, urllib.parse, urllib.request

ITEM = "7ba722aba7dd4ca88db1c1ed4b8895f0"  # arcgis.com item "Texas Toll Roads" (TxDOT)
UA = {"User-Agent": "hctra-toll-calculator (GitHub Actions)"}

def get(url, params):
    with urllib.request.urlopen(urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers=UA), timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))

def note(msg):
    print("::notice::" + msg.replace("\n", " ")[:900])

item = get("https://www.arcgis.com/sharing/rest/content/items/" + ITEM, {"f": "json"})
url = item["url"].rstrip("/")
note("Item: %s | %s | %s | %s" % (item.get("title"), item.get("owner"), item.get("type"), url))
svc = get(url, {"f": "json"})
if "fields" in svc: layers = [url]
else: layers = [url + "/" + str(l["id"]) for l in svc.get("layers", [])]
note("Layers: %s" % [(l.get("id"), l.get("name"), l.get("geometryType")) for l in svc.get("layers", [])])
feats = []
for lu in layers:
    meta = get(lu, {"f": "json"})
    if "Polyline" not in (meta.get("geometryType") or ""): continue
    note("Layer %s: %s | fields %s" % (lu, meta.get("name"), [f["name"] for f in meta.get("fields", [])]))
    offset = 0
    while True:
        page = get(lu + "/query", {"where": "1=1", "outFields": "*", "outSR": "4326", "f": "json",
                                   "maxAllowableOffset": "0.00015", "geometryPrecision": "5",
                                   "resultOffset": offset, "resultRecordCount": 1000})
        if "error" in page: note("query error: %s" % json.dumps(page["error"])[:400]); break
        got = page.get("features") or []
        for f in got:
            g = f.get("geometry") or {}
            if not g.get("paths"): continue
            feats.append({"type": "Feature", "properties": f.get("attributes") or {},
                          "geometry": {"type": "MultiLineString", "coordinates": g["paths"]}})
        if not got or not page.get("exceededTransferLimit"): break
        offset += len(got)
note("Features: %d" % len(feats))
if feats: note("Sample properties: " + json.dumps(feats[0]["properties"])[:700])
if not feats: sys.exit("No toll road lines downloaded")
json.dump({"type": "FeatureCollection", "source": "TxDOT Texas Toll Roads (arcgis.com item " + ITEM + ")", "features": feats},
          open(sys.argv[1], "w"), separators=(",", ":"))
