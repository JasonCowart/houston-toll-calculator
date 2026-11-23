# Installing the Toll Calculator on HCTRA's servers

The Toll Calculator is a static website: HTML, JavaScript, CSS and data files. It needs no
server-side code, no database and no build tools on the server. Any web server that can serve
files over HTTPS will run it.

This package was built from version `{{VERSION}}` on {{DATE}}.

## 1. Copy the files

Unzip the package and copy everything in the `site` folder to the web server, either at the
root of a site (`https://tolls.example.org/`) or in a folder (`https://www.example.org/tolls/`).
All paths in the app are relative, so either works.

- **IIS:** `web.config` is included. It adds the file types IIS doesn't always know
  (`.json`, `.geojson`, `.webmanifest`) and turns off caching for the files that must update
  right away.
- **Apache or nginx:** make sure `.geojson` is served as `application/geo+json` and
  `.webmanifest` as `application/manifest+json`, and serve `index.html`, `sw.js`, `config.js`
  and `data/` with `Cache-Control: no-cache`. You can delete `web.config`.

**HTTPS is required.** The map, location and the app's offline cache only work over HTTPS.

## 2. Add the keys in `config.js`

`config.js` ships with blank keys. Edit it on the server:

```js
window.TOLL_CONFIG = {
  arcgisApiKey: "",      // required: HCTRA's ArcGIS location services key
  // reportEmail: "",    // optional: inbox for "Report a wrong toll" (shown publicly)
  // goatcounter: "",    // optional: GoatCounter site code for anonymous usage counts
};
```

- **ArcGIS key (required).** Create it in HCTRA's ArcGIS account with the Basemaps, Routing
  and Geocoding (search) privileges. Under **Referrers**, list the address the site runs at,
  for example `https://tolls.example.org/*`. The key is visible to anyone who opens the page;
  the referrer list is what stops other sites from using it. Keep pay-as-you-go off if the
  account allows it.
- Without a key, the page shows a "map key missing" notice and nothing else.

## 3. Allow these outside services

The app runs in each visitor's browser and calls these services directly. If HCTRA's network
or a Content Security Policy filters outbound traffic, allow them:

| Service | Address | Used for |
| --- | --- | --- |
| Esri ArcGIS (maps, routing, search) | `js.arcgis.com`, `*.arcgis.com` | Required |
| Google Fonts | `fonts.googleapis.com`, `fonts.gstatic.com` | Montserrat font |
| GoatCounter | `gc.zgo.at`, `*.goatcounter.com` | Only if `goatcounter` is set |

Links that open other sites (Google Maps, Apple Maps, Waze, the toll agencies' rate pages,
hctra.org) are ordinary links.

## 4. Check it

1. Open the site and plan a trip, for example from Katy to downtown Houston.
2. Confirm the map, the two routes, the toll breakdown and Save PDF all work.
3. On a phone, open it over cellular data (not HCTRA Wi-Fi) to confirm it's reachable from
   outside.

## Keeping it up to date

- **Gas prices** in `data/fuel-prices.json` are as of the package date. To refresh them weekly,
  schedule `update/fetch_fuel.py` (Python 3, standard library only; it reads EIA's public
  page, which updates Monday afternoons) to run on Tuesdays, pointing it at the site's copy:
  `python3 update/fetch_fuel.py --out <site folder>/data/fuel-prices.json`.
  If EIA's page can't be read or looks wrong, the file is left as it is.
- **Toll rates and app changes** come in a new package. Copy it over the old one, keeping your
  edited `config.js`.
- To take the site down quickly, replace `index.html` with a short "not available" page.
