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
Then run tools/austin_rates.py on the output: it applies the Austin rates checked Oct 24, 2026
(TxDOT Central Texas Turnpike System; SH 130 segments 5-6 by vehicle class, with the Nov 11, 2026 change),
then tools/ntta_points.py: adds the Dallas-Fort Worth (NTTA) points from data/sources/.
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
    **{i: "BCTRA 2026 rates (eff. Jan 1, 2026)" for i in range(238, 242)},
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
    tag = [r(x["AxleRate%d" % i]) for i in range(3, 9)]
    assumed = []
    # FBCTRA publishes rates up to 6 axles only. 7+ axles are charged the top posted class
    # (6 axles), as on TxDOT's Grand Parkway: Jason's call, Oct 21, 2026; to confirm with FBCTRA.
    # BCTRA publishes one non-tag rate (2 axles). Its toll policy (eff. July 23, 2026) says
    # image (no-tag) trips pay the base rate x (axles - 1), which is the 3+ axle column, so
    # the layer's empty 3-8 axle no-tag rates are filled from the tag rates.
    if owner == "BCTRA":
        for axles in range(3, 9):
            if notag[axles - 2] is None and tag[axles - 3] is not None:
                notag[axles - 2] = tag[axles - 3]
        notes.append("3+ axle no-tag rates = tag rates, per BCTRA's toll policy")
    if owner == "FBCTRA":
        for axles in (7, 8):
            if tag[axles - 3] is None and tag[3] is not None:
                tag[axles - 3] = tag[3]; assumed.append(axles)
            if notag[axles - 2] is None and notag[4] is not None:
                notag[axles - 2] = notag[4]
                if axles not in assumed: assumed.append(axles)
        if assumed:
            notes.append("7+ axles priced at FBCTRA's top posted class (6 axles); assumed")
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
        "tag": tag,
        "notag": notag,
        "status": status,
        **({"schedule": TIMED[oid]} if oid in TIMED else {}),
        **({"checked": checked} if checked else {}),
        **({"assumedAxles": assumed} if assumed else {}),
        # BC Expressway gantries sit on SH 288's express lanes, which run beside the free
        # main lanes Esri routes on: priced as a lane option, like the Katy and SH 288 lanes.
        **({"lane": True} if owner == "BCTRA" and kind(x["Type"]) == "main" else {}),
        **({"note": "; ".join(notes)} if notes else {}),
    })
pts.sort(key=lambda p: p["id"])
meta = {
    "source": "HCTRA toll location layer (ExternalOnlineMap MapServer layer 4), exported Oct 20, 2026",
    "rateCheck": "HCTRA-owned rates checked against hctra.org/TollRates on Oct 20, 2026",
    "fields": "ez2/tag2 = 2-axle EZ TAG / other tag; tag = 3..8 axles with a tag; notag = 2..8 axles pay-by-mail",
    # Last day the rates were checked against the agencies' published tables. Shown on the
    # site as "Rates as of". Update it whenever rates are re-checked.
    "ratesAsOf": "2026-10-22",
}
json.dump({"meta": meta, "points": pts}, open(out, "w"), separators=(",", ":"))
print(len(pts), "points written")
