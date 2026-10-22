"""Build data/toll-points.json from the HCTRA toll location layer (GeoJSON features).

Usage: python3 tools/build_data.py <features.json> data/toll-points.json

Rate check (Oct 20, 2026) results applied here:
- HCTRA-owned points were checked against hctra.org/TollRates -> status "verified".
- 17 HCTRA points carry a 3-axle no-TAG rate of $1.30 that should be $3.00 -> overridden.
- Katy Managed Lanes and SH 288 Express Lanes are priced by time of day -> status "timed".
- MCTRA (SH 249 Tollway, Tomball Tollway north) and TxDOT SH 249 Tollway Extension points
  were checked against their 2026 schedules on Oct 21, 2026 -> "verified".
- Grand Parkway (TxDOT and FBCTRA), Fort Bend Parkway and the Westpark Tollway Extension
  were checked against their 2026 schedules on Oct 21, 2026 -> "verified".
- Everything else (SH 130, SH 45, Loop 1 near Austin; BCTRA) -> "unverified".
"""
import json, sys

AXLE3_NOTAG_FIX = {105, 106, 107, 108, 115, 193, 194, 197, 198, 199, 200, 212, 213, 220, 221, 222, 225}
# Priced by time of day in js/tolls.js (Katy: HCTRA 2013 chart; SH 288: data/sh288-rates.json)
TIMED = {
    174: "katy-eldridge-eb", 175: "katy-eldridge-wb", 176: "katy-wirt-eb", 177: "katy-wirt-wb",
    178: "katy-wilcrest-eb", 179: "katy-wilcrest-wb",
    311: "brays-nb", 312: "brays-sb", 308: "holly-nb", 307: "holly-sb", 302: "almeda-nb", 303: "almeda-sb",
    299: "bw8wb-to-288", 301: "bw8eb-to-288", 300: "288nb-to-bw8", 304: "288sb-to-bw8",
    310: "610-to-288nb", 306: "288nb-to-610", 309: "288sb-to-610", 305: "610-to-288sb",
}
# The layer swaps these two Grand Parkway gantry names. Coordinates and rates match TxDOT's
# "Riley Fuzzel ML (east of I-45)" at 281/282 and "Hardy ML (east of Hardy Toll Rd.)" at 279/280.
NAME_FIX = {
    279: "Hardy ML Gantry (east of Hardy Toll Rd)", 280: "Hardy ML Gantry (east of Hardy Toll Rd)",
    281: "Riley Fuzzel ML Gantry (east of I-45)", 282: "Riley Fuzzel ML Gantry (east of I-45)",
    # Renamed in spring 2026; keep the old name visible so drivers recognize it.
    160: "Dr. Richard A. Tapia Bridge Gantry (formerly Ship Channel Bridge)",
    161: "Dr. Richard A. Tapia Bridge Gantry (formerly Ship Channel Bridge)",
}
# Whole roads checked against the owner's published 2026 schedule (Oct 21, 2026)
CHECKED_ROADS = {
    ("Grand Parkway", "TxDOT"): "TxDOT SH 99 rates (eff. Jan 1, 2026)",
    ("Grand Parkway", "FBCTRA"): "FBCTRA 2026 rates (eff. Jan 1, 2026)",
    ("Fort Bend Parkway", "FBCTRA"): "FBCTRA 2026 rates (eff. Jan 1, 2026)",
    ("Westpark Tollway Extension", "FBCTRA"): "FBCTRA 2026 rates (eff. Jan 1, 2026)",
}
# Non-HCTRA points checked against the owner's published schedule (Oct 21, 2026)
CHECKED = {
    232: "MCTRA 2026 rates (eff. Jan 1, 2026)", 233: "MCTRA 2026 rates (eff. Jan 1, 2026)",
    236: "MCTRA 2026 rates (eff. Jan 1, 2026)", 237: "MCTRA 2026 rates (eff. Jan 1, 2026)",
    **{i: "TxDOT SH 249 rates (eff. Jan 1, 2026)" for i in range(313, 321)},
}
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
    oid = x["OBJECTID"]
    checked = CHECKED.get(oid) or CHECKED_ROADS.get((road, owner))
    status = "timed" if oid in TIMED else ("verified" if owner == "HCTRA" or checked else "unverified")
    notag = [r(x["NoTAG"])] + [r(x["AxleRate%dNoTAG" % i]) for i in range(3, 9)]
    notes = []
    if x["OBJECTID"] in AXLE3_NOTAG_FIX:
        notag[1] = 3.0
        notes.append("3-axle no-TAG rate corrected from $1.30 to $3.00 (layer error)")
    ez2 = r(x["EZ_Rate"])
    pts.append({
        "id": x["OBJECTID"],
        "name": NAME_FIX.get(x["OBJECTID"], x["Name"]),
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
        **({"schedule": TIMED[oid]} if oid in TIMED else {}),
        **({"checked": checked} if checked else {}),
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
