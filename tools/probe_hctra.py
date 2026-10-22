"""One-off: report which HCTRA GIS URLs answer from GitHub's runners."""
import urllib.request
for u in ["https://gismaps.hctra.org/rd/rest/services?f=json",
          "https://gismaps.hctra.org/rd/rest/services/ExternalOnlineMap?f=json",
          "https://gismaps.hctra.org/rd/rest/services/ExternalOnlineMap/HCTRASystemMap/MapServer?f=json",
          "https://gismaps.hctra.org/rd/rest/services/ExternalOnlineMap/HCTRASystemMap/MapServer/3?f=json",
          "https://gismaps.hctra.org/rd/rest/services/ExternalOnlineMap/HCTRASystemMap/MapServer/4?f=json"]:
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
            print("::notice::%s %s %s" % (r.status, u[38:], r.read(220).decode("utf8", "replace").replace("\n", " ")))
    except Exception as e:
        print("::notice::FAIL %s %s" % (u[38:], e))
