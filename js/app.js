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
  "esri/layers/WebTileLayer",
  "esri/intl",
], function (esriConfig, Map, Basemap, MapView, Search, GraphicsLayer, FeatureLayer, GeoJSONLayer, Graphic, route, RouteParameters, FeatureSet, networkService, locator, Point, WebTileLayer, intl) {
  "use strict";
  var L = window.I18N.t;   // translate (English text in, Spanish out when Spanish is on)

  var ROUTE_URL = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";
  var GEOCODE_URL = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer";
  var HOUSTON = [-95.37, 29.76];
  // Toll points stay HCTRA purple; the toll route is the familiar map-app blue with a light blue edge.
  var COLORS = { toll: [102, 45, 145], route: [26, 115, 232], routeEdge: [161, 199, 250], free: [143, 139, 150], missing: [245, 169, 32] };

  var key = (window.TOLL_CONFIG && window.TOLL_CONFIG.arcgisApiKey || "").trim();
  var DEBUG = /[?&]debug=1\b/.test(location.search);
  // TomTom traffic: being tested in the debug view only (free evaluation tier).
  var TT_KEY = (window.TOLL_CONFIG && window.TOLL_CONFIG.tomtomApiKey || "").trim();
  var TOMTOM = DEBUG && !!TT_KEY;
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
      locationEnabled: which === "from", allPlaceholder: which === "from" ? L("Starting address") : L("Destination") });
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
      var html = '<option value="">' + L("Choose a place…") + "</option>";
      function group(title, list, prefix) {
        if (!list.length) return;
        html += '<optgroup label="' + esc(title) + '">' + list.map(function (p, i) {
          return '<option value="' + prefix + i + '">' + esc(p.label) + "</option>";
        }).join("") + "</optgroup>";
      }
      group(L("My places"), saved, "s");
      group(L("Recent"), recent, "r");
      group(L("Common places"), COMMON.map(function (c) { return { label: c[0] }; }), "c");
      if (saved.length || recent.length) html += '<optgroup label="' + L("Manage") + '"><option value="manage">' + L("Edit my places and recent…") + "</option></optgroup>";
      sel.innerHTML = html;
      $("save-" + w).disabled = !stops[w];
    });
  }
  // Edit my places: remove saved places one at a time, or clear the recent list.
  function renderPlacesDialog() {
    var list = $("saved-list");
    list.innerHTML = saved.length ? saved.map(function (p, i) {
      return '<li><span>' + esc(p.label) + '</span><button type="button" class="btn-outline small" data-i="' + i + '">' + L("Remove") + "</button></li>";
    }).join("") : '<li class="empty">' + L("No saved places. Use “Save place” under From or To to add one.") + "</li>";
    $("recent-count").textContent = recent.length ? L(recent.length === 1 ? "{n} recent place" : "{n} recent places", { n: recent.length }) : L("No recent places");
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
      var name = window.prompt(L("Name this place (for example, Home or Work):"), /^Dropped pin/.test(current) ? "" : current);
      if (!name || !name.trim()) return;
      var p = { label: name.trim(), lon: +stops[w].longitude.toFixed(6), lat: +stops[w].latitude.toFixed(6) };
      saved = saved.filter(function (s) { return s.label.toLowerCase() !== p.label.toLowerCase() && !samePlace(s, p); });
      saved.unshift(p);
      saveList("saved", saved);
      fillPlaces();
      setStatus(L("Saved “{name}” to My places on this device.", { name: p.label }));
    });
  });
  fillPlaces();

  // English / Español: fixed page text swaps in place (lang.js); what the app builds is redrawn.
  function setEsriLocale() { try { if (intl && intl.setLocale) intl.setLocale(window.I18N.lang === "es" ? "es" : "en"); } catch (e) { /* keep */ } }
  setEsriLocale();
  window.I18N.apply();
  $("lang-toggle").addEventListener("click", function () { window.I18N.setLang(window.I18N.lang === "es" ? "en" : "es"); });
  window.I18N.onChange(function () {
    setEsriLocale();
    fillPlaces();
    if (typeof fillVehicles === "function") fillVehicles();
    ["from", "to"].forEach(function (w) { if (searches[w]) searches[w].allPlaceholder = L(w === "from" ? "Starting address" : "Destination"); });
    if (typeof setPicking === "function") setPicking(picking);
    showRatesAsOf();
    var bmEl = document.querySelector(".basemap-switch:not(.tt-switch)");
    if (bmEl) Array.prototype.forEach.call(bmEl.querySelectorAll("button"), function (b) {
      var m = BASEMAPS.filter(function (x) { return x[0] === b.getAttribute("data-id"); })[0]; if (m) b.textContent = L(m[1]);
    });
    card.setAttribute("aria-label", L("Toll point details"));
    hideCard();
    setStatus("");
    $("best-time-out").innerHTML = "";
    if (lastTrip) showResults(lastTrip.tollRoute, lastTrip.freeRoute, lastTrip.priced, lastTrip.savings);
  });

  // Dropping pins: tap "Pick on map" next to a box, then tap the map. If a box is
  // empty, tapping the map fills it (From first). The box shows the nearest address.
  var picking = null;
  function setPicking(which) {
    picking = picking === which ? null : which;
    ["from", "to"].forEach(function (w) {
      var b = $("pick-" + w);
      b.classList.toggle("active", picking === w);
      b.textContent = picking === w ? L("Tap the map…") : L("Pick on map");
    });
    if (picking) {
      setStatus(L(picking === "from" ? "Tap the map to set the start." : "Tap the map to set the destination."));
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
    if (searches[which]) searches[which].searchTerm = L("Dropped pin ({label})", { label: label });
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
    var incs = lastTrip && lastTrip.tollRoute.ttIncidents || [], bestInc = null;
    incs.forEach(function (inc, k) {
      var sp = view.toScreen(new Point({ longitude: inc.at[0], latitude: inc.at[1] }));
      if (!sp) return;
      var d = Math.hypot(sp.x - e.x, sp.y - e.y);
      if (d <= bestD) { bestD = d; bestInc = k; }
    });
    if (bestInc != null) return showIncidentCard(bestInc);
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
    .then(function (d) { tollPoints = d.points; ratesAsOf = d.meta && d.meta.ratesAsOf; showRatesAsOf(); updateButton(); if (shared) applyShared(); })
    .catch(function () { setStatus(L("Couldn't load the toll data."), true); });
  fetch("data/sh288-rates.json")
    .then(function (r) { return r.json(); })
    .then(function (d) { window.TollCalc.setSchedules({ sh288: d }); sh288Effective = d.effective; showRatesAsOf(); })
    .catch(function () { /* SH 288 tolls will show as not included */ });

  // "Rates as of": when the rates were last checked against the agencies' tables.
  var ratesAsOf = null, sh288Effective = null;
  function showRatesAsOf() {
    var el = $("rates-asof");
    if (!ratesAsOf) return;
    var d = new Date(ratesAsOf + "T12:00:00");
    el.textContent = L("Rates as of {date}", { date: d.toLocaleDateString(window.I18N.locale(), { month: "short", day: "numeric", year: "numeric" }) }) +
      (sh288Effective ? L(" · SH 288 time-of-day rates effective {date}", { date: sh288Effective }) : "") + ".";
    el.hidden = false;
  }

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
        steps: (t.steps || []).map(function (s) { return { maneuverType: s.maneuverType, text: s.text, time: s.time, length: s.length, path: s.path ? s.path.map(round6) : null }; }),
        trafficProbe: lastTrip.tollRoute.trafficProbe || null,
        stayedOn: lastTrip.tollRoute.stayedOn || null, stillHops: lastTrip.tollRoute.stillHops || null, anchors: lastTrip.tollRoute.anchors || null, originalMinutes: lastTrip.tollRoute.originalMinutes || null },
      free: { minutes: fs.minutes, miles: fs.miles, mode: lastTrip.freeRoute.modeNote || null, path: t.freePath.map(round6),
        steps: (lastTrip.freeRoute.steps || []).map(function (s) { return { maneuverType: s.maneuverType, text: s.text, time: s.time, length: s.length, path: s.path ? s.path.map(round6) : null }; }),
        feederFixed: lastTrip.freeRoute.feederFixed ? lastTrip.freeRoute.feederFixed.map(function (d) { return { road: d.road, via: d.via }; }) : null,
        feederGap: lastTrip.freeRoute.feederGap ? lastTrip.freeRoute.feederGap.map(function (d) { return { road: d.road, via: d.via }; }) : null,
        originalMinutes: lastTrip.freeRoute.originalFreeMinutes || null },
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
    return d.toLocaleTimeString(window.I18N.locale(), { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  }

  function paymentChoice() { var c = document.querySelector('input[name="payment"]:checked'); return c ? c.value : null; }
  // My vehicles: save the vehicle, tag and carpool setting under a name and pick it again
  // in one tap (handy for trucks). Kept in this browser only.
  var PAY_NAMES = { eztag: "EZ TAG", tag: "Other tag", notag: "No tag" };
  var vehicles = loadList("vehicles");
  function vehicleSummary(v) {
    return L("{n} axles", { n: v.axles }) + " · " + L(PAY_NAMES[v.payment]) + (v.carpool ? " · " + L("carpool") : "");
  }
  function fillVehicles() {
    var html = '<option value="">' + L("My vehicles…") + "</option>" + vehicles.map(function (v, i) {
      return '<option value="v' + i + '">' + esc(v.name) + " (" + esc(vehicleSummary(v)) + ")</option>";
    }).join("");
    if (vehicles.length) html += '<option value="manage">' + L("Edit my vehicles…") + "</option>";
    $("vehicles").innerHTML = html;
    $("save-vehicle").disabled = !paymentChoice();
    syncVehicleSelect();
  }
  // The box shows the vehicle you picked or just saved, for as long as the settings still
  // match it. Change the axles, tag or carpool and it goes back to "My vehicles..."; changing
  // back doesn't bring it back on its own, you pick it again.
  var activeVehicle = -1;
  function syncVehicleSelect() {
    if (!vehicles) return;
    var v = vehicles[activeVehicle];
    var axles = parseInt($("axles").value, 10), pay = paymentChoice(), car = $("carpool").checked;
    if (!v || v.axles !== axles || v.payment !== pay || !!v.carpool !== car) activeVehicle = -1;
    $("vehicles").value = activeVehicle >= 0 ? "v" + activeVehicle : "";
  }
  $("vehicles").addEventListener("change", function () {
    var v = this.value;
    if (v === "manage") { syncVehicleSelect(); renderVehicleDialog(); var d = $("vehicles-dialog"); if (d.showModal) d.showModal(); else d.setAttribute("open", ""); return; }
    var p = vehicles[+v.slice(1)];
    if (!p) { syncVehicleSelect(); return; }
    activeVehicle = +v.slice(1);
    $("axles").value = String(p.axles);
    var r = $("pay-" + p.payment); if (r) r.checked = true;
    $("carpool").checked = !!p.carpool;
    updateButton();
    repriceShown();
    if (!lastTrip || $("results").hidden) setStatus(L("Using “{name}”.", { name: p.name }) + " " + vehicleSummary(p) + ".");
  });
  $("save-vehicle").addEventListener("click", function () {
    var payment = paymentChoice();
    if (!payment) return;
    var axles = parseInt($("axles").value, 10), carpool = $("carpool").checked;
    var name = window.prompt(L("Name this vehicle (for example, My truck or Work van):"), axles > 2 ? L("{n}-axle truck", { n: axles }) : L("My car"));
    if (!name || !name.trim()) return;
    var v = { name: name.trim(), axles: axles, payment: payment, carpool: carpool };
    vehicles = [v].concat(vehicles.filter(function (x) { return x.name.toLowerCase() !== v.name.toLowerCase(); }));
    saveList("vehicles", vehicles);
    activeVehicle = 0;
    fillVehicles();
    setStatus(L("Saved “{name}” ({summary}) to My vehicles on this device.", { name: v.name, summary: vehicleSummary(v) }));
  });
  function renderVehicleDialog() {
    $("vehicle-list").innerHTML = vehicles.length ? vehicles.map(function (v, i) {
      return '<li><span>' + esc(v.name) + ' <small class="hint">' + esc(vehicleSummary(v)) + '</small></span><button type="button" class="btn-outline small" data-i="' + i + '">' + L("Remove") + "</button></li>";
    }).join("") : '<li class="empty">' + L("No saved vehicles. Set the vehicle and tag, then tap “Save vehicle”.") + "</li>";
  }
  $("vehicle-list").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-i]");
    if (!b) return;
    var gone = +b.getAttribute("data-i");
    vehicles.splice(gone, 1);
    activeVehicle = activeVehicle === gone ? -1 : activeVehicle > gone ? activeVehicle - 1 : activeVehicle;
    saveList("vehicles", vehicles);
    fillVehicles();
    renderVehicleDialog();
  });
  $("vehicles-done").addEventListener("click", function () { var d = $("vehicles-dialog"); if (d.close) d.close(); else d.removeAttribute("open"); });
  fillVehicles();

  // Step cards get a check mark once they have what they need.
  function updateSteps() {
    $("step-trip").classList.toggle("done", !!(stops.from && stops.to));
    $("step-vehicle").classList.toggle("done", !!paymentChoice());
  }

  // Toll-free route line on the map: on by default, can be hidden.
  var freeGraphic = null;
  $("show-free").addEventListener("change", function () { setFreeVisible(this.checked); });

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
    freeTraffic = [];
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
    $("save-vehicle").disabled = !paymentChoice();
    if (typeof syncVehicleSelect === "function" && $("vehicles").options.length) syncVehicleSelect();
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
  // probe (debug view only): also ask for the edges the route traverses with free-flow and
  // traffic times, to see whether the free Esri tier gives per-stretch traffic for coloring.
  // via: [lon, lat] waypoints the route must pass through (LocationType 1: no arrive/depart).
  // more.noTraffic: solve for free-flow driving instead of the departure time's traffic.
  function solve(mode, withDirections, probe, via, barriers, more) {
    more = more || {};
    var stopGraphics = [new Graphic({ geometry: stops.from })].concat((via || []).map(function (v) {
      return new Graphic({ geometry: new Point({ longitude: v[0], latitude: v[1] }), attributes: { LocationType: 1, CurbApproach: 0 } });
    }), [new Graphic({ geometry: stops.to })]);
    var opts = {
      stops: new FeatureSet({ features: stopGraphics }),
      travelMode: mode,
      outSpatialReference: { wkid: 4326 },
      returnRoutes: true,
      returnDirections: !!withDirections,
      directionsOutputType: "complete",
      startTime: departure, // traffic for the departure time (live traffic within 4 hours of now)
    };
    if (more.noTraffic) delete opts.startTime;
    if (barriers && barriers.length) {
      opts.pointBarriers = new FeatureSet({ features: barriers.map(function (b) {
        return new Graphic({ geometry: new Point({ longitude: b[0], latitude: b[1] }), attributes: { BarrierType: 0 } }); // 0 = restriction: can't pass
      }) });
    }
    if (probe) { opts.returnTraversedEdges = true; opts.accumulateAttributes = ["TravelTime", "Minutes", "Miles"]; }
    return route.solve(ROUTE_URL, new RouteParameters(opts)).then(function (res) {
      var rr = res.routeResults[0];
      var g = rr.route;
      g.modeNote = mode.__note || mode.name;
      g.mode = mode;
      var feats = rr.directions && rr.directions.features;
      if (withDirections && feats && feats.length) {
        g.steps = feats.map(function (f) {
          var a = f.attributes || {};
          var paths = f.geometry && f.geometry.paths;
          // time (minutes, with traffic) and length (miles) per step: a first source for traffic colors
          return { maneuverType: a.maneuverType, text: a.text, time: a.time, length: a.length, path: paths ? [].concat.apply([], paths) : null };
        });
      }
      if (probe) {
        var te = res.traversedEdges;
        var ef = te && te.features ? te.features : [];
        g.trafficProbe = {
          totals: Object.keys(g.attributes || {}).filter(function (k) { return /^Total_/.test(k); })
            .reduce(function (o, k) { o[k] = g.attributes[k]; return o; }, {}),
          edgeCount: ef.length,
          fields: ef.length ? Object.keys(ef[0].attributes || {}) : [],
          edges: ef.slice(0, 400).map(function (f) {
            var p = f.geometry && f.geometry.paths && f.geometry.paths[0];
            return { a: f.attributes, ends: p ? [p[0], p[p.length - 1]] : null };
          }),
        };
      }
      return g;
    }, function (err) {
      if (!probe) throw err;
      // The probe options were refused: solve normally and note why.
      return solve(mode, withDirections, false, via, barriers, more).then(function (g) { g.trafficProbe = { error: String(err && err.message || err) }; return g; });
    });
  }

  // Try each travel mode in turn (some restriction names may not exist for every mode).
  function solveFirst(modes, withDirections) {
    var i = 0;
    function next(err) {
      if (i >= modes.length) return Promise.reject(err);
      return solve(modes[i++], withDirections, DEBUG && withDirections).catch(next);
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
    var total = Math.round(min), h = Math.floor(total / 60), m = total % 60;
    return h ? h + (window.I18N.lang === "es" ? " h " : " hr ") + m + " min" : m + " min";
  }
  function fmtMeta(s) { return [fmtTime(s.minutes), s.miles ? s.miles.toFixed(1) + " mi" : ""].filter(Boolean).join(" · "); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Toll-free route line: light gray dashes, white on satellite imagery where gray
  // disappears. Custom dash pattern (points): short dashes, close together.
  var currentBasemap = null;
  function freeSymbol(traffic) {
    var color = traffic ? TRAFFIC[traffic].concat(255) : currentBasemap === "arcgis/imagery" ? [255, 255, 255, 255] : COLORS.free.concat(255);
    return { type: "cim", data: { type: "CIMSymbolReference", symbol: {
      type: "CIMLineSymbol", symbolLayers: [{ type: "CIMSolidStroke", enable: true, width: 2.25, color: color,
        capStyle: "Butt", joinStyle: "Round",
        effects: [{ type: "CIMGeometricEffectDashes", dashTemplate: [3, 2.5], lineDashEnding: "NoConstraint" }] }] } } };
  }

  // Traffic colors on highway stretches (TollCalc.trafficSegments): moderate, slow, heavy.
  var TRAFFIC = { moderate: [246, 180, 0], slow: [245, 124, 0], heavy: [217, 48, 37], closed: [91, 15, 15] };
  var TRAFFIC_HEX = { moderate: "#f6b400", slow: "#f57c00", heavy: "#d93025", closed: "#5b0f0f" };
  var freeTraffic = [], tollTraffic = [];
  function trafficGraphics(g, kind, skip) {
    return window.TollCalc.trafficSegments(g.steps, skip).filter(function (sg) { return sg.level && sg.path && sg.path.length > 1; })
      .map(function (sg) {
        var geom = { type: "polyline", paths: [sg.path], spatialReference: { wkid: 4326 } };
        return new Graphic({ geometry: geom, symbol: kind === "toll"
          ? { type: "simple-line", color: TRAFFIC[sg.level], width: 5, cap: "round", join: "round" }
          : freeSymbol(sg.level) });
      });
  }

  function drawRoute(g, kind) {
    if (kind === "toll") {
      // A wider light blue line underneath gives the blue route its light edge.
      routesLayer.add(new Graphic({ geometry: g.geometry, symbol: { type: "simple-line", color: COLORS.routeEdge, width: 8, cap: "round", join: "round" } }));
      routesLayer.add(new Graphic({ geometry: g.geometry, symbol: { type: "simple-line", color: COLORS.route, width: 5, cap: "round", join: "round" } }));
      // traffic colors are added after pricing (drawTollTraffic), once the managed-lane stretch is known
    } else {
      routesLayer.add(freeGraphic = new Graphic({ geometry: g.geometry, symbol: freeSymbol() }));
      freeTraffic = trafficGraphics(g, "free");
      routesLayer.addMany(freeTraffic);
      setFreeVisible($("show-free").checked);
    }
  }
  // Toll route traffic colors, leaving out the stretch beside managed lanes: Esri can't route
  // on those lanes, so the times there are the regular lanes' and would mislead.
  function drawTollTraffic(g, priced, routeMeters) {
    tollTraffic = trafficGraphics(g, "toll", window.TollCalc.laneRanges(priced.items, routeMeters));
    routesLayer.addMany(tollTraffic);
  }
  function setFreeVisible(on) {
    if (freeGraphic) freeGraphic.visible = on;
    freeTraffic.forEach(function (t) { t.visible = on; });
  }

  // ---- TomTom traffic (debug view only, while it's being evaluated) ----
  // Live speed for each road segment along a route: TomTom returns the whole segment a point
  // is on, so sample every half mile and skip points a segment already covers.
  var TT_BASE = "https://api.tomtom.com/traffic/services";
  var TT_SAMPLE_METERS = 800, TT_MAX_CALLS = 60, TT_WAVE = 6;
  // Spread lookups over the whole route first, then fill in: order the half-mile points so the
  // first ones are far apart (bit-reversed order), so the call limit never leaves the end blank.
  function spreadOrder(n) {
    var bits = Math.max(1, Math.ceil(Math.log2(n))), idx = [];
    for (var i = 0; i < (1 << bits); i++) {
      var r = 0; for (var b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      if (r < n) idx.push(r);
    }
    return idx;
  }
  function ttFlow(path) {
    var T = window.TollCalc, total = T.pathMeters(path), line = T.sampleAlong(path, TT_SAMPLE_METERS);
    var pts = spreadOrder(line.length).map(function (i) { return line[i]; });
    var segs = [], calls = 0;
    function covered(a) { return segs.some(function (sg) { return a >= sg.fromM - 40 && a <= sg.toM + 40; }); }
    function wave() {
      var batch = pts.filter(function (p) { return !p.done && !covered(p.along); }).slice(0, TT_WAVE);
      if (!batch.length || calls >= TT_MAX_CALLS) return Promise.resolve();
      return Promise.all(batch.map(function (p) {
        p.done = true; calls++;
        var url = TT_BASE + "/4/flowSegmentData/absolute/10/json?unit=MPH&point=" + p.lonlat[1].toFixed(6) + "," + p.lonlat[0].toFixed(6) + "&key=" + encodeURIComponent(TT_KEY);
        return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
          var f = d && d.flowSegmentData;
          if (!f || !f.coordinates) return;
          var coords = (f.coordinates.coordinate || []).map(function (c) { return [c.longitude, c.latitude]; });
          var m = T.segmentAlong(path, coords, 25);
          if (!m) return;
          segs.push({ fromM: m.from, toM: m.to, from: m.from / total, to: m.to / total, path: m.path,
            mph: f.currentSpeed, freeMph: f.freeFlowSpeed, confidence: f.confidence, closed: !!f.roadClosure,
            level: T.relativeLevel(f.currentSpeed, f.freeFlowSpeed, f.roadClosure) });
        }).catch(function () { /* one failed point leaves a gap */ });
      })).then(wave);
    }
    return wave().then(function () {
      segs.sort(function (a, b) { return a.fromM - b.fromM; });
      // share of the route the matched segments cover
      var covered = 0, end = 0;
      segs.forEach(function (sg) { var a = Math.max(sg.fromM, end); if (sg.toM > a) covered += sg.toM - a; end = Math.max(end, sg.toM); });
      segs.calls = calls; segs.coverage = total ? covered / total : 0;
      return segs;
    });
  }
  // Crashes, closures and roadwork along a route (TomTom incident details for the route's box).
  var TT_ICON = { 0: "Incident", 1: "Crash", 2: "Fog", 3: "Dangerous conditions", 4: "Rain", 5: "Ice", 6: "Traffic jam", 7: "Lane closed",
    8: "Road closed", 9: "Roadwork", 10: "Wind", 11: "Flooding", 14: "Broken-down vehicle" };
  function ttIncidents(paths) {
    var all = [].concat.apply([], paths), xs = all.map(function (p) { return p[0]; }), ys = all.map(function (p) { return p[1]; });
    var pad = 0.01, bbox = [Math.min.apply(null, xs) - pad, Math.min.apply(null, ys) - pad, Math.max.apply(null, xs) + pad, Math.max.apply(null, ys) + pad];
    var fields = "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},startTime,from,to,length,delay,roadNumbers}}}";
    var url = TT_BASE + "/5/incidentDetails?bbox=" + bbox.map(function (n) { return n.toFixed(5); }).join(",") +
      "&fields=" + encodeURIComponent(fields) + "&language=en-US&timeValidityFilter=present&key=" + encodeURIComponent(TT_KEY);
    return fetch(url).then(function (r) { return r.ok ? r.json() : { incidents: [] }; }).then(function (d) {
      return (d.incidents || []).map(function (inc) {
        var g = inc.geometry || {}, pr = inc.properties || {};
        var coords = g.type === "Point" ? [g.coordinates] : (g.coordinates || []);
        var on = paths.map(function (path) {
          if (coords.length > 1) return !!window.TollCalc.segmentAlong(path, coords, 30);
          return window.TollCalc.distanceToPath(path, coords[0]) <= 30; // a point: just close to the route
        });
        var at = coords[Math.floor(coords.length / 2)];
        var frac = function (path) { var a = window.TollCalc.alongPath(path, at); return a && a.total ? a.along / a.total : null; };
        return { kind: TT_ICON[pr.iconCategory] || "Incident", category: pr.iconCategory, onToll: on[0], onFree: on[1],
          at: at, road: (pr.roadNumbers || []).join("/"), from: pr.from, to: pr.to, start: pr.startTime || null,
          tollFrac: on[0] ? frac(paths[0]) : null, freeFrac: on[1] ? frac(paths[1]) : null,
          delayMin: pr.delay ? Math.round(pr.delay / 60) : 0, text: pr.events && pr.events[0] ? pr.events[0].description : "" };
      }).filter(function (i) { return (i.onToll || i.onFree) && i.category !== 6; }); // jams already show as traffic colors
    }).catch(function () { return []; });
  }
  var ttRun = 0;
  function loadTomTom(tollRoute, freeRoute) {
    if (!TOMTOM) return;
    var run = ++ttRun;
    var tp = [].concat.apply([], tollRoute.geometry.paths), fp = [].concat.apply([], freeRoute.geometry.paths);
    $("tt-status").hidden = false;
    $("tt-status").textContent = "TomTom traffic: loading\u2026";
    Promise.all([ttFlow(tp), ttFlow(fp), ttIncidents([tp, fp])]).then(function (res) {
      if (run !== ttRun || !lastTrip || lastTrip.tollRoute !== tollRoute) return;
      tollRoute.tt = res[0]; freeRoute.tt = res[1]; tollRoute.ttIncidents = res[2];
      showTomTom(tollRoute, freeRoute);
      $("tt-status").textContent = "TomTom traffic: " + (res[0].calls + res[1].calls) + " speed lookups, covering " +
        Math.round(res[0].coverage * 100) + "% of the toll route and " + Math.round(res[1].coverage * 100) + "% of the toll-free route; " +
        res[2].length + " incident(s) on the routes.";
    });
  }
  // Replace Esri's step-average colors with TomTom's per-segment ones, and mark incidents.
  function showTomTom(tollRoute, freeRoute) {
    routesLayer.removeMany(tollTraffic.concat(freeTraffic));
    function graphics(segs, kind) {
      return segs.filter(function (sg) { return sg.level && sg.path.length > 1; }).map(function (sg) {
        var geom = { type: "polyline", paths: [sg.path], spatialReference: { wkid: 4326 } };
        return new Graphic({ geometry: geom, symbol: kind === "toll"
          ? { type: "simple-line", color: TRAFFIC[sg.level], width: 5, cap: "round", join: "round" } : freeSymbol(sg.level) });
      });
    }
    tollTraffic = graphics(tollRoute.tt, "toll");
    freeTraffic = graphics(freeRoute.tt, "free");
    var marks = (tollRoute.ttIncidents || []).map(function (i) {
      return new Graphic({ geometry: { type: "point", longitude: i.at[0], latitude: i.at[1] },
        symbol: i.category === 1 ? { type: "picture-marker", url: CRASH_URL, width: "24px", height: "24px" }
          : { type: "simple-marker", style: "diamond", size: 13, color: i.category === 8 ? [217, 48, 37] : [245, 124, 0], outline: { color: [255, 255, 255], width: 1.5 } } });
    });
    routesLayer.addMany(tollTraffic.concat(freeTraffic, marks));
    setFreeVisible($("show-free").checked);
    if (lastTrip) showResults(lastTrip.tollRoute, lastTrip.freeRoute, lastTrip.priced, lastTrip.savings);
  }
  function ttChartSegs(route) {
    return (route.tt || []).map(function (sg) { return { from: sg.from, to: sg.to, level: sg.level, mph: sg.mph, free: sg.freeMph }; });
  }

  // Short map label for a toll point: "Peek Rd $0.84". Drops words that repeat on every gantry.
  function shortName(n) {
    var s = n.replace(/\s*\((formerly [^)]*)\)/i, "")
      .replace(/\b(ML|Mainline|Mainlane)?\s*(Gantry|Plaza|Canopy|Tolling Zone)\b/gi, "")
      .replace(/\s+(Mainlane|Mainline)\b/gi, "")
      .replace(/\s*(Tolled\s+)?(Entrance|Exit)\s+Ramp\b/gi, " ramp")
      .replace(/Katy Managed Lanes/i, "Katy ML").replace(/\((East|West|North|South)bound\)/i, function (m, d) { return d[0] + "B"; })
      .replace(/\s{2,}/g, " ").trim() || n;
    // "Hwy 249 - Hollister Rd - Bammell N Houston Rd - Antoine Dr": the first name is enough on the map
    if (s.length > 18 && / - /.test(s)) s = s.split(" - ")[0].trim();
    return s.length > 24 ? s.slice(0, 22).trim() + "…" : s;
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
          detail: esc(p.road) + (it.rate == null ? " · " + L("rate not included") : " · " + fmtMoney(it.rate)) },
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

  function trafficProbeNote(tp) {
    if (!tp) return "not run";
    if (tp.error) return "refused: " + tp.error;
    return tp.edgeCount + " traversed edges; edge fields: " + (tp.fields.join(", ") || "none") + "; totals: " +
      Object.keys(tp.totals).map(function (k) { return k + " " + (typeof tp.totals[k] === "number" ? tp.totals[k].toFixed(1) : tp.totals[k]); }).join(", ");
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
    box.innerHTML = "<h3>Debug</h3><p><button type='button' id='save-trip' class='go small'>Save trip for testing</button></p>" + base + "<p>Toll route: " + esc(tollRoute.modeNote || "") + "<br>Toll-free route: " + esc((window.__freeNote || "")) + "</p><p>Traffic probe: " + esc(trafficProbeNote(tollRoute.trafficProbe)) + "</p><p>Ramp zones: " + (rampZones ? rampZones.length : "none (no directions geometry)") + "</p>" +
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
    Array.prototype.forEach.call(document.querySelectorAll("#breakdown tr.selected, #trip-chart .tc-dot.selected"), function (r) { r.classList.remove("selected"); });
  }
  var VIOLET = [140, 92, 255]; // violet-screen: the brand's on-screen highlight colour
  // One ring, fill and outline together: it fades in at the point, swells out and fades
  // to nothing, then starts again. It keeps pulsing until the selection is cleared.
  // Toll points pulse violet; TomTom incidents pulse in their own color.
  function pulseAt(pt, rgb) {
    function ring(size, a) {
      return { type: "simple-marker", size: size, color: rgb.concat(0.25 * a), outline: { color: rgb.concat(a), width: 3 } };
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
    if (pulseFrame) cancelAnimationFrame(pulseFrame);
    pulseFrame = null;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      g.symbol = ring(30, 1); // reduce motion: a still ring, no pulse
      return;
    }
    pulseFrame = requestAnimationFrame(frame);
  }
  // mode: "map" (tap on the map: opens the card), "chart" (tap on a trip chart dot: opens
  // the breakdown at that row, no jump to the map), or none (a breakdown row: scrolls to the map).
  function highlightItem(i, row, mode) {
    var fromMap = mode === "map" || mode === true;
    var it = shownItems[i];
    if (!it) return;
    if (!fromMap && row && row.classList.contains("selected")) { clearHighlight(); return; } // tap again to clear
    clearHighlight();
    if (row) row.classList.add("selected");
    var dot = document.querySelector('#trip-chart .tc-dot[data-i="' + i + '"]');
    if (dot) dot.classList.add("selected");
    if (fromMap) showCard(i); // the card opens only for a tap on the map, not from the breakdown
    var pt = new Point({ longitude: it.point.lon, latitude: it.point.lat });
    pulseAt(pt, VIOLET);
    if (fromMap) return;
    if (view.extent && !view.extent.clone().expand(0.9).contains(pt)) view.goTo({ center: pt }).catch(function () {});
    if (mode === "chart") {
      $("breakdown-wrap").open = true;
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
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
  card.setAttribute("aria-label", L("Toll point details"));
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
      return '<div class="pay-cell' + (pay[0] === chosen ? " chosen" : "") + '"><span>' + L(pay[1]) + "</span><strong>" +
        (r == null ? "n/a" : fmtMoney(r)) + "</strong></div>";
    }).join("");
    var status = p.status === "verified" ? L("Rate checked against {owner}’s published schedule.", { owner: esc(p.owner) })
      : p.status === "timed" ? L("Priced by time of day") + (when ? L(" for about {time}", { time: fmtClock(when) }) : "") + (it.note ? " (" + esc(it.note) + ")" : "") + "."
      : L("This rate hasn’t been checked against {owner}’s published schedule yet.", { owner: esc(p.owner) });
    if (p.assumedAxles && p.assumedAxles.indexOf(axles) !== -1) status += L(" Fort Bend publishes rates up to 6 axles; 7+ axles are priced at the 6-axle rate.");
    var chips = [KIND[p.kind], DIRS[p.dir]].filter(Boolean).map(function (c) { return L(c); }).map(function (c) { return '<span class="chip">' + c + "</span>"; }).join("");
    card.innerHTML =
      '<button type="button" class="map-card-close" aria-label="Close">\u2715</button>' +
      '<div class="map-card-road">' + esc(p.road) + "</div>" +
      '<h3 class="map-card-title">' + esc(p.name) + "</h3>" +
      '<div class="chips">' + chips + "</div>" +
      '<div class="map-card-toll"><span>' + L("Your toll") + "</span><strong>" + (it.rate == null ? L("Not included") : fmtMoney(it.rate)) + "</strong>" +
        "<em>" + L("{n} axles", { n: axles }) + "</em></div>" +
      '<div class="pay-grid">' + rates + "</div>" +
      '<p class="map-card-note">' + status + "</p>" +
      '<p class="map-card-agency">' + esc(AGENCY[p.owner] || p.owner) + "</p>";
    card.hidden = false;
  }

  // TomTom incident card (debug test): what it is, where, delay, which route.
  function incidentColor(i) { return i.category === 1 || i.category === 8 ? "#d93025" : "#f57c00"; }
  // Crash icon: a red circle with a white wrecked car (tilted, with an impact burst), drawn in a
  // 32x32 box. The same shapes go on the map (as an image) and in the trip chart (inline).
  var CRASH_SHAPES =
    '<circle cx="16" cy="16" r="14.5" fill="#d93025" stroke="#fff" stroke-width="2"/>' +
    '<g transform="rotate(-14 15 18)" fill="#fff">' +
      '<path d="M10.2 16.2 11.6 12.2Q12 11.2 13.1 11.2H17Q18.1 11.2 18.5 12.2L19.9 16.2Z"/>' +
      '<path d="M12.2 15.4 13.1 12.6H17L17.9 15.4Z" fill="#d93025"/>' +
      '<rect x="8.4" y="15.8" width="13.3" height="5" rx="1.4"/>' +
      '<circle cx="10.9" cy="18.3" r="1" fill="#d93025"/><circle cx="19.2" cy="18.3" r="1" fill="#d93025"/>' +
      '<rect x="9.2" y="20.4" width="2.6" height="2.3" rx="0.6"/><rect x="18.3" y="20.4" width="2.6" height="2.3" rx="0.6"/>' +
    "</g>" +
    '<path fill="#fff" d="M23.6 6.2 24.4 8.6 26.8 7.9 25.4 9.9 27.4 11.3 24.9 11.4 24.8 13.9 23.4 11.9 21.3 13.2 22.2 10.9 19.8 10.1 22.3 9.4Z"/>';
  var CRASH_URL = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' + CRASH_SHAPES + "</svg>");
  function crashMark(x, y, size) { // centered at x, y in the trip chart
    var k = size / 32;
    return '<g transform="translate(' + (x - size / 2).toFixed(1) + " " + (y - size / 2).toFixed(1) + ") scale(" + k.toFixed(3) + ')">' + CRASH_SHAPES + "</g>";
  }
  function diamondMark(x, y, color, r) {
    r = r || 5.5;
    return '<rect x="' + (x - r) + '" y="' + (y - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" transform="rotate(45 ' + x + " " + y + ')" style="fill:' + color + ';stroke:#fff;stroke-width:1.5"/>';
  }
  function showIncidentCard(k) {
    var i = lastTrip && (lastTrip.tollRoute.ttIncidents || [])[k];
    if (!i) return;
    clearHighlight();
    var where = [i.road, i.from && i.to && i.to !== i.from ? i.from + " to " + i.to : i.from].filter(Boolean).join(" \u00b7 ");
    var routes = i.onToll && i.onFree ? "Toll and toll-free routes" : i.onToll ? "Toll route" : "Toll-free route";
    card.innerHTML =
      '<button type="button" class="map-card-close" aria-label="Close">\u2715</button>' +
      '<div class="map-card-road map-card-inc" style="color:' + incidentColor(i) + '">' +
        (i.category === 1 ? '<svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">' + CRASH_SHAPES + "</svg>" : "\u25c6") + " " + esc(i.kind) + "</div>" +
      '<h3 class="map-card-title">' + esc(i.text || i.kind) + "</h3>" +
      (where ? '<p class="map-card-note">' + esc(where) + "</p>" : "") +
      '<div class="chips"><span class="chip">' + routes + "</span>" + (i.delayMin ? '<span class="chip">About ' + i.delayMin + " min delay</span>" : "") +
        (i.start ? '<span class="chip">Since ' + esc(fmtClock(new Date(i.start))) + "</span>" : "") + "</div>" +
      '<p class="map-card-agency">Reported by TomTom (debug test)</p>';
    card.hidden = false;
    var hex = incidentColor(i), rgb = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    pulseAt(new Point({ longitude: i.at[0], latitude: i.at[1] }), rgb);
  }

  // Basemap switcher (top right of the map). The choice is remembered on this device.
  var BASEMAPS = [["arcgis/light-gray", "Light"], ["arcgis/navigation", "Streets"], ["arcgis/imagery", "Satellite"], ["arcgis/dark-gray", "Dark"]];
  if (key) {
    var bm = document.createElement("div");
    bm.className = "basemap-switch";
    bm.setAttribute("role", "group");
    bm.setAttribute("aria-label", L("Base map"));
    bm.innerHTML = BASEMAPS.map(function (b) { return '<button type="button" data-id="' + b[0] + '">' + L(b[1]) + "</button>"; }).join("");
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
    if (TOMTOM) {
      // Debug: TomTom's traffic map layer, to compare with Google's traffic view.
      var ttLayer = new WebTileLayer({ urlTemplate: "https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{level}/{col}/{row}.png?key=" + encodeURIComponent(TT_KEY),
        copyright: "Traffic \u00a9 TomTom", visible: false, opacity: 0.85 });
      map.add(ttLayer, 0);
      var tw = document.createElement("div");
      tw.className = "basemap-switch tt-switch";
      tw.innerHTML = '<button type="button" aria-pressed="false">TomTom traffic</button>';
      view.ui.add(tw, "top-right");
      tw.addEventListener("click", function () {
        ttLayer.visible = !ttLayer.visible;
        tw.firstChild.setAttribute("aria-pressed", ttLayer.visible ? "true" : "false");
      });
    }
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

  // Trip chart: each route as a straight line from S to E, like a subway map, with a dot
  // and price at each toll point placed by distance along the route. Tap a dot to find it
  // on the map. Price labels take the first free row (above, below, higher up); when all are
  // taken the dot stays unlabeled and its price shows on tap.
  function drawTripChart(t, f, priced, routeMeters) {
    var box = $("trip-chart");
    if (t.minutes == null || f.minutes == null) { box.innerHTML = ""; box.hidden = true; return; }
    var W = 340, X0 = 18, X1 = W - 18, yT = 62, yF = 128;
    function ends(y) {
      return '<circle cx="' + X0 + '" cy="' + y + '" r="7" class="tc-s"/><text x="' + X0 + '" y="' + (y + 3) + '" class="tc-l">S</text>' +
        '<circle cx="' + X1 + '" cy="' + y + '" r="7" class="tc-e"/><text x="' + X1 + '" y="' + (y + 3) + '" class="tc-l">E</text>';
    }
    var tr = window.I18N.t;
    var svg = '<svg viewBox="0 0 ' + W + ' 146" role="img" aria-label="' + esc(tr("Trip chart: toll route {tt}, {price}; toll-free route {ft}", { tt: fmtTime(t.minutes), price: fmtMoney(priced.total), ft: fmtTime(f.minutes) })) + '">';
    svg += '<text x="' + X0 + '" y="14" class="tc-h">' + esc(tr("Toll route · {time} · {price}", { time: fmtTime(t.minutes), price: fmtMoney(priced.total) })) + "</text>";
    svg += '<line x1="' + X0 + '" y1="' + yT + '" x2="' + X1 + '" y2="' + yT + '" class="tc-toll-edge"/>';
    svg += '<line x1="' + X0 + '" y1="' + yT + '" x2="' + X1 + '" y2="' + yT + '" class="tc-toll"/>';
    var laneSkip = window.TollCalc.laneRanges(priced.items, routeMeters);
    var useTT = !!(lastTrip && lastTrip.tollRoute.tt);
    var tSegs = useTT ? ttChartSegs(lastTrip.tollRoute) : lastTrip ? window.TollCalc.trafficSegments(lastTrip.tollRoute.steps, laneSkip) : [];
    var fSegs = useTT ? ttChartSegs(lastTrip.freeRoute) : lastTrip ? window.TollCalc.trafficSegments(lastTrip.freeRoute.steps) : [];
    function trafficLines(segs, y, cls) {
      return segs.filter(function (sg) { return sg.level; }).map(function (sg) {
        return '<line x1="' + (X0 + (X1 - X0) * sg.from).toFixed(1) + '" y1="' + y + '" x2="' + (X0 + (X1 - X0) * sg.to).toFixed(1) +
          '" y2="' + y + '" class="' + cls + '" style="stroke:' + TRAFFIC_HEX[sg.level] + '"><title>' + tr("{level} traffic, about {mph} mph", { level: tr(sg.level), mph: Math.round(sg.mph) }) + (sg.free ? " (usually " + Math.round(sg.free) + ")" : "") + "</title></line>";
      }).join("");
    }
    svg += trafficLines(tSegs, yT, "tc-traffic");
    // Beside managed lanes: say why there's no traffic color there.
    laneSkip.forEach(function (r) {
      var a = X0 + (X1 - X0) * r[0], b = X0 + (X1 - X0) * r[1];
      svg += '<line x1="' + a.toFixed(1) + '" y1="' + (yT + 9) + '" x2="' + b.toFixed(1) + '" y2="' + (yT + 9) + '" class="tc-lanes"/>' +
        '<text x="' + ((a + b) / 2).toFixed(1) + '" y="' + (yT + 35) + '" class="tc-k tc-mid">' + tr("Managed lanes · traffic not shown") + "</text>";
    });
    var tiers = [yT - 12, yT + 22, yT - 27], lastX = [-99, -99, -99], GAP = 36, dots = "";
    priced.items.forEach(function (it, i) {
      var frac = routeMeters && it.along != null ? Math.min(1, Math.max(0, it.along / routeMeters)) : (i + 1) / (priced.items.length + 1);
      var x = X0 + 14 + (X1 - X0 - 28) * frac;
      var label = it.rate == null ? "n/a" : fmtMoney(it.rate);
      var tier = -1;
      for (var k = 0; k < tiers.length; k++) if (x - lastX[k] >= GAP) { tier = k; lastX[k] = x; break; }
      dots += '<g class="tc-dot" tabindex="0" role="button" data-i="' + i + '" aria-label="' + esc(it.point.name + ", " + label) + '">' +
        "<title>" + esc(it.point.name + " \u00b7 " + label) + "</title>" +
        '<circle cx="' + x.toFixed(1) + '" cy="' + yT + '" r="12" class="tc-hit"/>' +
        '<circle cx="' + x.toFixed(1) + '" cy="' + yT + '" r="5.5" class="' + (it.rate == null ? "tc-pt missing" : "tc-pt") + '"/>' +
        (tier >= 0 ? '<text x="' + x.toFixed(1) + '" y="' + tiers[tier] + '" class="tc-p">' + label + "</text>" : "") + "</g>";
    });
    svg += ends(yT) + dots;
    svg += '<text x="' + X0 + '" y="' + (yF - 16) + '" class="tc-h">' + esc(tr("Toll-free · {time} · $0.00", { time: fmtTime(f.minutes) })) + "</text>";
    // Toll-free: traffic bands as wide as the toll line's, with the dashed line on top.
    svg += trafficLines(fSegs, yF, "tc-traffic") + '<line x1="' + X0 + '" y1="' + yF + '" x2="' + X1 + '" y2="' + yF + '" class="tc-free"/>' + ends(yF);
    // TomTom incidents (debug test): diamonds on each route line they're on.
    var incs = lastTrip && lastTrip.tollRoute.ttIncidents || [];
    incs.forEach(function (inc, k) {
      [[inc.tollFrac, yT], [inc.freeFrac, yF]].forEach(function (a) {
        if (a[0] == null) return;
        var x = (X0 + 14 + (X1 - X0 - 28) * a[0]).toFixed(1);
        svg += '<g class="tc-inc" tabindex="0" role="button" data-inc="' + k + '" aria-label="' + esc(inc.kind + (inc.road ? " on " + inc.road : "")) + '">' +
          '<rect x="' + (x - 12) + '" y="' + (a[1] - 12) + '" width="24" height="24" class="tc-hit"/>' +
          (inc.category === 1 ? crashMark(+x, a[1], 19) : diamondMark(+x, a[1], incidentColor(inc))) + "</g>";
      });
    });
    var any = tSegs.concat(fSegs).some(function (sg) { return sg.level; });
    var legendH = 146;
    if (any) {
      var lx = X0, ly = 162;
      legendH = 170;
      svg += '<text x="' + lx + '" y="' + ly + '" class="tc-k">' + tr("Highway traffic:") + "</text>";
      lx += 84;
      [["moderate", "Moderate"], ["slow", "Slow"], ["heavy", "Heavy"]].forEach(function (k) {
        svg += '<line x1="' + lx + '" y1="' + (ly - 3.5) + '" x2="' + (lx + 14) + '" y2="' + (ly - 3.5) + '" class="tc-traffic" style="stroke:' + TRAFFIC_HEX[k[0]] + '"/>' +
          '<text x="' + (lx + 19) + '" y="' + ly + '" class="tc-k">' + tr(k[1]) + "</text>";
        lx += tr(k[1]).length * 6 + 34;
      });
    }
    if (incs.length) {
      var iy = any ? 180 : 162;
      svg += crashMark(X0 + 6, iy - 4, 13) + '<text x="' + (X0 + 16) + '" y="' + iy + '" class="tc-k">Crash</text>' +
        diamondMark(X0 + 62, iy - 4, "#d93025", 4) + '<text x="' + (X0 + 71) + '" y="' + iy + '" class="tc-k">Road closure</text>' +
        diamondMark(X0 + 152, iy - 4, "#f57c00", 4) + '<text x="' + (X0 + 161) + '" y="' + iy + '" class="tc-k">Other \u00b7 tap any for details</text>';
      legendH = iy + 8;
    }
    svg = svg.replace('viewBox="0 0 ' + W + ' 146"', 'viewBox="0 0 ' + W + " " + legendH + '"');
    svg += "</svg>";
    // Long stretches with no turn get one average speed from Esri: say why they aren't colored.
    if (useTT) svg += '<p class="tc-note">Traffic colors: TomTom live speeds, compared with each road\'s usual speed (debug test). Traffic \u00a9 TomTom.</p>';
    var coarse = useTT ? null : tSegs.concat(fSegs).filter(function (sg) { return sg.coarse && !sg.skipped; })
      .sort(function (a, b) { return b.miles - a.miles; })[0];
    if (coarse) {
      var m = /\b(?:on|onto)\s+([^()/]+?)\s*(?:\(|\/|toward|$)/i.exec(coarse.text);
      var where = m ? m[1].trim() : tr("the highway");
      svg += '<p class="tc-note">' + esc(tr("No traffic colors on long stretches: Esri gives one average speed for {miles} mi of {road}, too coarse to show where it's slow. The trip time still includes traffic.", { miles: Math.round(coarse.miles), road: where })) + "</p>";
    }
    box.innerHTML = svg;
    box.hidden = false;
  }
  function chartPick(e) {
    var inc = e.target.closest && e.target.closest(".tc-inc");
    if (inc) {
      showIncidentCard(+inc.getAttribute("data-inc"));
      $("map").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    var g = e.target.closest && e.target.closest(".tc-dot");
    if (!g) return;
    var i = +g.getAttribute("data-i");
    var row = document.querySelector('#breakdown tr[data-i="' + i + '"]');
    highlightItem(i, row, "chart");
  }
  $("trip-chart").addEventListener("click", chartPick);
  $("trip-chart").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chartPick(e); } });

  // ---- Trip extras: fuel estimate, commute cost, best time to leave, share ----
  // Fuel: miles per gallon and price per gallon start from defaults for the vehicle class and
  // can be changed (kept in this browser).
  function fuelSettings() {
    var axles = lastTrip ? lastTrip.trip.axles : parseInt($("axles").value, 10);
    var d = window.TollCalc.fuelDefaults(axles), all = fuelStore(), o = all[axles] || {};
    return { axles: axles, mpg: o.mpg > 0 ? o.mpg : d.mpg, price: o.price > 0 ? o.price : d.price, fuel: d.fuel, custom: !!(o.mpg || o.price) };
  }
  // Changes are kept per vehicle size (axles), so a truck's mpg doesn't change a car's.
  function fuelStore() { try { return JSON.parse(localStorage.getItem("htc-fuel") || "{}") || {}; } catch (e) { return {}; } }
  function saveFuel(o) {
    var all = fuelStore(), axles = fuelSettings().axles;
    if (o) all[axles] = o; else delete all[axles];
    try { localStorage.setItem("htc-fuel", JSON.stringify(all)); } catch (e) { /* not kept */ }
  }
  var extrasState = null;
  function renderExtras(t, f, priced) {
    var fs = fuelSettings(), T = window.TollCalc;
    // Gallons count each stretch's speed (stop-and-go burns more per mile than steady driving).
    var gal = function (route, st) { var g = T.fuelGallons(route && route.steps, st.miles, st.minutes, fs.mpg); return g == null ? null : Math.round(g * fs.price * 100) / 100; };
    var tf = gal(lastTrip && lastTrip.tollRoute, t), ff = gal(lastTrip && lastTrip.freeRoute, f);
    var extra = tf != null && ff != null ? Math.round((tf - ff) * 100) / 100 : null;
    var line = "";
    if (extra != null) {
      line = Math.abs(extra) < 0.05 ? L("Gas, counting traffic: about the same on both routes ({cost})", { cost: fmtMoney(tf) })
        : L(extra > 0 ? "Gas, counting traffic: the toll route uses about {cost} more ({toll} vs {free})" : "Gas, counting traffic: the toll route saves about {cost} ({toll} vs {free})",
          { cost: fmtMoney(Math.abs(extra)), toll: fmtMoney(tf), free: fmtMoney(ff) });
      line = esc(line) + " · " + esc(L("{mpg} mpg, {price}/gal {fuel}", { mpg: fs.mpg, price: fmtMoney(fs.price), fuel: L(fs.fuel) })) + ' <button type="button" id="fuel-change">' + L("change") + "</button>";
    }
    $("fuel-line").innerHTML = line;
    $("fuel-mpg").value = fs.mpg; $("fuel-price").value = fs.price.toFixed(2);
    var saved = t.minutes != null && f.minutes != null ? Math.max(0, f.minutes - t.minutes) : null;
    if (priced.laneOptions && priced.laneOptions === priced.items.length) saved = null; // managed lanes: time saved isn't estimated
    extrasState = { toll: priced.total, minutesSaved: saved, fuelExtra: extra };
    renderCommute();
  }
  function renderCommute() {
    if (!extrasState) return;
    var days = parseInt($("commute-days").value, 10), round = $("commute-round").checked;
    var c = window.TollCalc.commute(extrasState, days, round);
    function row(label, v, fmt) { return v ? '<span>' + L(label) + '</span><span class="n">' + fmt(v.week) + '</span><span class="n">' + fmt(v.month) + "</span>" : ""; }
    var hrs = function (m) { return m >= 60 ? (m / 60).toFixed(1) + (window.I18N.lang === "es" ? " h" : " hr") : Math.round(m) + " min"; };
    var net = extrasState.fuelExtra != null ? { week: c.tolls.week + c.fuelExtra.week, month: c.tolls.month + c.fuelExtra.month } : null;
    $("commute-out").innerHTML =
      '<div class="commute-grid"><span class="h">' + L("{n} trips a week", { n: c.trips }) + '</span><span class="h n">' + L("Week") + '</span><span class="h n">' + L("Month") + "</span>" +
      row("Tolls", c.tolls, fmtMoney) +
      (extrasState.minutesSaved ? row("Time saved", c.minutesSaved, hrs) : "") +
      (c.fuelExtra ? row(c.fuelExtra.week >= 0 ? "Extra gas on the toll route" : "Gas saved on the toll route", { week: Math.abs(c.fuelExtra.week), month: Math.abs(c.fuelExtra.month) }, fmtMoney) : "") +
      (net ? '<span><strong>' + L(c.fuelExtra && c.fuelExtra.week < 0 ? "Tolls minus gas saved" : "Tolls plus extra gas") + '</strong></span><span class="n"><strong>' + fmtMoney(net.week) + '</strong></span><span class="n"><strong>' + fmtMoney(net.month) + "</strong></span>" : "") +
      "</div>" +
      '<p class="hint">' + L(round ? "Assumes the trip back costs the same and every trip matches this one (same time of day and traffic). A month is about 4.3 weeks."
        : "Assumes every trip matches this one (same time of day and traffic). A month is about 4.3 weeks.") + "</p>";
  }
  $("commute-days").addEventListener("change", renderCommute);
  $("commute-round").addEventListener("change", renderCommute);
  $("fuel-line").addEventListener("click", function (e) {
    if (e.target.id !== "fuel-change") return;
    $("fuel-edit").hidden = !$("fuel-edit").hidden;
  });
  function fuelEdited() {
    var mpg = parseFloat($("fuel-mpg").value), price = parseFloat($("fuel-price").value);
    saveFuel({ mpg: mpg > 0 ? mpg : null, price: price > 0 ? price : null });
    if (lastTrip) renderExtras(routeStats(lastTrip.tollRoute), routeStats(lastTrip.freeRoute), lastTrip.priced);
  }
  $("fuel-mpg").addEventListener("change", fuelEdited);
  $("fuel-price").addEventListener("change", fuelEdited);
  $("fuel-reset").addEventListener("click", function () {
    saveFuel(null);
    $("fuel-edit").hidden = true;
    if (lastTrip) renderExtras(routeStats(lastTrip.tollRoute), routeStats(lastTrip.freeRoute), lastTrip.priced);
  });

  // Best time to leave: the same trip leaving 30 minutes earlier through an hour later, in
  // 15-minute steps (not before now). Each time is routed with that time's traffic and priced
  // for it (time-of-day tolls). The toll route goes through the same tollway points as the
  // trip shown, so it doesn't hop off at rush hour.
  var bestRun = 0;
  $("best-time").addEventListener("click", function () {
    if (!lastTrip) return;
    var run = ++bestRun, base = new Date(lastTrip.trip.departure), now = Date.now();
    // 30 minutes earlier to an hour later in 15-minute steps; times already past are skipped,
    // and then later times fill in so there are still seven.
    var times = [-30, -15, 0, 15, 30, 45, 60, 75, 90, 105].map(function (m) { return new Date(base.getTime() + m * 60000); })
      .filter(function (d) { return d.getTime() >= now - 60000 || Math.abs(d - base) < 60000; }).slice(0, 7);
    var tollRoute = lastTrip.tollRoute, freeRoute = lastTrip.freeRoute, trip = lastTrip.trip;
    var via = tollRoute.anchors || null, out = $("best-time-out"), btn = $("best-time");
    btn.disabled = true;
    out.innerHTML = '<p class="hint">' + L("Checking {n} departure times…", { n: times.length - 1 }) + "</p>";
    var rows = [], saveDeparture = departure;
    var chain = Promise.resolve();
    times.forEach(function (d) {
      chain = chain.then(function () {
        if (run !== bestRun) return;
        if (Math.abs(d - base) < 60000) {
          // The time you picked: the trip already shown, so the row matches it exactly.
          var ts0 = routeStats(tollRoute), fs0 = routeStats(freeRoute);
          rows.push({ at: d, picked: true, tollMin: ts0.minutes, toll: lastTrip.priced.total,
            plus: lastTrip.priced.pending.length || lastTrip.priced.missing.length, freeMin: fs0.minutes });
          return;
        }
        departure = d;
        // Same routing rules as the trip shown: through its tollway points, with the same side
        // streets blocked, so Esri doesn't hop off the tollway (or the feeder road) at this time.
        return Promise.all([solve(tollRoute.mode, true, false, via, tollRoute.barriers || null),
          solve(freeRoute.mode, false, false, null, freeRoute.barriers || null)]).then(function (r) {
          var tp = [].concat.apply([], r[0].geometry.paths), ts = routeStats(r[0]), fs = routeStats(r[1]);
          var priced = window.TollCalc.analyzeTrip(Object.assign({}, trip, { tollPath: tp, freePath: [].concat.apply([], r[1].geometry.paths),
            steps: r[0].steps || null, departure: d.toISOString(), routeMinutes: ts.minutes }), tollPoints).priced;
          var hop = window.TollCalc.findTollwayHops(r[0].steps).length > 0;
          rows.push({ at: d, tollMin: ts.minutes, toll: priced.total, plus: priced.pending.length || priced.missing.length, freeMin: fs.minutes, hop: hop });
        }).catch(function () { rows.push({ at: d, error: true }); });
      });
    });
    chain.then(function () {
      departure = saveDeparture;
      btn.disabled = false;
      if (run !== bestRun) return;
      rows.sort(function (x, y) { return x.at - y.at; });
      var ok = rows.filter(function (r) { return !r.error; });
      var fastest = ok.reduce(function (b, r) { return !b || r.tollMin < b.tollMin ? r : b; }, null);
      var cheapest = ok.reduce(function (b, r) { return !b || r.toll < b.toll - 0.005 ? r : b; }, null);
      var sameToll = ok.every(function (r) { return Math.abs(r.toll - ok[0].toll) < 0.005; });
      if (fastest && !ok.some(function (r) { return r.tollMin - fastest.tollMin >= 1; })) fastest = null; // no real difference
      var anyHop = ok.some(function (r) { return r.hop; });
      out.innerHTML = '<table class="best-time"><thead><tr><th>' + L("Leave") + '</th><th class="n">' + L("Toll route") + '</th><th class="n">' + L("Toll") + '</th><th class="n">' + L("Toll-free") + '</th><th class="n">' + L("Saves") + "</th></tr></thead><tbody>" +
        rows.map(function (r) {
          if (r.error) return "<tr><td>" + esc(fmtClock(r.at)) + '</td><td colspan="4">' + L("Couldn’t check this time") + "</td></tr>";
          var save = r.freeMin - r.tollMin;
          return '<tr class="' + (r.picked ? "chosen" : "") + '"><td>' + esc(fmtClock(r.at)) +
            (r.picked ? '<span class="tag picked">' + L("Your time") + "</span>" : "") +
            (r === fastest ? '<span class="tag">' + L("Fastest") + "</span>" : "") + (!sameToll && r === cheapest ? '<span class="tag cheap">' + L("Cheapest") + "</span>" : "") +
            '</td><td class="n">' + esc(fmtTime(r.tollMin)) + '</td><td class="n">' + fmtMoney(r.toll) + (r.plus ? "+" : "") + (r.hop ? " *" : "") +
            '</td><td class="n">' + esc(fmtTime(r.freeMin)) + '</td><td class="n">' + (save >= 1 ? esc(fmtTime(save)) : "\u2014") + "</td></tr>";
        }).join("") + "</tbody></table>" +
        '<p class="hint">' + L("Live traffic up to about 4 hours ahead; later times use typical traffic for that day and time.") +
        (sameToll ? L(" Tolls on this route don’t change with the time of day.") : "") +
        (anyHop ? " " + L("* Esri’s route leaves the tollway at this time, so this toll may be low.") : "") + "</p>";
    });
  });

  // Drive it: open the toll or toll-free route in Google Maps (through a few points on the route,
  // so it follows the same roads), Apple Maps or Waze (they pick their own roads).
  function routeWaypoints(route, kind) {
    var T = window.TollCalc, path = [].concat.apply([], route.geometry.paths), pts = [];
    if (kind === "toll" && route.anchors && route.anchors.length) pts = route.anchors.slice(0, 3);
    else {
      // Points on the route itself (vertices of Esri's line, so they sit on the right lanes).
      var total = T.pathMeters(path);
      if (total > 3000) T.sampleAlong(path, total / 3).slice(0, 3).forEach(function (sp) { // 1/6, 1/2 and 5/6 of the way
        var p = sp.lonlat, best = path[0], bd = Infinity;
        path.forEach(function (v) { var d = Math.abs(v[0] - p[0]) + Math.abs(v[1] - p[1]); if (d < bd) { bd = d; best = v; } });
        pts.push(best);
      });
    }
    return pts;
  }
  function renderDrive() {
    if (!lastTrip || !stops.from || !stops.to) return;
    var kind = (document.querySelector('input[name="drive-route"]:checked') || {}).value || "toll";
    var route = kind === "free" ? lastTrip.freeRoute : lastTrip.tollRoute;
    var ll = function (p) { return p[1].toFixed(6) + "," + p[0].toFixed(6); };
    var from = [stops.from.longitude, stops.from.latitude], to = [stops.to.longitude, stops.to.latitude];
    var via = routeWaypoints(route, kind);
    var g = "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + ll(from) + "&destination=" + ll(to) +
      (via.length ? "&waypoints=" + encodeURIComponent(via.map(ll).join("|")) : "");
    $("nav-google").href = g;
    $("nav-apple").href = "https://maps.apple.com/?saddr=" + ll(from) + "&daddr=" + ll(to) + "&dirflg=d";
    $("nav-waze").href = "https://waze.com/ul?ll=" + ll(to) + "&navigate=yes";
    $("drive-note").textContent = L(kind === "free"
      ? "Google Maps follows this route through a few points. Apple Maps and Waze pick their own roads: turn on “Avoid tolls” there to stay toll-free."
      : "Google Maps follows this route through a few points on it. Apple Maps and Waze pick their own roads, which may differ.");
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="drive-route"]'), function (r) { r.addEventListener("change", renderDrive); });

  // Share: a link that reopens this trip (places, vehicle, tag, carpool, and the leave time if
  // one was set) and runs the compare.
  function shareUrl() {
    var t = lastTrip.trip, q = new URLSearchParams();
    ["from", "to"].forEach(function (w, i) {
      var p = stops[w]; if (!p) return;
      q.set(i ? "e" : "s", p.longitude.toFixed(5) + "," + p.latitude.toFixed(5));
      var label = searchesTerm(w); if (label) q.set(i ? "el" : "sl", label);
    });
    q.set("ax", t.axles); q.set("pay", t.payment); if (t.carpool) q.set("cp", "1");
    if ($("leave").value) q.set("t", $("leave").value);
    if (window.I18N.lang === "es") q.set("lang", "es");
    return location.origin + location.pathname + "?" + q.toString();
  }
  $("share").addEventListener("click", function () {
    if (!lastTrip) return;
    var url = shareUrl(), text = $("headline-big").textContent;
    if (navigator.share) {
      navigator.share({ title: L("HCTRA Toll Calculator"), text: text, url: url }).catch(function () { /* closed */ });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { setStatus(L("Link copied. Paste it anywhere to share this trip.")); },
        function () { window.prompt(L("Copy this link:"), url); });
    } else window.prompt(L("Copy this link:"), url);
  });
  // Opening a shared link: fill in the trip and compare once everything has loaded.
  var shared = (function () {
    var q = new URLSearchParams(location.search);
    function pt(v) { var a = (v || "").split(",").map(Number); return a.length === 2 && a.every(isFinite) ? a : null; }
    var s = pt(q.get("s")), e = pt(q.get("e"));
    if (!s || !e) return null;
    return { s: s, e: e, sl: q.get("sl"), el: q.get("el"), ax: parseInt(q.get("ax"), 10), pay: q.get("pay"), cp: q.get("cp") === "1", t: q.get("t") };
  })();
  function applyShared() {
    if (!shared || !searches.from || !searches.to) return false;
    var sh = shared; shared = null;
    stops.from = new Point({ longitude: sh.s[0], latitude: sh.s[1] });
    stops.to = new Point({ longitude: sh.e[0], latitude: sh.e[1] });
    searches.from.searchTerm = sh.sl || L("Shared start");
    searches.to.searchTerm = sh.el || L("Shared destination");
    if (sh.ax >= 2 && sh.ax <= 8) $("axles").value = String(sh.ax);
    var r = document.querySelector('input[name="payment"][value="' + sh.pay + '"]'); if (r) r.checked = true;
    $("carpool").checked = sh.cp;
    // A leave time in the past would show old traffic: use now instead.
    if (sh.t && new Date(sh.t).getTime() > Date.now()) $("leave").value = sh.t;
    drawStops();
    updateButton();
    var tries = 0;
    (function go() {
      if (!$("go").disabled) { $("go").click(); return; }
      if (++tries < 40) setTimeout(go, 250);
    })();
    return true;
  }

  function showResults(tollRoute, freeRoute, priced, savings) {
    var t = routeStats(tollRoute), f = routeStats(freeRoute);
    $("toll-price").textContent = fmtMoney(priced.total) + (priced.pending.length || priced.missing.length ? "+" : "");
    $("toll-meta").textContent = fmtMeta(t);
    $("free-meta").textContent = fmtMeta(f);

    // Headline: is the toll worth it? Time saved and price, then cost per minute saved.
    var big = "", small = "", neutral = false;
    var plus = priced.pending.length || priced.missing.length ? "+" : "";
    if (!priced.items.length) { big = L("No tolls on this trip"); small = L("The fastest route is already toll-free."); neutral = true; }
    else if (priced.laneOptions && priced.laneOptions === priced.items.length) {
      big = L("{price} for the managed lanes", { price: fmtMoney(priced.total) + plus });
      small = L("Time saved isn't estimated: the lanes are usually faster at rush hour.");
    } else if (t.minutes != null && f.minutes != null) {
      var saved = Math.round(f.minutes - t.minutes);
      if (saved > 0) {
        big = L("Save {time} for {price}", { time: fmtTime(saved), price: fmtMoney(priced.total) + plus });
        small = L("About {cost} per minute saved.", { cost: fmtPerMinute(priced.total / saved) });
      } else {
        neutral = true;
        big = L("Skip the tolls");
        small = saved < 0 ? L("The toll route is about {time} slower right now.", { time: fmtTime(-saved) }) : L("The toll-free route is about as fast right now.");
      }
    }
    $("headline").className = "headline" + (neutral ? " neutral" : "");
    $("headline-big").textContent = big;
    $("headline-small").textContent = small;
    renderExtras(t, f, priced);
    renderDrive();

    // Without an EZ TAG: what the same trip would cost with one.
    var ts = $("tag-savings");
    ts.hidden = true;
    if (savings && savings.amount >= 0.01) {
      // Side by side: what you pay (red) vs. with an EZ TAG (green), the savings, and a
      // link to sign up. Labels carry the meaning too, not just the colors.
      var yours = L(lastTrip && lastTrip.trip.payment === "tag" ? "Other tag" : "No tag");
      ts.innerHTML =
        '<div class="ts-grid">' +
          '<div class="ts-col"><span>' + yours + '</span><strong class="ts-bad">' + fmtMoney(priced.total) + "</strong></div>" +
          '<div class="ts-col"><span>' + L("With EZ TAG") + '</span><strong class="ts-good">' + fmtMoney(savings.eztag) + "</strong></div>" +
          '<div class="ts-pill">' + L("Save {amount}", { amount: fmtMoney(savings.amount) }) + "</div>" +
        "</div>" +
        '<a class="ts-link" href="https://www.hctra.org/NewAccount/PersonalAccount" target="_blank" rel="noopener">' + L("Get an EZ TAG →") + "</a>";
      ts.hidden = false;
    }

    var flags = [];
    (lastTrip && lastTrip.tollRoute.ttIncidents || []).forEach(function (i) {
      flags.push("TomTom: " + i.kind + (i.road ? " on " + i.road : "") + (i.from ? " (" + i.from + (i.to && i.to !== i.from ? " to " + i.to : "") + ")" : "") +
        (i.delayMin ? ", about " + i.delayMin + " min delay" : "") + " \u2014 on the " + (i.onToll && i.onFree ? "toll and toll-free routes" : i.onToll ? "toll route" : "toll-free route") + ".");
    });
    if (priced.pending.length) flags.push(L("Some time-of-day tolls (Katy Managed Lanes or SH 288 Express Lanes) couldn't be priced, so the total is low."));
    if (priced.laneOptions) flags.push(L("Your route runs alongside the Katy Managed Lanes or SH 288 Express Lanes. The toll route includes their tolls for that stretch; the toll-free route stays in the regular lanes."));
    if (priced.timed) flags.push(L("Katy Managed Lanes and SH 288 Express Lanes charge by time of day. These are priced for when you'd reach each gantry, leaving {when}.", { when: $("leave").value ? L("at {time}", { time: fmtClock(departure) }) : L("now ({time})", { time: fmtClock(departure) }) }));
    if (priced.missing.length) flags.push(L("{n} toll point(s) on this route have no rate for this vehicle in the data, so the total is low.", { n: priced.missing.length }));
    var fr = lastTrip && lastTrip.freeRoute;
    if (fr && fr.feederGap && fr.feederGap.length)
      flags.push(L("Esri's toll-free route leaves the {road} feeder road and comes back to it (via {via}), even when steered back. Esri's map may be missing part of the feeder road here, so the toll-free time may be a little long.",
        { road: fr.feederGap.map(function (d) { return d.road; }).filter(function (r, i, a) { return a.indexOf(r) === i; }).join(" / "),
          via: fr.feederGap.map(function (d) { return d.via.join(", "); }).join("; ") }));
    else if (fr && fr.feederFixed && fr.feederFixed.length)
      flags.push(L("Esri's fastest toll-free route left the feeder road for side streets ({via}) and came back. Drivers usually stay on the feeder road, so the toll-free route here does too.",
        { via: fr.feederFixed.map(function (d) { return d.via.join(", "); }).join("; ") }));
    var still = lastTrip && lastTrip.tollRoute.stillHops;
    if (still && still.length)
      flags.push(L("Esri's toll route still gets off the {road} and back on (via {via}), even after re-routing. Most drivers stay on the tollway, so the real trip may run a little differently.",
        { road: stillRoads(still), via: stillVia(still) }));
    else if (lastTrip && lastTrip.tollRoute.stayedOn && lastTrip.tollRoute.stayedOn.length)
      flags.push(L("Esri's fastest toll route got off the {road} onto the frontage road or side streets and back on again (to dodge traffic or a toll). Most drivers stay on unless there's a crash or closure, so the toll route here stays on the tollway.",
        { road: lastTrip.tollRoute.stayedOn.map(function (r) { return r === "Sam Houston" ? "Sam Houston Tollway" : r; }).join(" / ") }));
    if (priced.assumed) flags.push(L("{n} Fort Bend County toll point(s) on this route publish rates only up to 6 axles, so they're priced at the 6-axle rate.", { n: priced.assumed }));
    if (priced.unverified) flags.push(L("{n} toll point(s) on this route haven't been checked against their agency's published rates yet.", { n: priced.unverified }));
    $("flags").innerHTML = flags.map(function (m) { return '<div class="notice info">' + esc(m) + "</div>"; }).join("");

    $("breakdown").innerHTML = priced.items.map(function (it) {
      var p = it.point;
      var when = it.when ? ' <span class="tag-unverified">(' + fmtClock(it.when) + (it.note ? ", " + esc(it.note) : "") + ")</span>" : "";
      return '<tr class="pickable" tabindex="0" data-i="' + priced.items.indexOf(it) + '" title="' + L("Show on map") + '"><td class="bd-name">' + esc(p.name) + (p.status === "unverified" ? ' <span class="tag-unverified">' + L("(unverified)") + "</span>" : "") + when +
        '</td><td class="bd-road">' + esc(p.road) + '</td><td class="num">' + (it.rate == null ? "n/a" : fmtMoney(it.rate)) + "</td></tr>";
    }).join("") || '<tr><td colspan="3">' + L("No toll points crossed.") + "</td></tr>";
    $("breakdown-wrap").hidden = !priced.items.length;
    drawTripChart(t, f, priced, lastTrip ? window.TollCalc.pathMeters(lastTrip.trip.tollPath) : null);
    shownItems = priced.items;
    clearHighlight();
    $("results").hidden = false;
  }

  // Price a routed trip and show it. Used after routing, and again when only the payment
  // type or carpool changes: those don't change the route, so the same route is repriced
  // without asking Esri again (a new request can come back as a different route).
  // After a compare, bring the "Save X min for $Y" headline to the top of the panel
  // (or the page on phones) so the results below it are in view.
  function scrollToHeadline() {
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(function () {
      $("headline").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
      try { $("headline").focus({ preventScroll: true }); } catch (e) {} // screen readers hear the result
    });
  }
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
    lastTrip.savings = savings;
    showResults(tollRoute, freeRoute, priced, savings);
  }
  function repriceShown() {
    if (!lastTrip || $("results").hidden) return;
    var payment = paymentChoice();
    if (!payment) return;
    var axles = parseInt($("axles").value, 10);
    var trip = Object.assign({}, lastTrip.trip, { payment: payment, carpool: $("carpool").checked, axles: axles });
    if (trip.payment === lastTrip.trip.payment && trip.carpool === lastTrip.trip.carpool && trip.axles === lastTrip.trip.axles) return;
    var routedAxles = lastTrip.routedAxles || lastTrip.trip.axles;
    priceTrip(trip, lastTrip.tollRoute, lastTrip.freeRoute);
    lastTrip.routedAxles = routedAxles;
    var names = { eztag: "EZ TAG", tag: L("another toll tag"), notag: L("no tag") };
    var what = names[payment] + ", " + L("{n} axles", { n: axles }) + (trip.carpool ? ", " + L("carpool") : "");
    // Cars and trucks are routed differently (truck routing avoids truck-restricted roads),
    // so crossing between them offers a fresh route; within one class the route is the same.
    var truck = function (a) { return a > 2; };
    if (truck(axles) !== truck(routedAxles)) {
      var st = $("status");
      st.className = "status notice info";
      st.innerHTML = esc(L(truck(routedAxles) ? "Repriced for {what} on the truck route. " : "Repriced for {what} on the car route. ", { what: what })) +
        L(truck(axles) ? "Trucks can be routed differently. " : "Cars can take a different route. ") +
        '<button type="button" class="btn-outline small" id="reroute">' + L(truck(axles) ? "Find the truck route" : "Find the car route") + "</button>";
      $("reroute").addEventListener("click", function () { $("go").click(); });
    } else setStatus(L("Repriced for {what} on the same route.", { what: what }));
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="payment"]'), function (r) { r.addEventListener("change", repriceShown); });
  $("carpool").addEventListener("change", repriceShown);
  $("axles").addEventListener("change", repriceShown);
  $("axles").addEventListener("change", syncVehicleSelect);
  $("carpool").addEventListener("change", syncVehicleSelect);

  // Esri's toll route sometimes leaves a tollway for the frontage road (to dodge traffic or
  // skip a plaza) and gets back on a few miles later, often paying an extra entrance ramp.
  // Drivers stay on the tollway unless there's a crash or closure, which the app can't see,
  // so the toll route is asked for again with a barrier on each detour (TollCalc.findTollwayHops),
  // up to twice. If that fails, the original route is kept.
  // Toll-free routes that leave the feeder road for side streets and come back to it: re-route
  // with the side street blocked, a few rounds. If Esri still won't stay on, its map likely has a
  // gap in the feeder road there; say so.
  var FEEDER_ROUNDS = 3;
  function stayOnFeeder(freeRoute, barriers, round, first) {
    barriers = barriers || []; round = round || 0;
    var detours = window.TollCalc.findFeederDetours(freeRoute.steps);
    if (!first) first = detours;
    if (!detours.length || !freeRoute.mode || round >= FEEDER_ROUNDS) {
      if (round > 0) {
        freeRoute.feederFixed = detours.length ? null : first;
        freeRoute.originalFreeMinutes = freeRoute.originalFreeMinutes || null;
      }
      if (detours.length) freeRoute.feederGap = detours;
      if (barriers.length) freeRoute.barriers = barriers.slice(); // reused for other departure times
      return Promise.resolve(freeRoute);
    }
    setStatus(L("Keeping the toll-free route on the feeder road…"));
    detours.forEach(function (d) { barriers.push(d.barrier); });
    return solve(freeRoute.mode, true, DEBUG, null, barriers.slice()).then(function (g) {
      g.originalFreeMinutes = freeRoute.originalFreeMinutes || routeStats(freeRoute).minutes;
      return stayOnFeeder(g, barriers, round + 1, first);
    }).catch(function (e) {
      console.warn("stay-on-feeder route failed", e);
      freeRoute.feederGap = detours;
      return freeRoute;
    });
  }

  var STAY_ON_ROUNDS = 4;
  function tollwayName(r) { return r === "Sam Houston" ? "Sam Houston Tollway" : r; }
  function stillRoads(hops) {
    return hops.map(function (h) { return tollwayName(h.road); }).filter(function (r, i, a) { return a.indexOf(r) === i; }).join(" and ");
  }
  function stillVia(hops) {
    return hops.map(function (h) {
      var m = /\b(?:on|onto|to)\s+(.+)$/i.exec(h.via || "");
      var road = m ? m[1] : h.via;
      return /sam houston pkwy|frontage|frtg/i.test(road) ? L("the {road} frontage road", { road: road }) : road;
    }).filter(function (r, i, a) { return a.indexOf(r) === i; }).join("; ");
  }
  // Keep the toll route on the tollway when Esri's traffic route hops off and back on.
  // First: route through points on the tollway's own line, taken from the same trip solved
  // without traffic (which stays on). Then, if a hop is left, block side streets for a few rounds.
  function stayOnTollway(tollRoute, axles) {
    var hops = window.TollCalc.findTollwayHops(tollRoute.steps);
    if (!hops.length || !tollRoute.mode) return Promise.resolve(tollRoute);
    setStatus(L("Keeping the toll route on the tollway…"));
    var roads = [];
    hops.forEach(function (h) { if (roads.indexOf(h.road) === -1) roads.push(h.road); });
    var original = routeStats(tollRoute).minutes;
    return solve(tollRoute.mode, true, false, null, null, { noTraffic: true }).then(function (calm) {
      var anchors = window.TollCalc.tollwayAnchors(calm.steps, tollRoute.steps, hops);
      if (!anchors.length) return blockSideStreets(tollRoute, [], roads, 0, null);
      var via = anchors.map(function (a) { return a.lonlat; });
      return solve(tollRoute.mode, true, DEBUG, via).then(function (g) {
        g.originalMinutes = original;
        g.anchors = via;
        return blockSideStreets(g, [], roads, 0, via);
      }, function (e) {
        console.warn("route through tollway points failed", e);
        return blockSideStreets(tollRoute, [], roads, 0, null);
      });
    }, function (e) {
      console.warn("no-traffic route failed", e);
      return blockSideStreets(tollRoute, [], roads, 0, null);
    }).then(function (g) {
      g.stayedOn = roads;
      if (g.originalMinutes == null) g.originalMinutes = original;
      return g;
    });
  }
  function blockSideStreets(tollRoute, barriers, roads, round, via) {
    var hops = window.TollCalc.findTollwayHops(tollRoute.steps);
    // Each re-route can turn up a new side street, so allow a few rounds.
    if (!hops.length || round >= STAY_ON_ROUNDS) {
      if (hops.length) tollRoute.stillHops = hops.map(function (h) { return { road: h.road, via: h.via }; });
      if (barriers.length) tollRoute.barriers = barriers.slice(); // reused for other departure times
      return Promise.resolve(tollRoute);
    }
    hops.forEach(function (h) { barriers.push(h.barrier); if (roads.indexOf(h.road) === -1) roads.push(h.road); });
    return solve(tollRoute.mode, true, DEBUG, via, barriers.slice()).then(function (g) {
      g.originalMinutes = tollRoute.originalMinutes;
      g.anchors = tollRoute.anchors;
      return blockSideStreets(g, barriers, roads, round + 1, via);
    }).catch(function (e) {
      console.warn("stay-on-tollway route failed", e);
      return tollRoute;
    });
  }


  $("go").addEventListener("click", function () {
    var axles = parseInt($("axles").value, 10);
    var payment = paymentChoice();
    departure = readDeparture();
    bestRun++;
    $("best-time-out").innerHTML = "";
    $("best-time").disabled = false;
    $("go").disabled = true;
    $("results").hidden = true;
    setStatus(L("Finding routes…"));
    routesLayer.removeAll();
    freeGraphic = null;
    freeTraffic = [];
    clearHighlight();
    drawStops();

    loadTravelModes().then(function (modes) {
      var mode = pickMode(modes, axles);
      window.__baseMode = mode;
      return Promise.all([solveFirst(tollVariants(mode, axles, "prefer"), true), solveFirst(tollVariants(mode, axles, "prohibit"), true)]);
    }).then(function (routes) {
      return Promise.all([stayOnTollway(routes[0], axles), stayOnFeeder(routes[1])]);
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
      drawTollTraffic(tollRoute, lastTrip.priced, window.TollCalc.pathMeters(path));
      loadTomTom(tollRoute, freeRoute);
      setStatus("");
      scrollToHeadline();
    }).catch(function (err) {
      console.error(err);
      setStatus(L("Couldn't get routes: {msg}", { msg: err && err.message ? err.message : L("unknown error") }), true);
    }).then(updateButton);
  });
});
