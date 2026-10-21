# Houston Toll Calculator

Enter two addresses, pick your vehicle (axles) and how you pay. The page finds the fastest route and a toll-free route, adds up the tolls on the toll route, and shows whether the tolls are worth the time saved.

It's a static site (no server), hosted on GitHub Pages. Maps, address search and routing come from the ArcGIS Location Platform free tier.

## Setup

1. Turn on GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / root**. The site will be at `https://jasoncowart.github.io/houston-toll-calculator/`.
2. In your ArcGIS Location Platform portal, open the API key credential and restrict its **referrer** to that address.
3. Then paste the key into `config.js` (`arcgisApiKey: "..."`) and commit.

Keep pay-as-you-go **off** in Esri. The free tier then pauses at its limit instead of billing.

## How tolls are counted

- `data/toll-points.json` holds 386 toll points from HCTRA's toll location layer, with rates for 2–8 axles: EZ TAG, other tag, and no tag (pay by mail).
- A toll point counts when the route passes within 30 m of it while heading in that point's direction of travel (`js/tolls.js`).
- HCTRA rates were checked against hctra.org on Oct 20, 2026 (`status: "verified"`). Other agencies' rates are `"unverified"`.
- Katy Managed Lanes and SH 288 Express Lanes use time-of-day pricing (`"pending"`). They're flagged, not priced.
- 17 HCTRA points had a 3-axle no-TAG rate of $1.30 in the layer. It's corrected to $3.00 here (see `tools/build_data.py`).

## Files

| File | What it does |
| --- | --- |
| `index.html`, `css/style.css` | Page and layout |
| `config.js` | Your ArcGIS API key |
| `js/app.js` | Map, address search, routing, results |
| `js/tolls.js` | Toll matching and pricing (no map code) |
| `data/toll-points.json` | Toll points and rates |
| `tools/build_data.py` | Rebuilds the data file from the layer export |
| `tools/test_tolls.js` | Tests: `node tools/test_tolls.js` |
