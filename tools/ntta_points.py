#!/usr/bin/env python3
"""Dallas-Fort Worth (NTTA) toll points, from the public layers in data/sources/ (downloaded by
the "Update NTTA data" workflow, tools/fetch_ntta.py).

  python3 tools/ntta_points.py data/toll-points.json

Run after tools/build_data.py and tools/austin_rates.py. Replaces the NTTA points in place.

- Locations and direction: NCTCOG "Toll Gantries" (NTTA, fixed-rate, operational). Mainline
  gantries there are one point per direction ("NB", "SB", "EB", "WB" in the name).
- Fares: NTTA's own "Toll Location / Toll Rates" layer (TollTag, 2-axle), matched by gantry code.
  Checked Oct 24, 2026 against NTTA's published table, "Toll rates effective July 1, 2025 through
  June 30, 2027" (25 gantries: every mainline gantry, the bridges, the tunnel and sample ramps).
- 3+ axles: 2-axle TollTag rate x (axles - 1), 6 or more axles x 5 (same table).
- ZipCash (no tag) = 2 x TollTag, every class. EZ TAG and TxTag pay the TollTag rate.
- Not included: TEXpress lanes (TxDOT, NTE, LBJ): their tolls change with traffic.
"""
import json, re, sys, math

ROAD = {"DNT": "Dallas North Tollway", "PGBT": "President George Bush Turnpike", "PGBW": "President George Bush Turnpike",
        "PGBTEE": "President George Bush Turnpike", "SRT": "Sam Rayburn Tollway", "CTP": "Chisholm Trail Parkway",
        "360": "360 Tollway", "360T": "360 Tollway", "AATT": "Addison Airport Toll Tunnel",
        "LLTB": "Lewisville Lake Toll Bridge", "MCLB": "Mountain Creek Lake Bridge"}
CODE_FIX = {"NYAV": "NYAVE"}  # NCTCOG's code for the 360 Tollway New York Ave ramps
KIND = {"Mainlane": "main", "Entrance": "on", "Exit": "off"}
CHECKED = "NTTA toll rates (eff. Jul 1, 2025 - Jun 30, 2027)"
FIRST_ID = 2001

def m(a, b):
    return math.hypot((a[0] - b[0]) * 96000, (a[1] - b[1]) * 111000)

KEEP = {"FM", "SH", "US", "CR", "IH", "I", "NB", "SB", "EB", "WB", "DNT", "SRT", "CTP", "PGBT", "LBJ", "SW", "NW", "NE", "SE"}
def title(s):
    s = re.sub(r"\s+", " ", (s or "").strip())
    if s.isupper(): s = " ".join(w if w in KEEP else w.capitalize() for w in s.split(" "))
    return s

def nice_name(f):
    """NTTA's descriptive name ("Trinity Mills Main Lane Gantry"), without the code in brackets."""
    a = f["a"]
    desc = re.sub(r"\s*\([A-Z0-9]+\)\s*$", "", a.get("RITE_PlazaDescription") or "")
    if not desc or re.search(r"NB AND SB", desc, re.I): desc = a.get("PlazaName") or ""
    desc = title(desc)
    return re.sub(r"\s*\((PGBW|PGBT|SRT|DNT|CTP)\)$", "", desc).replace("Mainlane", "Main Lane")

def rates(tag2):
    mult = [1, 2, 3, 4, 5, 5, 5]  # axles 2..8
    return {"ez2": tag2, "tag2": tag2, "tag": [round(tag2 * k, 2) for k in mult[1:]], "notag": [round(tag2 * 2 * k, 2) for k in mult]}

path = sys.argv[1]
data = json.load(open(path))
data["points"] = [p for p in data["points"] if p.get("owner") != "NTTA"]
fares = {}
for r in json.load(open("data/sources/ntta-rates.json"))["rows"]:
    fares.setdefault(r["a"]["PlazaCode"], []).append(r)
rows = [r for r in json.load(open("data/sources/nctcog-gantries.json"))["rows"]
        if r["a"]["Maintaining_Authority"] == "NTTA" and r["a"]["Toll_Type"] == "Fixed" and r["a"]["Status"] == "Operational"]
pts, used, nid, problems = [], set(), FIRST_ID, []
for r in sorted(rows, key=lambda r: (r["a"]["Corridor"], r["y"], r["x"])):
    a = r["a"]; code = CODE_FIX.get(a["NTTA_Gantry_ID"], a["NTTA_Gantry_ID"])
    cands = fares.get(code, [])
    near = min(cands, key=lambda f: m((f["x"], f["y"]), (r["x"], r["y"])), default=None)
    tag2 = near["a"]["TagFare"] if near else a["Fixed_Toll_Tag"]
    if tag2 is None: problems.append(("no fare", a["Corridor"], a["Location"], code)); continue
    if near: used.add(code)
    kind = KIND.get((a["Ramp_Type"] or "").strip())
    d = re.search(r"\b(NB|SB|EB|WB)\b", a["Location"] or "")
    name = nice_name(near) if near else title(a["Location"])
    if kind == "main" and d: name = name + " " + d.group(1)
    pts.append({"id": nid, "name": name, "road": ROAD.get(a["Corridor"], a["Corridor"]), "owner": "NTTA", "state": "TX",
                "kind": kind, "dir": d.group(1)[0] if d else None, "lon": round(r["x"], 6), "lat": round(r["y"], 6),
                **rates(round(tag2, 2)), "status": "verified", "checked": CHECKED, "code": code})
    nid += 1
# Gantries in NTTA's layer with no NCTCOG point (e.g. Headquarters Dr on the DNT): use NTTA's point.
for code, cands in fares.items():
    if code in used: continue
    for f in cands:
        a = f["a"]
        pts.append({"id": nid, "name": nice_name(f), "road": ROAD.get(a["CORRIDOR"], a["CORRIDOR"]),
                    "owner": "NTTA", "state": "TX", "kind": {"ON_RAMP": "on", "OFF_RAMP": "off", "MLG": "main"}[a["TYPE"]], "dir": None,
                    "lon": round(f["x"], 6), "lat": round(f["y"], 6), **rates(round(a["TagFare"], 2)), "status": "verified",
                    "checked": CHECKED, "code": code})
        nid += 1
# Mainline pairs without a direction in NCTCOG (Arkansas Ln on the Bush Turnpike West): one point
# per carriageway; drivers keep right, so on a north-south road the east point is northbound.
from collections import defaultdict
pairs = defaultdict(list)
for p in pts:
    if p["kind"] == "main" and p["dir"] is None: pairs[(p["road"], p["code"])].append(p)
for group in pairs.values():
    if len(group) == 2:
        e, w = sorted(group, key=lambda p: -p["lon"])
        e["dir"], w["dir"] = "N", "S"
        e["name"] += " NB"; w["name"] += " SB"
data["points"] += pts
data["meta"]["nttaCheck"] = "NTTA gantries (NCTCOG locations, NTTA fares) checked Oct 24, 2026 against NTTA's 2025-2027 rate table"
json.dump(data, open(path, "w"), separators=(",", ":"))
print(len(pts), "NTTA points;", "problems:", problems)
