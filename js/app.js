/* HCTRA Toll Calculator: map, address search, routing and results. */
require([
  "esri/config",
  "esri/Map",
  "esri/Basemap",
  "esri/views/MapView",
  "esri/widgets/Search",
  "esri/layers/GraphicsLayer",
  "esri/layers/FeatureLayer",
  "esri/layers/GeoJSONLayer",
  "esri/Graphic",
  "esri/rest/route",
  "esri/rest/support/RouteParameters",
  "esri/rest/support/FeatureSet",
  "esri/rest/networkService",
  "esri/rest/locator",
  "esri/geometry/Point",
], function (esriConfig, Map, Basemap, MapView, Search, GraphicsLayer, FeatureLayer, GeoJSONLayer, Graphic, route, RouteParameters, FeatureSet, networkService, locator, Point) {
  "use strict";

  var ROUTE_URL = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";
  var GEOCODE_URL = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer";
  var HOUSTON = [-95.37, 29.76];
  // Toll points stay HCTRA purple; the toll route is the familiar map-app blue with a light blue edge.
  var COLORS = { toll: [102, 45, 145], route: [26, 115, 232], routeEdge: [161, 199, 250], free: [143, 139, 150], missing: [245, 169, 32] };

  var key = (window.TOLL_CONFIG && window.TOLL_CONFIG.arcgisApiKey || "").trim();
  var DEBUG = /[?&]debug=1\b/.test(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var stops = { from: null, to: null };
  var tollPoints = [];
  var travelModes = null;

  if (key) esriConfig.apiKey = key;
  else $("key-warning").hidden = false;

  var routesLayer = new GraphicsLayer();
  var markersLayer = new GraphicsLayer(); // start and end pins, drawn on top
  var tollLayer = null;                   // toll points on the route, with labels
  var highlightLayer = new GraphicsLayer(); // ring around the toll point picked in the breakdown
  var map = new Map({ basemap: key ? "arcgis/light-gray" : "osm", layers: [routesLayer, highlightLayer, markersLayer] });
  // HCTRA's Regional Toll Roads layer (every Houston-area toll road, all agencies). The
  // browser can't load it from HCTRA's server directly, so a copy is kept in
  // data/toll-roads.geojson (tools/fetch_toll_roads.py, refreshed weekly on GitHub).
  var tollRoadsLayer = new GeoJSONLayer({
    url: "data/toll-roads.geojson",
    title: "Regional Toll Roads (HCTRA)",
    copyright: "HCTRA",
    popupEnabled: false,
    renderer: { type: "simple", symbol: { type: "simple-line", color: [102, 45, 145, 0.4], width: 4, cap: "round", join: "round" } },
  });
  map.add(tollRoadsLayer, 0);
  tollRoadsLayer.load().catch(function (e) { console.warn("Toll roads layer unavailable", e); });

  var view = new MapView({ container: "map", map: map, center: HOUSTON, zoom: 9 });

  function makeSearch(container, which) {
    var s = new Search({ view: view, container: container, popupEnabled: false, resultGraphicEnabled: false,
      locationEnabled: which === "from", allPlaceholder: which === "from" ? "Starting address" : "Destination" });
    s.on("select-result", function (e) {
      stops[which] = e.result && e.result.feature ? e.result.feature.geometry : null;
      if (stops[which]) remember(e.result.name, stops[which]);
      drawStops();
      updateButton();
    });
    s.on("search-clear", function () { stops[which] = null; drawStops(); updateButton(); });
    searches[which] = s;
    return s;
  }
  var searches = {};
  if (key) { makeSearch("search-from", "from"); makeSearch("search-to", "to"); }

  // Quick picks under each address box: places you saved, places you used recently, and
  // common Houston-area destinations. Saved and recent places stay on this device only.
  var COMMON = [
    ["Downtown Houston (City Hall)", -95.3693, 29.7601],
    ["Bush Intercontinental Airport (IAH)", -95.3414, 29.9902],
    ["Hobby Airport (HOU)", -95.2789, 29.6454],
    ["The Galleria", -95.4613, 29.7389],
    ["Texas Medical Center", -95.3984, 29.7072],
    ["NRG Stadium", -95.4107, 29.6847],
    ["Energy Corridor (I-10 at Eldridge)", -95.6216, 29.7840],
    ["Katy Mills", -95.8077, 29.7752],
    ["Sugar Land Town Square", -95.6216, 29.5958],
    ["Pearland Town Center", -95.3897, 29.5545],
    ["The Woodlands Mall", -95.4664, 30.1626],
    ["Conroe (downtown)", -95.4560, 30.3119],
    ["Kemah Boardwalk", -95.0187, 29.5450],
    ["Baytown (I-10 at Garth Rd)", -94.9893, 29.7853],
  ];
  function loadList(name) { try { return JSON.parse(localStorage.getItem("htc-" + name) || "[]"); } catch (e) { return []; } }
  function saveList(name, list) { try { localStorage.setItem("htc-" + name, JSON.stringify(list)); } catch (e) { /* not kept */ } }
  var saved = loadList("saved"), recent = loadList("recent");
  function samePlace(a, b) { return Math.abs(a.lon - b.lon) < 0.0005 && Math.abs(a.lat - b.lat) < 0.0005; }
  function remember(label, g) {
    if (!label || !g) return;
    var p = { label: String(label), lon: +g.longitude.toFixed(6), lat: +g.latitude.toFixed(6) };
    recent = [p].concat(recent.filter(function (r) { return !samePlace(r, p); })).slice(0, 6);
    saveList("recent", recent);
    fillPlaces();
  }
  function fillPlaces() {
    ["from", "to"].forEach(function (w) {
      var sel = $("places-" + w);
      var html = '<option value="">Choose a place…</option>';
      function group(title, list, prefix) {
        if (!list.length) return;
        html += '<optgroup label="' + esc(title) + '">' + list.map(function (p, i) {
          return '<option value="' + prefix + i + '">' + esc(p.label) + "</option>";
        }).join("") + "</optgroup>";
      }
      group("My places", saved, "s");
      group("Recent", recent, "r");
      group("Common places", COMMON.map(function (c) { return { label: c[0] }; }), "c");
      if (saved.length || recent.length) html += '<optgroup label="Manage"><option value="manage">Edit my places and recent\u2026</option></optgroup>';
      sel.innerHTML = html;
      $("save-" + w).disabled = !stops[w];
    });
  }
  // Edit my places: remove saved places one at a time, or clear the recent list.
  function renderPlacesDialog() {
    var list = $("saved-list");
    list.innerHTML = saved.length ? saved.map(function (p, i) {
      return '<li><span>' + esc(p.label) + '</span><button type="button" class="btn-outline small" data-i="' + i + '">Remove</button></li>';
    }).join("") : '<li class="empty">No saved places. Use \u201cSave place\u201d under From or To to add one.</li>';
    $("recent-count").textContent = recent.length ? recent.length + " recent place" + (recent.length === 1 ? "" : "s") : "No recent places";
    $("clear-recent").disabled = !recent.length;
  }
  function openPlacesDialog() {
    renderPlacesDialog();
    var d = $("places-dialog");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }
  $("saved-list").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-i]");
    if (!b) return;
    saved.splice(+b.getAttribute("data-i"), 1);
    saveList("saved", saved);
    fillPlaces();
    renderPlacesDialog();
  });
  $("clear-recent").addEventListener("click", function () {
    recent = [];
    saveList("recent", recent);
    fillPlaces();
    renderPlacesDialog();
  });
  $("places-done").addEventListener("click", function () { var d = $("places-dialog"); if (d.close) d.close(); else d.removeAttribute("open"); });

  function placeFromValue(v) {
    var i = +v.slice(1);
    if (v[0] === "s") return saved[i];
    if (v[0] === "r") return recent[i];
    var c = COMMON[i];
    return c && { label: c[0], lon: c[1], lat: c[2] };
  }
  ["from", "to"].forEach(function (w) {
    $("places-" + w).addEventListener("change", function () {
      if (this.value === "manage") { this.value = ""; openPlacesDialog(); return; }
      var p = this.value && placeFromValue(this.value);
      this.value = "";
      if (!p) return;
      stops[w] = new Point({ longitude: p.lon, latitude: p.lat });
      if (searches[w]) searches[w].searchTerm = p.label;
      remember(p.label, stops[w]);
      drawStops();
      updateButton();
      if (!(stops.from && stops.to)) view.goTo({ target: stops[w], zoom: 13 }).catch(function () {});
    });
    $("save-" + w).addEventListener("click", function () {
      if (!stops[w]) return;
      var current = searchesTerm(w) || "";
      var name = window.prompt("Name this place (for example, Home or Work):", /^Dropped pin/.test(current) ? "" : current);
      if (!name || !name.trim()) return;
      var p = { label: name.trim(), lon: +stops[w].longitude.toFixed(6), lat: +stops[w].latitude.toFixed(6) };
      saved = saved.filter(function (s) { return s.label.toLowerCase() !== p.label.toLowerCase() && !samePlace(s, p); });
      saved.unshift(p);
      saveList("saved", saved);
      fillPlaces();
      setStatus("Saved \u201c" + p.label + "\u201d to My places on this device.");
    });
  });
  fillPlaces();

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
      if (stops[which] === mapPoint && c && c.address && searches[which]) { searches[which].searchTerm = c.address; remember(c.address, mapPoint); }
    }).catch(function () { /* keep the coordinates */ });
  }

  view.popupEnabled = false;
  view.on("click", function (e) {
    if (!key) return;
    if (picking || !tollLayer) return mapTap(e);
    // Find the nearest toll point on screen within a finger-sized radius, instead of
    // Esri's hit test, which only counts taps right on the small dot.
    var TAP_PX = 24, best = null, bestD = TAP_PX;
    shownItems.forEach(function (it, i) {
      var sp = view.toScreen(new Point({ longitude: it.point.lon, latitude: it.point.lat }));
      if (!sp) return;
      var d = Math.hypot(sp.x - e.x, sp.y - e.y);
      if (d <= bestD) { bestD = d; best = i; }
    });
    if (best == null) return mapTap(e);
    highlightItem(best, document.querySelector('#breakdown tr[data-i="' + best + '"]'), true);
  });
  function mapTap(e) {
    if (!picking && highlightLayer.graphics.length) { clearHighlight(); return; } // tap the map to clear the ring
    var target = picking || (!stops.from ? "from" : !stops.to ? "to" : null);
    if (!target) return;
    placeStop(target, e.mapPoint);
    if (picking) setPicking(null);
  }

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
  var lastTrip = null;

  // Debug: save the exact trip Esri returned, so it can be replayed as a test
  // (tools/test_trips.js). Coordinates are rounded to about 10 cm to keep the file small.
  function round6(p) { return [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]; }
  function lonLat(g) { return g ? round6([g.longitude != null ? g.longitude : g.x, g.latitude != null ? g.latitude : g.y]) : null; }
  function tripFile() {
    var t = lastTrip.trip, ts = routeStats(lastTrip.tollRoute), fs = routeStats(lastTrip.freeRoute);
    var label = function (w) { var s = searchesTerm(w); return s || null; };
    var data = {
      version: 1,
      saved: new Date().toISOString(),
      page: location.href,
      input: { from: lonLat(stops.from), to: lonLat(stops.to), fromLabel: label("from"), toLabel: label("to"),
        axles: t.axles, payment: t.payment, carpool: t.carpool, departure: t.departure },
      toll: { minutes: ts.minutes, miles: ts.miles, mode: lastTrip.tollRoute.modeNote || null, path: t.tollPath.map(round6),
        steps: (t.steps || []).map(function (s) { return { maneuverType: s.maneuverType, text: s.text, path: s.path ? s.path.map(round6) : null }; }) },
      free: { minutes: fs.minutes, miles: fs.miles, mode: lastTrip.freeRoute.modeNote || null, path: t.freePath.map(round6) },
      result: { total: lastTrip.priced.total, items: lastTrip.priced.items.map(function (it) { return { id: it.point.id, name: it.point.name, rate: it.rate }; }) },
      expected: null,
    };
    return data;
  }
  function searchesTerm(w) { try { return searches[w] ? searches[w].searchTerm : null; } catch (e) { return null; } }
  function saveTrip() {
    if (!lastTrip) return;
    var data = tripFile();
    var stamp = data.saved.replace(/[-:]/g, "").slice(0, 13);
    var name = "trip-" + stamp + "-" + data.result.total.toFixed(2).replace(".", "_") + ".json";
    var text = JSON.stringify(data);
    var file;
    try { file = new File([text], name, { type: "application/json" }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Toll trip for testing" }).catch(function () { download(text, name); });
    } else download(text, name);
  }
  function download(text, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function readDeparture() {
    var v = $("leave").value;
    var d = v ? new Date(v) : new Date();
    return isNaN(d) ? new Date() : d;
  }
  function fmtClock(d) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  }

  function paymentChoice() { var c = document.querySelector('input[name="payment"]:checked'); return c ? c.value : null; }
  // Step cards get a check mark once they have what they need.
  function updateSteps() {
    $("step-trip").classList.toggle("done", !!(stops.from && stops.to));
    $("step-vehicle").classList.toggle("done", !!paymentChoice());
  }

  // Toll-free route line on the map: on by default, can be hidden.
  var freeGraphic = null;
  $("show-free").addEventListener("change", function () { if (freeGraphic) freeGraphic.visible = this.checked; });

  // Start over: clear both places, the routes, the results and the map. Vehicle, tag and
  // carpool stay as they are.
  $("reset").addEventListener("click", function () {
    if (picking) setPicking(null);
    ["from", "to"].forEach(function (w) {
      stops[w] = null;
      if (searches[w]) { try { searches[w].clear(); } catch (e) { searches[w].searchTerm = ""; } }
    });
    clearHighlight();
    routesLayer.removeAll();
    freeGraphic = null;
    if (tollLayer) { map.remove(tollLayer); tollLayer = null; }
    drawStops();
    lastTrip = null;
    shownItems = [];
    $("results").hidden = true;
    var dbg = document.getElementById("debug");
    if (dbg) dbg.remove();
    setStatus("");
    updateButton();
    view.goTo({ center: HOUSTON, zoom: 9 }).catch(function () {});
    document.querySelector(".panel").scrollTo({ top: 0, behavior: "smooth" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function updateButton() {
    updateSteps();
    ["from", "to"].forEach(function (w) { $("save-" + w).disabled = !stops[w]; });
    $("pay-hint").hidden = !!paymentChoice();
    $("go").disabled = !(key && stops.from && stops.to && tollPoints.length && paymentChoice());
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="payment"]'), function (r) { r.addEventListener("change", updateButton); });
  function setStatus(msg, isError) { $("status").textContent = msg || ""; $("status").className = "status" + (isError ? " error" : ""); }

  function drawStops() {
    markersLayer.removeAll();
    ["from", "to"].forEach(function (w) {
      if (!stops[w]) return;
      // Start: green dot with a white S. End: red dot with a white E. Fills are dark enough
      // for white letters; the rings are darker still.
      var c = w === "from" ? { fill: [30, 142, 62], ring: [18, 94, 40], letter: "S" } : { fill: [210, 47, 47], ring: [140, 18, 24], letter: "E" };
      markersLayer.add(new Graphic({ geometry: stops[w], symbol: { type: "simple-marker", size: 17,
        color: c.fill, outline: { color: c.ring, width: 2 } } }));
      markersLayer.add(new Graphic({ geometry: stops[w], symbol: { type: "text", text: c.letter, color: [255, 255, 255],
        horizontalAlignment: "center", verticalAlignment: "middle", font: { size: 10, weight: "bold" } } }));
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
    // Toll route: prefer toll roads only. Esri has no drivable Katy/SH 288 managed lanes
    // (they're added as "alongside" tolls), and preferring express lanes made the route
    // weave on and off I-10. Toll-free route: prohibit toll roads and express lanes.
    tollNames.forEach(function (t) {
      var sets = usage === "prefer" ? [[t]] : [[t, "Avoid Express Lanes"], [t]];
      sets.forEach(function (names) {
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

  // Toll-free route line: light gray dashes, white on satellite imagery where gray
  // disappears. Custom dash pattern (points): short dashes, close together.
  var currentBasemap = null;
  function freeSymbol() {
    var color = currentBasemap === "arcgis/imagery" ? [255, 255, 255, 255] : COLORS.free.concat(255);
    return { type: "cim", data: { type: "CIMSymbolReference", symbol: {
      type: "CIMLineSymbol", symbolLayers: [{ type: "CIMSolidStroke", enable: true, width: 2.25, color: color,
        capStyle: "Butt", joinStyle: "Round",
        effects: [{ type: "CIMGeometricEffectDashes", dashTemplate: [3, 2.5], lineDashEnding: "NoConstraint" }] }] } } };
  }

  function drawRoute(g, kind) {
    if (kind === "toll") {
      // A wider light blue line underneath gives the blue route its light edge.
      routesLayer.add(new Graphic({ geometry: g.geometry, symbol: { type: "simple-line", color: COLORS.routeEdge, width: 8, cap: "round", join: "round" } }));
      routesLayer.add(new Graphic({ geometry: g.geometry, symbol: { type: "simple-line", color: COLORS.route, width: 5, cap: "round", join: "round" } }));
    } else {
      routesLayer.add(freeGraphic = new Graphic({ geometry: g.geometry, symbol: freeSymbol() }));
      freeGraphic.visible = $("show-free").checked;
    }
  }

  // Short map label for a toll point: "Peek Rd $0.84". Drops words that repeat on every gantry.
  function shortName(n) {
    var s = n.replace(/\s*\((formerly [^)]*)\)/i, "")
      .replace(/\b(ML|Mainline|Mainlane)?\s*(Gantry|Plaza|Canopy|Tolling Zone)\b/gi, "")
      .replace(/\s+(Mainlane|Mainline)\b/gi, "")
      .replace(/\s*(Tolled\s+)?(Entrance|Exit)\s+Ramp\b/gi, " ramp")
      .replace(/Katy Managed Lanes/i, "Katy ML").replace(/\((East|West|North|South)bound\)/i, function (m, d) { return d[0] + "B"; })
      .replace(/\s{2,}/g, " ").trim() || n;
    return s.length > 30 ? s.slice(0, 28).trim() + "…" : s;
  }

  // Toll points as a client-side feature layer, so the map can label each one and
  // hide labels that would overlap (they come back as you zoom in).
  function drawCrossings(items) {
    if (tollLayer) { map.remove(tollLayer); tollLayer = null; }
    if (!items.length) return;
    var source = items.map(function (it, i) {
      var p = it.point;
      return new Graphic({
        geometry: { type: "point", longitude: p.lon, latitude: p.lat },
        attributes: { oid: i + 1, idx: i, name: p.name, road: p.road, priced: it.rate == null ? 0 : 1,
          label: shortName(p.name) + " " + (it.rate == null ? "n/a" : fmtMoney(it.rate)),
          detail: esc(p.road) + (it.rate == null ? " · rate not included" : " · " + fmtMoney(it.rate)) },
      });
    });
    var marker = function (color) { return { type: "simple-marker", size: 9, color: color, outline: { color: [255, 255, 255], width: 1.5 } }; };
    tollLayer = new FeatureLayer({
      source: source,
      objectIdField: "oid",
      geometryType: "point",
      spatialReference: { wkid: 4326 },
      fields: [
        { name: "oid", type: "oid" }, { name: "idx", type: "integer" }, { name: "name", type: "string" }, { name: "road", type: "string" },
        { name: "priced", type: "integer" }, { name: "label", type: "string" }, { name: "detail", type: "string" },
      ],
      renderer: { type: "unique-value", field: "priced", defaultSymbol: marker(COLORS.toll),
        uniqueValueInfos: [{ value: 0, symbol: marker(COLORS.missing) }] },
      labelingInfo: [{
        labelExpressionInfo: { expression: "$feature.label" },
        labelPlacement: "center-right",
        deconflictionStrategy: "static",
        symbol: { type: "text", color: [47, 26, 80], haloColor: [255, 255, 255], haloSize: 1.5,
          font: { size: 11, weight: "bold" } },
      }],
      popupEnabled: false, // tapping a point opens our own card (showCard)
    });
    map.add(tollLayer, map.layers.indexOf(routesLayer) + 1); // above the routes, below the highlight and pins
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
    box.innerHTML = "<h3>Debug</h3><p><button type='button' id='save-trip' class='go small'>Save trip for testing</button></p>" + base + "<p>Toll route: " + esc(tollRoute.modeNote || "") + "<br>Toll-free route: " + esc((window.__freeNote || "")) + "</p><p>Ramp zones: " + (rampZones ? rampZones.length : "none (no directions geometry)") + "</p>" +
      "<table class='breakdown'><thead><tr><th>ID</th><th>Toll point within 60 m</th><th>Kind</th><th class='num'>Offset</th><th class='num'>Zone</th><th>Counted</th></tr></thead><tbody>" +
      html + "</tbody></table><details><summary>Maneuvers (" + (tollRoute.steps || []).length + ")</summary><ol>" + steps + "</ol></details>";
    document.getElementById("results").after(box);
    document.getElementById("save-trip").addEventListener("click", saveTrip);
  }

  function fmtPerMinute(v) { return v < 1 ? Math.max(1, Math.round(v * 100)) + "¢" : fmtMoney(v); }

  // Breakdown rows: tap one to scroll to the map and ring that toll point. The map pans
  // only if the point is off screen, and keeps its zoom.
  var shownItems = [], pulseFrame = null;
  function clearHighlight() {
    if (pulseFrame) { cancelAnimationFrame(pulseFrame); pulseFrame = null; }
    highlightLayer.removeAll();
    hideCard();
    Array.prototype.forEach.call(document.querySelectorAll("#breakdown tr.selected"), function (r) { r.classList.remove("selected"); });
  }
  var VIOLET = [140, 92, 255]; // violet-screen: the brand's on-screen highlight colour
  function highlightItem(i, row, fromMap) {
    var it = shownItems[i];
    if (!it) return;
    if (!fromMap && row && row.classList.contains("selected")) { clearHighlight(); return; } // tap again to clear
    clearHighlight();
    if (row) row.classList.add("selected");
    if (fromMap) showCard(i); // the card opens only for a tap on the map, not from the breakdown
    var pt = new Point({ longitude: it.point.lon, latitude: it.point.lat });
    // One ring, fill and outline together: it fades in at the point, swells out and fades
    // to nothing, then starts again. It keeps pulsing until the selection is cleared.
    function ring(size, a) {
      return { type: "simple-marker", size: size, color: VIOLET.concat(0.25 * a), outline: { color: VIOLET.concat(a), width: 3 } };
    }
    var g = new Graphic({ geometry: pt, symbol: ring(22, 0) });
    highlightLayer.add(g);
    var PULSE = 1400, FADE_IN = 0.12, start = null;
    function frame(ts) {
      if (start == null) start = ts;
      var t = ((ts - start) % PULSE) / PULSE;
      var grow = 1 - Math.pow(1 - t, 2); // eases out as it widens
      var a = t < FADE_IN ? t / FADE_IN : 1 - (t - FADE_IN) / (1 - FADE_IN);
      g.symbol = ring(22 + 30 * grow, Math.max(0, a));
      pulseFrame = requestAnimationFrame(frame);
    }
    pulseFrame = requestAnimationFrame(frame);
    if (fromMap) return;
    if (view.extent && !view.extent.clone().expand(0.9).contains(pt)) view.goTo({ center: pt }).catch(function () {});
    $("map").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  // Toll point card: our own panel at the bottom of the map in place of Esri's popup.
  var AGENCY = { HCTRA: "Harris County Toll Road Authority", TxDOT: "TxDOT", FBCTRA: "Fort Bend County Toll Road Authority",
    MCTRA: "Montgomery County Toll Road Authority", BCTRA: "Brazoria County Toll Road Authority" };
  var KIND = { main: "Mainline", on: "Entrance ramp", off: "Exit ramp" };
  var DIRS = { N: "Northbound", S: "Southbound", E: "Eastbound", W: "Westbound" };
  var PAY = [["eztag", "EZ TAG"], ["tag", "Other tag"], ["notag", "No tag"]];
  var card = document.createElement("div");
  card.className = "map-card";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Toll point details");
  view.ui.add(card, "manual");
  card.addEventListener("click", function (e) { if (e.target.closest(".map-card-close")) clearHighlight(); });

  function hideCard() { card.hidden = true; }
  function showCard(i) {
    var it = shownItems[i];
    if (!it || !lastTrip) return;
    var p = it.point, t = lastTrip.trip;
    var axles = t.axles, chosen = t.payment, when = it.when || null;
    var opts = { carpool: t.carpool };
    var rates = PAY.map(function (pay) {
      var r = window.TollCalc.rateFor(p, axles, pay[0], when || new Date(t.departure), opts);
      return '<div class="pay-cell' + (pay[0] === chosen ? " chosen" : "") + '"><span>' + pay[1] + "</span><strong>" +
        (r == null ? "n/a" : fmtMoney(r)) + "</strong></div>";
    }).join("");
    var status = p.status === "verified" ? "Rate checked against " + esc(p.owner) + "\u2019s published schedule."
      : p.status === "timed" ? "Priced by time of day" + (when ? " for about " + fmtClock(when) : "") + (it.note ? " (" + esc(it.note) + ")" : "") + "."
      : "This rate hasn\u2019t been checked against " + esc(p.owner) + "\u2019s published schedule yet.";
    if (p.assumedAxles && p.assumedAxles.indexOf(axles) !== -1) status += " Fort Bend publishes rates up to 6 axles; 7+ axles are priced at the 6-axle rate.";
    var chips = [KIND[p.kind], DIRS[p.dir]].filter(Boolean).map(function (c) { return '<span class="chip">' + c + "</span>"; }).join("");
    card.innerHTML =
      '<button type="button" class="map-card-close" aria-label="Close">\u2715</button>' +
      '<div class="map-card-road">' + esc(p.road) + "</div>" +
      '<h3 class="map-card-title">' + esc(p.name) + "</h3>" +
      '<div class="chips">' + chips + "</div>" +
      '<div class="map-card-toll"><span>Your toll</span><strong>' + (it.rate == null ? "Not included" : fmtMoney(it.rate)) + "</strong>" +
        "<em>" + axles + " axles</em></div>" +
      '<div class="pay-grid">' + rates + "</div>" +
      '<p class="map-card-note">' + status + "</p>" +
      '<p class="map-card-agency">' + esc(AGENCY[p.owner] || p.owner) + "</p>";
    card.hidden = false;
  }

  // Basemap switcher (top right of the map). The choice is remembered on this device.
  var BASEMAPS = [["arcgis/light-gray", "Light"], ["arcgis/navigation", "Streets"], ["arcgis/imagery", "Satellite"], ["arcgis/dark-gray", "Dark"]];
  if (key) {
    var bm = document.createElement("div");
    bm.className = "basemap-switch";
    bm.setAttribute("role", "group");
    bm.setAttribute("aria-label", "Base map");
    bm.innerHTML = BASEMAPS.map(function (b) { return '<button type="button" data-id="' + b[0] + '">' + b[1] + "</button>"; }).join("");
    view.ui.add(bm, "top-right");
    var setBasemap = function (id) {
      if (!BASEMAPS.some(function (b) { return b[0] === id; })) id = BASEMAPS[0][0];
      currentBasemap = id;
      if (id === "arcgis/imagery") {
        // Satellite comes with a road-and-label overlay that Esri draws above everything,
        // hiding the routes. Move that overlay under the routes instead.
        var sat = new Basemap({ style: { id: id } });
        sat.load().then(function () {
          if (currentBasemap !== id) return;
          var refs = sat.referenceLayers.toArray();
          sat.referenceLayers.removeAll();
          sat.baseLayers.addMany(refs);
          map.basemap = sat;
        }).catch(function () { if (currentBasemap === id) map.basemap = id; });
      } else map.basemap = id;
      if (freeGraphic) freeGraphic.symbol = freeSymbol();
      Array.prototype.forEach.call(bm.querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-id") === id ? "true" : "false"); });
      try { localStorage.setItem("htc-basemap", id); } catch (e) { /* not kept */ }
    };
    bm.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setBasemap(b.getAttribute("data-id")); });
    var savedBasemap = null;
    try { savedBasemap = localStorage.getItem("htc-basemap"); } catch (e) { /* default */ }
    setBasemap(savedBasemap || BASEMAPS[0][0]);
  }

  $("breakdown").addEventListener("click", function (e) {
    var row = e.target.closest("tr.pickable");
    if (row) highlightItem(+row.getAttribute("data-i"), row);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") clearHighlight(); });
  $("breakdown").addEventListener("keydown", function (e) {
    var row = e.target.closest("tr.pickable");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); highlightItem(+row.getAttribute("data-i"), row); }
  });

  function showResults(tollRoute, freeRoute, priced, savings) {
    var t = routeStats(tollRoute), f = routeStats(freeRoute);
    $("toll-price").textContent = fmtMoney(priced.total) + (priced.pending.length || priced.missing.length ? "+" : "");
    $("toll-meta").textContent = fmtMeta(t);
    $("free-meta").textContent = fmtMeta(f);

    // Headline: is the toll worth it? Time saved and price, then cost per minute saved.
    var big = "", small = "", neutral = false;
    var plus = priced.pending.length || priced.missing.length ? "+" : "";
    if (!priced.items.length) { big = "No tolls on this trip"; small = "The fastest route is already toll-free."; neutral = true; }
    else if (priced.laneOptions && priced.laneOptions === priced.items.length) {
      big = fmtMoney(priced.total) + plus + " for the managed lanes";
      small = "Time saved isn't estimated: the lanes are usually faster at rush hour.";
    } else if (t.minutes != null && f.minutes != null) {
      var saved = Math.round(f.minutes - t.minutes);
      if (saved > 0) {
        big = "Save " + fmtTime(saved) + " for " + fmtMoney(priced.total) + plus;
        small = "About " + fmtPerMinute(priced.total / saved) + " per minute saved.";
      } else {
        neutral = true;
        big = "Skip the tolls";
        small = saved < 0 ? "The toll route is about " + fmtTime(-saved) + " slower right now." : "The toll-free route is about as fast right now.";
      }
    }
    $("headline").className = "headline" + (neutral ? " neutral" : "");
    $("headline-big").textContent = big;
    $("headline-small").textContent = small;

    // Without an EZ TAG: what the same trip would cost with one.
    var ts = $("tag-savings");
    ts.hidden = true;
    if (savings && savings.amount >= 0.01) {
      ts.innerHTML = "With an <strong>EZ TAG</strong>, this trip would cost " + fmtMoney(savings.eztag) + " instead of " + fmtMoney(priced.total) +
        ", saving <strong>" + fmtMoney(savings.amount) + "</strong>.";
      ts.hidden = false;
    }

    var flags = [];
    if (priced.pending.length) flags.push("Some time-of-day tolls (Katy Managed Lanes or SH 288 Express Lanes) couldn't be priced, so the total is low.");
    if (priced.laneOptions) flags.push("Your route runs alongside the Katy Managed Lanes or SH 288 Express Lanes. The toll route includes their tolls for that stretch; the toll-free route stays in the regular lanes.");
    if (priced.timed) flags.push("Katy Managed Lanes and SH 288 Express Lanes charge by time of day. These are priced for when you'd reach each gantry, leaving " + (($("leave").value ? "at " : "now, ") + fmtClock(departure)) + ".");
    if (priced.missing.length) flags.push(priced.missing.length + " toll point(s) on this route have no rate for this vehicle in the data, so the total is low.");
    if (priced.assumed) flags.push(priced.assumed + " Fort Bend County toll point(s) on this route publish rates only up to 6 axles, so they're priced at the 6-axle rate.");
    if (priced.unverified) flags.push(priced.unverified + " toll point(s) on this route haven't been checked against their agency's published rates yet.");
    $("flags").innerHTML = flags.map(function (m) { return '<div class="notice info">' + esc(m) + "</div>"; }).join("");

    $("breakdown").innerHTML = priced.items.map(function (it) {
      var p = it.point;
      var when = it.when ? ' <span class="tag-unverified">(' + fmtClock(it.when) + (it.note ? ", " + esc(it.note) : "") + ")</span>" : "";
      return '<tr class="pickable" tabindex="0" data-i="' + priced.items.indexOf(it) + '" title="Show on map"><td>' + esc(p.name) + (p.status === "unverified" ? ' <span class="tag-unverified">(unverified)</span>' : "") + when +
        "</td><td>" + esc(p.road) + '</td><td class="num">' + (it.rate == null ? "n/a" : fmtMoney(it.rate)) + "</td></tr>";
    }).join("") || '<tr><td colspan="3">No toll points crossed.</td></tr>';
    $("breakdown-wrap").hidden = !priced.items.length;
    shownItems = priced.items;
    clearHighlight();
    $("results").hidden = false;
  }

  // Price a routed trip and show it. Used after routing, and again when only the payment
  // type or carpool changes: those don't change the route, so the same route is repriced
  // without asking Esri again (a new request can come back as a different route).
  function priceTrip(trip, tollRoute, freeRoute) {
    var result = window.TollCalc.analyzeTrip(trip, tollPoints);
    var priced = result.priced;
    lastTrip = { trip: trip, tollRoute: tollRoute, freeRoute: freeRoute, priced: priced };
    if (DEBUG) showDebug(tollRoute, trip.tollPath, result.rampZones, result.crossings, result.dropped);
    drawCrossings(priced.items);
    var savings = null;
    if (trip.payment !== "eztag" && priced.items.length) {
      var ez = window.TollCalc.analyzeTrip(Object.assign({}, trip, { payment: "eztag" }), tollPoints).priced;
      if (!ez.missing.length && !ez.pending.length) savings = { eztag: ez.total, amount: Math.round((priced.total - ez.total) * 100) / 100 };
    }
    showResults(tollRoute, freeRoute, priced, savings);
  }
  function repriceShown() {
    if (!lastTrip || $("results").hidden) return;
    var payment = paymentChoice();
    if (!payment) return;
    var trip = Object.assign({}, lastTrip.trip, { payment: payment, carpool: $("carpool").checked });
    if (trip.payment === lastTrip.trip.payment && trip.carpool === lastTrip.trip.carpool) return;
    priceTrip(trip, lastTrip.tollRoute, lastTrip.freeRoute);
    var names = { eztag: "EZ TAG", tag: "another toll tag", notag: "no tag" };
    setStatus("Repriced for " + names[payment] + (trip.carpool ? ", carpool" : "") + " on the same route.");
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="payment"]'), function (r) { r.addEventListener("change", repriceShown); });
  $("carpool").addEventListener("change", repriceShown);

  $("go").addEventListener("click", function () {
    var axles = parseInt($("axles").value, 10);
    var payment = paymentChoice();
    departure = readDeparture();
    $("go").disabled = true;
    $("results").hidden = true;
    setStatus("Finding routes…");
    routesLayer.removeAll();
    freeGraphic = null;
    clearHighlight();
    drawStops();

    loadTravelModes().then(function (modes) {
      var mode = pickMode(modes, axles);
      window.__baseMode = mode;
      return Promise.all([solveFirst(tollVariants(mode, axles, "prefer"), true), solveFirst(tollVariants(mode, axles, "prohibit"))]);
    }).then(function (routes) {
      var tollRoute = routes[0], freeRoute = routes[1];
      var path = [].concat.apply([], tollRoute.geometry.paths);
      var freePath = [].concat.apply([], freeRoute.geometry.paths);
      window.__freeNote = freeRoute.modeNote;
      var trip = {
        tollPath: path, freePath: freePath, steps: tollRoute.steps || null,
        departure: departure.toISOString(), routeMinutes: routeStats(tollRoute).minutes,
        axles: axles, payment: payment, carpool: $("carpool").checked,
      };
      drawRoute(freeRoute, "free");
      drawRoute(tollRoute, "toll");
      view.goTo(tollRoute.geometry.extent.clone().expand(1.25)).catch(function () {});
      priceTrip(trip, tollRoute, freeRoute);
      setStatus("");
    }).catch(function (err) {
      console.error(err);
      setStatus("Couldn't get routes: " + (err && err.message ? err.message : "unknown error"), true);
    }).then(updateButton);
  });
});
