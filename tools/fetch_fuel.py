#!/usr/bin/env python3
"""Weekly fuel prices for the gas estimate, from the U.S. Energy Information Administration.

Reads EIA's "Gasoline and Diesel Fuel Update" page (free, no key; updated Mondays) and
writes data/fuel-prices.json:
  regular: Houston's average retail price for regular gasoline (EIA's city table)
  diesel:  Texas's on-highway diesel price if EIA lists Texas, else the Gulf Coast (PADD 3)

Run by the Deploy site workflow (weekly on a schedule, and on every deploy). If the page
can't be read or the numbers look wrong, the file is left as it is and the step only warns,
so a bad week never breaks the site: the app then uses the last good prices.

  python3 tools/fetch_fuel.py            # update data/fuel-prices.json
  python3 tools/fetch_fuel.py --check    # print what it would write
"""
import datetime
import html.parser
import json
import os
import re
import sys
import urllib.request

URL = "https://www.eia.gov/petroleum/gasdiesel/"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "fuel-prices.json")
UA = "Mozilla/5.0 (compatible; HCTRA-toll-calculator fuel price check)"
DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2})$")
NUM_RE = re.compile(r"^\d+\.\d{2,3}$")


class Tables(html.parser.HTMLParser):
    """Collects every table as rows of cell text, each tagged with the heading text seen
    most recently before it ("gasoline" or "diesel")."""

    def __init__(self):
        super().__init__()
        self.tables, self.stack, self.kind = [], [], None
        self.row = self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            t = {"kind": self.kind, "rows": []}
            self.tables.append(t)
            self.stack.append(t)
        elif self.stack and tag == "tr":
            self.row = []
        elif self.stack and tag in ("td", "th"):
            self.cell = []

    def handle_endtag(self, tag):
        if tag == "table" and self.stack:
            self.stack.pop()
        elif self.stack and tag in ("td", "th") and self.cell is not None and self.row is not None:
            self.row.append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif self.stack and tag == "tr" and self.row is not None:
            if self.row:
                self.stack[-1]["rows"].append(self.row)
            self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)
        t = data.lower()
        if len(t) > 120:
            return
        # A heading such as "U.S. On-Highway Diesel Fuel Prices": the tables after it are diesel.
        # (Inside a layout table the heading may itself sit in a cell; tables opened later take it.)
        if "diesel" in t and "price" in t:
            self.kind = "diesel"
        elif "gasoline" in t and "price" in t:
            self.kind = "gasoline"


def latest(table, label):
    """(date, price) for the row starting with label: the last of the weekly columns."""
    dates = []
    for row in table["rows"]:
        ds = [c for c in row if DATE_RE.match(c)]
        if len(ds) >= 2:
            dates = ds
            break
    for row in table["rows"]:
        if row and row[0].lower().startswith(label.lower()):
            nums = [c for c in row[1:] if NUM_RE.match(c)]
            n = len(dates) or 3
            if len(nums) >= n:
                d = None
                if dates:
                    m = DATE_RE.match(dates[-1])
                    d = datetime.date(2000 + int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
                return d, float(nums[n - 1])
    return None, None


def parse(page):
    p = Tables()
    p.feed(page)
    gas = dsl = None
    for t in p.tables:
        if gas is None and t["kind"] == "gasoline":
            d, v = latest(t, "Houston")
            if v:
                gas = (d, v, "Houston")
        if dsl is None and t["kind"] == "diesel":
            d, v = latest(t, "Texas")
            if v:
                dsl = (d, v, "Texas")
            else:
                d, v = latest(t, "Gulf Coast")
                if v:
                    dsl = (d, v, "Gulf Coast")
    return gas, dsl


def main():
    check = "--check" in sys.argv
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "text/html"})
        with urllib.request.urlopen(req, timeout=45) as r:
            page = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - any failure keeps last week's prices
        print(f"::warning::Couldn't read EIA fuel prices ({e}); keeping the last ones.")
        return 0
    gas, dsl = parse(page)
    if not gas or not dsl or not (1.5 <= gas[1] <= 9) or not (1.5 <= dsl[1] <= 10):
        print(f"::warning::EIA fuel prices not found or out of range (gas {gas}, diesel {dsl}); keeping the last ones.")
        return 0
    out = {
        "regular": round(gas[1], 2), "diesel": round(dsl[1], 2),
        "week": gas[0] or dsl[0], "regularArea": gas[2], "dieselArea": dsl[2],
        "source": "U.S. Energy Information Administration, Gasoline and Diesel Fuel Update",
        "url": URL, "fetched": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
    }
    if check:
        print(json.dumps(out, indent=2))
        return 0
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(f"Fuel prices: regular ${out['regular']:.2f} ({gas[2]}), diesel ${out['diesel']:.2f} ({dsl[2]}), week of {out['week']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
