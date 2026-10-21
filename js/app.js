/* Houston Toll Calculator: map, address search, routing and results. */
require([
  "esri/config",
  "esri/Map",
  "esri/views/MapView",
  "esri/widgets/Search",
  "esri/layers/GraphicsLayer",
  "esri/Graphic",
  "esri/rest/route",
  "esri/rest/support/RouteParameters",
  "esri/rest/support/FeatureSet",
  "esri/rest/networkService",
  "esri/rest/locator",
], function (esriConfig, Map, MapView, Search, GraphicsLayer, Graphic, route, RouteParameters, FeatureSet, networkService, locator) {
  "use strict";

  var ROUTE_URL = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";
  var GEOCODE_URL = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer";
  var HOUSTON = [-95.37, 29.76];
  var COLORS = { toll: [11, 92, 173], free: [107, 107, 102] };

  var key = (window.TOLL_CONFIG && window.TOLL_CONFIG.arcgisApiKey || "").trim();
  var DEBUG = /[?&]debug=1\b/.test(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var stops = { from: null, to: null };
  var tollPoints = [];
  var travelModes = null;

  if (key) esriConfig.apiKey = key;
  else $("key-warning").hidden = false;

  var routesLayer = new GraphicsLayer();
  var markersLayer = new GraphicsLayer();
  var map = new Map({ basemap: key ? "arcgis/navigation" : "osm", layers: [routesLayer, markersLayer] });
  var view = new MapView({ container: "map", map: map, center: HOUSTON, zoom: 9 });

  function makeSearch(container, which) {
    var s = new Search({ view: view, container: container, popupEnabled: false, resultGraphicEnabled: false,
      locationEnabled: which === "from", allPlaceholder: which === "from" ? "Starting address" : "Destination" });
    s.on("select-result", function (e) {
      stops[which] = e.result && e.result.feature ? e.result.feature.geometry : null;
      drawStops();
      updateButton();
    });
    s.on("search-clear", function () { stops[which] = null; drawStops(); updateButton(); });
    searches[which] = s;
    return s;
  }
  var searches = {};
  if (key) { makeSearch("search-from", "from"); makeSearch("search-to", "to"); }

  // Dropping pins: tap "Pick on map" next to a box, then tap the map. If a box is
  // empty, tapping the map fills it (From first). The box shows the nearest address.
  var picking = null;
  function setPicking(which) {
    picking = picking === which ? null : which;
    ["from", "to"].forEach(function (w) {
      var b = $("pick-" + w);
      b.classList.toggle("active", picking === w);
      b.textContent = picking === w ? "Tap the map…" : "Pick on map";
    });
    if (picking) {
      setStatus("Tap the map to set the " + (picking === "from" ? "start." : "destination."));
      if (window.innerWidth <= 760) $("map").scrollIntoView({ behavior: "smooth", block: "center" });
    } else setStatus("");
  }
  ["from", "to"].forEach(function (w) {
    var b = $("pick-" + w);
    if (!key) { b.disabled = true; return; }
    b.addEventListener("click", function () { setPicking(w); });
  });

  function placeStop(which, mapPoint) {
    stops[which] = mapPoint;
    drawStops();
    updateButton();
    var label = mapPoint.latitude.toFixed(5) + ", " + mapPoint.longitude.toFixed(5);
    if (searches[which]) searches[which].searchTerm = "Dropped pin (" + label + ")";
    locator.locationToAddress(GEOCODE_URL, { location: mapPoint }).then(function (c) {
      if (stops[which] === mapPoint && c && c.address && searches[which]) searches[which].searchTerm = c.address;
    }).catch(function () { /* keep the coordinates */ });
  }

  view.on("click", function (e) {
    if (!key) return;
    var target = picking || (!stops.from ? "from" : !stops.to ? "to" : null);
    if (!target) return;
    placeStop(target, e.mapPoint);
    if (picking) setPicking(null);
  });

  fetch("data/toll-points.json")
    .then(function (r) { return r.json(); })
    .then(function (d) { tollPoints = d.points; updateButton(); })
    .catch(function () { setStatus("Couldn't load the toll data.", true); });
  fetch("data/sh288-rates.json")
    .then(function (r) { return r.json(); })
    .then(function (d) { window.TollCalc.setSchedules({ sh288: d }); })
    .catch(function () { /* SH 288 tolls will show as not included */ });

  // Departure time: blank = now. The datetime-local value is read as the device's local time.
  var departure = new Date();
  function readDeparture() {
    var v = $("leave").value;
    var d = v ? new Date(v) : new Date();
    return isNaN(d) ? new Date() : d;
  }
  function fmtClock(d) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  }

  function updateButton() { $("go").disabled = !(key && stops.from && stops.to && tollPoints.length); }
  function setStatus(msg, isError) { $("status").textContent = msg || ""; $("status").className = "status" + (isError ? " error" : ""); }

  function drawStops() {
    markersLayer.removeAll();
    ["from", "to"].forEach(function (w) {
      if (!stops[w]) return;
      markersLayer.add(new Graphic({ geometry: stops[w], symbol: { type: "simple-marker", size: 11,
        color: w === "from" ? [255, 255, 255] : [30, 30, 30], outline: { color: [30, 30, 30], width: 2 } } }));
    });
  }

  function loadTravelModes() {
    if (travelModes) return Promise.resolve(travelModes);
    return networkService.fetchServiceDescription(ROUTE_URL, key).then(function (desc) {
      travelModes = desc.supportedTravelModes || [];
      return travelModes;
    });
  }

  function pickMode(modes, axles) {
    var wanted = axles > 2 ? "Trucking Time" : "Driving Time";
    var m = modes.find(function (t) { return t.name === wanted; });
    if (!m) throw new Error('Travel mode "' + wanted + '" not found on the routing service.');
    return m;
  }

  // Travel-mode variants that set "Restriction Usage" on the toll restrictions.
  // Toll route: PREFER_HIGH ("very likely the route will include those roads").
  // Toll-free route: PROHIBITED (the default "avoid" is only a soft preference).
  // Restriction names differ for trucks, and "Avoid Express Lanes" (Katy, SH 288)
  // may not exist on every mode, so variants run from most to least specific.
  function tollVariants(mode, axles, usage) {
    var tollNames = axles > 2 ? ["Avoid Toll Roads for Trucks", "Avoid Toll Roads"] : ["Avoid Toll Roads"];
    var values = usage === "prefer" ? ["PREFER_HIGH", 0.2] : ["PROHIBITED", -1];
    var out = [];
    var extra = [];
    tollNames.forEach(function (t) {
      [[t, "Avoid Express Lanes"].concat(extra), [t].concat(extra)].forEach(function (names) {
        values.forEach(function (v) { out.push(withUsage(mode, names, v)); });
      });
    });
    return out;
  }

  function withUsage(mode, names, value) {
    var m = mode.clone();
    var r = (m.restrictionAttributeNames || []).slice();
    var apv = (m.attributeParameterValues || []).filter(function (p) {
      return !(names.indexOf(p.attributeName) !== -1 && p.parameterName === "Restriction Usage");
    });
    names.forEach(function (n) {
      if (r.indexOf(n) === -1) r.push(n);
      apv.push({ attributeName: n, parameterName: "Restriction Usage", value: value });
    });
    m.restrictionAttributeNames = r;
    m.attributeParameterValues = apv;
    m.__note = names.join(" + ") + " = " + value;
    return m;
  }

  // Returns the route graphic; with directions, also attaches route.steps
  // ([{maneuverType, text, path}]) for finding where the route takes ramps.
  function solve(mode, withDirections) {
    var params = new RouteParameters({
      stops: new FeatureSet({ features: [new Graphic({ geometry: stops.from }), new Graphic({ geometry: stops.to })] }),
      travelMode: mode,
      outSpatialReference: { wkid: 4326 },
      returnRoutes: true,
      returnDirections: !!withDirections,
      directionsOutputType: "complete",
      startTime: departure, // traffic for the departure time (live traffic within 4 hours of now)
    });
    return route.solve(ROUTE_URL, params).then(function (res) {
      var rr = res.routeResults[0];
      var g = rr.route;
      g.modeNote = mode.__note || mode.name;
      var feats = rr.directions && rr.directions.features;
      if (withDirections && feats && feats.length) {
        g.steps = feats.map(function (f) {
          var a = f.attributes || {};
          var paths = f.geometry && f.geometry.paths;
          return { maneuverType: a.maneuverType, text: a.text, path: paths ? [].concat.apply([], paths) : null };
        });
      }
      return g;
    });
  }

  // Try each travel mode in turn (some restriction names may not exist for every mode).
  function solveFirst(modes, withDirections) {
    var i = 0;
    function next(err) {
      if (i >= modes.length) return Promise.reject(err);
      return solve(modes[i++], withDirections).catch(next);
    }
    return next();
  }

  function routeStats(g) {
    var a = g.attributes || {};
    var minutes = a.Total_TravelTime || a.Total_Minutes || a.Total_TruckTravelTime || null;
    var miles = a.Total_Miles || (a.Total_Kilometers ? a.Total_Kilometers * 0.621371 : null) || pathMiles(g.geometry.paths);
    return { minutes: minutes, miles: miles };
  }

  function pathMiles(paths) {
    var m = 0;
    paths.forEach(function (p) {
      for (var i = 1; i < p.length; i++) {
        var lat1 = p[i - 1][1] * Math.PI / 180, lat2 = p[i][1] * Math.PI / 180;
        var dLat = lat2 - lat1, dLon = (p[i][0] - p[i - 1][0]) * Math.PI / 180;
        var h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        m += 2 * 3958.8 * Math.asin(Math.sqrt(h));
      }
    });
    return m;
  }

  function fmtMoney(v) { return "$" + v.toFixed(2); }
  function fmtTime(min) {
    if (min == null) return "";
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? h + " hr " + m + " min" : m + " min";
  }
  function fmtMeta(s) { return [fmtTime(s.minutes), s.miles ? s.miles.toFixed(1) + " mi" : ""].filter(Boolean).join(" · "); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function drawRoute(g, kind) {
    routesLayer.add(new Graphic({ geometry: g.geometry, symbol: { type: "simple-line", color: COLORS[kind],
      width: kind === "toll" ? 5 : 4, style: kind === "toll" ? "solid" : "short-dash" } }));
  }

  function drawCrossings(items) {
    items.forEach(function (it) {
      var p = it.point;
      markersLayer.add(new Graphic({
        geometry: { type: "point", longitude: p.lon, latitude: p.lat },
        symbol: { type: "simple-marker", size: 8, color: it.rate == null ? [227, 181, 74] : COLORS.toll, outline: { color: [255, 255, 255], width: 1.5 } },
        attributes: { name: p.name, road: p.road },
        popupTemplate: { title: "{name}", content: esc(p.road) + (it.rate == null ? " · rate not included" : " · " + fmtMoney(it.rate)) },
      }));
    });
  }

  // ?debug=1: list each toll point near the route, whether it counted and why,
  // plus the route's maneuvers. For tuning the matching on real trips.
  function showDebug(tollRoute, path, rampZones, crossings, dropped) {
    var counted = {};
    (dropped || []).forEach(function (c) { counted[c.point.id] = { rule: null, freeOffset: c.freeOffset }; });
    crossings.forEach(function (c) { counted[c.point.id] = c; });
    // Every toll point within 60 m of the route, ignoring direction and kind.
    var rows = [];
    tollPoints.forEach(function (p) {
      var probe = Object.assign({}, p, { kind: "main", dir: null });
      var hit = window.TollCalc.findCrossings(path, [probe], { matchMeters: 60 })[0];
      if (hit) rows.push({ p: p, off: hit.offset, along: hit.along });
    });
    rows.sort(function (a, b) { return a.along - b.along; });
    function zoneCell(p) {
      if (p.kind === "main") return "";
      var z = window.TollCalc.zoneDistance(p, rampZones);
      return z == null ? "n/a" : z > 999 ? "far" : z.toFixed(0) + " m";
    }
    var html = rows.map(function (r) {
      var c = counted[r.p.id];
      return "<tr><td>" + r.p.id + "</td><td>" + esc(r.p.name) + "</td><td>" + r.p.kind + " " + (r.p.dir || "") +
        "</td><td class='num'>" + r.off.toFixed(0) + " m</td><td class='num'>" + zoneCell(r.p) + "</td><td>" + (!c ? "no" : c.rule ? "yes, " + c.rule : "no, free route " + c.freeOffset.toFixed(0) + " m") + "</td></tr>";
    }).join("");
    var steps = (tollRoute.steps || []).map(function (s) {
      return "<li>" + esc(s.maneuverType || "?") + ": " + esc(s.text || "") + (s.path ? "" : " (no geometry)") + "</li>";
    }).join("");
    var box = document.getElementById("debug") || document.createElement("div");
    box.id = "debug";
    box.className = "debug";
    var bm = window.__baseMode || {};
    var base = "<p>Base mode \"" + esc(bm.name || "") + "\" restrictions: " + esc((bm.restrictionAttributeNames || []).join(", ")) +
      "<br>Parameters: " + esc((bm.attributeParameterValues || []).map(function (a) { return a.attributeName + " = " + a.value; }).join("; ")) + "</p>";
    box.innerHTML = "<h3>Debug</h3>" + base + "<p>Toll route: " + esc(tollRoute.modeNote || "") + "<br>Toll-free route: " + esc((window.__freeNote || "")) + "</p><p>Ramp zones: " + (rampZones ? rampZones.length : "none (no directions geometry)") + "</p>" +
      "<table class='breakdown'><thead><tr><th>ID</th><th>Toll point within 60 m</th><th>Kind</th><th class='num'>Offset</th><th class='num'>Zone</th><th>Counted</th></tr></thead><tbody>" +
      html + "</tbody></table><details><summary>Maneuvers (" + (tollRoute.steps || []).length + ")</summary><ol>" + steps + "</ol></details>";
    document.getElementById("results").after(box);
  }

  function showResults(tollRoute, freeRoute, priced) {
    var t = routeStats(tollRoute), f = routeStats(freeRoute);
    $("toll-price").textContent = fmtMoney(priced.total) + (priced.pending.length || priced.missing.length ? "+" : "");
    $("toll-meta").textContent = fmtMeta(t);
    $("free-meta").textContent = fmtMeta(f);

    var verdict = "";
    if (!priced.items.length) verdict = "No toll road helps on this trip, so both routes are toll-free.";
    else if (priced.laneOptions && priced.laneOptions === priced.items.length)
      verdict = "The toll route uses the managed lanes on the same freeway for " + fmtMoney(priced.total) + ". Time saved isn't estimated: the lanes are usually faster at rush hour.";
    else if (t.minutes != null && f.minutes != null) {
      var saved = Math.round(f.minutes - t.minutes);
      verdict = saved > 0 ? "Paying " + fmtMoney(priced.total) + " in tolls saves about " + saved + " min."
        : saved < 0 ? "The toll route is about " + (-saved) + " min slower right now. Skip the tolls."
        : "The toll-free route is about as fast. You can skip the tolls.";
    }
    $("verdict").textContent = verdict;

    var flags = [];
    if (priced.pending.length) flags.push("Some time-of-day tolls (Katy Managed Lanes or SH 288 Express Lanes) couldn't be priced, so the total is low.");
    if (priced.laneOptions) flags.push("Your route runs alongside the Katy Managed Lanes or SH 288 Express Lanes. The toll route includes their tolls for that stretch; the toll-free route stays in the regular lanes.");
    if (priced.timed) flags.push("Katy Managed Lanes and SH 288 Express Lanes charge by time of day. These are priced for when you'd reach each gantry, leaving " + (($("leave").value ? "at " : "now, ") + fmtClock(departure)) + ".");
    if (priced.missing.length) flags.push(priced.missing.length + " toll point(s) on this route have no rate for this vehicle in the data, so the total is low.");
    if (priced.unverified) flags.push(priced.unverified + " toll point(s) on this route haven't been checked against their agency's published rates yet.");
    $("flags").innerHTML = flags.map(function (m) { return '<div class="notice info">' + esc(m) + "</div>"; }).join("");

    $("breakdown").innerHTML = priced.items.map(function (it) {
      var p = it.point;
      var when = it.when ? ' <span class="tag-unverified">(' + fmtClock(it.when) + (it.note ? ", " + esc(it.note) : "") + ")</span>" : "";
      return "<tr><td>" + esc(p.name) + (p.status === "unverified" ? ' <span class="tag-unverified">(unverified)</span>' : "") + when +
        "</td><td>" + esc(p.road) + '</td><td class="num">' + (it.rate == null ? "n/a" : fmtMoney(it.rate)) + "</td></tr>";
    }).join("") || '<tr><td colspan="3">No toll points crossed.</td></tr>';
    $("breakdown-wrap").hidden = !priced.items.length;
    $("results").hidden = false;
  }

  $("go").addEventListener("click", function () {
    var axles = parseInt($("axles").value, 10);
    var payment = $("payment").value;
    departure = readDeparture();
    $("go").disabled = true;
    $("results").hidden = true;
    setStatus("Finding routes…");
    routesLayer.removeAll();
    drawStops();

    loadTravelModes().then(function (modes) {
      var mode = pickMode(modes, axles);
      window.__baseMode = mode;
      return Promise.all([solveFirst(tollVariants(mode, axles, "prefer"), true), solveFirst(tollVariants(mode, axles, "prohibit"))]);
    }).then(function (routes) {
      var tollRoute = routes[0], freeRoute = routes[1];
      var path = [].concat.apply([], tollRoute.geometry.paths);
      var hasSteps = tollRoute.steps && tollRoute.steps.some(function (s) { return s.path; });
      var rampZones = hasSteps ? window.TollCalc.rampZonesFromSteps(tollRoute.steps) : null;
      var raw = window.TollCalc.findCrossings(path, tollPoints, { rampZones: rampZones });
      var freePath = [].concat.apply([], freeRoute.geometry.paths);
      window.__freeNote = freeRoute.modeNote;
      var split = window.TollCalc.dropSharedWithFree(raw, freePath);
      var crossings = split.kept;
      // Add managed-lane plazas the route runs alongside (lane choice on the same freeway).
      var have = {};
      crossings.forEach(function (c) { have[c.point.id] = true; });
      window.TollCalc.managedLaneCrossings(path, tollPoints).forEach(function (c) { if (!have[c.point.id]) crossings.push(c); });
      crossings.sort(function (a, b) { return a.along - b.along; });
      if (DEBUG) showDebug(tollRoute, path, rampZones, crossings, split.dropped);
      var priced = window.TollCalc.price(crossings, axles, payment, {
        departure: departure, routeMeters: window.TollCalc.pathMeters(path),
        routeMinutes: routeStats(tollRoute).minutes, carpool: $("carpool").checked,
      });
      drawRoute(freeRoute, "free");
      drawRoute(tollRoute, "toll");
      drawCrossings(priced.items);
      view.goTo(tollRoute.geometry.extent.clone().expand(1.25)).catch(function () {});
      showResults(tollRoute, freeRoute, priced);
      setStatus("");
    }).catch(function (err) {
      console.error(err);
      setStatus("Couldn't get routes: " + (err && err.message ? err.message : "unknown error"), true);
    }).then(updateButton);
  });
});
