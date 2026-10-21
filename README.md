# Houston Toll Calculator

Enter two addresses, pick your vehicle (axles) and how you pay. The page finds the fastest route and a toll-free route, adds up the tolls on the toll route, and shows whether the tolls are worth the time saved.

It's a static site (no server), hosted on GitHub Pages. Maps, address search and routing come from the ArcGIS Location Platform free tier.

## Setup

1. In your ArcGIS Location Platform portal, restrict the API key's **referrer** to `https://jasoncowart.github.io/`, then regenerate the key.
2. Add the key as a secret: **Settings → Secrets and variables → Actions → New repository secret**. Name it `ARCGIS_API_KEY` and paste the key as the value.
3. Turn on GitHub Pages: **Settings → Pages → Source: GitHub Actions**.
4. Run the **Deploy site** workflow (**Actions → Deploy site → Run workflow**). It also runs on every push to `main`. The site is at `https://jasoncowart.github.io/houston-toll-calculator/`.

The key never goes in the code. The workflow writes it into `config.js` only in the published copy.

Keep pay-as-you-go **off** in Esri. The free tier then pauses at its limit instead of billing.

## How tolls are counted

- `data/toll-points.json` holds 386 toll points from HCTRA's toll location layer, with rates for 2–8 axles: EZ TAG, other tag, and no tag (pay by mail).
- A toll point counts when the route passes within 30 m of it while heading in that point's direction of travel (`js/tolls.js`).
- HCTRA rates were checked against hctra.org on Oct 20, 2026 (`status: "verified"`). Other agencies' rates are `"unverified"`.
- Katy Managed Lanes and SH 288 Express Lanes are priced by time of day (`status: "timed"`), at the estimated time the car reaches each gantry:
  - Katy: HCTRA's rate chart effective Sept 7, 2013 (still current). 3+ axles $7.00 per plaza; no tag +25%; carpools and motorcycles free weekdays 5–11 am and 2–8 pm.
  - SH 288: TxDOT's half-hour tables (effective Sept 1, 2026) in `data/sh288-rates.json`, refreshed by the **Update SH 288 rates** workflow (`tools/fetch_sh288.py`). Trucks × (axles − 1), max 5; no tag × 1.5 plus fees.
- Montgomery County (Hardin Store, Decker Prairie) and TxDOT SH 249 Tollway Extension rates were checked against their 2026 schedules on Oct 21, 2026.
- 17 HCTRA points had a 3-axle no-TAG rate of $1.30 in the layer. It's corrected to $3.00 here (see `tools/build_data.py`).

## Files

| File | What it does |
| --- | --- |
| `index.html`, `css/style.css` | Page and layout |
| `config.js` | ArcGIS API key (blank in the code; filled in when the site is published) |
| `.github/workflows/deploy.yml` | Tests, inserts the key, publishes to GitHub Pages |
| `js/app.js` | Map, address search, routing, results |
| `js/tolls.js` | Toll matching and pricing (no map code) |
| `data/toll-points.json` | Toll points and rates |
| `data/sh288-rates.json` | SH 288 time-of-day tables (from TxDOT) |
| `tools/fetch_sh288.py` | Downloads the SH 288 tables (run by the Update SH 288 rates workflow) |
| `tools/build_data.py` | Rebuilds the data file from the layer export |
| `tools/test_tolls.js` | Tests: `node tools/test_tolls.js` |
