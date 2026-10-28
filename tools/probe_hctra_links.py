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
    finally:
        browser.close()
json.dump(out, open("data/hctra-links-probe.json", "w"), indent=1)
print(len(out.get("links", [])), "links")
