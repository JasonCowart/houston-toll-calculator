# One-time probe: where does hctra.org/TollRates load its rates from?
import json, re, urllib.request
from playwright.sync_api import sync_playwright
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
out = {"requests": [], "console": [], "mainjs": []}
def save():
    out["requests"] = [r for r in out["requests"] if "hctra" in r][:150]
    json.dump(out, open("data/probe-hctra.json", "w"), indent=1)
try:
  html = urllib.request.urlopen(urllib.request.Request("https://www.hctra.org/TollRates", headers={"User-Agent": UA}), timeout=45).read().decode()
  m = re.search(r'src="(/Client_build/Web/main\.[^"]+\.js)"', html)
  if m:
    js = urllib.request.urlopen(urllib.request.Request("https://www.hctra.org" + m.group(1), headers={"User-Agent": UA}), timeout=60).read().decode("utf-8", "replace")
    out["mainjs"] = sorted(set(x for x in re.findall(r'["\'`]((?:/|api/)[A-Za-z0-9_/.-]{3,80})["\'`]', js) if re.search(r"toll|rate|plaza", x, re.I)))[:80]
except Exception as e:
  out["error_mainjs"] = repr(e)
try:
  with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome")
    p = b.new_page(user_agent=UA)
    p.on("response", lambda r: out["requests"].append(f"{r.status} {r.request.resource_type} {r.url[:160]}"))
    p.on("requestfailed", lambda r: out["requests"].append(f"FAILED {r.url[:160]} {r.failure}"))
    p.on("console", lambda m: out["console"].append(m.text[:200]))
    try:
      p.goto("https://www.hctra.org/TollRates", wait_until="load", timeout=60000)
    except Exception as e:
      out["error_goto"] = repr(e)[:300]
    p.wait_for_timeout(20000)
    out["text"] = p.inner_text("body")[:3000]
    b.close()
except Exception as e:
  out["error_browser"] = repr(e)[:300]
save()
