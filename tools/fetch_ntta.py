#!/usr/bin/env python3
"""Download the public Dallas-Fort Worth toll gantry layers into data/sources/ (run by the
"Update NTTA data" workflow; the build workspace can't reach ArcGIS).

- NTTA Toll Location + Toll Rates (nttagis): every gantry with its current fares.
- NCTCOG Toll Gantries: every DFW gantry (NTTA, TxDOT and NTE/LBJ TEXpress lanes), with direction text.
"""
import json, urllib.request, urllib.parse

SOURCES = {
    "ntta-rates.json": "https://services.arcgis.com/pS2RA6RqB5M3sZIg/arcgis/rest/services/NTTA_TollLocation_TollRates_View_PROD/FeatureServer/0",
    "nctcog-gantries.json": "https://geospatial.nctcog.org/map/rest/services/Transportation/DFWMaps_Roadway/MapServer/6",
}
UA = {"User-Agent": "hctra-toll-calculator"}

def get(url, params):
    with urllib.request.urlopen(urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers=UA), timeout=90) as r:
        return json.loads(r.read().decode("utf-8"))

for name, url in SOURCES.items():
    rows, offset = [], 0
    while True:
        page = get(url + "/query", {"where": "1=1", "outFields": "*", "outSR": "4326", "f": "json",
                                     "resultOffset": offset, "resultRecordCount": 1000, "orderByFields": "OBJECTID" if "nctcog" in name else "ObjectId"})
        feats = page.get("features") or []
        rows += [{"a": f["attributes"], "x": round(f["geometry"]["x"], 6), "y": round(f["geometry"]["y"], 6)} for f in feats if f.get("geometry")]
        if not page.get("exceededTransferLimit") or not feats: break
        offset += len(feats)
    json.dump({"source": url, "rows": rows}, open("data/sources/" + name, "w"), indent=0, default=str)
    print(name, len(rows))
