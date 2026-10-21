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
], function (esriConfig, Map, MapView, Search, GraphicsLayer, Graphic, route, RouteParameters, FeatureSet, networkService) {
  "use strict";

  var ROUTE_URL = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";
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
    return s;
  }
  if (key) { makeSearch("search-from", "from"); makeSearch("search-to", "to"); }

  fetch("data/toll-points.json")
    .then(function (r) { return r.json(); })
    .then(function (d) { tollPoints = d.points; updateButton(); })
    .catch(function () { setStatus("Couldn't load the toll data.", true); });

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

  function withAvoidTolls(mode, axles) {
    var names = axles > 2 ? ["Avoid Toll Roads for Trucks", "Avoid Toll Roads"] : ["Avoid Toll Roads"];
    return names.map(function (n) {
      var m = mode.clone();
      var r = (m.restrictionAttributeNames || []).slice();
      if (r.indexOf(n) === -1) r.push(n);
      m.restrictionAttributeNames = r;
      return m;
    });
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
    });
    return route.solve(ROUTE_URL, params).then(function (res) {
      var rr = res.routeResults[0];
      var g = rr.route;
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
  function solveFirst(modes) {
    var i = 0;
    function next(err) {
      if (i >= modes.length) return Promise.reject(err);
      return solve(modes[i++]).catch(next);
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
  function showDebug(tollRoute, path, rampZones, crossings) {
    var counted = {};
    crossings.forEach(function (c) { counted[c.point.id] = c; });
    // Every toll point within 60 m of the route, ignoring direction and kind.
    var rows = [];
    tollPoints.forEach(function (p) {
      var probe = Object.assign({}, p, { kind: "main", dir: null });
      var hit = window.TollCalc.findCrossings(path, [probe], { matchMeters: 60 })[0];
      if (hit) rows.push({ p: p, off: hit.offset, along: hit.along });
    });
    rows.sort(function (a, b) { return a.along - b.along; });
    var html = rows.map(function (r) {
      var c = counted[r.p.id];
      return "<tr><td>" + r.p.id + "</td><td>" + esc(r.p.name) + "</td><td>" + r.p.kind + " " + (r.p.dir || "") +
        "</td><td class='num'>" + r.off.toFixed(0) + " m</td><td>" + (c ? "yes, " + c.rule : "no") + "</td></tr>";
    }).join("");
    var steps = (tollRoute.steps || []).map(function (s) {
      return "<li>" + esc(s.maneuverType || "?") + ": " + esc(s.text || "") + (s.path ? "" : " (no geometry)") + "</li>";
    }).join("");
    var box = document.getElementById("debug") || document.createElement("div");
    box.id = "debug";
    box.className = "debug";
    box.innerHTML = "<h3>Debug</h3><p>Ramp zones: " + (rampZones ? rampZones.length : "none (no directions geometry)") + "</p>" +
      "<table class='breakdown'><thead><tr><th>ID</th><th>Toll point within 60 m</th><th>Kind</th><th class='num'>Offset</th><th>Counted</th></tr></thead><tbody>" +
      html + "</tbody></table><details><summary>Maneuvers (" + (tollRoute.steps || []).length + ")</summary><ol>" + steps + "</ol></details>";
    document.getElementById("results").after(box);
  }

  function showResults(tollRoute, freeRoute, priced) {
    var t = routeStats(tollRoute), f = routeStats(freeRoute);
    $("toll-price").textContent = fmtMoney(priced.total) + (priced.pending.length || priced.missing.length ? "+" : "");
    $("toll-meta").textContent = fmtMeta(t);
    $("free-meta").textContent = fmtMeta(f);

    var verdict = "";
    if (!priced.items.length) verdict = "The fastest route doesn't use any toll roads.";
    else if (t.minutes != null && f.minutes != null) {
      var saved = Math.round(f.minutes - t.minutes);
      verdict = saved > 0 ? "Paying " + fmtMoney(priced.total) + " in tolls saves about " + saved + " min."
        : "The toll-free route is about as fast. You can skip the tolls.";
    }
    $("verdict").textContent = verdict;

    var flags = [];
    if (priced.pending.length) flags.push("This route uses Katy Managed Lanes or SH 288 Express Lanes, which price by time of day. Those tolls aren't included yet.");
    if (priced.missing.length) flags.push(priced.missing.length + " toll point(s) on this route have no rate for this vehicle in the data, so the total is low.");
    if (priced.unverified) flags.push(priced.unverified + " toll point(s) belong to agencies other than HCTRA. Their rates haven't been checked yet.");
    $("flags").innerHTML = flags.map(function (m) { return '<div class="notice info">' + esc(m) + "</div>"; }).join("");

    $("breakdown").innerHTML = priced.items.map(function (it) {
      var p = it.point;
      return "<tr><td>" + esc(p.name) + (p.status === "unverified" ? ' <span class="tag-unverified">(unverified)</span>' : "") +
        "</td><td>" + esc(p.road) + '</td><td class="num">' + (it.rate == null ? "n/a" : fmtMoney(it.rate)) + "</td></tr>";
    }).join("") || '<tr><td colspan="3">No toll points crossed.</td></tr>';
    $("breakdown-wrap").hidden = !priced.items.length;
    $("results").hidden = false;
  }

  $("go").addEventListener("click", function () {
    var axles = parseInt($("axles").value, 10);
    var payment = $("payment").value;
    $("go").disabled = true;
    $("results").hidden = true;
    setStatus("Finding routes…");
    routesLayer.removeAll();
    drawStops();

    loadTravelModes().then(function (modes) {
      var mode = pickMode(modes, axles);
      return Promise.all([solve(mode, true), solveFirst(withAvoidTolls(mode, axles))]);
    }).then(function (routes) {
      var tollRoute = routes[0], freeRoute = routes[1];
      var path = [].concat.apply([], tollRoute.geometry.paths);
      var hasSteps = tollRoute.steps && tollRoute.steps.some(function (s) { return s.path; });
      var rampZones = hasSteps ? window.TollCalc.rampZonesFromSteps(tollRoute.steps) : null;
      var crossings = window.TollCalc.findCrossings(path, tollPoints, { rampZones: rampZones });
      if (DEBUG) showDebug(tollRoute, path, rampZones, crossings);
      var priced = window.TollCalc.price(crossings, axles, payment);
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
