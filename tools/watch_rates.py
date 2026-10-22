#!/usr/bin/env python3
"""Weekly check of the toll agencies' rate pages.

For each page it keeps a small fingerprint: the dollar amounts, "effective" dates and
rate-file links on it (or the file's checksum for a PDF). Page layout, news and
scripts are ignored, so only a rate change counts as a change.

  python3 tools/watch_rates.py data/rate-watch.json report.md

Updates the snapshot file and writes report.md when something changed or a page
couldn't be read two weeks running. Exit code 0 either way; the workflow turns the
report into a GitHub issue.
"""
import hashlib
import html
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

SOURCES = [
    {"id": "hctra", "name": "HCTRA toll rates", "url": "https://www.hctra.org/TollRates", "kind": "page", "render": True,
     "covers": "Sam Houston, Hardy, Westpark, Tomball, Fort Bend Westpark plazas run by HCTRA, MCTRA SH 249"},
    {"id": "hctra-katy", "name": "HCTRA Katy Managed Lanes schedule (PDF)", "kind": "file",
     "url": "https://www.hctra.org/Content/hctra3rdPartyPages/katymanagedlanes/media/Katy_Toll_Sched.pdf",
     "covers": "Katy Managed Lanes time-of-day rates"},
    {"id": "fbctra", "name": "Fort Bend County Toll Road Authority news about rates", "kind": "posts",
     "url": "https://www.fbctra.com/wp-json/wp/v2/posts?search=toll%20rate&per_page=20&_fields=id,date,link,title",
     "covers": "Fort Bend Parkway, Westpark ext., Grand Parkway (FBCTRA)"},
    {"id": "fbctra-roads", "name": "Fort Bend County Toll Road Authority toll roads page", "kind": "page",
     "url": "https://www.fbctra.com/toll-roads/", "covers": "Fort Bend Parkway, Westpark ext., Grand Parkway (FBCTRA)"},
    {"id": "bctra", "name": "Brazoria County Toll Road Authority rates", "url": "https://www.bctra-tx.com/page/rates", "kind": "page",
     "covers": "SH 288 Brazoria County Expressway"},
    {"id": "txdot-sh99", "name": "TxDOT Grand Parkway (SH 99) rates", "kind": "page",
     "url": "https://www.txdot.gov/discover/toll-roads-managed-lanes/txdot-toll-roads/sh99-grand-parkway-system-toll-rates.html",
     "covers": "Grand Parkway (TxDOT)"},
    {"id": "txdot-sh249", "name": "TxDOT SH 249 rates", "kind": "page",
     "url": "https://www.txdot.gov/discover/toll-roads-managed-lanes/txdot-toll-roads/sh249-project-toll-rates.html",
     "covers": "SH 249 Tollway Extension (Aggie Expressway)"},
    {"id": "txdot-sh288", "name": "TxDOT SH 288 Managed Lanes rates", "kind": "page",
     "url": "https://www.txdot.gov/discover/toll-roads-managed-lanes/managed-lanes/sh288-toll/sh288-managed-lanes-project-toll-rates.html",
     "covers": "SH 288 Express Lanes (Harris County) time-of-day rates"},
]

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 hctra-toll-calculator-rate-watch"
MONEY = re.compile(r"\$\s?\d{1,3}(?:,\d{3})*\.\d{2}")
EFFECTIVE = re.compile(r"effective\W{0,3}(?:\w+\W{1,3}){0,4}?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}|\d{1,2}/\d{1,2}/\d{2,4})", re.I)
HREF = re.compile(r"""(?:href|src)\s*=\s*["']([^"'#]+)["']""", re.I)
RATE_FILE = re.compile(r"\.(pdf|xlsx?)(\?|$)", re.I)
RATE_WORD = re.compile(r"toll|rate|sched|policy|fee", re.I)


def fetch(url):
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5 * (attempt + 1))
    raise last


def render(url):
    """Load the page in headless Chrome (on GitHub's runners) for pages built by scripts."""
    import shutil
    import subprocess
    chrome = next((c for c in ("google-chrome", "chromium", "chromium-browser") if shutil.which(c)), None)
    if not chrome:
        raise RuntimeError("no Chrome to render the page")
    out = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-sandbox", f"--user-agent={UA}",
                          "--virtual-time-budget=20000", "--dump-dom", url],
                         capture_output=True, timeout=120, check=True)
    return out.stdout


def page_text(raw):
    s = raw.decode("utf-8", "replace")
    s = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def fingerprint(src, raw):
    if src["kind"] == "file":
        return {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
    s = raw.decode("utf-8", "replace")
    links = sorted({h.strip() for h in HREF.findall(s)})
    if src["kind"] == "posts":
        posts = json.loads(raw)
        return {"links": sorted(f"{p['date'][:10]} {html.unescape(p['title']['rendered'])} {p['link']}"
                                for p in posts if re.search(r"rate", p["title"]["rendered"], re.I))}
    if src["kind"] == "links":
        pat = re.compile(src["pattern"], re.I)
        return {"links": [h for h in links if pat.search(h)]}
    text = page_text(raw)
    return {
        "amounts": [m.replace(" ", "") for m in MONEY.findall(text)],
        "effective": sorted({" ".join(m.split()) for m in EFFECTIVE.findall(text)}),
        "files": [h for h in links if RATE_FILE.search(h) and RATE_WORD.search(h)],
    }


def describe(old, new):
    out = []
    for key in ("effective", "files", "links"):
        a, b = set(old.get(key, [])), set(new.get(key, []))
        for x in sorted(b - a):
            out.append(f"- New {key[:-1] if key != 'effective' else 'effective date'}: `{x}`")
        for x in sorted(a - b):
            out.append(f"- Gone {key[:-1] if key != 'effective' else 'effective date'}: `{x}`")
    if "amounts" in new and old.get("amounts") != new.get("amounts"):
        a, b = old.get("amounts", []), new["amounts"]
        added = sorted(set(b) - set(a), key=lambda m: float(m[1:].replace(",", "")))
        gone = sorted(set(a) - set(b), key=lambda m: float(m[1:].replace(",", "")))
        out.append(f"- Dollar amounts on the page changed ({len(a)} before, {len(b)} now).")
        if added:
            out.append("  - New amounts: " + ", ".join(added[:40]) + (" …" if len(added) > 40 else ""))
        if gone:
            out.append("  - Amounts no longer shown: " + ", ".join(gone[:40]) + (" …" if len(gone) > 40 else ""))
        if not added and not gone:
            out.append("  - Same amounts, different order or count (a table may have been rearranged).")
    if "sha256" in new and old.get("sha256") != new["sha256"]:
        out.append(f"- The file itself changed ({old.get('bytes')} → {new['bytes']} bytes).")
    return out


def main(snap_path, report_path):
    try:
        snap = json.load(open(snap_path))
    except FileNotFoundError:
        snap = {"sources": {}}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    changed, broken, baseline = [], [], []
    for src in SOURCES:
        prev = snap["sources"].get(src["id"], {})
        try:
            raw = render(src["url"]) if src.get("render") else fetch(src["url"])
            fp = fingerprint(src, raw)
        except Exception as e:  # noqa: BLE001
            fails = prev.get("failures", 0) + 1
            prev.update({"failures": fails, "lastError": f"{type(e).__name__}: {e}"[:300]})
            snap["sources"][src["id"]] = prev
            print(f"{src['id']}: can't read ({fails} in a row): {e}")
            if fails == 2:
                broken.append((src, prev["lastError"]))
            continue
        empty = not any(fp.get(k) for k in ("amounts", "effective", "files", "links", "sha256"))
        if "fingerprint" not in prev:
            baseline.append(src["id"])
        elif fp != prev["fingerprint"]:
            changed.append((src, describe(prev["fingerprint"], fp), prev.get("checked")))
        if empty:
            print(f"{src['id']}: page read but no rates found on it")
        snap["sources"][src["id"]] = {"name": src["name"], "url": src["url"], "fingerprint": fp,
                                      "checked": now, "failures": 0}
        if empty:  # keep a few clues about what the page held, to fix the source
            body = raw.decode("utf-8", "replace")
            title = re.search(r"(?is)<title[^>]*>(.*?)</title>", body)
            snap["sources"][src["id"]]["emptyClues"] = {
                "bytes": len(raw), "title": (title.group(1).strip()[:120] if title else None),
                "text": page_text(raw)[:600],
                "links": sorted({h for h in HREF.findall(body) if re.search(r"rate|toll|sched", h, re.I)})[:40],
                "scripts": sorted({h for h in re.findall(r'''<script[^>]+src=["']([^"']+)''', body, re.I)})[:15],
                "apiHints": sorted(set(re.findall(r'''["'](/api/[^"']{3,80}|[^"' ]{0,60}(?:rate|Rate)[^"' ]{0,40}\.json)["']''', body)))[:20],
            }
        print(f"{src['id']}: ok" + (" (baseline)" if src["id"] in baseline else ""))
    snap["lastRun"] = now
    with open(snap_path, "w") as f:
        json.dump(snap, f, indent=1, sort_keys=True)
        f.write("\n")

    if not changed and not broken:
        print("No rate page changes.")
        return
    lines = []
    if changed:
        lines.append("A toll agency's rate page changed since the last weekly check. "
                     "Check the new rates, update `tools/build_data.py` (and `meta.ratesAsOf`), "
                     "and rerun the rate guard.\n")
        for src, notes, since in changed:
            lines.append(f"### {src['name']}\n[{src['url']}]({src['url']}) · covers {src['covers']} · "
                         f"last unchanged {since or 'unknown'}\n")
            lines.extend(notes or ["- Something on the rate page changed."])
            lines.append("")
    if broken:
        lines.append("### Pages that couldn't be read two weeks running\n"
                     "The page may have moved. Find the new address and update `SOURCES` in `tools/watch_rates.py`.\n")
        for src, err in broken:
            lines.append(f"- [{src['name']}]({src['url']}): {err}")
    with open(report_path, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Report written: {len(changed)} changed, {len(broken)} unreadable.")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
