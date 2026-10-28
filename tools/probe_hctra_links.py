"""One-off check: the links and toll road groups on HCTRA's toll rates page (an app, so it
needs a real browser). Saves them to data/hctra-links-probe.json (public page content)."""
import json, sys
from playwright.sync_api import sync_playwright

URL = "https://www.hctra.org/TollRates?tollRoad=Other+HCTRA-Managed+Toll+Roads"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 hctra-toll-calculator-probe"
out = {"url": URL}
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    try:
        page = browser.new_page(user_agent=UA)
        page.goto(URL, wait_until="load", timeout=90000)
        try:
            page.wait_for_selector("text=/\\$\\d+\\.\\d\\d/", timeout=60000)
        except Exception as e:
            out["waitError"] = str(e)[:300]
        page.wait_for_timeout(3000)
        out["links"] = page.eval_on_selector_all("a[href]", "els => els.map(a => [a.innerText.trim().replace(/\\s+/g, ' '), a.href])")
        out["selects"] = [[o.strip() for o in s.locator("option").all_inner_texts()] for s in page.locator("select").all()]
        body = page.inner_text("body")
        out["text"] = body[:20000]
        # Follow each agency link: where it lands, its title, and the dollar amounts and dates on it.
        import re
        checks = sorted(set(h for t, h in out.get("links", []) if t in ("Visit Toll Rates", "Visit Website")) | {
            "https://mysh130.com/traveler-info/toll-rates/", "https://www.fbctra.com/toll-roads/"})
        out["checks"] = []
        for u in checks:
            r = {"url": u}
            try:
                resp = page.goto(u, wait_until="load", timeout=60000)
                page.wait_for_timeout(2500)
                r.update(status=resp.status if resp else None, final=page.url, title=page.title())
                txt = page.inner_text("body")
                r["amounts"] = re.findall(r"\$\d+\.\d\d", txt)[:40]
                r["dates"] = sorted(set(re.findall(r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? 20\d\d|20\d\d", txt)))[:20]
                r["snippet"] = re.sub(r"\s+", " ", txt)[:1500]
            except Exception as e:
                r["error"] = str(e)[:300]
            out["checks"].append(r)
    finally:
        browser.close()
json.dump(out, open("data/hctra-links-probe.json", "w"), indent=1)
print(len(out.get("links", [])), "links")
