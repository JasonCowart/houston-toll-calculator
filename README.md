# HCTRA Toll Calculator

Enter two addresses, pick your vehicle (axles) and how you pay. The page finds the fastest route and a toll-free route, adds up the tolls on the toll route, and shows whether the tolls are worth the time saved.

It's a static site (no server), hosted on GitHub Pages. Maps, address search and routing come from the ArcGIS Location Platform free tier.

## Setup

1. In your ArcGIS Location Platform portal, restrict the API key's **referrer** to `https://jasoncowart.github.io/`, then regenerate the key.
2. Add the key as a secret: **Settings → Secrets and variables → Actions → New repository secret**. Name it `ARCGIS_API_KEY` and paste the key as the value.
3. Turn on GitHub Pages: **Settings → Pages → Source: GitHub Actions**.
4. Run the **Deploy site** workflow (**Actions → Deploy site → Run workflow**). It also runs on every push to `main`. The site is at `https://jasoncowart.github.io/houston-toll-calculator/`.

Optional settings (same page):
- `TOMTOM_API_KEY` (secret): live traffic test in the debug view (`?debug=1`) only.
- `REPORT_EMAIL` (on the **Variables** tab): turns on "Report a wrong toll". Use a shared inbox; the address is visible in the page.
- `GOATCOUNTER_CODE` (on the **Variables** tab): turns on anonymous usage counts at goatcounter.com (no cookies). Use the site code only, e.g. `hctra-tolls` for hctra-tolls.goatcounter.com. Counted: visits, actions (compare, PDF, print, share, map app opens, reports, best time, trip back, stops added, language) and trip types (state, axles, payment, number of stops, toll range, toll roads). Never addresses or routes; not counted in the debug view.

To take the site offline, add an empty `SITE_OFFLINE` file and push; delete it to bring the site back.

**Preview before going live:** push changes to the `preview` branch to try them at `https://jasoncowart.github.io/houston-toll-calculator/preview/` (yellow PREVIEW tag, same keys, not counted, not indexed). The `Publish preview` workflow asks main's Deploy site to run, which builds the preview branch into `/preview/` (Pages only deploys from `main`). If the preview's tests fail, only the main site publishes. When it's approved, fast-forward `main` to `preview` and push.

The key never goes in the code. The workflow writes it into `config.js` only in the published copy.

Keep pay-as-you-go **off** in Esri. The free tier then pauses at its limit instead of billing.

## How tolls are counted

- `data/toll-points.json` holds 604 toll points with rates for 2–8 axles: EZ TAG, other tag, and no tag (pay by mail). Houston and Austin TxDOT points come from HCTRA's toll location layer (`tools/build_data.py`, `tools/austin_rates.py`); DFW points come from NTTA's rate schedule and NCTCOG's gantry layer (`tools/ntta_points.py`).
- A toll point counts when the route passes within 30 m of it while heading in that point's direction of travel (`js/tolls.js`).
- Every point is checked against its agency's published schedule (`status: "verified"`): HCTRA on Oct 20, 2026; the other agencies later that month (see `meta.ratesAsOf`).
- Katy Managed Lanes and SH 288 Express Lanes are priced by time of day (`status: "timed"`), at the estimated time the car reaches each gantry:
  - Katy: HCTRA's rate chart effective Sept 7, 2013 (still current). 3+ axles $7.00 per plaza; no tag +25%; carpools and motorcycles free weekdays 5–11 am and 2–8 pm.
  - SH 288: TxDOT's half-hour tables (effective Sept 1, 2026) in `data/sh288-rates.json`, refreshed by the **Update SH 288 rates** workflow (`tools/fetch_sh288.py`). Trucks × (axles − 1), max 5; no tag × 1.5 plus fees.
- Montgomery County (Hardin Store, Decker Prairie), TxDOT SH 249 Tollway Extension, TxDOT Grand Parkway (94 points) and Fort Bend County (Grand Parkway Segment D, Fort Bend Parkway, Westpark Tollway Extension; 35 points) were checked against their 2026 schedules on Oct 21, 2026. All match.
- The layer swaps two Grand Parkway gantry names (Riley Fuzzel and Hardy); `tools/build_data.py` fixes the names. Their rates were already right for their locations.
- SH 130, SH 45 and Loop 1 (Austin area, TxDOT and SH 130 Concession Co.) and the NTTA system (DFW) were added and checked in October 2026.
- 17 HCTRA points had a 3-axle no-TAG rate of $1.30 in the layer. It's corrected to $3.00 here (see `tools/build_data.py`).

## Coverage

The toll road lines on the map (`data/toll-roads.geojson`) cover every toll road in Texas, from TxDOT. Toll points and rates exist only for the areas below. A route that drives on a toll road with no toll points (within 400 m of its line) gets a red warning naming the road, and the toll total shows a "+", instead of a silent $0 (`unpricedRoads` and `unpricedOnRoute` in `js/tolls.js`). Express, managed and HOV/HOT lanes are left out of that check, because they run beside free lanes.

Covered: Houston area (HCTRA, Fort Bend, Montgomery and Brazoria counties, TxDOT Grand Parkway, SH 249 and SH 288), Austin (TxDOT SH 130, SH 45 and Loop 1, and SH 130 segments 5–6), and DFW (NTTA).

Not covered yet:

| Area | Roads | Agency | What's needed |
| --- | --- | --- | --- |
| Tyler | Toll 49 | NET RMA (NTTA bills no-tag trips) | Rates are published only as an image ("Toll Rate Chart" on netrma.org). Get the chart and system map, then place the gantries. |
| Austin | 183 Toll, 183A, 290 Toll, 45SW, 71 Toll Lane, MoPac Express | CTRMA | No public gantry data; their GIS consultant is Atkins. Data request pending. MoPac is priced by time of day. |
| DFW | LBJ, NTE, I-35E, I-30, SH 114, SH 183 and Loop 12 TEXpress Lanes; International Parkway | TEXpress operators (LBJ/NTE Mobility Partners, TxDOT); DFW Airport | Dynamic or time-of-day pricing, like SH 288. |
| Houston | I-45 N, I-45 S, US 290 and US 59 HOV/HOT lanes | METRO | Time-of-day pricing. |
| Brownsville | I-169 / SH 550 | Cameron County RMA | Rates and gantry locations. |
| Galveston | San Luis Pass–Vacek Bridge | Galveston County | One toll point. |
| Border | International bridges and Border West Expressway (El Paso) | Cities, counties and TxDOT | Usually out of scope (border crossings). |

Partner states (Kansas, Colorado, Oklahoma, Florida) aren't covered yet.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `css/style.css` | Page and layout |
| `config.js` | ArcGIS API key (blank in the code; filled in when the site is published) |
| `.github/workflows/deploy.yml` | Tests, inserts the key, publishes to GitHub Pages |
| `js/app.js` | Map, address search, routing, results |
| `js/tolls.js` | Toll matching and pricing (no map code) |
| `js/lang.js` | English/Spanish text |
| `js/pdf.js` | Builds the one-page trip summary PDF (Save PDF) |
| `manifest.webmanifest`, `sw.js`, `assets/icon-*.png` | Add to home screen (app icon, offline copy) |
| `tests/trips/*.json` | Saved real trips replayed by `tools/test_trips.js` on every deploy |
| `tools/watch_rates.py` | Weekly check of the agencies' rate pages (Watch toll rates workflow) |
| `data/toll-points.json` | Toll points and rates |
| `data/sh288-rates.json` | SH 288 time-of-day tables (from TxDOT) |
| `tools/fetch_sh288.py` | Downloads the SH 288 tables (run by the Update SH 288 rates workflow) |
| `tools/build_data.py` | Rebuilds the data file from the layer export |
| `tools/test_tolls.js` | Tests: `node tools/test_tolls.js` |
