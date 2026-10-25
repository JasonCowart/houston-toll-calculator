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

item = get("https://www.arcgis.com/sharing/rest/content/items/" + ITEM, {"f": "json"})
url = item["url"].rstrip("/")
print("Item:", item.get("title"), "|", item.get("owner"), "|", url)
svc = get(url, {"f": "json"})
layers = [url] if "fields" in svc else [url + "/" + str(l["id"]) for l in svc.get("layers", []) if "Line" in (l.get("geometryType") or "")]
feats = []
for lu in layers:
    meta = get(lu, {"f": "json"})
    print("Layer:", meta.get("name"), "| fields:", [f["name"] for f in meta.get("fields", [])])
    offset = 0
    while True:
        page = get(lu + "/query", {"where": "1=1", "outFields": "*", "outSR": "4326", "f": "geojson",
                                   "maxAllowableOffset": "0.00015", "geometryPrecision": "5",
                                   "resultOffset": offset, "resultRecordCount": 1000})
        got = page.get("features") or []
        feats += [f for f in got if f.get("geometry")]
        if not got or not (page.get("exceededTransferLimit") or (page.get("properties") or {}).get("exceededTransferLimit")): break
        offset += len(got)
print("Features:", len(feats))
if feats: print("Sample properties:", json.dumps(feats[0].get("properties"))[:800])
json.dump({"type": "FeatureCollection", "source": "TxDOT Texas Toll Roads (arcgis.com item " + ITEM + ")", "features": feats},
          open(sys.argv[1], "w"), separators=(",", ":"))
