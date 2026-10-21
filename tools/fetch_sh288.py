"""Download TxDOT's SH 288 managed-lanes toll schedule and save it as JSON.

Usage: python3 tools/fetch_sh288.py data/sh288-rates.json

TxDOT publishes one table per gantry (mainline gantries and direct connectors,
each direction): 48 half-hour rows (Midnight ... 11:30 PM, "Midday" = 12:00 PM)
by Monday..Sunday plus Holidays, for 2-axle vehicles. Trucks pay rate x class
factor (axles - 1, max 5). Without a tag: rate x factor x 1.5, plus fees.
"""
import json, re, sys, urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser

URL = "https://www.txdot.gov/discover/toll-roads-managed-lanes/managed-lanes/sh288-toll/sh288-managed-lanes-project-toll-rates.html"
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "hol"]


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.recent, self.text, self.cap = [], [], None, None
        self.cur = self.row = self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            named = [t for t in self.recent if key_for(t)]
            self.cur = {"label": named[-1] if named else (self.recent[-1] if self.recent else ""), "rows": []}
        elif tag == "caption" and self.cur is not None:
            self.cap = ""
        elif tag == "tr" and self.cur is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ""
        elif tag in ("h2", "h3", "h4", "h5", "h6", "p", "strong", "b") and self.cur is None:
            self.text = ""

    def handle_endtag(self, tag):
        if tag == "table" and self.cur is not None:
            self.tables.append(self.cur)
            self.cur = None
        elif tag == "caption" and self.cap is not None:
            if key_for(self.cap):
                self.cur["label"] = self.cap.strip()
            self.cap = None
        elif tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(self.cell.split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.cur["rows"].append(self.row)
            self.row = None
        elif tag in ("h2", "h3", "h4", "h5", "h6", "p", "strong", "b") and self.text is not None:
            t = " ".join(self.text.split())
            if t and len(t) < 200:
                self.recent = (self.recent + [t])[-6:]
            self.text = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data
        elif self.cap is not None:
            self.cap += data
        elif self.text is not None:
            self.text += data


def key_for(label):
    """Short key for a table, e.g. 'brays-nb', 'bw8wb-to-288', '288nb-to-610'."""
    l = label.lower()
    d = "nb" if "northbound" in l else "sb" if "southbound" in l else ""
    for name in ("brays", "holly", "almeda"):
        if name in l and "mainlane" in l:
            return f"{name}-{d}"
    if "bw 8 westbound to sh 288" in l: return "bw8wb-to-288"
    if "bw 8 eastbound to sh 288" in l: return "bw8eb-to-288"
    if "sh 288 northbound to bw 8" in l: return "288nb-to-bw8"
    if "sh 288 southbound to bw 8" in l: return "288sb-to-bw8"
    if "i-610 to sh 288 northbound" in l: return "610-to-288nb"
    if "i-610 to sh 288 southbound" in l: return "610-to-288sb"
    if "sh 288 northbound to i-610" in l: return "288nb-to-610"
    if "sh 288 southbound to i-610" in l: return "288sb-to-610"
    return None


def main(out):
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (houston-toll-calculator rate fetcher)"})
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    p = Tables()
    p.feed(html)
    eff = re.search(r"rates shown below are effective\s+([A-Za-z]+\.?\s+\d{1,2},\s+\d{4})", html, re.I)
    gantries, problems = {}, []
    for t in p.tables:
        k = key_for(t["label"])
        rows = t["rows"]
        if not k:
            problems.append("unrecognized table: " + t["label"][:80])
            continue
        head = [c.lower() for c in rows[0]]
        if len(rows) != 49 or len(head) != 9 or not head[1].startswith("mon") or not head[8].startswith("holiday"):
            problems.append(f"{k}: unexpected shape {len(rows)}x{len(head)}")
            continue
        grid = []
        for r in rows[1:]:
            grid.append([float(c.replace("$", "")) for c in r[1:9]])
        if rows[1][0].lower() != "midnight" or rows[48][0] != "11:30 PM":
            problems.append(f"{k}: unexpected time labels")
        gantries[k] = grid
    expected = {"brays-nb", "brays-sb", "holly-nb", "holly-sb", "almeda-nb", "almeda-sb", "bw8wb-to-288", "bw8eb-to-288",
                "288nb-to-bw8", "288sb-to-bw8", "610-to-288nb", "610-to-288sb", "288nb-to-610", "288sb-to-610"}
    missing = expected - set(gantries)
    if missing:
        problems.append("missing tables: " + ", ".join(sorted(missing)))
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    data = {
        "source": URL,
        "effective": eff.group(1) if eff else "unknown",
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "notes": "2-axle tag rates; rows = 48 half-hour slots from midnight; columns = " + ",".join(DAYS) +
                 ". Trucks: x (axles-1), max 5. No tag: x 1.5 plus fees (from Oct 1, 2026).",
        "days": DAYS,
        "gantries": gantries,
    }
    json.dump(data, open(out, "w"), separators=(",", ":"))
    print(f"wrote {len(gantries)} tables to {out}; effective {data['effective']}")
    for k in sorted(gantries):
        g = gantries[k]
        print(f"  {k}: midnight mon {g[0][0]}, 7:00 AM mon {g[14][0]}, 5:00 PM fri {g[34][4]}, max {max(max(r) for r in g)}")


if __name__ == "__main__":
    main(sys.argv[1])
