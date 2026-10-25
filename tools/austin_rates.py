#!/usr/bin/env python3
"""Austin-area toll rates, checked against the owners' published 2026 schedules (Oct 24, 2026).

  python3 tools/austin_rates.py data/toll-points.json

Run after tools/build_data.py. Updates the Austin points in place (safe to run again).

TxDOT Central Texas Turnpike System (SH 130 segments 1-4, SH 45 North, Loop 1, SH 45 Southeast),
rates effective Jan 1, 2026 (txdot.gov "Central Texas Turnpike System toll rates"):
- 2-axle TxTag and non-tag rates per plaza / ramp, below. EZ TAG and other tags pay the TxTag rate.
- 3+ axles = 2-axle rate x (axles - 1). On SH 130 and SH 45 SE, truck tolls are capped at the
  4-axle rate (TxDOT annual toll rate report: "the truck tolls on SH 130 and SH 45 SE are capped
  at the 4-axle rate"); TxDOT's 2026 page lists separate 5- and 6-axle rates for those roads.
- Non-tag = the non-tag 2-axle rate x (axles - 1), same caps (50% over the TxTag rate).

SH 130 segments 5-6 (SH 130 Concession Company, mysh130.com): charged by vehicle class, not axles.
Class A (cars, under 7 ft high / 20 ft long), B (A + trailer), C (larger, no trailer), D (larger
+ one trailer), E (more than one trailer). Axles are mapped 2 = A, 3 = B, 4 = C, 5 = D, 6+ = E,
an estimate (marked axleNote "class"). New rates take effect Nov 11, 2026 ("next").
"""
import json, sys

CTTS = "TxDOT CTTS rates (eff. Jan 1, 2026)"
# (road in the layer, point name) -> (TxTag 2-axle, non-tag 2-axle, capped at 4 axles?)
CTTS_RATES = {}
def add(road, names, tag, notag, cap):
    for n in names: CTTS_RATES[(road, n)] = (tag, notag, cap)
add("Loop1 / MoPac Expwy", ["Merrilltown Plaza"], 1.36, 2.04, False)
add("Loop1 / MoPac Expwy", ["Shoreline Dr", "Wells Branch/Howard"], 0.90, 1.35, False)
add("SH 130", ["Mustang Creek Plaza", "Cameron Plaza", "Decker Creek Plaza", "Airport Plaza", "Cameron Rd"], 2.24, 3.36, True)
add("SH 130", ["SH 29", "Blue Bluff Rd", "Tesla Rd", "Moore Rd"], 0.61, 0.92, True)
add("SH 130", ["CR 104", "Pecan St", "Gregg Manor Rd", "FM 973 / Bloor Rd", "FM 969", "Pearce Ln", "FM 812"], 0.76, 1.14, True)
add("SH 130", ["US 79", "CR 138 / Gattis School Rd / FM 685", "Chandler Rd", "Elroy Rd"], 0.95, 1.43, True)
# SH 45 North ("Lake Creek Pkwy" ramps sit at the Lake Creek plaza and are charged its rate)
add("SH 45 N", ["Lake Creek Plaza", "Lake Creek Pkwy", "Heatherwilde Plaza", "Donnell Dr", "N Heatherwilde Blvd"], 1.36, 2.04, False)
add("SH 45 N", ["Parmer Ln", "RM 620"], 1.18, 1.77, False)
add("SH 45 N", ["O'Connor Dr", "O'Connor Dr Connector"], 1.20, 1.80, False)
add("SH 45 N", ["Greenlawn Blvd", "S A.W. Grimes Blvd"], 0.90, 1.35, False)
add("SH 45 SE", ["Southeast Mainline"], 1.34, 2.01, True)
add("SH 45 SE", ["FM 1625", "N Turnersville Rd"], 0.87, 1.31, True)

SH130_SOUTH = "SH 130 Concession Co. rates"
# name -> classes A..E as (tag, mail); current, then from Nov 11, 2026
CLASS_NOW = {
    "SH 21": [(1.24, 1.65), (2.48, 3.30), (3.71, 4.93), (4.95, 6.58), (6.18, 8.22)],
    "Skyline Plaza": [(3.29, 4.38), (6.56, 8.72), (9.84, 12.90), (13.12, 16.18), (16.40, 19.46)],
    "FM 1185": [(0.69, 0.92), (1.36, 1.81), (2.04, 2.71), (2.72, 3.62), (3.40, 4.52)],
    "SH 142": [(1.06, 1.41), (2.11, 2.81), (3.17, 4.22), (4.22, 5.61), (5.28, 7.02)],
    "Bluebonnet Plaza": [(7.18, 9.55), (14.33, 17.39), (21.51, 24.57), (28.66, 31.72), (35.83, 38.89)],
    "SH 80": [(4.14, 5.51), (8.26, 10.99), (12.39, 15.45), (16.51, 19.57), (20.64, 23.70)],
    "FM 621": [(3.44, 4.58), (6.87, 9.14), (10.31, 13.37), (13.74, 16.80), (17.18, 20.24)],
    "FM 20": [(1.77, 2.35), (3.52, 4.68), (5.29, 7.04), (7.04, 9.36), (8.81, 11.72)],
}
CLASS_NEXT = {
    "SH 21": [(1.31, 1.74), (2.62, 3.48), (3.93, 5.23), (5.23, 6.96), (6.54, 8.70)],
    "Skyline Plaza": [(3.47, 4.62), (6.95, 9.24), (10.41, 13.65), (13.88, 17.12), (17.34, 20.58)],
    "FM 1185": [(0.72, 0.96), (1.44, 1.92), (2.16, 2.87), (2.88, 3.83), (3.59, 4.77)],
    "SH 142": [(1.12, 1.49), (2.24, 2.98), (3.35, 4.46), (4.46, 5.93), (5.58, 7.42)],
    "Bluebonnet Plaza": [(7.58, 10.08), (15.17, 18.41), (22.75, 25.99), (30.32, 33.56), (37.89, 41.13)],
    "SH 80": [(4.37, 5.81), (8.74, 11.62), (13.10, 16.34), (17.47, 20.71), (21.83, 25.07)],
    "FM 621": [(3.63, 4.83), (7.28, 9.68), (10.90, 14.14), (14.53, 17.77), (18.16, 21.40)],
    "FM 20": [(1.87, 2.49), (3.73, 4.96), (5.59, 7.43), (7.45, 9.91), (9.31, 12.38)],
}
NEXT_FROM = "2026-11-11"
AXLE_CLASS = [0, 1, 2, 3, 4, 4, 4]  # axles 2..8 -> class A..E

def ctts_rates(tag2, notag2, cap):
    mult = [min(n - 1, 3) if cap else n - 1 for n in range(2, 9)]  # axles 2..8
    return ([round(tag2 * m, 2) for m in mult[1:]], [round(notag2 * m, 2) for m in mult])

def class_rates(table):
    cls = [table[c] for c in AXLE_CLASS]
    return {"ez2": cls[0][0], "tag2": cls[0][0], "tag": [c[0] for c in cls[1:]], "notag": [c[1] for c in cls]}

path = sys.argv[1]
data = json.load(open(path))
done = 0
for p in data["points"]:
    road = p["road"]
    if road == "SH 45":  # the layer calls both SH 45 North and SH 45 Southeast "SH 45"
        road = "SH 45 SE" if p["lat"] < 30.2 else "SH 45 N"
    if road == "SH 130" and p["name"] in CLASS_NOW:
        p.update(class_rates(CLASS_NOW[p["name"]]))
        p["next"] = dict(class_rates(CLASS_NEXT[p["name"]]), **{"from": NEXT_FROM})
        p["owner"] = "SH130CC"
        p["status"] = "verified"; p["checked"] = SH130_SOUTH + " (current; new rates Nov 11, 2026)"
        p["axleNote"] = "class"; p["assumedAxles"] = [3, 4, 5, 6, 7, 8]
        p["road"] = "SH 130"
        done += 1
        continue
    key = (road, p["name"])
    if key in CTTS_RATES:
        tag2, notag2, cap = CTTS_RATES[key]
        tag, notag = ctts_rates(tag2, notag2, cap)
        p.update({"ez2": tag2, "tag2": tag2, "tag": tag, "notag": notag, "status": "verified", "checked": CTTS})
        p.pop("assumedAxles", None); p.pop("axleNote", None)
        if road.startswith("SH 45"): p["road"] = road
        done += 1
missing = [p["id"] for p in data["points"] if p["lon"] > -98.2 and p["lon"] < -97.2 and p["status"] != "verified"]
data["meta"]["austinCheck"] = "TxDOT CTTS and SH 130 segments 5-6 rates checked Oct 24, 2026"
json.dump(data, open(path, "w"), separators=(",", ":"))
print(done, "Austin points updated; unchecked left:", missing)
