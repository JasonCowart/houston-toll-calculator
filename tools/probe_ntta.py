#!/usr/bin/env python3
"""One-off look at the public toll data for the Dallas-Fort Worth area (NTTA), so the importer
can be written against the real fields. Run by the "Probe NTTA data" workflow (GitHub's servers
can reach ArcGIS; the build workspace can't).

Looks at:
- NCTCOG's "Toll Gantries" layer (hub.arcgis.com/datasets/NCTCOGGIS::toll-gantries)
- NTTA's "Toll Rates Web Map" (arcgis.com item 06c5e54b951747ea92080b90f24b058c)

Writes data/ntta-probe.json: item details, each layer's URL, fields, record count, extent and a
few sample records. Public data only; no keys.
"""
import json, urllib.request, urllib.parse

UA = {"User-Agent": "hctra-toll-calculator-probe"}
OUT = {"checked": None, "searches": [], "layers": []}

def get(url, params=None):
    if params: url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def safe(fn, *a, **k):
    try: return fn(*a, **k)
    except Exception as e: return {"error": str(e)[:300]}

def layer_info(url, why):
    url = url.rstrip("/")
    info = {"why": why, "url": url}
    meta = safe(get, url, {"f": "json"})
    if "error" in meta and isinstance(meta["error"], str): info["error"] = meta["error"]; OUT["layers"].append(info); return
    if "layers" in meta and "fields" not in meta:  # a service: look at each layer
        info["serviceLayers"] = [{"id": l.get("id"), "name": l.get("name"), "geometryType": l.get("geometryType")} for l in meta.get("layers", [])]
        OUT["layers"].append(info)
        for l in meta.get("layers", [])[:12]:
            layer_info(url + "/" + str(l["id"]), why + " / " + str(l.get("name")))
        return
    info.update({"name": meta.get("name"), "geometryType": meta.get("geometryType"), "description": (meta.get("description") or "")[:500],
                 "copyright": meta.get("copyrightText"), "editingInfo": meta.get("editingInfo"),
                 "fields": [{"name": f.get("name"), "type": f.get("type"), "alias": f.get("alias"),
                             "domain": [c.get("name") for c in (f.get("domain") or {}).get("codedValues", [])][:40] or None} for f in meta.get("fields", [])]})
    cnt = safe(get, url + "/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"})
    info["count"] = cnt.get("count", cnt)
    ext = safe(get, url + "/query", {"where": "1=1", "returnExtentOnly": "true", "outSR": "4326", "f": "json"})
    info["extent"] = ext.get("extent", ext)
    sample = safe(get, url + "/query", {"where": "1=1", "outFields": "*", "resultRecordCount": "8", "outSR": "4326", "f": "json"})
    info["sample"] = [{"attributes": f.get("attributes"), "geometry": f.get("geometry")} for f in (sample.get("features") or [])] if isinstance(sample, dict) else sample
    OUT["layers"].append(info)

# 1. Find the NCTCOG Toll Gantries item and its service URL.
for q in ['title:"Toll Gantries"', '"Toll Gantries" NCTCOG', 'NTTA toll gantries']:
    res = safe(get, "https://www.arcgis.com/sharing/rest/search", {"q": q, "f": "json", "num": "20"})
    items = [{"id": i.get("id"), "title": i.get("title"), "owner": i.get("owner"), "type": i.get("type"), "url": i.get("url"),
              "modified": i.get("modified"), "access": i.get("access")} for i in (res.get("results") or [])] if isinstance(res, dict) else res
    OUT["searches"].append({"q": q, "items": items})
hub = safe(get, "https://hub.arcgis.com/api/v3/datasets", {"q": "toll gantries"})
OUT["hub"] = [{"id": d.get("id"), "name": (d.get("attributes") or {}).get("name"), "url": (d.get("attributes") or {}).get("url"),
               "source": (d.get("attributes") or {}).get("source"), "records": (d.get("attributes") or {}).get("recordCount")}
              for d in (hub.get("data") or [])][:20] if isinstance(hub, dict) else hub

seen = set()
for s in OUT["searches"]:
    for i in s["items"] if isinstance(s["items"], list) else []:
        if i.get("url") and "toll" in (i.get("title") or "").lower() and i["url"] not in seen and i.get("type") in ("Feature Service", "Map Service"):
            seen.add(i["url"]); layer_info(i["url"], "search: " + i["title"] + " (" + str(i.get("owner")) + ")")
for d in OUT["hub"] if isinstance(OUT["hub"], list) else []:
    if d.get("url") and "toll" in (d.get("name") or "").lower() and d["url"] not in seen:
        seen.add(d["url"]); layer_info(d["url"], "hub: " + str(d["name"]))

# 2. NTTA's Toll Rates Web Map: its layers.
wm = safe(get, "https://www.arcgis.com/sharing/rest/content/items/06c5e54b951747ea92080b90f24b058c", {"f": "json"})
OUT["nttaWebMapItem"] = {k: wm.get(k) for k in ("title", "owner", "type", "modified", "description", "snippet")} if isinstance(wm, dict) else wm
data = safe(get, "https://www.arcgis.com/sharing/rest/content/items/06c5e54b951747ea92080b90f24b058c/data", {"f": "json"})
ops = data.get("operationalLayers", []) if isinstance(data, dict) else []
OUT["nttaWebMapLayers"] = [{"title": o.get("title"), "url": o.get("url"), "itemId": o.get("itemId")} for o in ops]
for o in ops:
    if o.get("url") and o["url"] not in seen:
        seen.add(o["url"]); layer_info(o["url"], "NTTA web map: " + str(o.get("title")))

import datetime
OUT["checked"] = datetime.datetime.utcnow().isoformat() + "Z"
json.dump(OUT, open("data/ntta-probe.json", "w"), indent=1, default=str)
print("layers:", len(OUT["layers"]))
