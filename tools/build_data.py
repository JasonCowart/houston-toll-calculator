"""Build data/toll-points.json from the HCTRA toll location layer (GeoJSON features).

Usage: python3 tools/build_data.py <features.json> data/toll-points.json

Rate check (Oct 20, 2026) results applied here:
- HCTRA-owned points were checked against hctra.org/TollRates -> status "verified".
- 17 HCTRA points carry a 3-axle no-TAG rate of $1.30 that should be $3.00 -> overridden.
- Katy Managed Lanes and SH 288 Express Lanes use variable pricing -> status "pending".
- Everything else (TxDOT, FBCTRA, BCTRA, MCTRA) -> "unverified".
"""
import json, sys

AXLE3_NOTAG_FIX = {105, 106, 107, 108, 115, 193, 194, 197, 198, 199, 200, 212, 213, 220, 221, 222, 225}
PENDING_ROADS = {"Katy Managed Lanes", "SH 288 Express Lanes"}
DIR = {"North": "N", "South": "S", "East": "E", "West": "W"}

def r(v):
    return None if v is None else round(float(v), 2)

def kind(t):
    t = (t or "").replace(" ", "")
    if "Ramp-On" in t: return "on"
    if "Ramp-Off" in t: return "off"
    return "main"

src, out = sys.argv[1], sys.argv[2]
pts = []
for x in json.load(open(src)):
    owner = (x["RoadwayOwner"] or "").replace(" ", "")
    road = x["Toll_Road"]
    status = "pending" if road in PENDING_ROADS else ("verified" if owner == "HCTRA" else "unverified")
    notag = [r(x["NoTAG"])] + [r(x["AxleRate%dNoTAG" % i]) for i in range(3, 9)]
    notes = []
    if x["OBJECTID"] in AXLE3_NOTAG_FIX:
        notag[1] = 3.0
        notes.append("3-axle no-TAG rate corrected from $1.30 to $3.00 (layer error)")
    ez2 = r(x["EZ_Rate"])
    pts.append({
        "id": x["OBJECTID"],
        "name": x["Name"],
        "road": road,
        "owner": owner,
        "kind": kind(x["Type"]),
        "dir": DIR.get(x["TrafficDirection"]),
        "lon": round(x["_coords"][0], 6),
        "lat": round(x["_coords"][1], 6),
        "ez2": ez2,
        "tag2": r(x["OtherTAG2AxleRate"]) if x["OtherTAG2AxleRate"] is not None else ez2,
        "tag": [r(x["AxleRate%d" % i]) for i in range(3, 9)],
        "notag": notag,
        "status": status,
        **({"note": "; ".join(notes)} if notes else {}),
    })
pts.sort(key=lambda p: p["id"])
meta = {
    "source": "HCTRA toll location layer (ExternalOnlineMap MapServer layer 4), exported Oct 20, 2026",
    "rateCheck": "HCTRA-owned rates checked against hctra.org/TollRates on Oct 20, 2026",
    "fields": "ez2/tag2 = 2-axle EZ TAG / other tag; tag = 3..8 axles with a tag; notag = 2..8 axles pay-by-mail",
}
json.dump({"meta": meta, "points": pts}, open(out, "w"), separators=(",", ":"))
print(len(pts), "points written")
