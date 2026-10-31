/* Toll Calculator: map, address search, routing and results. */
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
  // "Report a wrong toll" opens an email to this address; set by the REPORT_EMAIL repo variable. No address, no button.
  var REPORT_TO = (window.TOLL_CONFIG && window.TOLL_CONFIG.reportEmail || "").trim();
  // Anonymous usage counts (GoatCounter, no cookies): set by the GOATCOUNTER_CODE repo variable.
  // Nothing personal is sent: no addresses, places or routes; only actions and trip types.
  // Not counted in the debug view or when testing on this computer.
  var GC_CODE = (window.TOLL_CONFIG && window.TOLL_CONFIG.goatcounter || "").trim();
  var COUNTING = !!GC_CODE && !DEBUG && location.protocol === "https:";
  if (COUNTING) {
    // The page's own address is counted without its ?query: a shared link's query holds places.
    window.goatcounter = { path: function () { return location.pathname + (/[?&]s=/.test(location.search) ? "#shared-link" : ""); } };
    var gcs = document.createElement("script");
    gcs.async = true; gcs.src = "https://gc.zgo.at/count.js";
    gcs.setAttribute("data-goatcounter", "https://" + GC_CODE + ".goatcounter.com/count");
    document.head.appendChild(gcs);
    document.getElementById("count-note").hidden = false;
  }
  // Count one action, e.g. track("pdf") or track("trip/2-axles/eztag/TX").
  var trackQueue = [];
  function track(path) {
    if (!COUNTING) return;
    var go = function () { try { window.goatcounter.count({ path: path, title: path, event: true }); } catch (e) { /* not counted */ } };
    if (window.goatcounter && window.goatcounter.count) go();
    else if (trackQueue.push(go) === 1) (function wait(n) {
      if (window.goatcounter && window.goatcounter.count) { trackQueue.splice(0).forEach(function (f) { f(); }); return; }
      if (n < 40) setTimeout(function () { wait(n + 1); }, 250);
    })(0);
  }
  // A toll point's state; every point today is in Texas. Interoperability partners (Kansas,
  // Colorado, Oklahoma, Florida) will carry their own "state" in the data.
  function stateOf(p) { return p && p.state || "TX"; }
  function tollBucket(v) { return v <= 0 ? "0" : v < 2 ? "under-2" : v < 5 ? "2-5" : v < 10 ? "5-10" : v < 20 ? "10-20" : "20-plus"; }
  function trackTrip(trip, priced) {
    var states = [], roads = [];
    priced.items.forEach(function (it) {
      var st = stateOf(it.point); if (states.indexOf(st) < 0) states.push(st);
      if (roads.indexOf(it.point.road) < 0) roads.push(it.point.road);
    });
    var stopsN = midPoints().length;
    track("compare");
    track("trip/" + (states.join("+") || "no-tolls") + "/" + trip.axles + "-axles/" + trip.payment + (trip.carpool ? "/carpool" : "") +
      "/stops-" + stopsN + "/toll-" + tollBucket(priced.total));
    if (roads.length) track("roads/" + roads.sort().join(" + "));
  }
  var TOMTOM = DEBUG && !!TT_KEY;
  var $ = function (id) { return document.getElementById(id); };
  var stops = { from: null, to: null };
  // Stops along the way (up to 6), between From and To, in order. Keys m0, m1… (never reused).
  // Six leaves room in a Google Maps link (about 9 points along the way) for 3 route-shaping points.
  var midKeys = [], midSeq = 0, MAX_MID = 6;
  function fieldKeys() { return ["from"].concat(midKeys, ["to"]); }
  function midPoints() { return midKeys.map(function (k) { return stops[k]; }).filter(Boolean); }
  function placeholderFor(w) { return L(w === "from" ? "Starting address" : w === "to" ? "Destination" : "Stop address"); }
  var tollPoints = [];
  var travelModes = null;

  if (key) esriConfig.apiKey = key;
  else $("key-warning").hidden = false;

  var routesLayer = new GraphicsLayer();
  var markersLayer = new GraphicsLayer(); // start and end pins, drawn on top
  var tollLayer = null;                   // toll points on the route, with labels
  var highlightLayer = new GraphicsLayer(); // ring around the toll point picked in the breakdown
  var map = new Map({ basemap: key ? "arcgis/light-gray" : "osm", layers: [routesLayer, highlightLayer, markersLayer] });
  // Every toll road and managed lane in Texas (TxDOT's statewide "Texas Toll Roads" layer), kept
  // in data/toll-roads.geojson by the "Update Texas toll roads" workflow (monthly). Shown with
  // the "Toll roads" switch on the map.
  var tollRoadsLayer = new GeoJSONLayer({
    url: "data/toll-roads.geojson",
    title: "Texas toll roads (TxDOT)",
    copyright: "TxDOT",
    popupEnabled: false,
    // Neutral light gray, not HCTRA purple: most of these roads belong to other agencies.
    renderer: { type: "simple", symbol: { type: "simple-line", color: [171, 171, 176, 0.5], width: 2.5, cap: "round", join: "round" } },
  });
  map.add(tollRoadsLayer, 0);
  tollRoadsLayer.load().catch(function (e) { console.warn("Toll roads layer unavailable", e); });

  var view = new MapView({ container: "map", map: map, center: HOUSTON, zoom: 9 });

  function makeSearch(container, which) {
    var s = new Search({ view: view, container: container, popupEnabled: false, resultGraphicEnabled: false,
      locationEnabled: which === "from", allPlaceholder: placeholderFor(which) });
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
    // Austin area
    ["Austin-Bergstrom Airport (AUS)", -97.6699, 30.1975, "austin"],
    ["Texas Capitol (Austin)", -97.7404, 30.2747, "austin"],
    ["Round Rock (downtown)", -97.6789, 30.5083, "austin"],
    ["Georgetown (courthouse square)", -97.6773, 30.6372, "austin"],
    ["Pflugerville (downtown)", -97.6200, 30.4394, "austin"],
    ["San Marcos (downtown)", -97.9414, 29.8833, "austin"],
    // Dallas-Fort Worth area
    ["DFW Airport", -97.0403, 32.8998, "dfw"],
    ["Dallas Love Field (DAL)", -96.8518, 32.8471, "dfw"],
    ["Downtown Dallas (City Hall)", -96.7970, 32.7767, "dfw"],
    ["Downtown Fort Worth (Sundance Square)", -97.3308, 32.7555, "dfw"],
    ["Plano (Legacy West)", -96.8270, 33.0806, "dfw"],
    ["Frisco (The Star)", -96.8336, 33.1098, "dfw"],
    ["Arlington (AT&T Stadium)", -97.0929, 32.7473, "dfw"],
    ["Cleburne (downtown)", -97.3867, 32.3477, "dfw"],
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
    fieldKeys().forEach(function (w) {
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
      // Common places by area; the option values keep their place in COMMON ("c" + index).
      [["houston", "Houston area"], ["austin", "Austin area"], ["dfw", "Dallas-Fort Worth area"]].forEach(function (a) {
        var items = COMMON.map(function (c, i) { return { label: c[0], i: i, area: c[3] || "houston" }; }).filter(function (c) { return c.area === a[0]; });
        if (!items.length) return;
        html += '<optgroup label="' + esc(L(a[1])) + '">' + items.map(function (c) { return '<option value="c' + c.i + '">' + esc(c.label) + "</option>"; }).join("") + "</optgroup>";
      });
      // Manage: save the place in this box, edit the saved and recent lists.
      var mg = (stops[w] ? '<option value="save">' + L("Save this place…") + "</option>" : "") +
        (saved.length || recent.length ? '<option value="manage">' + L("Edit my places and recent…") + "</option>" : "");
      if (mg) html += '<optgroup label="' + L("Manage") + '">' + mg + "</optgroup>";
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
  function wirePlaceField(w) {
    $("places-" + w).addEventListener("change", function () {
      if (this.value === "manage") { this.value = ""; openPlacesDialog(); return; }
      if (this.value === "save") { this.value = ""; $("save-" + w).click(); return; }
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
  }
  wirePlaceField("from"); wirePlaceField("to");
  fillPlaces();

  // Languages: fixed page text swaps in place (lang.js); what the app builds is redrawn.
  var ESRI_LOCALE = { en: "en", es: "es", vi: "vi", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW" };
  function setEsriLocale() { try { if (intl && intl.setLocale) intl.setLocale(ESRI_LOCALE[window.I18N.lang] || "en"); } catch (e) { /* keep */ } }
  setEsriLocale();
  window.I18N.apply();
  // Desktop: the page itself never scrolls (only the panel does); undo any scroll that slips
  // through on browsers without overflow: clip.
  window.addEventListener("scroll", function () {
    if (window.innerWidth > 760 && (window.scrollY || window.scrollX)) window.scrollTo(0, 0);
  }, { passive: true });
  // Theme button: Auto (follow the device) → Dark → Light → Auto.
  function themeLabel() {
    var T = window.Theme, m = T.mode;
    var txt = m === "auto" ? L("Theme: automatic ({theme} now)", { theme: L(T.theme === "dark" ? "dark" : "light") }) : L(m === "dark" ? "Theme: dark" : "Theme: light");
    $("theme-btn").setAttribute("aria-label", txt + ". " + L("Tap to change."));
    $("theme-btn").title = txt;
  }
  if (window.Theme) {
    $("theme-btn").addEventListener("click", function () { window.Theme.next(); track("theme/" + window.Theme.mode); });
    window.Theme.onChange(themeLabel);
    themeLabel();
  } else $("theme-btn").hidden = true;
  // Language menu: a globe button with the current language's short name; the list shows each
  // language in its own words.
  (function () {
    var btn = $("lang-btn"), list = $("lang-list");
    list.innerHTML = window.I18N.langs.map(function (x) {
      return '<li role="none"><button type="button" role="menuitemradio" data-lang="' + x[0] + '" lang="' + x[0] + '">' + x[1] + "</button></li>";
    }).join("");
    function sync() {
      var l = window.I18N.lang, info = window.I18N.langs.filter(function (x) { return x[0] === l; })[0] || window.I18N.langs[0];
      $("lang-code").textContent = info[2];
      btn.setAttribute("aria-label", L("Language") + ": " + info[1]);
      btn.title = L("Language");
      Array.prototype.forEach.call(list.querySelectorAll("button"), function (b) { b.setAttribute("aria-checked", b.getAttribute("data-lang") === l ? "true" : "false"); });
    }
    function open(on) {
      list.hidden = !on; btn.setAttribute("aria-expanded", on ? "true" : "false");
      if (on) { var c = list.querySelector('[aria-checked="true"]') || list.querySelector("button"); if (c) c.focus(); }
    }
    btn.addEventListener("click", function () { open(list.hidden); });
    list.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-lang]");
      if (!b) return;
      open(false); btn.focus();
      window.I18N.setLang(b.getAttribute("data-lang"));
      track("language/" + b.getAttribute("data-lang"));
    });
    list.addEventListener("keydown", function (e) {
      var items = Array.prototype.slice.call(list.querySelectorAll("button")), i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); }
      else if (e.key === "Escape") { open(false); btn.focus(); }
      else if (e.key === "Tab") open(false);
    });
    document.addEventListener("click", function (e) { if (!list.hidden && !e.target.closest(".lang-menu")) open(false); });
    window.I18N.onChange(sync);
    sync();
  })();
  window.I18N.onChange(function () {
    setEsriLocale();
    if (window.Theme) themeLabel();
    fillPlaces();
    if (typeof fillVehicles === "function") fillVehicles();
    fieldKeys().forEach(function (w) { if (searches[w]) searches[w].allPlaceholder = placeholderFor(w); });
    labelStops();
    addStopsLabel();
    if (typeof setPicking === "function") setPicking(picking);
    showRatesAsOf();
    var bmEl = document.querySelector(".basemap-switch:not(.tt-switch)");
    if (bmEl) Array.prototype.forEach.call(bmEl.querySelectorAll("button"), function (b) {
      var m = BASEMAPS.filter(function (x) { return x[0] === b.getAttribute("data-id"); })[0]; if (m) b.textContent = L(m[1]);
    });
    card.setAttribute("aria-label", L("Toll point details"));
    hideCard();
    setStatus("");
    clearPreview();
    $("best-time-out").innerHTML = "";
    if (lastTrip) showResults(lastTrip.tollRoute, lastTrip.freeRoute, lastTrip.priced, lastTrip.savings);
  });

  // Dropping pins: tap "Pick on map" next to a box, then tap the map. If a box is
  // empty, tapping the map fills it (From first). The box shows the nearest address.
  var picking = null;
  function setPicking(which) {
    if (which && addingStops) setAddingStops(false);
    picking = picking === which ? null : which;
    fieldKeys().forEach(function (w) {
      var b = $("pick-" + w);
      b.classList.toggle("active", picking === w);
      b.textContent = picking === w ? L("Tap the map…") : L("Pick on map");
    });
    if (picking) {
      setStatus(L(picking === "from" ? "Tap the map to set the start." : picking === "to" ? "Tap the map to set the destination." : "Tap the map to set this stop."));
      if (window.innerWidth <= 760) $("map").scrollIntoView({ behavior: "smooth", block: "center" });
    } else setStatus("");
  }
  function wirePick(w) {
    var b = $("pick-" + w);
    if (!key) { b.disabled = true; return; }
    b.addEventListener("click", function () { setPicking(w); });
  }
  wirePick("from"); wirePick("to");

  // Add a stop: a box like From and To, between them. Routes go through the stops in order.
  function labelStops() {
    midKeys.forEach(function (w, i) {
      $("label-" + w).innerHTML = '<span class="pin stop" aria-hidden="true">' + (i + 1) + "</span>" + esc(L("Stop {n}", { n: i + 1 }));
      $("remove-" + w).setAttribute("aria-label", L("Remove stop {n}", { n: i + 1 }));
      $("save-" + w).textContent = L("Save place");
      $("places-" + w).setAttribute("aria-label", L("Saved, recent and common places for Stop {n}", { n: i + 1 }));
    });
    $("add-stop").hidden = midKeys.length >= MAX_MID;
    $("add-stop").innerHTML = '<span class="pin stop" aria-hidden="true">+</span>' + esc(L("Add a stop"));
  }
  function addStop(at, label) {
    if (midKeys.length >= MAX_MID) return null;
    var w = "m" + (midSeq++);
    var sec = document.createElement("section");
    sec.className = "field mid-stop"; sec.id = "field-" + w;
    sec.innerHTML = '<div class="label-row"><label id="label-' + w + '"></label><span class="mid-actions row-actions">' +
      '<span class="menu-link"><span aria-hidden="true">☆ </span><span>' + L("My places") + '</span><select id="places-' + w + '" class="places"></select></span>' +
      '<button type="button" id="pick-' + w + '" class="pick">' + L("Pick on map") + '</button>' +
      '<button type="button" id="remove-' + w + '" class="pick remove-stop">\u2715</button></span></div>' +
      '<div id="search-' + w + '" class="search"></div>' +
      '<button type="button" id="save-' + w + '" class="pick" hidden disabled></button>';
    $("mid-stops").appendChild(sec);
    midKeys.push(w);
    stops[w] = at || null;
    if (key) makeSearch("search-" + w, w);
    if (at && searches[w]) searches[w].searchTerm = label || "";
    wirePlaceField(w); wirePick(w);
    $("remove-" + w).addEventListener("click", function () { removeStop(w); });
    labelStops(); fillPlaces(); drawStops(); updateButton();
    return w;
  }
  function removeStop(w) {
    if (picking === w) setPicking(null);
    try { if (searches[w]) searches[w].destroy(); } catch (e) { /* gone */ }
    delete searches[w]; delete stops[w];
    midKeys = midKeys.filter(function (k) { return k !== w; });
    var el = $("field-" + w); if (el) el.remove();
    labelStops(); drawStops(); updateButton();
  }
  $("add-stop").addEventListener("click", function () {
    track("stop-added/form");
    var w = addStop();
    if (w && searches[w]) setTimeout(function () { try { searches[w].focus(); } catch (e) { /* ok */ } }, 50);
  });
  labelStops();

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
    if (picking || addingStops || !tollLayer) return mapTap(e);
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
    if (addingStops) return addStopAt(e.mapPoint);
    if (stopBubble && !stopBubble.hidden) { hideStopBubble(); return; } // tap elsewhere closes the bubble
    if (!picking && highlightLayer.graphics.length) { clearHighlight(); return; } // tap the map to clear the ring
    var target = picking || (!stops.from ? "from" : !stops.to ? "to" : null);
    if (!target) { if (STOP_UI === "bubble") showStopBubble(e); return; }
    placeStop(target, e.mapPoint);
    if (picking) setPicking(null);
  }

  fetch("data/toll-points.json")
    .then(function (r) { return r.json(); })
    .then(function (d) { tollPoints = d.points; ratesAsOf = d.meta && d.meta.ratesAsOf; showRatesAsOf(); drawAllPoints(); updateButton(); if (shared) applyShared(); loadUnpriced(); })
    .catch(function () { setStatus(L("Couldn't load the toll data."), true); });

  // Texas toll roads we don't have rates for yet (no toll points near them, e.g. Toll 49 in Tyler
  // or CTRMA's roads in Austin). A route that drives on one gets a warning instead of a silent $0.
  var unpricedRoadList = null, tollRoadFeatures = null;
  // A stop dropped right on a toll road is a way of saying "take this toll road": the toll
  // route goes through it, the toll-free route doesn't (it can't drive there).
  function stopTollRoad(m) { return m && tollRoadFeatures ? window.TollCalc.tollRoadAt(tollRoadFeatures, [m.longitude, m.latitude], 35) : null; }
  function freeMids() { return midPoints().filter(function (m) { return !stopTollRoad(m); }); }
  function loadUnpriced() {
    fetch("data/toll-roads.geojson")
      .then(function (r) { return r.json(); })
      .then(function (g) {
        tollRoadFeatures = g.features;
        unpricedRoadList = window.TollCalc.unpricedRoads(g.features, tollPoints);
        if (lastTrip && !$("results").hidden) showResults(lastTrip.tollRoute, lastTrip.freeRoute, lastTrip.priced, lastTrip.savings);
      })
      .catch(function (e) { console.warn("Toll roads check unavailable", e); });
  }
  // { toll: [{name}], free: [{name}] } for the current trip, worked out once per route.
  function unpricedOnTrip() {
    var none = { toll: [], free: [] };
    if (!lastTrip || !unpricedRoadList) return none;
    var T = window.TollCalc, tp = lastTrip.trip.tollPath, fp = lastTrip.trip.freePath, c = lastTrip.unpriced;
    if (c && c.tp === tp && c.fp === fp) return c.found;
    var found = { toll: T.unpricedOnRoute(tp, unpricedRoadList), free: T.unpricedOnRoute(fp, unpricedRoadList) };
    lastTrip.unpriced = { tp: tp, fp: fp, found: found };
    return found;
  }
  function roadList(list) {
    var names = list.map(function (r) { return r.name; });
    if (names.length < 2) return names.join("");
    return names.slice(0, -1).join(", ") + " " + L("and") + " " + names[names.length - 1];
  }
  fetch("data/sh288-rates.json")
    .then(function (r) { return r.json(); })
    .then(function (d) { window.TollCalc.setSchedules({ sh288: d }); sh288Effective = d.effective; showRatesAsOf(); })
    .catch(function () { /* SH 288 tolls will show as not included */ });

  // This week's fuel prices (EIA, refreshed by each deploy and weekly): they replace the
  // built-in defaults. A saved vehicle's or typed-in price still wins.
  var fuelWeek = null;
  fetch("data/fuel-prices.json")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var P = window.TollCalc.FUEL_PRICES;
      if (d.regular >= 1.5 && d.regular <= 9) P.regular = d.regular;
      if (d.diesel >= 1.5 && d.diesel <= 10) P.diesel = d.diesel;
      if (d.week) { P.asOf = d.week; fuelWeek = d; }
      if (lastTrip && !$("results").hidden) renderExtras(routeStats(lastTrip.tollRoute), routeStats(lastTrip.freeRoute), lastTrip.priced);
    })
    .catch(function () { /* built-in prices */ });
  function fuelSourceNote() {
    if (!fuelWeek) return "";
    var d = new Date(fuelWeek.week + "T12:00:00");
    return " " + L("Default prices: {area} average for the week of {date} (U.S. Energy Information Administration).",
      { area: L(fuelWeek.regularArea === "Houston" ? "Houston" : fuelWeek.regularArea), date: d.toLocaleDateString(window.I18N.locale(), { month: "short", day: "numeric" }) });
  }

  // "Rates as of": when the rates were last checked against the agencies' tables.
  var ratesAsOf = null, sh288Effective = null;
  function showRatesAsOf() {
    var el = $("rates-asof");
    if (!ratesAsOf) return;
    var d = new Date(ratesAsOf + "T12:00:00");
    el.textContent = L("Rates as of {date}", { date: d.toLocaleDateString(window.I18N.locale(), { month: "short", day: "numeric", year: "numeric" }) }) +
      (sh288Effective ? L(" · SH 288 time-of-day rates effective {date}", { date: sh288Effective }) : "") + ".";
    el.hidden = false;
    $("rates-asof-print").textContent = el.textContent; // print: right under the toll breakdown
  }

  // Departure time: blank = now. The datetime-local value is read as the device's local time.
  var departure = new Date();
  var lookupLog = { t0: performance.now(), list: [] };
  // While the trip back is being priced, routes go from the end to the start (see priceBack).
  var swapEnds = null;
  // With stops along the way: this trip's route line, for putting route-shaping points in order.
  var orderPath = null;
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
        stops: midKeys.length ? midPoints().map(lonLat) : undefined,
        axles: t.axles, payment: t.payment, carpool: t.carpool, departure: t.departure },
      toll: { minutes: ts.minutes, miles: ts.miles, mode: lastTrip.tollRoute.modeNote || null, path: t.tollPath.map(round6),
        steps: (t.steps || []).map(function (s) { return { maneuverType: s.maneuverType, text: s.text, time: s.time, length: s.length, path: s.path ? s.path.map(round6) : null }; }),
        trafficProbe: lastTrip.tollRoute.trafficProbe || null,
        stayedOn: lastTrip.tollRoute.stayedOn || null, stopStatus: lastTrip.tollRoute.stopStatus || null, stillHops: lastTrip.tollRoute.stillHops || null, anchors: lastTrip.tollRoute.anchors || null, originalMinutes: lastTrip.tollRoute.originalMinutes || null },
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
  // Leave: on desktop, Chrome's date-and-time popup has no OK button (you have to click away),
  // so there it's a date box (closes when you pick a day) and a time list (closes when you pick
  // a time). The hidden #leave keeps the value, so the rest of the app reads and sets it as before.
  (function () {
    var box = $("leave"), split = $("leave-split"), dIn = $("leave-date"), tIn = $("leave-time");
    if (!window.matchMedia || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    var pad = function (n) { return ("0" + n).slice(-2); };
    var ymd = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
    function clock(hm) {
      var p = hm.split(":"), d = new Date(2000, 0, 1, +p[0], +p[1]);
      return d.toLocaleTimeString(window.I18N.locale(), { hour: "numeric", minute: "2-digit" });
    }
    function fillTimes(extra) {
      var keep = extra || tIn.value, list = [];
      for (var m = 0; m < 1440; m += 15) list.push(pad(Math.floor(m / 60)) + ":" + pad(m % 60));
      if (keep && list.indexOf(keep) < 0) { list.push(keep); list.sort(); }
      tIn.innerHTML = "";
      tIn.appendChild(new Option(L("Now"), ""));
      list.forEach(function (hm) { tIn.appendChild(new Option(clock(hm), hm)); });
      tIn.value = keep || "";
    }
    function show(v) { // #leave value → the two boxes
      var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(v || "");
      dIn.value = m ? m[1] : "";
      fillTimes(m ? m[2] : "");
    }
    Object.defineProperty(box, "value", {
      configurable: true,
      get: function () { return proto.get.call(box); },
      set: function (v) { proto.set.call(box, v); show(v); }
    });
    function store() {
      var v = dIn.value && tIn.value ? dIn.value + "T" + tIn.value : "";
      proto.set.call(box, v);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function nextSlot() { var d = new Date(Date.now() + 15 * 60000); return pad(d.getHours()) + ":" + pad(Math.floor(d.getMinutes() / 15) * 15); }
    dIn.addEventListener("change", function () {
      if (dIn.value && !tIn.value) fillTimes(nextSlot());
      if (!dIn.value) tIn.value = "";
      store();
    });
    tIn.addEventListener("change", function () {
      if (!tIn.value) dIn.value = "";              // "Now"
      else if (!dIn.value) {                       // a time with no date: today, or tomorrow if it's passed
        var d = new Date(), p = tIn.value.split(":");
        if (+p[0] * 60 + +p[1] <= d.getHours() * 60 + d.getMinutes()) d.setDate(d.getDate() + 1);
        dIn.value = ymd(d);
      }
      store();
    });
    dIn.min = ymd(new Date());
    box.style.display = "none";
    split.hidden = false;
    $("leave-label").htmlFor = "leave-date";
    show(proto.get.call(box));
    window.I18N.onChange(function () { fillTimes(); });
  })();

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
    if (paymentChoice()) html += '<option value="save">' + L("Save this vehicle…") + "</option>";
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
    // The button shows the saved vehicle in use, or "My vehicles".
    $("vehicles-label").textContent = activeVehicle >= 0 ? v.name : L("My vehicles");
  }
  // Puts a saved vehicle's settings into the panel and makes it the active one.
  function applyVehicle(i) {
    var p = vehicles[i];
    if (!p) { syncVehicleSelect(); return; }
    activeVehicle = i;
    $("axles").value = String(p.axles);
    var r = $("pay-" + p.payment); if (r) r.checked = true;
    $("carpool").checked = !!p.carpool;
    updateButton();
    repriceShown();
    if (lastTrip && !$("results").hidden) renderExtras(routeStats(lastTrip.tollRoute), routeStats(lastTrip.freeRoute), lastTrip.priced);
    if (!lastTrip || $("results").hidden) setStatus(L("Using “{name}”.", { name: p.name }) + " " + vehicleSummary(p) + ".");
  }
  function openDialog(d) { if (d.showModal) { if (!d.open) d.showModal(); } else d.setAttribute("open", ""); }
  function closeDialog(d) { if (d.close) d.close(); else d.removeAttribute("open"); }
  $("vehicles").addEventListener("change", function () {
    var v = this.value;
    if (v === "manage") { syncVehicleSelect(); renderVehicleDialog(); openDialog($("vehicles-dialog")); return; }
    if (v === "save") { syncVehicleSelect(); if (paymentChoice()) openVehicleEditor(-1); return; }
    applyVehicle(+v.slice(1));
  });

  // Save / edit a vehicle: name, vehicle, tag, carpool and its fuel (gas or diesel, mpg and
  // price). Blank or untouched mpg and price follow the defaults for the vehicle size.
  var veIndex = -1, veTouched = {};
  function veFuel() { var f = document.querySelector('input[name="ve-fuel"]:checked'); return f ? f.value : "regular"; }
  function veDefaults() {
    var axles = parseInt($("ve-axles").value, 10), d = window.TollCalc.fuelDefaults(axles), fuel = veFuel();
    return { mpg: d.mpg, price: window.TollCalc.FUEL_PRICES[fuel], fuel: fuel, sizeFuel: d.fuel };
  }
  function veRefresh() {
    var d = veDefaults();
    if (!veTouched.mpg) $("ve-mpg").value = d.mpg;
    if (!veTouched.price) $("ve-price").value = d.price.toFixed(2);
    $("ve-price-label").textContent = L(d.fuel === "diesel" ? "Diesel price per gallon" : "Gas price per gallon");
    $("ve-fuel-hint").textContent = L("Defaults: {mpg} mpg, {price} a gallon. Change them to match your vehicle.", { mpg: d.mpg, price: fmtMoney(d.price) });
  }
  function openVehicleEditor(i) {
    veIndex = i;
    var v = i >= 0 ? vehicles[i] : null;
    var axles = v ? v.axles : parseInt($("axles").value, 10);
    var pay = v ? v.payment : paymentChoice();
    var cur = v ? v : (function () { var o = fuelStore()[axles] || {}; return { fuel: o.fuel, mpg: o.mpg, price: o.price }; })();
    $("ve-title").textContent = L(v ? "Edit vehicle" : "Save vehicle");
    $("ve-name").value = v ? v.name : (axles > 2 ? L("{n}-axle truck", { n: axles }) : L("My car"));
    $("ve-name").removeAttribute("aria-invalid"); $("ve-name-error").hidden = true;
    $("ve-axles").value = String(axles);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="ve-pay"]'), function (r) { r.checked = r.value === pay; });
    $("ve-carpool").checked = v ? !!v.carpool : $("carpool").checked;
    var fuel = cur.fuel || window.TollCalc.fuelDefaults(axles).fuel;
    $("ve-fuel-" + fuel).checked = true;
    veTouched = { mpg: cur.mpg > 0, price: cur.price > 0 };
    if (cur.mpg > 0) $("ve-mpg").value = cur.mpg;
    if (cur.price > 0) $("ve-price").value = (+cur.price).toFixed(2);
    veRefresh();
    openDialog($("vehicle-edit"));
    setTimeout(function () { $("ve-name").focus(); $("ve-name").select(); }, 30);
  }
  $("ve-axles").addEventListener("change", function () {
    // A new size brings its usual fuel (gas for 2-3 axles, diesel for 4+) unless already set.
    var d = window.TollCalc.fuelDefaults(parseInt(this.value, 10));
    if (!veTouched.fuel) $("ve-fuel-" + d.fuel).checked = true;
    veRefresh();
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="ve-fuel"]'), function (r) {
    r.addEventListener("change", function () { veTouched.fuel = true; veTouched.price = false; veRefresh(); });
  });
  $("ve-mpg").addEventListener("input", function () { veTouched.mpg = this.value !== ""; });
  $("ve-price").addEventListener("input", function () { veTouched.price = this.value !== ""; });
  $("ve-name").addEventListener("input", function () { this.removeAttribute("aria-invalid"); $("ve-name-error").hidden = true; });
  $("ve-cancel").addEventListener("click", function () { closeDialog($("vehicle-edit")); });
  $("ve-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("ve-name").value.trim();
    if (!name) { $("ve-name").setAttribute("aria-invalid", "true"); $("ve-name-error").hidden = false; $("ve-name").focus(); return; }
    var pay = document.querySelector('input[name="ve-pay"]:checked');
    var d = veDefaults(), mpg = parseFloat($("ve-mpg").value), price = parseFloat($("ve-price").value);
    var v = { name: name, axles: parseInt($("ve-axles").value, 10), payment: pay ? pay.value : "eztag", carpool: $("ve-carpool").checked,
      fuel: d.fuel !== d.sizeFuel ? d.fuel : null,
      mpg: mpg > 0 && Math.abs(mpg - d.mpg) > 0.001 ? mpg : null,
      price: price > 0 && Math.abs(price - d.price) > 0.001 ? Math.round(price * 100) / 100 : null };
    var editing = veIndex >= 0 ? vehicles[veIndex] : null, active = vehicles[activeVehicle] || null;
    var wasActive = editing && editing === active;
    var others = vehicles.filter(function (x) { return x !== editing && x.name.toLowerCase() !== name.toLowerCase(); });
    if (editing) { var at = vehicles.indexOf(editing); others.splice(Math.min(at, others.length), 0, v); vehicles = others; }
    else vehicles = [v].concat(others);
    saveList("vehicles", vehicles);
    closeDialog($("vehicle-edit"));
    if (!editing || wasActive) { fillVehicles(); applyVehicle(vehicles.indexOf(v)); }
    else { activeVehicle = active ? vehicles.indexOf(active) : -1; fillVehicles(); }
    if ($("vehicles-dialog").open) renderVehicleDialog();
    setStatus(L(editing ? "Updated “{name}” ({summary})." : "Saved “{name}” ({summary}) to My vehicles on this device.", { name: v.name, summary: vehicleSummary(v) }));
  });
  $("save-vehicle").addEventListener("click", function () { openVehicleEditor(-1); });
  // Carpool note behind a small "i" button, to keep the vehicle row short.
  function carpoolNote(show) { $("carpool-hint").hidden = !show; $("carpool-info").setAttribute("aria-expanded", String(show)); }
  $("carpool-info").addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); carpoolNote($("carpool-hint").hidden); });
  document.addEventListener("click", function (e) { if (!$("carpool-hint").hidden && !e.target.closest("#carpool-hint")) carpoolNote(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("carpool-hint").hidden) { carpoolNote(false); $("carpool-info").focus(); } });
  function fuelSummary(v) {
    var d = window.TollCalc.fuelDefaults(v.axles), fuel = v.fuel || d.fuel;
    return L(fuel === "diesel" ? "Diesel" : "Gas") + " · " + L("{mpg} mpg", { mpg: v.mpg || d.mpg }) + " · " + L("{price}/gal", { price: fmtMoney(v.price || window.TollCalc.FUEL_PRICES[fuel]) });
  }
  function renderVehicleDialog() {
    $("vehicle-list").innerHTML = vehicles.length ? vehicles.map(function (v, i) {
      return '<li><span class="ve-info">' + esc(v.name) + ' <small class="hint">' + esc(vehicleSummary(v)) + '</small><small class="hint">' + esc(fuelSummary(v)) + "</small></span>" +
        '<span class="ve-actions"><button type="button" class="btn-outline small" data-edit="' + i + '" aria-label="' + esc(L("Edit {name}", { name: v.name })) + '">' + L("Edit") + "</button>" +
        '<button type="button" class="btn-outline small" data-i="' + i + '" aria-label="' + esc(L("Remove {name}", { name: v.name })) + '">' + L("Remove") + "</button></span></li>";
    }).join("") : '<li class="empty">' + L("No saved vehicles. Set the vehicle and tag, then tap “Save vehicle”.") + "</li>";
  }
  $("vehicle-list").addEventListener("click", function (e) {
    var ed = e.target.closest("button[data-edit]");
    if (ed) { openVehicleEditor(+ed.getAttribute("data-edit")); return; }
    var b = e.target.closest("button[data-i]");
    if (!b) return;
    var gone = +b.getAttribute("data-i");
    vehicles.splice(gone, 1);
    activeVehicle = activeVehicle === gone ? -1 : activeVehicle > gone ? activeVehicle - 1 : activeVehicle;
    saveList("vehicles", vehicles);
    fillVehicles();
    renderVehicleDialog();
  });
  $("vehicles-done").addEventListener("click", function () { closeDialog($("vehicles-dialog")); });
  fillVehicles();

  // Section jump bar: tap a section to scroll the panel (the page on phones) to it. The
  // results sections show once there are results; folded sections open when you jump to them.
  (function () {
    var bar = $("jump"), btns = Array.prototype.slice.call(bar.querySelectorAll("button"));
    function shown() {
      var has = !$("results").hidden;
      btns.forEach(function (b) { if (b.getAttribute("data-need")) b.hidden = !has; });
      spy();
      edges();
    }
    var pinUntil = 0;
    function spy() {
      if (Date.now() < pinUntil) return;
      var top = bar.getBoundingClientRect().bottom + 12, on = null, last = null;
      btns.forEach(function (b) {
        var id = b.getAttribute("data-to"), el = id === "results" ? $("headline") : $(id);
        if (b.hidden || !el || getComputedStyle(b).display === "none") return;
        if (el.getBoundingClientRect().top <= top || !on) on = b;
        last = b;
      });
      // At the very bottom the last sections can't reach the top: light the last one.
      var phone = window.matchMedia("(max-width: 760px)").matches, panel = document.querySelector(".panel");
      var atEnd = phone ? window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
                        : panel.scrollTop > 0 && panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4;
      if (atEnd && last && !(spacer && parseFloat(spacer.style.height) > 0)) on = last;
      var was = bar.querySelector("button.on");
      btns.forEach(function (b) { b.classList.toggle("on", b === on); });
      if (on && on !== was) panBar(on);
    }
    // When the bar is wider than the screen, slide it so the lit chip sits in the middle and
    // the chips on either side stay in view to tap.
    function panBar(b) {
      var max = bar.scrollWidth - bar.clientWidth;
      if (max > 0) {
        var br = bar.getBoundingClientRect(), r = b.getBoundingClientRect();
        var want = bar.scrollLeft + (r.left - br.left) - (bar.clientWidth - r.width) / 2;
        var behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        bar.scrollTo({ left: Math.max(0, Math.min(max, want)), behavior: behavior });
      }
      edges();
    }
    function edges() {
      var max = bar.scrollWidth - bar.clientWidth;
      bar.classList.toggle("more-left", max > 0 && bar.scrollLeft > 4);
      bar.classList.toggle("more-right", max > 0 && bar.scrollLeft < max - 4);
    }
    bar.addEventListener("scroll", edges, { passive: true });
    // Scroll the panel (the page on phones) so the section starts just under the bar. Not
    // scrollIntoView: on desktop that also scrolls the page itself, pushing the header and
    // the bar out of view, and on phones it can't scroll to the results (display: contents).
    // Near the end of the panel a spacer makes room so the last sections can reach the top.
    var spacer = document.createElement("div");
    spacer.className = "jump-spacer";
    spacer.setAttribute("aria-hidden", "true");
    document.querySelector(".panel").appendChild(spacer);
    function scrollToSection(el) {
      var phone = window.matchMedia("(max-width: 760px)").matches, panel = document.querySelector(".panel");
      var behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      var gap = bar.offsetHeight + 8;
      spacer.style.height = "0px";
      if (phone) {
        window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - gap), behavior: behavior });
        return;
      }
      if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0);
      var top = el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - gap;
      var max = panel.scrollHeight - panel.clientHeight;
      if (top > max) spacer.style.height = Math.ceil(top - max) + "px";
      panel.scrollTo({ top: Math.max(0, top), behavior: behavior });
    }
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-to]");
      if (!b) return;
      var el = $(b.getAttribute("data-to"));
      if (!el) return;
      track("jump-" + b.getAttribute("data-to"));
      if (el.tagName === "DETAILS") el.open = true;
      // The page may not scroll far enough to bring the last sections to the top: keep the
      // tapped chip lit until the scroll has settled.
      btns.forEach(function (x) { x.classList.toggle("on", x === b); });
      panBar(b);
      pinUntil = Date.now() + 900;
      scrollToSection(el.id === "results" ? $("headline") : el);
      var f = el.tagName === "DETAILS" ? el.querySelector("summary") : el.id === "results" ? $("headline") : null;
      if (f) setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (x) { /* old browser */ } }, 400);
    });
    var tick = false;
    function onScroll() { if (tick) return; tick = true; requestAnimationFrame(function () { tick = false; spy(); }); }
    document.querySelector(".panel").addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { onScroll(); edges(); });
    new MutationObserver(shown).observe($("results"), { attributes: true, attributeFilter: ["hidden"] });
    shown();
  })();

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
    if (addingStops) { addingStops = false; addStopsLabel(); }
    midKeys.slice().forEach(removeStop);
    ["from", "to"].forEach(function (w) {
      stops[w] = null;
      if (searches[w]) { try { searches[w].clear(); } catch (e) { searches[w].searchTerm = ""; } }
    });
    clearHighlight();
    routesLayer.removeAll(); if (cursorLayer) cursorLayer.removeAll(); if (previewLayer) clearPreview();
    freeGraphic = null;
    freeTraffic = [];
    if (tollLayer) { map.remove(tollLayer); tollLayer = null; }
    tollFallback.removeAll();
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

  // The places as last compared. If they change while results are showing (a stop added,
  // moved or removed, a new start or end), compare again by itself so the results match.
  var comparedKey = null, recompareTimer = null;
  function placesKey() {
    return fieldKeys().map(function (k) { var p = stops[k]; return p ? p.longitude.toFixed(5) + "," + p.latitude.toFixed(5) : "-"; })
      .filter(function (v, i, a) { return v !== "-" || i === 0 || i === a.length - 1; }).join(";");
  }
  function maybeRecompare() {
    if (addingStops) return; // wait for "Done", then compare once
    if (!lastTrip || $("results").hidden || comparedKey == null || placesKey() === comparedKey) return;
    clearTimeout(recompareTimer);
    recompareTimer = setTimeout(function () {
      if (!$("go").disabled && placesKey() !== comparedKey) {
        // Keep the results on screen (dimmed) and the page where it is while the new routes come in.
        rerouteMsg = L("Your trip changed. Finding new routes…");
        setStatus(rerouteMsg, false, true);
        $("go").click();
      }
    }, 1200);
  }
  function updateButton() {
    updateSteps();
    // Refill the My places / My vehicles menus: "Save this place…" and "Save this vehicle…"
    // show only once there's something to save.
    if (typeof fillVehicles === "function" && $("vehicles").options.length) fillVehicles();
    fillPlaces();
    $("pay-hint").hidden = !!paymentChoice();
    $("go").disabled = !(key && stops.from && stops.to && tollPoints.length && paymentChoice());
    maybeRecompare();
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="payment"]'), function (r) { r.addEventListener("change", updateButton); });
  // busy: a spinner beside the message, while the app waits on Esri.
  function spinner() { return '<span class="spinner" aria-hidden="true"></span>'; }
  function setStatus(msg, isError, busy) {
    if (swapEnds) return; // the trip back is routed quietly
    $("status").innerHTML = msg ? (busy ? spinner() : "") + esc(msg) : "";
    $("status").className = "status" + (isError ? " error" : "") + (busy ? " busy" : "");
  }

  function drawStops() {
    markersLayer.removeAll();
    fieldKeys().forEach(function (w) {
      if (!stops[w]) return;
      // Start: green dot with a white S. End: red dot with a white E. Stops: blue, numbered.
      // Fills are dark enough for white letters; the rings are darker still.
      var c = w === "from" ? { fill: [30, 142, 62], ring: [18, 94, 40], letter: "S" } : w === "to" ? { fill: [210, 47, 47], ring: [140, 18, 24], letter: "E" }
        : { fill: [25, 103, 210], ring: [13, 60, 140], letter: String(midKeys.indexOf(w) + 1) };
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
    // Every point goes to Esri as longitude/latitude. A spot picked on the map (or found by the
    // address search) is in the map's own Web Mercator coordinates; Esri reads all stops in the
    // first one's coordinate system, so a mix left the odd one "not located" and skipped.
    function ll(g) { return g ? new Point({ longitude: g.longitude, latitude: g.latitude }) : g; }
    var ends0 = swapEnds || stops, ends = { from: ll(ends0.from), to: ll(ends0.to) };
    var isFree = /PROHIBITED/.test(mode.__note || "");
    var mids = (swapEnds ? swapEnds.mids : midPoints()).filter(function (m) { return !(isFree && stopTollRoad(m)); }).map(ll);
    var middle = (via || []).map(function (v) {
      // A third number is the direction of travel there (degrees from north): Esri then places
      // the point on the lanes going that way, within 30 degrees.
      var at = { LocationType: 1, CurbApproach: 0 };
      if (v[2] != null) { at.Bearing = v[2]; at.BearingTol = 30; }
      return { lonlat: [v[0], v[1]], g: new Graphic({ geometry: new Point({ longitude: v[0], latitude: v[1] }), attributes: at }) };
    });
    if (mids.length) {
      // Your stops, plus any route-shaping points, in the order they come along the trip.
      middle = middle.concat(mids.map(function (m, k) {
        return { lonlat: [m.longitude, m.latitude], g: new Graphic({ geometry: m, attributes: { Name: "Stop " + (k + 1), LocationType: 0 } }), stop: true };
      }));
      var line = orderPath || [[ends.from.longitude, ends.from.latitude]].concat(mids.map(function (m) { return [m.longitude, m.latitude]; }), [[ends.to.longitude, ends.to.latitude]]);
      middle.forEach(function (x, i) { var a = window.TollCalc.alongPath(line, x.lonlat); x.along = a ? a.along : 0; x.i = i; });
      middle.sort(function (a, b) { return a.along - b.along || a.i - b.i; });
    }
    var stopGraphics = [new Graphic({ geometry: ends.from })].concat(middle.map(function (x) { return x.g; }), [new Graphic({ geometry: ends.to })]);
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
    if (mids.length) opts.returnStops = true; // to check Esri placed every stop (it skips ones it can't)
    if (probe) { opts.returnTraversedEdges = true; opts.accumulateAttributes = ["TravelTime", "Minutes", "Miles"]; }
    // Timing for the debug view: each route lookup, what kind it was and how long it took.
    var t0 = performance.now(), entry = { what: (mode.__note || mode.name) + (via && via.length ? " · via " + via.length : "") +
      (barriers && barriers.length ? " · " + barriers.length + " blocked" : "") + (more.noTraffic ? " · no traffic" : "") + (swapEnds ? " · trip back" : ""), start: t0 - lookupLog.t0 };
    lookupLog.list.push(entry);
    function done(ok) { entry.ms = performance.now() - t0; entry.ok = ok; }
    return route.solve(ROUTE_URL, new RouteParameters(opts)).then(function (res) { done(true); return res; }, function (e) { done(false); throw e; }).then(function (res) {
      var rr = res.routeResults[0];
      var g = rr.route;
      // Stops Esri couldn't place on a drivable road are left out of the route without an error.
      var rs = rr.stops || (res.stops && res.stops.features) || null;
      if (rs && rs.length) g.stopStatus = rs.map(function (st) {
        var a = st.attributes || {};
        return { name: st.name || a.Name || "", status: st.status != null ? st.status : a.Status, seq: st.sequence || a.Sequence };
      });
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
  // Toll route through a chosen plaza (Choose a toll road).
  function solveFirstVia(modes, via) {
    var i = 0;
    function next(err) {
      if (i >= modes.length) return Promise.reject(err);
      return solve(modes[i++], true, DEBUG, via).then(function (g) { g.anchors = via; g.chosenVia = true; return g; }, next);
    }
    return next();
  }
  // Same as stayOnTollway's last step: block side streets if Esri hops off and back on, still through the chosen plaza.
  function stayOnChosen(tollRoute, via) {
    var hops = window.TollCalc.findTollwayHops(tollRoute.steps);
    if (!hops.length || !tollRoute.mode) return Promise.resolve(tollRoute);
    var roads = [];
    hops.forEach(function (h) { if (roads.indexOf(h.road) === -1) roads.push(h.road); });
    return blockSideStreets(tollRoute, [], roads, 0, via);
  }
  // Variants that the routing service turned down (a restriction name it doesn't have) are
  // remembered for this visit, so later lookups don't spend a round trip on them again.
  var badVariant = {};
  function solveFirst(modes, withDirections) {
    var list = modes.filter(function (m) { return !badVariant[m.__note]; });
    if (!list.length) list = modes;
    var i = 0;
    function next(err) {
      if (i >= list.length) return Promise.reject(err);
      var m = list[i++];
      return solve(m, withDirections, DEBUG && withDirections).catch(function (e) {
        // Only a "no such restriction / bad parameter" answer counts, not a network hiccup.
        var msg = String(e && (e.message || (e.details && JSON.stringify(e.details))) || "");
        if (i < list.length && /restriction|attribute|parameter|invalid/i.test(msg)) badVariant[m.__note] = true;
        return next(e);
      });
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
    return h ? L("{h} hr {m} min", { h: h, m: m }) : L("{m} min", { m: m });
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
  // Debug view: TomTom traffic loads only when asked (each load uses about 50-120 of the
  // 20,000 free speed lookups a month), not on every compare.
  function offerTomTom(tollRoute, freeRoute) {
    if (!TOMTOM) return;
    ttRun++;
    var st = $("tt-status");
    st.hidden = false;
    st.innerHTML = '<button type="button" class="btn-outline small" id="tt-load">Load TomTom traffic</button> ' +
      '<span>Uses about 50\u2013120 of the 20,000 free speed lookups a month.</span>' +
      '<br><button type="button" class="btn-outline small" id="tt-times">TomTom second opinion: travel times</button> ' +
      '<span>TomTom times the same two routes. 2 routing requests.</span><span id="tt-times-out"></span>';
    $("tt-load").addEventListener("click", function () { loadTomTom(tollRoute, freeRoute); });
    $("tt-times").addEventListener("click", function () { tomTomTimes(tollRoute, freeRoute); });
  }
  // Debug view, only when asked: TomTom's travel time for exactly the routes Esri gave (the
  // route line goes to TomTom as supporting points, so TomTom follows it rather than picking
  // its own), with its live traffic, at the same departure time. A second opinion on Esri's
  // times, e.g. whether going through downtown really is faster than the tollway.
  function ttRouteTime(path) {
    var step = Math.max(1, Math.ceil(path.length / 120)), pts = [];
    for (var i = 0; i < path.length; i += step) pts.push(path[i]);
    if (pts[pts.length - 1] !== path[path.length - 1]) pts.push(path[path.length - 1]);
    var a = path[0], b = path[path.length - 1];
    var soon = departure.getTime() - Date.now() < 60000;
    var url = "https://api.tomtom.com/routing/1/calculateRoute/" + a[1] + "," + a[0] + ":" + b[1] + "," + b[0] + "/json?key=" + encodeURIComponent(TT_KEY) +
      "&traffic=true&routeType=fastest&computeTravelTimeFor=all&routeRepresentation=summaryOnly&departAt=" + (soon ? "now" : encodeURIComponent(departure.toISOString().replace(/\.\d+Z$/, "Z")));
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supportingPoints: pts.map(function (p) { return { latitude: p[1], longitude: p[0] }; }) }) })
      .then(function (r) { if (!r.ok) throw new Error("TomTom routing " + r.status); return r.json(); })
      .then(function (j) { return j.routes[0].summary; });
  }
  function tomTomTimes(tollRoute, freeRoute) {
    if (!TOMTOM) return;
    var out = $("tt-times-out"), btn = $("tt-times");
    btn.disabled = true;
    out.innerHTML = " " + spinner() + " Asking TomTom\u2026";
    var tp = [].concat.apply([], tollRoute.geometry.paths), fp = [].concat.apply([], freeRoute.geometry.paths);
    Promise.all([ttRouteTime(tp), ttRouteTime(fp)]).then(function (r) {
      var e = [routeStats(tollRoute), routeStats(freeRoute)];
      function m(sec) { return sec == null ? "?" : fmtTime(Math.round(sec / 60)); }
      function row(name, sum, es) {
        return "<tr><td>" + name + "</td><td class='n'><b>" + m(sum.travelTimeInSeconds) + "</b></td><td class='n'>" + m(sum.historicTrafficTravelTimeInSeconds) +
          "</td><td class='n'>" + m(sum.noTrafficTravelTimeInSeconds) + "</td><td class='n'>" + fmtTime(Math.round(es.minutes)) +
          "</td><td class='n'>" + (sum.lengthInMeters / 1609.34).toFixed(1) + " / " + (es.miles || 0).toFixed(1) + " mi</td></tr>";
      }
      var saveTT = Math.round((r[1].travelTimeInSeconds - r[0].travelTimeInSeconds) / 60), saveEsri = Math.round(e[1].minutes - e[0].minutes);
      var verdict = function (n) { return n > 0 ? "toll route saves " + fmtTime(n) : n < 0 ? "toll-free is " + fmtTime(-n) + " faster" : "about the same"; };
      out.innerHTML = "<table class='dbg'><tr><th></th><th>TomTom now</th><th>TomTom typical</th><th>No traffic</th><th>Esri</th><th>Length TomTom / Esri</th></tr>" +
        row("Toll route", r[0], e[0]) + row("Toll-free", r[1], e[1]) + "</table>" +
        "<p>TomTom: " + verdict(saveTT) + ". Esri: " + verdict(saveEsri) + ". Lengths should match; if not, TomTom didn't follow the same roads.</p>";
      btn.disabled = false;
    }).catch(function (err) {
      out.textContent = " TomTom routing failed: " + err.message;
      btn.disabled = false;
    });
  }
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
  // Every toll point in the data (Houston, Austin, DFW), small, under the routes: shown with the
  // "Toll roads" switch. Labels (name and 2-axle EZ TAG rate) appear once zoomed in.
  var allPointsLayer = null;
  function drawAllPoints() {
    if (!key || allPointsLayer || !tollPoints.length) return;
    var src = tollPoints.map(function (p, i) {
      var rate = p.status === "timed" ? null : p.ez2;
      return new Graphic({ geometry: { type: "point", longitude: p.lon, latitude: p.lat },
        attributes: { oid: i + 1, kind: p.kind || "main", label: shortName(p.name) + (rate != null ? " " + fmtMoney(rate) : "") } });
    });
    var dot = function (size, color) { return { type: "simple-marker", size: size, color: color, outline: { color: [255, 255, 255], width: 1 } }; };
    allPointsLayer = new FeatureLayer({
      source: src, objectIdField: "oid", geometryType: "point", spatialReference: { wkid: 4326 },
      fields: [{ name: "oid", type: "oid" }, { name: "kind", type: "string" }, { name: "label", type: "string" }],
      title: "Toll points",
      // Neutral dark gray, not HCTRA purple: most of these belong to other agencies.
      renderer: { type: "unique-value", field: "kind", defaultSymbol: dot(6, [107, 107, 110, 0.85]),
        uniqueValueInfos: [{ value: "main", symbol: dot(7, [95, 95, 99, 0.9]) }, { value: "on", symbol: dot(5, [135, 135, 139, 0.85]) }, { value: "off", symbol: dot(5, [135, 135, 139, 0.85]) }] },
      labelingInfo: [{ labelExpressionInfo: { expression: "$feature.label" }, labelPlacement: "center-right", minScale: 40000,
        symbol: { type: "text", color: [99, 99, 102], haloColor: [255, 255, 255], haloSize: 1, font: { size: 9 } } }],
      popupEnabled: false, visible: showTollMapNow(),
    });
    map.add(allPointsLayer, map.layers.indexOf(tollRoadsLayer) + 1); // over the road lines, under the routes
  }
  function showTollMapNow() { try { return localStorage.getItem("htc-tollmap") !== "off"; } catch (e) { return true; } }
  // Fallback when the toll point layer doesn't draw: the same dots and labels as plain map
  // graphics (no hiding of overlapping labels), like the highlight ring, which always draws.
  var tollFallback = new GraphicsLayer();
  map.add(tollFallback, map.layers.indexOf(routesLayer) + 1);
  var tollLayerStatus = "";
  function drawCrossingGraphics(items) {
    tollFallback.removeAll();
    items.forEach(function (it) {
      var p = it.point, pt = new Point({ longitude: p.lon, latitude: p.lat }), color = it.rate == null ? COLORS.missing : COLORS.toll;
      tollFallback.add(new Graphic({ geometry: pt, symbol: { type: "simple-marker", size: 9, color: color, outline: { color: [255, 255, 255], width: 1.5 } } }));
      tollFallback.add(new Graphic({ geometry: pt, symbol: { type: "text", text: shortName(p.name) + " " + (it.rate == null ? "n/a" : fmtMoney(it.rate)),
        color: [47, 26, 80], haloColor: [255, 255, 255], haloSize: 1.5, xoffset: 8, yoffset: -4, horizontalAlignment: "left",
        font: { size: 11, weight: "bold" } } }));
    });
  }
  function noteLayerStatus(msg) {
    tollLayerStatus = msg;
    var el = document.getElementById("dbg-layer");
    if (el) el.textContent = "Toll point layer: " + msg;
  }
  function drawCrossings(items) {
    if (tollLayer) { map.remove(tollLayer); tollLayer = null; }
    tollFallback.removeAll();
    noteLayerStatus(items.length ? "drawing…" : "no toll points");
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
    // If the layer fails or hasn't drawn in 8 seconds, draw the dots as plain graphics instead.
    var layer = tollLayer, settledFlag = false;
    function fallback(why) {
      if (settledFlag || layer !== tollLayer) return;
      settledFlag = true;
      noteLayerStatus(why + "; showing plain dots instead");
      console.warn("toll point layer:", why);
      try { layer.visible = false; } catch (e) { /* ok */ }
      drawCrossingGraphics(items);
    }
    if (!layer.when || !view.whenLayerView) return;
    layer.when(function () {
      return view.whenLayerView(layer);
    }).then(function (lv) {
      if (settledFlag || layer !== tollLayer) return;
      var t0 = Date.now();
      (function check() { // drawn when the layer view has finished updating with features in it
        if (layer !== tollLayer || settledFlag) return;
        if (!lv.updating) {
          settledFlag = true;
          noteLayerStatus("ok, " + items.length + " points in layer " + map.layers.indexOf(layer) + " of " + map.layers.length);
        } else if (Date.now() - t0 > 8000) fallback("still drawing after 8 s");
        else setTimeout(check, 200);
      })();
    }).catch(function (e) { fallback("failed (" + (e && (e.message || e.name) || e) + ")"); });
    setTimeout(function () { fallback("no answer after 10 s"); }, 10000);
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
    var lk = lookupLog.list, secs = function (ms) { return (ms / 1000).toFixed(1) + " s"; };
    var timing = "<p><strong>Timing:</strong> " + lk.length + " route lookups, " + secs(lookupLog.totalMs || 0) + " from Compare to results; page open to Compare " +
      secs(lookupLog.pageMs || 0) + ".</p><table class='dbg'><tr><th>Start</th><th>Took</th><th>Lookup</th></tr>" + lk.map(function (e) {
        return "<tr><td>" + secs(e.start) + "</td><td>" + (e.ms == null ? "…" : secs(e.ms)) + (e.ok === false ? " (failed)" : "") + "</td><td>" + esc(e.what) + "</td></tr>";
      }).join("") + "</table>";
    box.innerHTML = "<h3>Debug</h3><p><button type='button' id='save-trip' class='go small'>Save trip for testing</button></p>" + timing + base + "<p>Toll route: " + esc(tollRoute.modeNote || "") + "<br>Toll-free route: " + esc((window.__freeNote || "")) + "</p><p>Traffic probe: " + esc(trafficProbeNote(tollRoute.trafficProbe)) + "</p><p>Ramp zones: " + (rampZones ? rampZones.length : "none (no directions geometry)") + "</p>" +
      "<p id='dbg-layer'>Toll point layer: " + esc(tollLayerStatus) + "</p>" +
      (tollRoute.stopStatus ? "<p>Stops (Esri status): " + esc(tollRoute.stopStatus.map(function (st) { return (st.name || "?") + " = " + st.status; }).join("; ")) + "</p>" : "") +
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
    // Desktop: the map is always beside the panel, so only the panel scrolls. scrollIntoView
    // would also try to scroll the page itself, which snaps back and makes the app shake.
    var desk = window.innerWidth > 760;
    if (mode === "chart") {
      $("breakdown-wrap").open = true;
      if (row) {
        if (desk) {
          var panel = document.querySelector(".panel"), pr = panel.getBoundingClientRect(), rr = row.getBoundingClientRect();
          panel.scrollTo({ top: panel.scrollTop + rr.top - pr.top - (panel.clientHeight - rr.height) / 2, behavior: "smooth" });
        } else row.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    if (!desk) $("map").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  // Desktop: drag the edge between the panel and the map to make the panel wider (up to
  // leaving 360 px of map), or use the arrow keys on it; double-click puts it back. The
  // width is kept in this browser. Phones stack the panel and map, so there's no edge.
  (function () {
    var bar = $("panel-resizer"), panel = document.querySelector(".panel"), DEF = 390, MIN = 320;
    if (!bar || !panel) return;
    function maxW() { return Math.max(MIN, Math.min(1000, window.innerWidth - 360)); }
    function setW(w, save) {
      w = Math.round(Math.max(MIN, Math.min(maxW(), w)));
      panel.style.width = w === DEF ? "" : w + "px";
      bar.setAttribute("aria-valuenow", String(w));
      if (save) { try { if (w === DEF) localStorage.removeItem("htc-panelw"); else localStorage.setItem("htc-panelw", String(w)); } catch (e) { /* not kept */ } }
    }
    bar.setAttribute("aria-valuemin", String(MIN));
    try { var kept = parseInt(localStorage.getItem("htc-panelw"), 10); if (kept > 0 && window.innerWidth > 760) setW(kept, false); } catch (e) { /* default */ }
    bar.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      bar.classList.add("dragging"); document.body.classList.add("resizing");
      var left = panel.getBoundingClientRect().left;
      function move(ev) { setW(ev.clientX - left, false); }
      function up(ev) {
        bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); bar.removeEventListener("pointercancel", up);
        bar.classList.remove("dragging"); document.body.classList.remove("resizing");
        setW(panel.getBoundingClientRect().width, true);
        redrawTripChart();
      }
      bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up); bar.addEventListener("pointercancel", up);
    });
    bar.addEventListener("dblclick", function () { setW(DEF, true); redrawTripChart(); });
    bar.addEventListener("keydown", function (e) {
      var w = panel.getBoundingClientRect().width;
      if (e.key === "ArrowRight") { e.preventDefault(); setW(w + 40, true); redrawTripChart(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setW(w - 40, true); redrawTripChart(); }
      else if (e.key === "Home") { e.preventDefault(); setW(DEF, true); redrawTripChart(); }
    });
    var rt = null;
    window.addEventListener("resize", function () {
      if (panel.style.width && window.innerWidth > 760) setW(panel.getBoundingClientRect().width, false);
      clearTimeout(rt); rt = setTimeout(redrawTripChart, 150);
    });
  })();

  // Toll point card: our own panel at the bottom of the map in place of Esri's popup.
  var AGENCY = { HCTRA: "Harris County Toll Road Authority", TxDOT: "TxDOT", FBCTRA: "Fort Bend County Toll Road Authority",
    MCTRA: "Montgomery County Toll Road Authority", BCTRA: "Brazoria County Toll Road Authority",
    SH130CC: "SH 130 Concession Company (SH 130 south of Mustang Ridge)", NTTA: "North Texas Tollway Authority" };
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
    if (p.assumedAxles && p.assumedAxles.indexOf(axles) !== -1)
      status += p.axleNote === "class" ? L(" This stretch of SH 130 charges by vehicle size, not axles. For 3+ axles the app assumes: 3 = car with a trailer, 4 = larger vehicle, 5 = larger vehicle with a trailer, 6+ = more than one trailer.")
        : L(" Fort Bend publishes rates up to 6 axles; 7+ axles are priced at the 6-axle rate.");
    if (p.next && p.next.from) status += L(" New rates start {date}; your trip is priced for its own date.", {
      date: new Date(p.next.from + "T12:00:00").toLocaleDateString(window.I18N.locale(), { month: "short", day: "numeric", year: "numeric" }) });
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
      '<p class="map-card-agency">' + esc(AGENCY[p.owner] || p.owner) + "</p>" +
      (function () { var src = window.TollCalc.rateSource(p); return src ? '<p class="map-card-rate"><a href="' + esc(src.url) + '" target="_blank" rel="noopener">' +
        L("Check this rate on {site}", { site: esc(src.site) }) + "</a></p>" : ""; })() +
      (REPORT_TO ? '<p class="map-card-report"><a href="' + esc(reportMailto(i)) + '">' + L("Report this toll") + "</a></p>" : "");
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

  // Add stops from the map: a button on the map turns on "each tap adds the next stop" (up to 6),
  // so stops can be dropped one after another without going back to the form. Done compares once.
  var addingStops = false, addStopsBtn = null;
  function addStopsLabel() {
    if (!addStopsBtn) return;
    var n = midKeys.filter(function (k) { return stops[k]; }).length;
    addStopsBtn.innerHTML = addingStops ? "\u2713 " + esc(L("Done adding stops")) + " (" + n + "/" + MAX_MID + ")" : "+ " + esc(L("Add stops on map"));
    addStopsBtn.setAttribute("aria-pressed", addingStops ? "true" : "false");
  }
  function stopsFull() { return midKeys.length >= MAX_MID && !midKeys.some(function (k) { return !stops[k]; }); }
  function setAddingStops(on) {
    addingStops = !!on;
    if (addingStops && picking) setPicking(null);
    if (addingStops && stopsFull()) {
      addingStops = false;
      setStatus(L("This trip already has {n} stops, the most allowed.", { n: MAX_MID }));
    } else if (addingStops) {
      setStatus(L("Tap the map to add stops, in the order you'll visit them (up to {n}). Tap Done when finished.", { n: MAX_MID }));
    } else {
      setStatus("");
      maybeRecompare();
    }
    addStopsLabel();
  }
  function addStopAt(pt) {
    // Fill an empty stop box first, else add a new one.
    var w = midKeys.filter(function (k) { return !stops[k]; })[0] || addStop();
    if (!w) { setAddingStops(false); return; }
    placeStop(w, pt);
    addStopsLabel();
    var n = midKeys.indexOf(w) + 1;
    if (stopsFull() && addingStops) {
      setAddingStops(false);
      setStatus(L("Added stop {n}, the most allowed.", { n: n }));
    } else if (addingStops) setStatus(L("Added stop {n}. Tap the map for the next stop, or tap Done.", { n: n }));
  }
  // Which way the map offers adding stops: "hold" (press and hold the map), "bubble" (tap the map,
  // then "Add stop here") or "button" (the "Add stops on map" mode button). Jason picked "hold".
  var STOP_UI = "hold";
  // The bubble: once start and end are set, a tap on an empty spot offers "Add stop here" there.
  var stopBubble = null, bubbleTimer = null;
  function hideStopBubble() { if (stopBubble) stopBubble.hidden = true; clearTimeout(bubbleTimer); }
  function showStopBubble(e) {
    if (!stopBubble) {
      stopBubble = document.createElement("div");
      stopBubble.className = "stop-bubble";
      view.ui.add(stopBubble, "manual");
      view.on("drag", hideStopBubble);
    }
    var full = stopsFull(), pt = e.mapPoint;
    stopBubble.innerHTML = full ? '<span class="sb-note">' + esc(L("This trip already has {n} stops, the most allowed.", { n: MAX_MID })) + "</span>"
      : '<button type="button" class="sb-add">+ ' + esc(L("Add stop here")) + "</button>";
    stopBubble.style.left = Math.round(e.x) + "px";
    stopBubble.style.top = Math.round(e.y) + "px";
    stopBubble.hidden = false;
    var add = stopBubble.querySelector(".sb-add");
    if (add) {
      add.onclick = function (ev) { ev.stopPropagation(); hideStopBubble(); addStopAt(pt); };
      try { add.focus({ preventScroll: true }); } catch (x) { /* ok */ }
    }
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideStopBubble, 6000);
  }
  // Press and hold: with start and end set, holding a finger (or the mouse) on the map drops the
  // next stop there; a short note at that spot says which stop it is.
  if (key && STOP_UI === "hold") {
    view.on("hold", function (e) {
      if (picking) return; // "Pick on map" is waiting for a tap
      if (!stops.from || !stops.to) { mapTap(e); return; } // start/end first, as with a tap
      if (stopsFull()) { flashNote(e, L("This trip already has {n} stops, the most allowed.", { n: MAX_MID })); return; }
      var before = midKeys.filter(function (k) { return stops[k]; }).length;
      addStopAt(e.mapPoint);
      track("stop-added/hold");
      flashNote(e, L("Stop {n} added", { n: before + 1 }));
    });
    $("hold-tip").hidden = false;
  }
  function flashNote(e, text) {
    if (!stopBubble) {
      stopBubble = document.createElement("div");
      stopBubble.className = "stop-bubble";
      view.ui.add(stopBubble, "manual");
      view.on("drag", hideStopBubble);
    }
    stopBubble.innerHTML = '<span class="sb-note">' + esc(text) + "</span>";
    stopBubble.style.left = Math.round(e.x) + "px";
    stopBubble.style.top = Math.round(e.y) + "px";
    stopBubble.hidden = false;
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideStopBubble, 1600);
  }
  if (key && STOP_UI === "button") {
    addStopsBtn = document.createElement("button");
    addStopsBtn.type = "button";
    addStopsBtn.className = "map-add-stops";
    addStopsBtn.addEventListener("click", function () { setAddingStops(!addingStops); });
    addStopsLabel();
    view.ui.add(addStopsBtn, "top-left");
  }

  // Basemap switcher (top right of the map). The choice is remembered on this device.
  var BASEMAPS = [["arcgis/light-gray", "Light"], ["arcgis/dark-gray", "Dark"], ["arcgis/navigation", "Streets"], ["arcgis/imagery", "Satellite"]];
  if (key) {
    var bm = document.createElement("div");
    bm.className = "basemap-switch";
    bm.setAttribute("role", "group");
    bm.setAttribute("aria-label", L("Base map"));
    bm.innerHTML = BASEMAPS.map(function (b) { return '<button type="button" data-id="' + b[0] + '">' + L(b[1]) + "</button>"; }).join("");
    view.ui.add(bm, "top-right");
    var setBasemap = function (id, keep) {
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
      if (!keep) try { localStorage.setItem("htc-basemap", id); } catch (e) { /* not kept */ }
    };
    bm.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setBasemap(b.getAttribute("data-id")); });
    // "Toll roads" switch: every toll road line and every toll point (all agencies), for
    // seeing where the tolls are before picking a route. Remembered on this device; on by default.
    var trSwitch = document.createElement("div");
    trSwitch.className = "basemap-switch tr-switch";
    trSwitch.innerHTML = '<button type="button" aria-pressed="true"></button>';
    view.ui.add(trSwitch, "top-right");
    var showTollMap = true;
    try { showTollMap = localStorage.getItem("htc-tollmap") !== "off"; } catch (e) { /* default on */ }
    var setTollMap = function (on) {
      showTollMap = on;
      tollRoadsLayer.visible = on;
      if (allPointsLayer) allPointsLayer.visible = on;
      trSwitch.firstChild.setAttribute("aria-pressed", on ? "true" : "false");
      trSwitch.firstChild.textContent = L("Toll roads");
      try { localStorage.setItem("htc-tollmap", on ? "on" : "off"); } catch (e) { /* not kept */ }
    };
    trSwitch.addEventListener("click", function () { setTollMap(!showTollMap); });
    setTollMap(showTollMap);
    window.I18N.onChange(function () { setTollMap(showTollMap); });
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
    // With no map picked, the map follows the page's theme (Light or Dark), and switching the
    // theme switches a Light or Dark map along with it.
    var themeMap = function (id) {
      var dark = window.Theme && window.Theme.theme === "dark";
      if (!id || id === "arcgis/light-gray" || id === "arcgis/dark-gray") return dark ? "arcgis/dark-gray" : "arcgis/light-gray";
      return id;
    };
    setBasemap(savedBasemap || themeMap(null), true); // a map someone picked stays picked

    if (window.Theme) window.Theme.onChange(function () { if (/gray$/.test(currentBasemap)) setBasemap(themeMap(currentBasemap), true); });
  }

  $("breakdown").addEventListener("click", function (e) {
    if (e.target.closest("a")) return; // a rate link: open it, don't pick the row
    var row = e.target.closest("tr.pickable");
    if (row) highlightItem(+row.getAttribute("data-i"), row);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") clearHighlight(); });
  $("breakdown").addEventListener("keydown", function (e) {
    var row = e.target.closest("tr.pickable");
    if (e.target.closest("a")) return;
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); highlightItem(+row.getAttribute("data-i"), row); }
  });

  // Trip chart: each route as a straight line from S to E, like a subway map, with a dot
  // and price at each toll point placed by distance along the route. Tap a dot to find it
  // on the map. Price labels take the first free row (above, below, higher up); when all are
  // taken the dot stays unlabeled and its price shows on tap.
  // The chart is drawn as wide as its box (at least 340), so a wider panel gives longer lines
  // instead of bigger text. It's redrawn when the panel or window changes width.
  var chartArgs = null;
  function redrawTripChart() { if (chartArgs && !$("results").hidden) drawTripChart.apply(null, chartArgs); }
  function drawTripChart(t, f, priced, routeMeters) {
    var box = $("trip-chart");
    chartArgs = [t, f, priced, routeMeters];
    if (t.minutes == null || f.minutes == null) { box.innerHTML = ""; box.hidden = true; return; }
    box.hidden = false;
    var W = Math.max(340, Math.round((box.clientWidth || 352) - 12)), X0 = 18, X1 = W - 18, yT = 62;
    // Two or more agencies: named in one line under the chart (and on each dot), so the chart
    // keeps its height and the toll-free line stays where it is.
    var ags = window.TollCalc.agencyTotals(priced.items), multi = ags.length > 1;
    var off = 0, yF = 128 + off, H0 = 146 + off;
    function ends(y) {
      return '<circle cx="' + X0 + '" cy="' + y + '" r="7" class="tc-s"/><text x="' + X0 + '" y="' + (y + 3) + '" class="tc-l">S</text>' +
        '<circle cx="' + X1 + '" cy="' + y + '" r="7" class="tc-e"/><text x="' + X1 + '" y="' + (y + 3) + '" class="tc-l">E</text>';
    }
    var tr = window.I18N.t;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H0 + '" role="img" aria-label="' + esc(tr("Trip chart: toll route {tt}, {price}; toll-free route {ft}", { tt: fmtTime(t.minutes), price: fmtMoney(priced.total), ft: fmtTime(f.minutes) })) + '">';
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
      dots += '<g class="tc-dot" tabindex="0" role="button" data-i="' + i + '" aria-label="' + esc(it.point.name + ", " + label + ", " + window.TollCalc.agencyInfo(it.point.owner).short) + '">' +
        "<title>" + esc(it.point.name + " \u00b7 " + label + " \u00b7 " + window.TollCalc.agencyInfo(it.point.owner).short) + "</title>" +
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
    var legendH = H0;
    if (any) {
      var lx = X0, ly = 162 + off;
      legendH = 170 + off;
      svg += '<text x="' + lx + '" y="' + ly + '" class="tc-k">' + tr("Highway traffic:") + "</text>";
      lx += 84;
      [["moderate", "Moderate"], ["slow", "Slow"], ["heavy", "Heavy"]].forEach(function (k) {
        svg += '<line x1="' + lx + '" y1="' + (ly - 3.5) + '" x2="' + (lx + 14) + '" y2="' + (ly - 3.5) + '" class="tc-traffic" style="stroke:' + TRAFFIC_HEX[k[0]] + '"/>' +
          '<text x="' + (lx + 19) + '" y="' + ly + '" class="tc-k">' + tr(k[1]) + "</text>";
        lx += tr(k[1]).length * 6 + 34;
      });
    }
    if (incs.length) {
      var iy = (any ? 180 : 162) + off;
      svg += crashMark(X0 + 6, iy - 4, 13) + '<text x="' + (X0 + 16) + '" y="' + iy + '" class="tc-k">Crash</text>' +
        diamondMark(X0 + 62, iy - 4, "#d93025", 4) + '<text x="' + (X0 + 71) + '" y="' + iy + '" class="tc-k">Road closure</text>' +
        diamondMark(X0 + 152, iy - 4, "#f57c00", 4) + '<text x="' + (X0 + 161) + '" y="' + iy + '" class="tc-k">Other \u00b7 tap any for details</text>';
      legendH = iy + 8;
    }
    svg = svg.replace('viewBox="0 0 ' + W + ' ' + H0 + '"', 'viewBox="0 0 ' + W + " " + legendH + '"');
    // Slide along a line: a target follows on the map (pointer-events off so dots still tap).
    svg += '<g class="tc-cursor" visibility="hidden"><line class="tc-cur-line" x1="0" x2="0"/><circle class="tc-cur-dot" r="6"/>' +
      '<text class="tc-cur-label" y="0"></text></g>';
    svg += "</svg>";
    box._geo = { W: W, X0: X0, X1: X1, yT: yT, yF: yF };
    if (multi) svg += '<p class="tc-note tc-agencies">' + esc(tr("Tolls by agency:")) + " " +
      ags.map(function (g) { return "<b>" + esc(g.short) + "</b> " + fmtMoney(g.total) + (g.missing ? "+" : ""); }).join(" \u00b7 ") + "</p>";
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
      if (window.innerWidth <= 760) $("map").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    var g = e.target.closest && e.target.closest(".tc-dot");
    if (!g) return;
    var i = +g.getAttribute("data-i");
    var row = document.querySelector('#breakdown tr[data-i="' + i + '"]');
    highlightItem(i, row, "chart");
  }
  // Trip chart scrubbing: sliding along the toll or toll-free line moves a target to the same
  // spot (by distance along the route) on that route on the map.
  var cursorLayer = new GraphicsLayer({ listMode: "hide" });
  map.add(cursorLayer);
  var scrub = { route: null, hideTimer: null };
  function routeLine(which) {
    var r = lastTrip && (which === "toll" ? lastTrip.tollRoute : lastTrip.freeRoute);
    if (!r) return null;
    if (!r._line) { var path = [].concat.apply([], r.geometry.paths); r._line = { path: path, meters: window.TollCalc.pathMeters(path) }; }
    return r._line;
  }
  function scrubAt(e) {
    var box = $("trip-chart"), svg = box.querySelector("svg"), g = box._geo;
    if (!svg || !g || !lastTrip) return false;
    var rc = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    var x = (e.clientX - rc.left) * vb.width / rc.width, y = (e.clientY - rc.top) * vb.height / rc.height;
    var which = Math.abs(y - g.yT) <= Math.abs(y - g.yF) ? "toll" : "free", ly = which === "toll" ? g.yT : g.yF;
    if (Math.abs(y - ly) > 30 || x < g.X0 - 10 || x > g.X1 + 10) return false;
    // Same placement as the toll dots: the line's ends hold S and E, so 14 px in from each end.
    var a = g.X0 + 14, b = g.X1 - 14, frac = Math.min(1, Math.max(0, (x - a) / (b - a)));
    var cx = a + (b - a) * frac, line = routeLine(which);
    if (!line || !(line.meters > 0)) return false;
    var pt = window.TollCalc.pointAt(line.path, frac * line.meters);
    if (!pt) return false;
    var cur = svg.querySelector(".tc-cursor");
    cur.setAttribute("visibility", "visible");
    cur.setAttribute("class", "tc-cursor " + which);
    var ln = cur.querySelector(".tc-cur-line"), dot = cur.querySelector(".tc-cur-dot"), lab = cur.querySelector(".tc-cur-label");
    ln.setAttribute("x1", cx.toFixed(1)); ln.setAttribute("x2", cx.toFixed(1)); ln.setAttribute("y1", ly - 16); ln.setAttribute("y2", ly + 16);
    dot.setAttribute("cx", cx.toFixed(1)); dot.setAttribute("cy", ly);
    var miles = frac * line.meters / 1609.344;
    lab.textContent = L("{miles} mi", { miles: miles < 10 ? miles.toFixed(1) : Math.round(miles) });
    lab.setAttribute("x", Math.min(g.W - 22, Math.max(22, cx)).toFixed(1)); lab.setAttribute("y", ly - 20);
    var color = which === "toll" ? [26, 115, 232] : [80, 77, 87];
    var at = new Point({ longitude: pt[0], latitude: pt[1] });
    cursorLayer.removeAll();
    cursorLayer.addMany([
      new Graphic({ geometry: at, symbol: { type: "simple-marker", size: 26, color: [255, 255, 255, 0.35], outline: { color: color.concat(1), width: 2.5 } } }),
      new Graphic({ geometry: at, symbol: { type: "simple-marker", style: "cross", size: 34, outline: { color: color.concat(0.9), width: 1.5 } } }),
      new Graphic({ geometry: at, symbol: { type: "simple-marker", size: 8, color: color.concat(1), outline: { color: [255, 255, 255, 1], width: 1.5 } } })
    ]);
    return true;
  }
  function scrubHide(delay) {
    clearTimeout(scrub.hideTimer);
    scrub.hideTimer = setTimeout(function () {
      cursorLayer.removeAll();
      var c = document.querySelector("#trip-chart .tc-cursor");
      if (c) c.setAttribute("visibility", "hidden");
    }, delay || 0);
  }
  $("trip-chart").addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch" && !scrub.touch) return;
    clearTimeout(scrub.hideTimer);
    if (!scrubAt(e)) scrubHide(0);
  });
  $("trip-chart").addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    scrub.touch = true; clearTimeout(scrub.hideTimer); scrubAt(e);
  });
  ["pointerup", "pointercancel"].forEach(function (t) {
    $("trip-chart").addEventListener(t, function (e) { if (e.pointerType === "touch") { scrub.touch = false; scrubHide(2500); } });
  });
  $("trip-chart").addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") scrubHide(0); });
  $("trip-chart").addEventListener("click", chartPick);
  $("trip-chart").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); chartPick(e); } });

  // ---- Trip extras: fuel estimate, commute cost, best time to leave, share ----
  // Fuel: miles per gallon and price per gallon start from defaults for the vehicle class and
  // can be changed (kept in this browser).
  // The fuel settings in use: the active saved vehicle's (if it matches the trip's size),
  // otherwise what was set for this vehicle size, otherwise the defaults.
  function fuelVehicle(axles) { var v = vehicles[activeVehicle]; return v && v.axles === axles ? v : null; }
  function fuelSettings() {
    var axles = lastTrip ? lastTrip.trip.axles : parseInt($("axles").value, 10);
    var d = window.TollCalc.fuelDefaults(axles), v = fuelVehicle(axles), o = v || fuelStore()[axles] || {};
    var fuel = o.fuel === "diesel" || o.fuel === "regular" ? o.fuel : d.fuel;
    return { axles: axles, mpg: o.mpg > 0 ? +o.mpg : d.mpg, price: o.price > 0 ? +o.price : window.TollCalc.FUEL_PRICES[fuel], fuel: fuel,
      custom: !!(o.mpg || o.price || fuel !== d.fuel), vehicle: v };
  }
  // Changes are kept with the active saved vehicle, or else per vehicle size (axles), so a
  // truck's mpg doesn't change a car's.
  function fuelStore() { try { return JSON.parse(localStorage.getItem("htc-fuel") || "{}") || {}; } catch (e) { return {}; } }
  function saveFuel(o) {
    var fs = fuelSettings(), axles = fs.axles;
    if (fs.vehicle) {
      fs.vehicle.fuel = o && o.fuel || null; fs.vehicle.mpg = o && o.mpg || null; fs.vehicle.price = o && o.price || null;
      saveList("vehicles", vehicles);
      if ($("vehicles-dialog").open) renderVehicleDialog();
      return;
    }
    var all = fuelStore();
    if (o) all[axles] = o; else delete all[axles];
    try { localStorage.setItem("htc-fuel", JSON.stringify(all)); } catch (e) { /* not kept */ }
  }
  var extrasState = null;
  // Gas for each route (counting each stretch's speed: stop-and-go burns more per mile than
  // steady driving) and the toll route's extra over the toll-free one.
  function gasFor(tollRoute, freeRoute) {
    var fs = fuelSettings(), T = window.TollCalc;
    var gal = function (route) { var st = routeStats(route), g = T.fuelGallons(route && route.steps, st.miles, st.minutes, fs.mpg); return g == null ? null : Math.round(g * fs.price * 100) / 100; };
    var tf = gal(tollRoute), ff = gal(freeRoute);
    return { toll: tf, free: ff, extra: tf != null && ff != null ? Math.round((tf - ff) * 100) / 100 : null };
  }
  function minutesSaved(t, f, priced) {
    var saved = t.minutes != null && f.minutes != null ? Math.max(0, f.minutes - t.minutes) : null;
    if (priced.laneOptions && priced.laneOptions === priced.items.length) saved = null; // managed lanes: time saved isn't estimated
    return saved;
  }
  function renderExtras(t, f, priced) {
    var fs = fuelSettings();
    var gas = gasFor(lastTrip && lastTrip.tollRoute, lastTrip && lastTrip.freeRoute);
    var tf = gas.toll, ff = gas.free, extra = gas.extra;
    // Gas for the whole trip on each route, then the difference in plain words, with the likely
    // reason (a shorter or longer route, or less stop-and-go traffic).
    var line = "";
    if (extra != null) {
      var dm = t.miles != null && f.miles != null ? t.miles - f.miles : 0, why = "";
      if (extra > 0 && dm >= 1) why = L("it's {n} mi longer", { n: Math.round(dm) });
      else if (extra < 0 && dm <= -1) why = Math.abs(extra) > 1.5 * (-dm / fs.mpg * fs.price) // mostly traffic, not distance
        ? L("it's {n} mi shorter, with less stop-and-go", { n: Math.round(-dm) }) : L("it's {n} mi shorter", { n: Math.round(-dm) });
      else if (extra < 0) why = L("less stop-and-go");
      var diff = Math.abs(extra) < 0.05 ? L("About the same gas on both routes.")
        : L(extra > 0 ? "The toll route uses about {cost} more gas" : "The toll route uses about {cost} less gas", { cost: "<b>" + fmtMoney(Math.abs(extra)) + "</b>" }) + (why ? " (" + esc(why) + ")." : ".");
      line = '<span class="fuel-h">' + L("Gas for this trip") + "</span>" +
        '<span class="fuel-both">' + L("Toll route") + " <b>" + fmtMoney(tf) + "</b> \u00b7 " + L("Toll-free route") + " <b>" + fmtMoney(ff) + "</b></span>" +
        '<span class="fuel-diff">' + diff + "</span>" +
        // On paper the inputs aren't shown, so say what the gas figures are based on.
        '<span class="fuel-basis print-only">' + esc(L("Based on {mpg} mpg and {price} a gallon ({fuel}).", { mpg: fs.mpg, price: fmtMoney(fs.price), fuel: L(fs.fuel) })) + "</span>";
    }
    $("fuel-line").innerHTML = line;
    $("fuel-price-label").textContent = L(fs.fuel === "diesel" ? "Diesel price per gallon" : "Gas price per gallon");
    var def = window.TollCalc.fuelDefaults(fs.axles);
    $("fuel-hint").textContent = fs.vehicle
      ? L("Saved with “{name}”: changes here update it.", { name: fs.vehicle.name })
      : L("Change these to match your vehicle. Defaults for {n} axles: {mpg} mpg, {price}/gal {fuel}.", { n: fs.axles, mpg: def.mpg, price: fmtMoney(def.price), fuel: L(def.fuel) }) + fuelSourceNote();
    $("fuel-type").value = fs.fuel;
    $("fuel-mpg").value = fs.mpg; $("fuel-price").value = fs.price.toFixed(2);
    extrasState = { toll: priced.total, minutesSaved: minutesSaved(t, f, priced), fuelExtra: extra };
    if (!backTimeSet) setBackTime();
    renderCommute();
  }
  function renderCommute() {
    if (!extrasState) return;
    var days = parseInt($("commute-days").value, 10), round = $("commute-round").checked;
    var back = round ? backState() : null;
    $("back-trip").hidden = !round;
    renderBack(back);
    var c = window.TollCalc.commute(extrasState, days, round, back);
    function row(label, v, fmt) { return v ? '<span>' + L(label) + '</span><span class="n">' + fmt(v.week) + '</span><span class="n">' + fmt(v.month) + "</span>" : ""; }
    var hrs = function (m) { return m >= 60 ? L("{h} hr", { h: (m / 60).toFixed(1) }) : L("{m} min", { m: Math.round(m) }); };
    var net = extrasState.fuelExtra != null ? { week: c.tolls.week + c.fuelExtra.week, month: c.tolls.month + c.fuelExtra.month } : null;
    $("commute-out").innerHTML =
      '<div class="commute-grid"><span class="h">' + L("{n} trips a week", { n: c.trips }) + '</span><span class="h n">' + L("Week") + '</span><span class="h n">' + L("Month") + "</span>" +
      row("Tolls", c.tolls, fmtMoney) +
      (extrasState.minutesSaved ? row("Time saved", c.minutesSaved, hrs) : "") +
      (c.fuelExtra ? row(c.fuelExtra.week >= 0 ? "Extra gas on the toll route" : "Gas saved on the toll route", { week: Math.abs(c.fuelExtra.week), month: Math.abs(c.fuelExtra.month) }, fmtMoney) : "") +
      (net ? '<span><strong>' + L(c.fuelExtra && c.fuelExtra.week < 0 ? "Tolls minus gas saved" : "Tolls plus extra gas") + '</strong></span><span class="n"><strong>' + fmtMoney(net.week) + '</strong></span><span class="n"><strong>' + fmtMoney(net.month) + "</strong></span>" : "") +
      "</div>" +
      '<p class="hint">' + L(c.withBack ? "Uses this trip there and the trip back priced for {time}, every day the same. A month is about 4.3 weeks."
        : round ? "Assumes the trip back costs the same and every trip matches this one (same time of day and traffic). A month is about 4.3 weeks."
        : "Assumes every trip matches this one (same time of day and traffic). A month is about 4.3 weeks.", { time: back ? fmtClock(back.at) : "" }) + "</p>";
  }

  // The trip back: the same trip from the end to the start, routed and priced for the time you
  // come back (its own traffic and time-of-day tolls). Used in the commute cost.
  var backTrip = null, backRun = 0, backTimeSet = false, backFailed = false;
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function setBackTime() {
    // A workday later, on the quarter hour: leave 7:40 AM, back about 4:45 PM.
    var d = new Date(new Date(lastTrip.trip.departure).getTime() + 9 * 3600000);
    d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
    $("back-time").value = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function backDeparture() {
    var v = ($("back-time").value || "").split(":"), out = new Date(lastTrip.trip.departure);
    if (v.length < 2) return null;
    var d = new Date(out); d.setHours(+v[0], +v[1], 0, 0);
    if (d <= out) d = new Date(d.getTime() + 86400000); // coming back the next day
    return d;
  }
  function backState() {
    if (!backTrip || !lastTrip) return null;
    // Priced with today's vehicle and payment, so a change to either applies both ways.
    var t = lastTrip.trip, trip = Object.assign({}, backTrip.trip, { axles: t.axles, payment: t.payment, carpool: t.carpool });
    var priced = window.TollCalc.analyzeTrip(trip, tollPoints).priced;
    var ts = routeStats(backTrip.tollRoute), fs = routeStats(backTrip.freeRoute);
    return { at: backTrip.at, toll: priced.total, plus: priced.pending.length || priced.missing.length, tollMin: ts.minutes, freeMin: fs.minutes,
      minutesSaved: minutesSaved(ts, fs, priced), fuelExtra: gasFor(backTrip.tollRoute, backTrip.freeRoute).extra, hop: backTrip.hop };
  }
  function renderBack(b) {
    var out = $("back-out");
    if (!b) {
      if (out.dataset.busy) return;
      out.innerHTML = backFailed ? esc(L("Couldn’t route the trip back. Try again in a moment.")) : "";
      return;
    }
    out.innerHTML = esc(L("Trip back at {time}: {toll} in tolls. Toll route {tt}, toll-free {ft}.", {
      time: fmtClock(b.at), toll: fmtMoney(b.toll) + (b.plus ? "+" : ""), tt: fmtTime(b.tollMin), ft: fmtTime(b.freeMin) })) +
      (b.hop ? " " + esc(L("Esri’s route leaves the tollway at this time, so this toll may be low.")) : "");
  }
  function clearBack() { if (swapEnds) orderPath = null; backRun++; backTrip = null; backFailed = false; swapEnds = null; $("back-out").innerHTML = ""; delete $("back-out").dataset.busy; $("back-go").disabled = false; }
  $("back-time").addEventListener("change", function () { backTimeSet = true; backFailed = false; if (backTrip) backTrip = null; renderCommute(); });
  $("back-go").addEventListener("click", function () {
    track("trip-back");
    if (!lastTrip || !stops.from || !stops.to) return;
    var at = backDeparture();
    if (!at) return;
    var run = ++backRun, t = lastTrip.trip, saveDeparture = departure, out = $("back-out");
    var bv = chosenVia() && window.TollCalc.viaPlazas(tollPoints, [stops.to.longitude, stops.to.latitude], [stops.from.longitude, stops.from.latitude])
      .filter(function (o) { return o.road === viaChoice.road; })[0];
    var bvia = bv ? [[bv.point.lon, bv.point.lat]] : null; // the chosen toll road, going the other way
    backTrip = null; backFailed = false;
    $("back-go").disabled = true; $("best-time").disabled = true;
    out.dataset.busy = "1";
    out.innerHTML = '<span class="busy-line">' + spinner() + esc(L("Routing the trip back…")) + "</span>";
    function live() { if (run !== backRun) throw new Error("stale"); }
    var backMids = midPoints().filter(function (m) { return !stopTollRoad(m); }).reverse(), saveOrder = orderPath, backOrder = null; // a stop on a toll road steers one way only
    function begin() { live(); swapEnds = { from: stops.to, to: stops.from, mids: backMids }; departure = at; orderPath = backOrder; } // set again before each step, in case another lookup ran between
    begin();
    loadTravelModes().then(function (modes) {
      begin();
      var mode = pickMode(modes, t.axles);
      return Promise.all([bvia ? solveFirstVia(tollVariants(mode, t.axles, "prefer"), bvia) : solveFirst(tollVariants(mode, t.axles, "prefer"), true),
        solveFirst(tollVariants(mode, t.axles, "prohibit"), true)]);
    }).then(function (routes) {
      if (backMids.length) backOrder = [].concat.apply([], routes[0].geometry.paths);
      begin();
      return Promise.all([bvia ? stayOnChosen(routes[0], bvia) : stayOnTollway(routes[0], t.axles), stayOnFeeder(routes[1])]);
    }).then(function (routes) {
      live();
      var tollRoute = routes[0], freeRoute = routes[1];
      backTrip = { at: at, tollRoute: tollRoute, freeRoute: freeRoute, hop: window.TollCalc.findTollwayHops(tollRoute.steps).length > 0,
        trip: { tollPath: [].concat.apply([], tollRoute.geometry.paths), freePath: [].concat.apply([], freeRoute.geometry.paths),
          steps: tollRoute.steps || null, departure: at.toISOString(), routeMinutes: routeStats(tollRoute).minutes,
          axles: t.axles, payment: t.payment, carpool: t.carpool } };
    }).catch(function (e) {
      if (run !== backRun) return;
      console.warn("trip back failed", e);
      backFailed = true;
    }).then(function () {
      if (run !== backRun) return;
      swapEnds = null; departure = saveDeparture; orderPath = saveOrder;
      delete out.dataset.busy;
      $("back-go").disabled = false; $("best-time").disabled = false;
      renderCommute();
    });
  });
  $("commute-days").addEventListener("change", function () { renderCommute(); renderTagSavings(); });
  $("commute-round").addEventListener("change", function () { renderCommute(); renderTagSavings(); });
  function fuelEdited(e) {
    var d = window.TollCalc.fuelDefaults(fuelSettings().axles), fuel = $("fuel-type").value;
    var mpg = parseFloat($("fuel-mpg").value), price = parseFloat($("fuel-price").value);
    if (e && e.target && e.target.id === "fuel-type") price = NaN; // new fuel: its usual price
    saveFuel({ fuel: fuel !== d.fuel ? fuel : null, mpg: mpg > 0 && mpg !== d.mpg ? mpg : null,
      price: price > 0 && Math.abs(price - window.TollCalc.FUEL_PRICES[fuel]) > 0.001 ? price : null });
    if (lastTrip) renderExtras(routeStats(lastTrip.tollRoute), routeStats(lastTrip.freeRoute), lastTrip.priced);
  }
  $("fuel-type").addEventListener("change", fuelEdited);
  $("fuel-mpg").addEventListener("change", fuelEdited);
  $("fuel-price").addEventListener("change", fuelEdited);
  $("fuel-reset").addEventListener("click", function () {
    saveFuel(null);
    if (lastTrip) renderExtras(routeStats(lastTrip.tollRoute), routeStats(lastTrip.freeRoute), lastTrip.priced);
  });

  // Best time to leave: the same trip at other departure times in a window you set (by
  // default 30 minutes before to an hour after the trip's time), every 15 minutes (30 or 60 for
  // longer windows), skipping times already past. Each time is routed with that time's traffic
  // and priced for it (time-of-day tolls). The toll route goes through the same tollway points
  // as the trip shown, so it doesn't hop off at rush hour. Tap a time to preview its toll route.
  var bestRun = 0, btRows = [], btEdited = false, btPreview = -1;
  function hhmm(d) { return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function roundQuarter(d) { var x = new Date(d); x.setMinutes(Math.round(x.getMinutes() / 15) * 15, 0, 0); return x; }
  function btDefaults(base) {
    if (btEdited && $("bt-from").value && $("bt-to").value) return;
    var b0 = roundQuarter(base);
    $("bt-from").value = hhmm(new Date(b0.getTime() - 30 * 60000));
    $("bt-to").value = hhmm(new Date(b0.getTime() + 60 * 60000));
    btWindowHint();
  }
  // The times to check: on the trip's day, from "From" to "To" (past midnight if To is earlier).
  function btTimes(base) {
    var f = ($("bt-from").value || "").split(":"), t = ($("bt-to").value || "").split(":");
    if (f.length < 2 || t.length < 2) return { times: [], step: 15 };
    var from = new Date(base); from.setHours(+f[0], +f[1], 0, 0);
    var to = new Date(base); to.setHours(+t[0], +t[1], 0, 0);
    if (to <= from) to = new Date(to.getTime() + 864e5);
    var span = Math.min((to - from) / 60000, 12 * 60), step = span <= 180 ? 15 : span <= 360 ? 30 : 60;
    var out = [], now = Date.now();
    for (var m = 0; m <= span + 0.5; m += step) {
      var d = new Date(from.getTime() + m * 60000);
      if (d.getTime() >= now - 60000 && Math.abs(d - base) >= 60000) out.push(d);
    }
    var inWindow = base >= from && base <= to;
    return { times: out, step: step, picked: inWindow, capped: (to - from) / 60000 > 12 * 60 };
  }
  function btWindowHint() {
    if (!lastTrip) { $("bt-window-hint").textContent = ""; return; }
    var w = btTimes(new Date(lastTrip.trip.departure));
    $("bt-window-hint").textContent = !w.times.length ? L("No times to check in that window (times already past are skipped).")
      : L("Checks {n} times, every {step} minutes.", { n: w.times.length, step: w.step }) + (w.capped ? " " + L("Up to 12 hours.") : "");
  }
  ["bt-from", "bt-to"].forEach(function (id) {
    $(id).addEventListener("change", function () { btEdited = true; btWindowHint(); });
  });

  // Preview of one time's toll route: dashed on the map over the dimmed trip, with a note on
  // the map to use that time or go back.
  var previewLayer = new GraphicsLayer({ listMode: "hide" });
  map.add(previewLayer, map.layers.indexOf(cursorLayer));
  var previewChip = document.createElement("div");
  previewChip.className = "preview-chip";
  previewChip.hidden = true;
  previewChip.setAttribute("role", "status");
  view.ui.add(previewChip, "manual");
  function clearPreview() {
    btPreview = -1;
    previewLayer.removeAll();
    previewChip.hidden = true;
    routesLayer.opacity = 1;
    if (tollLayer) tollLayer.opacity = 1;
    Array.prototype.forEach.call(document.querySelectorAll("#best-time-out tr.bt-row"), function (r) { r.classList.remove("previewing"); r.setAttribute("aria-pressed", "false"); });
    var d = document.querySelector("#best-time-out tr.bt-detail"); if (d) d.remove();
  }
  function useTime(d) {
    clearPreview();
    var pad = function (n) { return ("0" + n).slice(-2); };
    $("leave").value = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
    track("best-time-use");
    $("go").click();
  }
  // What changed from the trip shown: tolls added, dropped or priced differently.
  function tollChanges(was, now) {
    var A = {}, B = {}, out = [];
    was.items.forEach(function (it) { A[it.point.id] = it; });
    now.items.forEach(function (it) { B[it.point.id] = it; });
    now.items.forEach(function (it) {
      var o = A[it.point.id];
      if (!o) out.push(L("{name}: {price} (not on your trip)", { name: it.point.name, price: it.rate == null ? "n/a" : fmtMoney(it.rate) }));
      else if (o.rate != null && it.rate != null && Math.abs(o.rate - it.rate) > 0.005) out.push(L("{name}: {was} → {now}", { name: it.point.name, was: fmtMoney(o.rate), now: fmtMoney(it.rate) }));
    });
    was.items.forEach(function (it) { if (!B[it.point.id]) out.push(L("{name}: not on this route", { name: it.point.name })); });
    return out;
  }
  function showPreview(k) {
    var r = btRows[k];
    if (!r || r.error || !lastTrip) return;
    if (r.picked || !r.differ || btPreview === k) { clearPreview(); return; }
    clearPreview();
    btPreview = k;
    track("best-time-preview");
    routesLayer.opacity = 0.3;
    if (tollLayer) tollLayer.opacity = 0.3;
    previewLayer.addMany([
      new Graphic({ geometry: r.route.geometry, symbol: { type: "simple-line", color: [255, 255, 255, 0.9], width: 6, cap: "round", join: "round" } }),
      // Same dashes as the toll-free line, in purple.
      new Graphic({ geometry: r.route.geometry, symbol: { type: "cim", data: { type: "CIMSymbolReference", symbol: {
        type: "CIMLineSymbol", symbolLayers: [{ type: "CIMSolidStroke", enable: true, width: 3, color: [102, 45, 145, 255],
          capStyle: "Butt", joinStyle: "Round",
          effects: [{ type: "CIMGeometricEffectDashes", dashTemplate: [3, 2.5], lineDashEnding: "NoConstraint" }] }] } } } })
    ]);
    var changes = tollChanges(lastTrip.priced, r.priced);
    var when = fmtClock(r.at);
    previewChip.innerHTML = '<p class="pc-h"><span class="pc-swatch" aria-hidden="true"></span>' + esc(L("Leaving {time}: toll route", { time: when })) + "</p>" +
      '<p class="pc-m">' + esc(fmtTime(r.tollMin)) + " · " + fmtMoney(r.toll) + (r.plus ? "+" : "") + " · " +
      esc(L("different roads from your trip")) + "</p>" +
      '<div class="pc-b"><button type="button" class="go small" data-use="' + k + '">' + esc(L("Use this time")) + "</button>" +
      '<button type="button" class="btn-outline small" data-back="1">' + esc(L("Back to your trip")) + "</button></div>";
    previewChip.hidden = false;
    var row = document.querySelector('#best-time-out tr.bt-row[data-k="' + k + '"]');
    if (row) {
      row.classList.add("previewing"); row.setAttribute("aria-pressed", "true");
      var det = document.createElement("tr");
      det.className = "bt-detail";
      det.innerHTML = '<td colspan="5"><p>' + esc(L("The dashed line on the map is a different route from your trip's.")) + "</p>" +
        (changes.length ? '<ul class="bt-changes">' + changes.slice(0, 6).map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>"
          : "<p>" + esc(L("Same tolls as your trip.")) + "</p>") +
        '<div class="pc-b"><button type="button" class="go small" data-use="' + k + '">' + esc(L("Use this time")) + "</button>" +
        '<button type="button" class="btn-outline small" data-back="1">' + esc(L("Back to your trip")) + "</button></div></td>";
      row.parentNode.insertBefore(det, row.nextSibling);
    }
    if (window.matchMedia("(max-width: 760px)").matches) $("map").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function previewAction(e) {
    var u = e.target.closest("[data-use]");
    if (u) { e.stopPropagation(); var r = btRows[+u.getAttribute("data-use")]; if (r) useTime(r.at); return true; }
    if (e.target.closest("[data-back]")) { e.stopPropagation(); clearPreview(); return true; }
    return false;
  }
  previewChip.addEventListener("click", previewAction);
  $("best-time-out").addEventListener("click", function (e) {
    if (previewAction(e)) return;
    var row = e.target.closest("tr.bt-row.pickable");
    if (row) showPreview(+row.getAttribute("data-k"));
  });
  $("best-time-out").addEventListener("keydown", function (e) {
    var row = e.target.closest("tr.bt-row.pickable");
    if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showPreview(+row.getAttribute("data-k")); }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && btPreview >= 0) clearPreview(); });

  $("best-time").addEventListener("click", function () {
    track("best-time");
    if (!lastTrip) return;
    clearPreview();
    var run = ++bestRun, base = new Date(lastTrip.trip.departure);
    var w = btTimes(base), times = w.times.slice();
    if (w.picked) times.push(base);
    var tollRoute = lastTrip.tollRoute, freeRoute = lastTrip.freeRoute, trip = lastTrip.trip;
    var via = tollRoute.anchors || null, out = $("best-time-out"), btn = $("best-time");
    if (!w.times.length) { out.innerHTML = '<p class="hint">' + esc(L("No times to check in that window (times already past are skipped).")) + "</p>"; return; }
    btn.disabled = true; $("back-go").disabled = true;
    var todo = w.times.length, done = 0;
    out.innerHTML = '<div class="busy-line">' + spinner() + "<span>" + esc(L("Checking {n} departure times…", { n: todo })) +
      ' <span class="busy-count" id="bt-count"></span></span></div><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + todo +
      '" aria-valuenow="0" aria-label="' + esc(L("Departure times checked")) + '"><span id="bt-bar"></span></div>';
    function tick() {
      done++;
      if (!$("bt-bar")) return;
      $("bt-bar").style.width = Math.round(100 * done / todo) + "%";
      $("bt-count").textContent = L("{done} of {n}", { done: done, n: todo });
      out.querySelector(".progress").setAttribute("aria-valuenow", done);
    }
    var rows = [], saveDeparture = departure;
    var chain = Promise.resolve();
    times.forEach(function (d) {
      chain = chain.then(function () {
        if (run !== bestRun) return;
        if (d === base) {
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
          rows.push({ at: d, tollMin: ts.minutes, toll: priced.total, plus: priced.pending.length || priced.missing.length, freeMin: fs.minutes, hop: hop,
            route: r[0], priced: priced, differ: window.TollCalc.pathsDiffer(tp, [].concat.apply([], tollRoute.geometry.paths)) });
        }).catch(function () { rows.push({ at: d, error: true }); }).then(function () { if (run === bestRun) tick(); });
      });
    });
    chain.then(function () {
      departure = saveDeparture;
      btn.disabled = false; $("back-go").disabled = false;
      if (run !== bestRun) return;
      rows.sort(function (x, y) { return x.at - y.at; });
      btRows = rows;
      var ok = rows.filter(function (r) { return !r.error; });
      var fastest = ok.reduce(function (b, r) { return !b || r.tollMin < b.tollMin ? r : b; }, null);
      var cheapest = ok.reduce(function (b, r) { return !b || r.toll < b.toll - 0.005 ? r : b; }, null);
      var sameToll = ok.every(function (r) { return Math.abs(r.toll - ok[0].toll) < 0.005; });
      if (fastest && !ok.some(function (r) { return r.tollMin - fastest.tollMin >= 1; })) fastest = null; // no real difference
      var anyHop = ok.some(function (r) { return r.hop; }), anyDiffer = ok.some(function (r) { return r.differ && !r.picked; });
      out.innerHTML = '<table class="best-time"><thead><tr><th>' + L("Leave") + '</th><th class="n">' + L("Toll route") + '</th><th class="n">' + L("Toll") + '</th><th class="n">' + L("Toll-free") + '</th><th class="n">' + L("Saves") + "</th></tr></thead><tbody>" +
        rows.map(function (r, k) {
          if (r.error) return "<tr><td>" + esc(fmtClock(r.at)) + '</td><td colspan="4">' + L("Couldn’t check this time") + "</td></tr>";
          var save = r.freeMin - r.tollMin;
          // Only a time whose toll route takes other roads can be shown on the map.
          var pick = r.differ && !r.picked;
          return '<tr class="bt-row' + (r.picked ? " chosen" : "") + (pick ? " pickable" : "") + '" data-k="' + k + '"' + (!pick ? "" : ' tabindex="0" role="button" aria-pressed="false" aria-label="' +
            esc(L("{time}: different route. Show it on the map", { time: fmtClock(r.at) })) + '"') + "><td>" + esc(fmtClock(r.at)) +
            (r.picked ? '<span class="tag picked">' + L("Your time") + "</span>" : "") +
            (pick ? '<span class="tag route">' + L("Different route") + "</span>" : "") +
            (r === fastest ? '<span class="tag">' + L("Fastest") + "</span>" : "") + (!sameToll && r === cheapest ? '<span class="tag cheap">' + L("Cheapest") + "</span>" : "") +
            '</td><td class="n">' + esc(fmtTime(r.tollMin)) + '</td><td class="n">' + fmtMoney(r.toll) + (r.plus ? "+" : "") + (r.hop ? " *" : "") +
            '</td><td class="n">' + esc(fmtTime(r.freeMin)) + '</td><td class="n">' + (save >= 1 ? esc(fmtTime(save)) : "—") + "</td></tr>";
        }).join("") + "</tbody></table>" +
        '<p class="hint">' + (anyDiffer ? L("Tap a time marked “Different route” to see it on the map.") + " " : "") + L("Live traffic up to about 4 hours ahead; later times use typical traffic for that day and time.") +
        (sameToll ? L(" Tolls on this route don’t change with the time of day.") : "") +
        (anyHop ? " " + L("* Esri’s route leaves the tollway at this time, so this toll may be low.") : "") + "</p>";
    });
  });

  // Drive it: open the toll or toll-free route in Google Maps (through a few points on the route,
  // so it follows the same roads), Apple Maps or Waze (they pick their own roads).
  // Points for Google Maps: the stops, plus a point on the route line at each toll the app
  // priced (toll route), so Google drives the same roads and passes the same tolls.
  function routeWaypoints(route, kind) {
    var path = [].concat.apply([], route.geometry.paths);
    var tolls = kind === "toll" && lastTrip ? lastTrip.priced.items.map(function (it) { return [it.point.lon, it.point.lat]; }) : [];
    var mids = (kind === "toll" ? midPoints() : freeMids()).map(function (m) { return [m.longitude, m.latitude]; });
    return window.TollCalc.googleWaypoints(path, tolls, mids, 9);
  }
  // Choose a toll road: send the toll route through a plaza on a road the driver picks
  // (from roads near the trip, going its way). "" = the route Esri picks.
  var viaChoice = { road: "", ends: null };
  function endsKey() { return stops.from && stops.to ? [stops.from.longitude, stops.from.latitude, stops.to.longitude, stops.to.latitude].map(function (v) { return v.toFixed(5); }).join(",") : ""; }
  function chosenVia() {
    if (!viaChoice.road || viaChoice.ends !== endsKey()) return null;
    var o = window.TollCalc.viaPlazas(tollPoints, [stops.from.longitude, stops.from.latitude], [stops.to.longitude, stops.to.latitude])
      .filter(function (x) { return x.road === viaChoice.road; })[0];
    return o ? o.point : null;
  }
  function renderViaRoads() {
    if (!lastTrip || !stops.from || !stops.to) return;
    var opts = window.TollCalc.viaPlazas(tollPoints, [stops.from.longitude, stops.from.latitude], [stops.to.longitude, stops.to.latitude]);
    var used = {};
    lastTrip.priced.items.forEach(function (it) { used[it.point.road] = true; });
    var via = chosenVia(), sel = $("via-road");
    // Only worth showing when there's a road to pick that this route doesn't already take.
    var others = opts.filter(function (o) { return !used[o.road]; });
    $("via-road-wrap").hidden = !via && !others.length;
    sel.innerHTML = '<option value="">' + esc(L("Fastest (any toll road)")) + "</option>" + opts.map(function (o) {
      return '<option value="' + esc(o.road) + '"' + (via && via.road === o.road ? " selected" : "") + ">" + esc(L("Use {road}", { road: tollwayName(o.road) })) + "</option>";
    }).join("");
    var note = "";
    if (via) {
      note = used[via.road] ? L("Routed through the {name} plaza on {road}.", { name: via.name, road: tollwayName(via.road) })
        : L("Couldn’t keep the route on {road}. Try “Fastest” instead.", { road: tollwayName(via.road) });
    } else if (!lastTrip.priced.items.length && others.length) {
      note = L("The fastest route doesn’t use a toll road. To compare one, pick it here.");
    }
    $("via-note").textContent = note;
  }
  var rerouteMsg = null;
  $("via-road").addEventListener("change", function () {
    track(this.value ? "toll-road-picked" : "toll-road-fastest");
    viaChoice = { road: this.value, ends: endsKey() };
    rerouteMsg = this.value ? L("Finding a route on {road}…", { road: tollwayName(this.value) }) : L("Finding the fastest route…");
    if (!$("go").disabled) $("go").click();
  });

  function renderDrive() {
    if (!lastTrip || !stops.from || !stops.to) return;
    var kind = (document.querySelector('input[name="drive-route"]:checked') || {}).value || "toll";
    var route = kind === "free" ? lastTrip.freeRoute : lastTrip.tollRoute;
    var ll = function (p) { return p[1].toFixed(6) + "," + p[0].toFixed(6); };
    var from = [stops.from.longitude, stops.from.latitude], to = [stops.to.longitude, stops.to.latitude];
    var via = routeWaypoints(route, kind), mids = midPoints();
    var g = "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + ll(from) + "&destination=" + ll(to) +
      (via.length ? "&waypoints=" + encodeURIComponent(via.map(ll).join("|")) : "");
    $("nav-google").href = g;
    $("nav-apple").href = "https://maps.apple.com/?saddr=" + ll(from) + "&daddr=" + ll(to) + "&dirflg=d";
    $("nav-waze").href = "https://waze.com/ul?ll=" + ll(to) + "&navigate=yes";
    $("drive-note").textContent = L(kind === "free"
      ? "Google Maps follows this route through a few points. Apple Maps and Waze pick their own roads: turn on “Avoid tolls” there to stay toll-free."
      : "Google Maps follows this route through a few points on it. Apple Maps and Waze pick their own roads, which may differ.") +
      (mids.length ? " " + L("Apple Maps and Waze open with the destination only; add your stops there.") : "");
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="drive-route"]'), function (r) { r.addEventListener("change", renderDrive); });
  ["google", "apple", "waze"].forEach(function (app) {
    $("nav-" + app).addEventListener("click", function () {
      track("drive/" + app + "/" + ((document.querySelector('input[name="drive-route"]:checked') || {}).value || "toll"));
    });
  });

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
    if (window.I18N.lang !== "en") q.set("lang", window.I18N.lang);
    if (chosenVia()) q.set("r", viaChoice.road);
    var ms = midKeys.filter(function (k) { return stops[k]; });
    if (ms.length) {
      q.set("m", ms.map(function (k) { return stops[k].longitude.toFixed(5) + "," + stops[k].latitude.toFixed(5); }).join(";"));
      q.set("ml", ms.map(function (k) { return (searchesTerm(k) || "").replace(/\|/g, "/"); }).join("|"));
    }
    return location.origin + location.pathname + "?" + q.toString();
  }
  // The message that goes with a shared link: the trip, both routes and the link.
  function shareText(url) {
    var lines = [L("Toll Calculator") + ": " + L("Trip summary")];
    summaryRows().rows.forEach(function (r) { lines.push(r[0] + ": " + r[1]); });
    lines.push("");
    if (chartArgs && chartArgs[0].minutes != null && chartArgs[1].minutes != null) {
      lines.push(L("Toll route · {time} · {price}", { time: fmtTime(chartArgs[0].minutes), price: fmtMoney(chartArgs[2].total) }));
      lines.push(L("Toll-free · {time} · $0.00", { time: fmtTime(chartArgs[1].minutes) }));
    }
    var head = ($("headline-big").textContent || "").trim();
    if (head) lines.push(head);
    lines.push("", L("Open this trip:") + " " + url);
    return lines.join("\n");
  }
  // Email: opens the email app with a subject and the message already in the body, where
  // apps put it above the signature (the share menu hands it over as an attachment-like
  // block that Outlook puts below the signature, with no subject).
  $("email-trip").addEventListener("click", function () {
    track("email");
    if (!lastTrip) return;
    var subject = L("Toll Calculator") + ": " + L("Trip summary");
    var body = shareText(shareUrl()).split("\n").slice(1).join("\r\n");
    location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  });
  $("share").addEventListener("click", function () {
    track("share");
    if (!lastTrip) return;
    var url = shareUrl();
    if (navigator.share) {
      // The link goes inside the text, not as a separate url: some apps (Outlook, for one)
      // keep only one of the two, and a bare headline with no link was all that arrived.
      navigator.share({ title: L("Toll Calculator"), text: shareText(url) }).catch(function () { /* closed */ });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { setStatus(L("Link copied. Paste it anywhere to share this trip.")); },
        function () { window.prompt(L("Copy this link:"), url); });
    } else window.prompt(L("Copy this link:"), url);
  });
  // Printable summary: a header with the trip (places, time, vehicle, payment, link) and a
  // picture of the map, then the results with the breakdown and commute cost opened.
  // The saved vehicle picked for this trip (My vehicles), if its settings still match the trip.
  function vehicleName() {
    var v = vehicles && vehicles[activeVehicle], t = lastTrip && lastTrip.trip;
    return v && t && v.axles === t.axles && v.payment === t.payment && !!v.carpool === !!t.carpool ? v.name : "";
  }
  // The trip's facts as label/value pairs, for the printout and the PDF.
  function summaryRows() {
    var t = lastTrip.trip;
    var payName = L({ eztag: "EZ TAG", tag: "Other tag", notag: "No tag" }[t.payment] || t.payment);
    var places = [searchesTerm("from") || L("Start")].concat(midKeys.filter(function (k) { return stops[k]; }).map(function (k, i) {
      return searchesTerm(k) || L("Stop {n}", { n: i + 1 }); }), [searchesTerm("to") || L("Destination")]);
    var when = new Date(t.departure).toLocaleString(window.I18N.locale(), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    // Start, stops and end each get a row with the same dot as on the map.
    var rows = places.map(function (pl, i) {
      var last = i === places.length - 1;
      return i === 0 ? [L("Start"), pl, { fill: "#1e8e3e", ring: "#125e28", letter: "S" }]
        : last ? [L("End"), pl, { fill: "#d22f2f", ring: "#8c1218", letter: "E" }]
        : [L("Stop {n}", { n: i }), pl, { fill: "#1967d2", ring: "#0d3c8c", letter: String(i) }];
    });
    var vName = vehicleName();
    rows.push([L("Leave"), when], [L("Vehicle"), (vName ? vName + " \u2014 " : "") + L("{n} axles", { n: t.axles }) + (t.carpool ? ", " + L("carpool") : "") + " · " + payName]);
    if (chosenVia()) rows.push([L("Toll road"), L("Use {road}", { road: tollwayName(viaChoice.road) })]);
    return { rows: rows, places: places };
  }
  function printedLine() {
    return L("Printed {date}. Estimates only; rates and traffic change.", { date: new Date().toLocaleString(window.I18N.locale(), { dateStyle: "medium", timeStyle: "short" }) });
  }
  // A picture of the map (JPEG data URL), or null after 4 seconds or if the map can't make one.
  var SHOT_W = 900, SHOT_H = 530;
  // The map is zoomed to show the whole trip (both routes and all stops) for the picture, then
  // put back where it was.
  // Wait for the map to finish drawing (up to 5 seconds; a just-opened page is still loading tiles).
  function settled() {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function check() { if (!view.updating || Date.now() - t0 > 5000) setTimeout(res, 200); else setTimeout(check, 100); })();
    });
  }
  function tripScreenRect() {
    var ext = lastTrip.tollRoute.geometry.extent.clone();
    if (lastTrip.freeRoute && $("show-free").checked) ext = ext.union(lastTrip.freeRoute.geometry.extent);
    var pts = [[ext.xmin, ext.ymin], [ext.xmax, ext.ymax], [ext.xmin, ext.ymax], [ext.xmax, ext.ymin]].map(function (c) {
      return view.toScreen(new Point({ longitude: c[0], latitude: c[1] }));
    }).filter(Boolean);
    if (!pts.length) return null;
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    return { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) };
  }
  // The trip's box on screen, padded and widened to the picture's shape; null if it doesn't fit.
  function shotArea(pad) {
    var r = tripScreenRect();
    if (!r) return null;
    var w = (r.x1 - r.x0) * pad + 30, h = (r.y1 - r.y0) * pad + 30, want = SHOT_W / SHOT_H;
    if (w / h < want) w = h * want; else h = w / want;
    var cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, vw = view.width, vh = view.height;
    return { area: { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: Math.round(w), height: Math.round(h) }, fit: Math.max(w / vw, h / vh) };
  }
  function mapShot() {
    try { return frameAndShoot(); } catch (e) { console.warn("map picture failed", e); if (tollLayer) tollLayer.labelsVisible = true; return Promise.resolve(null); }
  }
  // Numbered dots placed so they don't sit on top of each other: a dot that would overlap one
  // already placed moves aside, with a short line back to its toll point. Sizes in the same units as w/h.
  function placeMarks(marks, w, h, r) {
    var placed = [];
    marks.forEach(function (m) {
      var x = m.fx * w, y = m.fy * h, px = x, py = y, tries = 0;
      function hits() { return placed.some(function (q) { return Math.hypot(q.x - px, q.y - py) < r * 2.1; }); }
      while (hits() && tries < 12) {
        tries++;
        var ang = (tries % 6) * Math.PI / 3 - Math.PI / 6, dist = r * 2.3 * Math.ceil(tries / 6);
        px = Math.min(w - r, Math.max(r, x + Math.cos(ang) * dist)); py = Math.min(h - r, Math.max(r, y + Math.sin(ang) * dist));
      }
      placed.push({ n: m.n, x: px, y: py, ax: x, ay: y, missing: m.missing });
    });
    return placed;
  }
  function frameAndShoot() {
    if (!view.takeScreenshot || !lastTrip) return Promise.resolve(null);
    var saved = view.viewpoint ? view.viewpoint.clone() : null, area = null, finished = false;
    // The map's own labels drop some when toll points are close; the picture gets numbered dots instead.
    if (tollLayer) tollLayer.labelsVisible = false;
    tollFallback.visible = false;
    var ext = lastTrip.tollRoute.geometry.extent.clone();
    if (lastTrip.freeRoute && $("show-free").checked) ext = ext.union(lastTrip.freeRoute.geometry.extent);
    function quiet(e) { console.warn("map picture step", e); window.__shotError = String(e && e.message || e); }
    function shoot(a) {
      var o = { format: "jpg", quality: 88, width: SHOT_W, height: SHOT_H };
      area = null;
      if (a && view.width > 0 && view.height > 0 && isFinite(a.area.width)) {
        var ar = a.area;
        ar.x = Math.max(0, ar.x); ar.y = Math.max(0, ar.y);
        ar.width = Math.min(ar.width, view.width - ar.x); ar.height = Math.min(ar.height, view.height - ar.y);
        o.area = ar; area = ar;
      }
      if (!area) area = { x: 0, y: 0, width: view.width, height: view.height };
      return view.takeScreenshot(o).catch(function (e) { // a cropped picture failed: try the whole map
        quiet(e); area = { x: 0, y: 0, width: view.width, height: view.height };
        return view.takeScreenshot({ format: "jpg", quality: 88, width: SHOT_W, height: SHOT_H });
      });
    }
    function withMarks(r) {
      if (!r || !r.dataUrl) return null;
      // Where each toll point sits in the picture (0..1 across and down), numbered as in the toll list.
      var marks = [];
      shownItems.forEach(function (it, i) {
        var sp = view.toScreen(new Point({ longitude: it.point.lon, latitude: it.point.lat }));
        if (!sp || !area || !(area.width > 0)) return;
        var fx = (sp.x - area.x) / area.width, fy = (sp.y - area.y) / area.height;
        if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) marks.push({ n: i + 1, fx: fx, fy: fy, missing: it.rate == null });
      });
      return { url: r.dataUrl, marks: marks };
    }
    // Each step carries on if it fails: a picture of the map as it is beats no picture.
    var work = view.goTo(ext.expand(1.15), { animate: false }).catch(quiet).then(function () { return settled(); }).then(function () {
      var a = null;
      try { a = shotArea(1.1); } catch (e) { quiet(e); }
      if (a && a.fit > 1) { // the picture's shape doesn't fit the map on screen: zoom out and measure again
        return view.goTo({ target: view.center, scale: view.scale * a.fit * 1.05 }, { animate: false }).catch(quiet).then(function () { return settled(); })
          .then(function () { try { return shotArea(1.1); } catch (e) { quiet(e); return null; } });
      }
      return a;
    }).then(function (a) { return finished ? null : shoot(a); }).then(withMarks, function (e) { quiet(e); return null; });
    // A slow phone or map still loading: after 12 seconds, take the map as it is now.
    var late = new Promise(function (res) { setTimeout(res, 12000); }).then(function () {
      if (finished) return null;
      area = { x: 0, y: 0, width: view.width, height: view.height };
      return view.takeScreenshot({ format: "jpg", quality: 85, width: SHOT_W, height: SHOT_H }).then(withMarks, function (e) { quiet(e); return null; });
    });
    return Promise.race([work, late]).then(function (shot) {
      finished = true;
      if (tollLayer) tollLayer.labelsVisible = true;
      tollFallback.visible = true;
      if (saved) view.goTo(saved, { animate: false }).catch(function () {});
      return shot;
    });
  }
  // Pictures for the PDF, as JPEGs (PDF pictures here are JPEG): the HCTRA logo on the purple
  // title bar, and the EZ TAG picture for the offer at the bottom.
  var jpegs = {};
  function loadJpeg(src) {
    if (jpegs[src]) return Promise.resolve(jpegs[src]);
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
          var g = c.getContext("2d"); g.fillStyle = "#662d91"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
          jpegs[src] = { url: c.toDataURL("image/jpeg", 0.92), w: c.width, h: c.height };
        } catch (e) { jpegs[src] = null; }
        res(jpegs[src]);
      };
      img.onerror = function () { res(null); };
      img.src = src;
    });
  }
  function loadLogo() { return loadJpeg("assets/hctra-lockup-reverse.png"); }
  function printHead(shot) {
    var rows = summaryRows().rows.map(function (r) {
      var dot = r[2] ? '<span class="ph-dot" style="background:' + r[2].fill + ";border-color:" + r[2].ring + '">' + r[2].letter + "</span>" : "";
      return [esc(r[0]), dot + esc(r[1])];
    });
    var url = shareUrl();
    return '<div class="ph-left"><h2 class="ph-title">' + esc(L("Trip summary")) + "</h2>" +
      '<table class="ph-trip">' + rows.map(function (r) { return "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>"; }).join("") + "</table>" +
      '<p class="ph-link">' + esc(L("Open this trip:")) + " " + esc(url) + "</p>" +
      '<p class="ph-printed">' + esc(L("Printed {date}. Estimates only; rates and traffic change.", { date: new Date().toLocaleString(window.I18N.locale(), { dateStyle: "medium", timeStyle: "short" }) })) + "</p></div>" +
      (shot ? '<div class="ph-mapwrap"><img class="ph-map" alt="' + esc(L("Map of the toll route and toll-free route")) + '" src="' + shot.url + '">' +
        placeMarks(shot.marks, 100, 100 * SHOT_H / SHOT_W, 2.4).map(function (m) {
          return '<span class="ph-mark' + (m.missing ? " missing" : "") + '" style="left:' + m.x.toFixed(2) + "%;top:" + (m.y * SHOT_W / SHOT_H).toFixed(2) + '%">' + m.n + "</span>";
        }).join("") + "</div>" : "");
  }
  var printOpened = [];
  $("print").addEventListener("click", function () {
    track("print");
    if (!lastTrip) return;
    var btn = this; btn.disabled = true;
    // Breakdown and commute cost print opened; put them back after.
    printOpened = ["breakdown-wrap", "commute-wrap"].filter(function (id) { return !$(id).open; });
    printOpened.forEach(function (id) { $(id).open = true; });
    mapShot().then(function (shot) {
      $("print-head").innerHTML = printHead(shot);
      btn.disabled = false;
      setTimeout(function () { window.print(); }, 50);
    });
  });
  // Save PDF: the same one-page summary as a PDF file, drawn directly (js/pdf.js), so it works
  // on phones whose print screen has no "Save as PDF".
  function textOf(el) { return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }
  function buildPdf(shot, logo, ezPic) {
    var mapUrl = shot && shot.url;
    var P = window.MiniPDF, d = new P.Doc(612, 792), M = 32, R = 612 - M, PURPLE = "#662d91", GRAY = "#5f5a66", FAINT = "#8a8590", LINE = "#d9d5de";
    var y = M, ezOffer = null;
    // Title bar like the site's: the HCTRA logo, a thin divider, the title.
    d.rect(M, y, R - M, 36, { fill: PURPLE });
    var tx = M + 12;
    if (logo) {
      var lh = 22, lw = lh * logo.w / logo.h;
      d.jpeg(logo.url, logo.w, logo.h, M + 12, y + 7, lw, lh);
      d.line(M + 22 + lw, y + 8, M + 22 + lw, y + 28, { color: "#a585c2", lineWidth: 0.75 });
      tx = M + 32 + lw;
    }
    d.text(tx, y + 23, L("Toll Calculator"), { size: 14, bold: true, color: "#ffffff" });
    y += 48;
    // Trip details on the left, the map on the right.
    var mapW = 228, mapH = mapW * SHOT_H / SHOT_W, leftW = R - M - mapW - 14, top = y;
    if (!mapUrl) { // no picture: say where to see the map instead of leaving a gap
      d.rect(R - mapW, top, mapW, mapH, { fill: "#f4f1f8", stroke: "#d9d5de", lineWidth: 0.5 });
      d.para(R - mapW + 14, top + mapH / 2 - 10, L("The map picture couldn’t be made. Tap “Open this trip online” to see the map."), mapW - 28, { size: 8, color: GRAY });
    }
    if (mapUrl) {
      var mx = R - mapW;
      d.jpeg(mapUrl, SHOT_W, SHOT_H, mx, top, mapW, mapH);
      d.rect(mx, top, mapW, mapH, { stroke: "#bbbbbb", lineWidth: 0.5 });
      // Numbered toll points, matching the numbers in the toll list.
      placeMarks(shot.marks, mapW, mapH, 5.5).forEach(function (m) {
        if (Math.hypot(m.x - m.ax, m.y - m.ay) > 1) d.line(mx + m.ax, top + m.ay, mx + m.x, top + m.y, { color: "#2f1a50", lineWidth: 0.6 });
        d.circle(mx + m.x, top + m.y, 5.5, { fill: m.missing ? "#f5a920" : PURPLE, stroke: "#ffffff", lineWidth: 0.9 });
        var lbl = String(m.n);
        d.text(mx + m.x - P.width(lbl, 6.5, true) / 2, top + m.y + 2.4, lbl, { size: 6.5, bold: true, color: "#ffffff" });
      });
    }
    var w = leftW;
    d.text(M, y + 12, L("Trip summary"), { size: 12, bold: true }); y += 20;
    summaryRows().rows.forEach(function (r) {
      d.text(M, y + 9, r[0], { size: 9, bold: true, color: GRAY });
      var vx = M + 52;
      if (r[2]) { // the map's dot: green S, blue numbered stop, red E
        d.circle(vx + 5.5, y + 6, 5.5, { fill: r[2].fill, stroke: r[2].ring, lineWidth: 0.8 });
        d.text(vx + 5.5 - P.width(r[2].letter, 6.5, true) / 2, y + 8.4, r[2].letter, { size: 6.5, bold: true, color: "#ffffff" });
        vx += 15;
      }
      y = d.para(vx, y, r[1], w - (vx - M), { size: 9 }) + 3;
    });
    // The link: a tappable "Open this trip online" (copying a wrapped address breaks it), then the address.
    var url = shareUrl(), linkTop = y + 3;
    d.text(M, linkTop + 8, L("Open this trip online"), { size: 8, bold: true, color: PURPLE });
    d.link(M, linkTop, P.width(L("Open this trip online"), 8, true), 11, url);
    y = d.para(M, linkTop + 11, url, w, { size: 6, color: FAINT });
    y = d.para(M, y + 2, printedLine(), w, { size: 6.5, color: FAINT });
    y = Math.max(y, top + mapH) + 12;
    // Headline banner.
    var big = textOf($("headline-big")), small = textOf($("headline-small")), neutral = $("headline").classList.contains("neutral");
    var hh = small ? 38 : 26;
    d.rect(M, y, R - M, hh, { fill: neutral ? "#ebe4f2" : PURPLE });
    d.text(M + 10, y + 17, big, { size: 13, bold: true, color: neutral ? "#1c1b1d" : "#ffffff" });
    if (small) d.text(M + 10, y + 30, small, { size: 8.5, color: neutral ? GRAY : "#ffffff" });
    y += hh;
    // Below the banner, two columns: the left one holds the route box, the EZ TAG price cards,
    // the notes and the toll breakdown; gas and commute start at the top of the right one, so
    // the page has no empty band.
    var colW = (R - M - 20) / 2, lx0 = M, rx0 = M + colW + 20, colTop = y;
    // Route cards, attached under the banner (they show where its answer comes from): one box,
    // toll route above toll-free, with the prices and times lined up in columns.
    var rowsC = [[L("Toll route"), textOf($("toll-price")), textOf($("toll-meta"))], [L("Toll-free route"), "$0.00", textOf($("free-meta"))]];
    var labW = Math.max.apply(null, rowsC.map(function (c) { return P.width(c[0], 8.5, true); }));
    var priW = Math.max.apply(null, rowsC.map(function (c) { return P.width(c[1], 12, true); }));
    d.rect(M, y, colW, 44, { stroke: LINE });
    d.line(M + 8, y + 22, M + colW - 8, y + 22, { color: LINE });
    rowsC.forEach(function (c, i) {
      var ry0 = y + i * 22;
      d.text(M + 10, ry0 + 14.5, c[0], { size: 8.5, bold: true, color: GRAY });
      d.text(M + 22 + labW + priW, ry0 + 15, c[1], { size: 12, bold: true, color: i ? FAINT : PURPLE, align: "right" });
      d.text(M + 30 + labW + priW, ry0 + 14.5, c[2], { size: 8.5, color: GRAY });
    });
    y += 52;
    // Without an EZ TAG: what the same trip costs with one, as on screen.
    var sv = lastTrip && lastTrip.savings;
    if (sv && sv.amount >= 0.01) {
      // Your price in a pale red card, the EZ TAG price in a green-edged card with the savings.
      // The offer with the monthly savings goes at the bottom of the page (when about $10 or more).
      var other = lastTrip.trip.payment === "tag", ch = 34, cw = (colW - 20) / 2;
      d.rect(M, y, cw, ch, { fill: "#fdecec" });
      d.text(M + 8, y + 12, L(other ? "Your TxTag or TollTag" : "No tag · by mail"), { size: 7.5, color: GRAY });
      d.text(M + 8, y + 27, fmtMoney(lastTrip.priced.total), { size: 13, bold: true, color: "#c0272d" });
      var ax = M + cw + 5, ay = y + ch / 2; // arrow (the PDF fonts have no arrow character)
      d.line(ax, ay, ax + 10, ay, { color: FAINT });
      d.line(ax + 7, ay - 3, ax + 10, ay, { color: FAINT });
      d.line(ax + 7, ay + 3, ax + 10, ay, { color: FAINT });
      var ex = M + cw + 20;
      d.rect(ex, y, cw, ch, { fill: "#e6f4ea", stroke: "#7cc694", lineWidth: 1.2 });
      d.text(ex + 8, y + 12, L("With EZ TAG"), { size: 7.5, color: GRAY });
      d.text(ex + 8, y + 27, fmtMoney(sv.eztag), { size: 13, bold: true, color: "#1b7a36" });
      var saveT = L("Save {amount}", { amount: fmtMoney(sv.amount) }), sw = P.width(saveT, 7.5, true) + 10;
      d.rect(ex + cw - sw - 5, y + 18, sw, 11, { fill: "#1b7a36" });
      d.text(ex + cw - sw, y + 26, saveT, { size: 7.5, bold: true, color: "#ffffff" });
      var days = parseInt($("commute-days").value, 10) || 5, round = $("commute-round").checked;
      var month = Math.round(sv.amount * days * (round ? 2 : 1) * 4.3);
      if (month >= 10) ezOffer = { month: month, days: days, round: round };
      y += ch + 8;
      if (month < 10) { // small savings: no offer at the bottom, just the link under the cards
        var get = L("Get an EZ TAG: hctra.org"), gw = P.width(get, 8, true);
        d.text(M, y + 6, get, { size: 8, bold: true, color: PURPLE });
        d.link(M, y - 3, gw, 12, EZTAG_URL);
        y += 14;
      }
    }
    // Notes (managed lanes, time-of-day pricing, etc.).
    Array.prototype.forEach.call(document.querySelectorAll("#flags .notice"), function (n) {
      var lines = P.wrap(textOf(n), 7.5, false, colW - 14);
      var h = lines.length * 9.5 + 6;
      d.rect(M, y, colW, h, { fill: "#f4f1f8" });
      d.para(M + 7, y + 3, textOf(n), colW - 14, { size: 7.5, lineHeight: 9.5, color: "#333333" });
      y += h + 4;
    });
    y += 6;
    // Toll breakdown continues the left column; gas and commute start at the top of the right.
    var ly = y, ry = colTop + 6;
    d.text(lx0, ly + 10, L("Toll breakdown"), { size: 10, bold: true, color: PURPLE }); ly += 16;
    var roadX = lx0 + colW * 0.58;
    d.text(lx0 + 17, ly + 7, L("Toll point"), { size: 7.5, bold: true, color: GRAY });
    d.text(roadX, ly + 7, L("Road"), { size: 7.5, bold: true, color: GRAY });
    d.text(lx0 + colW - 3, ly + 7, L("Toll"), { size: 7.5, bold: true, color: GRAY, align: "right" });
    ly += 10; d.line(lx0, ly, lx0 + colW, ly, { color: LINE });
    // Grouped by agency, as on screen: an agency banner (name, subtotal), then its toll points,
    // numbered to match the map. The agencies' rate pages are listed once at the bottom.
    Array.prototype.forEach.call(document.querySelectorAll("#breakdown tr"), function (tr) {
      var td = tr.querySelectorAll("td");
      if (ly > 792 - M - 20) { d.addPage(); ly = M; ry = Math.max(ry, M); }
      if (tr.classList.contains("bd-agency")) {
        var code = tr.getAttribute("data-agency"), a = window.TollCalc.agencyInfo(code);
        ly += 3;
        // Slim lavender banner with a purple edge, as on screen.
        d.rect(lx0, ly, colW, 12, { fill: "#efe8f5" });
        d.rect(lx0, ly, 2.5, 12, { fill: PURPLE });
        d.text(lx0 + 6, ly + 8.6, a.short + "  " + a.name, { size: 7.5, bold: true, color: PURPLE });
        var sub = textOf(tr.querySelector(".ag-total"));
        if (sub) d.text(lx0 + colW - 4, ly + 8.6, sub, { size: 7.5, bold: true, color: PURPLE, align: "right" });
        ly += 15;
        return;
      }
      if (td.length < 3) { ly = d.para(lx0, ly + 2, textOf(td[0]), colW, { size: 8 }); return; }
      var k = +tr.getAttribute("data-i");
      var n = Math.max(P.wrap(textOf(td[0]), 8, false, colW * 0.56 - 18).length, P.wrap(textOf(td[1]), 8, false, colW * 0.3).length);
      var h = n * 9.5 + 5;
      d.circle(lx0 + 8, ly + 7.5, 5, { fill: shownItems[k] && shownItems[k].rate == null ? "#f5a920" : PURPLE });
      var nl = String(k + 1);
      d.text(lx0 + 8 - P.width(nl, 6, true) / 2, ly + 9.7, nl, { size: 6, bold: true, color: "#ffffff" });
      d.para(lx0 + 17, ly + 2, textOf(td[0]), colW * 0.56 - 18, { size: 8, lineHeight: 9.5 });
      d.para(roadX, ly + 2, textOf(td[1]), colW * 0.3, { size: 8, lineHeight: 9.5 });
      d.text(lx0 + colW - 3, ly + 10, textOf(td[2]), { size: 8, align: "right" });
      ly += h;
    });
    d.line(lx0, ly, lx0 + colW, ly, { color: LINE });
    // Where to check each agency's rates: tappable links right under the toll list, wrapped
    // to stay in this column.
    var srcs = [];
    shownItems.forEach(function (it) {
      var s = window.TollCalc.rateSource(it.point), a = window.TollCalc.agencyInfo(it.point.owner);
      if (s && !srcs.some(function (x) { return x.url === s.url; })) srcs.push({ url: s.url, label: a.short + " (" + s.site + ")" });
    });
    if (srcs.length) {
      ly += 6;
      var head = L("Check the agencies' rates:") + " ", fx = lx0;
      d.text(fx, ly + 7, head, { size: 7, bold: true, color: GRAY }); fx += P.width(head, 7, true);
      srcs.forEach(function (sr, k) {
        var t = sr.label + (k < srcs.length - 1 ? "," : ""), wdt = P.width(t, 7, false);
        if (fx + wdt > lx0 + colW) { fx = lx0; ly += 9; }
        d.text(fx, ly + 7, t, { size: 7, color: PURPLE });
        d.link(fx, ly - 1, wdt, 10, sr.url);
        fx += wdt + 5;
      });
      ly += 10;
    }
    // "Rates as of", right under that in the same column.
    var asof = textOf($("rates-asof"));
    if (asof) ly = d.para(lx0, ly + 4, asof, colW, { size: 6.5, lineHeight: 8.5, color: FAINT });
    d.text(rx0, ry + 10, L("Gas and commute cost"), { size: 10, bold: true, color: PURPLE }); ry += 18;
    // Gas for this trip: a heading, one row per route with its gas cost, the difference, and
    // the mpg and price it's based on. Then a rule, the trip back, and the commute table.
    var fl = $("fuel-line"), fh = fl.querySelector(".fuel-h");
    if (fh) {
      d.text(rx0, ry + 8, textOf(fh), { size: 8.5, bold: true, color: "#1c1b1d" }); ry += 13;
      var amts = fl.querySelectorAll(".fuel-both b");
      [[L("Toll route"), amts[0]], [L("Toll-free route"), amts[1]]].forEach(function (r) {
        d.text(rx0, ry + 8, r[0], { size: 8 });
        d.text(rx0 + colW, ry + 8, textOf(r[1]), { size: 8, align: "right" });
        ry += 11;
      });
      ry += 1;
      ry = d.para(rx0, ry, textOf(fl.querySelector(".fuel-diff")), colW, { size: 7.5, lineHeight: 9.5, color: GRAY }) + 2;
      var basisEl = fl.querySelector(".fuel-basis");
      if (basisEl) ry = d.para(rx0, ry, textOf(basisEl), colW, { size: 7, lineHeight: 9, color: FAINT });
      ry += 6; d.line(rx0, ry, rx0 + colW, ry, { color: LINE }); ry += 7;
    }
    var back = textOf($("back-out"));
    if (back && !$("back-trip").hidden) ry = d.para(rx0, ry, back, colW, { size: 7.5, lineHeight: 9.5, color: GRAY }) + 6;
    var cells = document.querySelectorAll("#commute-out .commute-grid > span");
    for (var i = 0; i + 2 < cells.length; i += 3) {
      var head = i === 0, bold = !!cells[i].querySelector("strong");
      if (bold) { d.line(rx0, ry + 1, rx0 + colW, ry + 1, { color: LINE }); ry += 3; }
      var o = { size: 8, bold: head || bold, color: head ? "#1c1b1d" : bold ? PURPLE : "#1c1b1d" };
      var oc = head ? { size: 7.5, color: FAINT } : o;
      d.text(rx0, ry + 9, textOf(cells[i]), o);
      d.text(rx0 + colW - 56, ry + 9, textOf(cells[i + 1]), Object.assign({ align: "right" }, oc));
      d.text(rx0 + colW, ry + 9, textOf(cells[i + 2]), Object.assign({ align: "right" }, oc));
      ry += head ? 14 : 12.5;
    }
    var hint = textOf(document.querySelector("#commute-out .hint"));
    if (hint) ry = d.para(rx0, ry + 3, hint, colW, { size: 6.5, color: FAINT });
    y = Math.max(ly, ry) + 12;
    // EZ TAG offer: a purple strip across the bottom of the page (or right after the content if
    // there's no room there; a new page if there's none at all), like a flyer's footer.
    if (ezOffer) {
      var adH = 62, bottom = 792 - M - adH;
      if (y > bottom) { d.addPage(); bottom = M; }
      d.rect(M, bottom, R - M, adH, { fill: "#652d90" });
      var picW = ezPic ? adH * ezPic.w / ezPic.h : 0;
      if (ezPic) d.jpeg(ezPic.url, ezPic.w, ezPic.h, M, bottom, picW, adH);
      var ax0 = M + picW + 14, how = L(ezOffer.days === 1 ? (ezOffer.round ? "if you drive this once a week, both ways." : "if you drive this once a week, one way.")
        : (ezOffer.round ? "if you drive this {n} days a week, both ways." : "if you drive this {n} days a week, one way."), { n: ezOffer.days });
      d.text(ax0, bottom + 18, L("Save about {amount} a month with an EZ TAG", { amount: "$" + ezOffer.month }), { size: 12, bold: true, color: "#ffe512" });
      var after = d.para(ax0, bottom + 21, how.charAt(0).toUpperCase() + how.slice(1) + " " + L("Tolls only; gas costs the same with any tag."), R - ax0 - 10, { size: 7.5, lineHeight: 9, color: "#ffffff" });
      var cta = L("Get an EZ TAG at hctra.org"), cw2 = P.width(cta, 8, true) + 16, by = Math.max(bottom + 37, Math.min(after + 3, bottom + adH - 19));
      d.rect(ax0, by, cw2, 15, { fill: "#ffe512" });
      d.text(ax0 + 8, by + 10.5, cta, { size: 8, bold: true, color: "#3b1a5a" });
      d.link(ax0, by, cw2, 15, EZTAG_URL);
    }
    return d.bytes();
  }
  function pdfName() {
    var pl = summaryRows().places, slug = function (s) { return String(s).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").replace(/^(.{0,24})(-.*)?$/, "$1"); }; // up to 24 letters, whole words
    var d = new Date(lastTrip.trip.departure), ymd = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    return "tolls-" + [slug(pl[0]), "to", slug(pl[pl.length - 1]), ymd].filter(Boolean).join("-") + ".pdf";
  }
  $("save-pdf").addEventListener("click", function () {
    track("pdf");
    if (!lastTrip || !window.MiniPDF) return;
    var btn = this; btn.disabled = true;
    setStatus(L("Making the PDF…"), false, true);
    window.__shotError = null;
    Promise.all([mapShot(), loadLogo(), loadJpeg("assets/eztag-new.jpg")]).then(function (r) {
      // The PDF's built-in fonts have no Vietnamese or Chinese letters, so in those languages
      // the PDF is in English (Print uses the page itself, in any language).
      var pdfLang = /^(en|es)$/.test(window.I18N.lang) ? window.I18N.lang : "en";
      var blob = new Blob([window.I18N.withLang(pdfLang, function () { return buildPdf(r[0], r[1], r[2]); })], { type: "application/pdf" }), name = pdfName();
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
      setStatus(L("Saved {name}.", { name: name }) + (DEBUG && !r[0] ? " Map picture failed: " + (window.__shotError || "timed out") : ""));
    }).catch(function (e) {
      console.error(e);
      setStatus(L("Couldn't make the PDF. Try Print instead."), true);
    }).then(function () { btn.disabled = false; });
  });
  window.addEventListener("afterprint", function () {
    printOpened.forEach(function (id) { $(id).open = false; });
    printOpened = [];
  });

  // Report a wrong toll: an email with the trip filled in, so staff can open the same trip from the link.
  // The facts are in English for the team reading them; only the question to the driver is translated.
  function reportMailto(only) {
    var t = lastTrip.trip, pr = lastTrip.priced;
    var payName = { eztag: "EZ TAG", tag: "Other tag", notag: "No tag" }[t.payment] || t.payment;
    var from = searchesTerm("from") || "", to = searchesTerm("to") || "";
    var items = pr.items.map(function (it, i) { return { it: it, i: i }; })
      .filter(function (x) { return only == null || x.i === only; });
    var lines = [
      L("What looks wrong? (For example: the price, a toll that is missing, or one that shouldn't be there.)"), "", "", "",
      "---- Trip details (filled in by the calculator) ----",
      "From: " + from].concat(midKeys.filter(function (k) { return stops[k]; }).map(function (k, n) { return "Stop " + (n + 1) + ": " + (searchesTerm(k) || lonLat(stops[k]).join(",")); }), ["To: " + to,
      "Leaving: " + new Date(t.departure).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
      "Vehicle: " + (vehicleName() ? vehicleName() + " - " : "") + t.axles + " axles" + (t.carpool ? ", carpool" : "") + " · Payment: " + payName,
      "Route total: " + fmtMoney(pr.total) + " for " + pr.items.length + " toll point" + (pr.items.length === 1 ? "" : "s"),
      only == null ? "Tolls:" : "Toll being reported:"
    ]);
    items.slice(0, 25).forEach(function (x) {
      var p = x.it.point;
      lines.push("  " + (x.i + 1) + ". " + p.road + " · " + p.name + " (" + (p.dir || "") + ", id " + p.id + "): " +
        (x.it.rate == null ? "not included" : fmtMoney(x.it.rate)) + (p.status === "verified" ? "" : " [rate not yet checked]"));
    });
    if (items.length > 25) lines.push("  ... and " + (items.length - 25) + " more");
    lines.push("Open this trip: " + shareUrl(), "Page language: " + window.I18N.lang);
    var subject = "Toll calculator report" + (from || to ? ": " + (from || "?") + " to " + (to || "?") : "");
    return "mailto:" + REPORT_TO + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\n"));
  }
  if (REPORT_TO) {
    $("report").hidden = false;
    $("report").addEventListener("click", function () { if (lastTrip) { track("report"); location.href = reportMailto(null); } });
  }
  // Opening a shared link: fill in the trip and compare once everything has loaded.
  var shared = (function () {
    var q = new URLSearchParams(location.search);
    function pt(v) { var a = (v || "").split(",").map(Number); return a.length === 2 && a.every(isFinite) ? a : null; }
    var s = pt(q.get("s")), e = pt(q.get("e"));
    if (!s || !e) return null;
    return { s: s, e: e, sl: q.get("sl"), el: q.get("el"), ax: parseInt(q.get("ax"), 10), pay: q.get("pay"), cp: q.get("cp") === "1", t: q.get("t"), r: q.get("r"),
      m: (q.get("m") || "").split(";").map(pt).filter(Boolean).slice(0, MAX_MID), ml: (q.get("ml") || "").split("|") };
  })();
  if (shared) setStatus(L("Opening the shared trip…"), false, true);
  function applyShared() {
    if (!shared || !searches.from || !searches.to) return false;
    var sh = shared; shared = null;
    stops.from = new Point({ longitude: sh.s[0], latitude: sh.s[1] });
    stops.to = new Point({ longitude: sh.e[0], latitude: sh.e[1] });
    searches.from.searchTerm = sh.sl || L("Shared start");
    searches.to.searchTerm = sh.el || L("Shared destination");
    sh.m.forEach(function (m, i) { addStop(new Point({ longitude: m[0], latitude: m[1] }), sh.ml[i] || L("Stop {n}", { n: i + 1 })); });
    if (sh.ax >= 2 && sh.ax <= 8) $("axles").value = String(sh.ax);
    var r = document.querySelector('input[name="payment"][value="' + sh.pay + '"]'); if (r) r.checked = true;
    $("carpool").checked = sh.cp;
    if (sh.r) viaChoice = { road: sh.r, ends: endsKey() };
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

  // Stops the routes don't actually reach: Esri reported it couldn't place them, or the route
  // line never comes within 300 m of them.
  function unreachedStops() {
    if (!lastTrip || !midKeys.length) return [];
    var T = window.TollCalc, out = [], n = 0;
    midKeys.forEach(function (k) {
      if (!stops[k]) return;
      n++;
      var p = [stops[k].longitude, stops[k].latitude];
      var far = T.distanceToPath(lastTrip.trip.tollPath, p) > 300 || (!stopTollRoad(stops[k]) && T.distanceToPath(lastTrip.trip.freePath, p) > 300);
      var bad = (lastTrip.tollRoute.stopStatus || []).some(function (st) { return st.name === "Stop " + n && st.status && st.status !== "ok" && st.status !== 0; });
      if (far || bad) out.push({ n: n, label: searchesTerm(k) || lonLat(stops[k]).join(", ") });
    });
    return out;
  }
  // An agency's label row in the toll breakdown: one small line with its short name (full name
  // on hover), a link to the page that publishes its rates, and its subtotal when it has more
  // than one toll here. Kept light so the toll rows stay the easy-to-read part.
  function agencyHeader(code, its) {
    var T = window.TollCalc, a = T.agencyInfo(code), total = 0, missing = 0, srcs = [];
    its.forEach(function (it) {
      if (it.rate == null) missing++; else total = Math.round((total + it.rate) * 100) / 100;
      var s = T.rateSource(it.point);
      if (s && srcs.indexOf(s.url) === -1) srcs.push(s.url);
    });
    var links = srcs.map(function (u, k) {
      return '<a class="ag-link" href="' + esc(u) + '" target="_blank" rel="noopener">' + L(srcs.length > 1 ? "Rates {n}" : "Rates", { n: k + 1 }) + "</a>";
    }).join(" ");
    // A purple banner: short name, full name (cut short with … on narrow screens), the rates
    // link, and the subtotal when the agency has more than one toll here.
    return '<tr class="bd-agency" data-agency="' + esc(code) + '"><td colspan="3"><div class="ag-top">' +
      '<span class="ag-who" title="' + esc(a.name) + '"><span class="ag-short">' + esc(a.short) + "</span>" +
      (a.name !== a.short ? '<span class="ag-name">' + esc(a.name) + "</span>" : "") + "</span>" +
      // The subtotal's slot is always there (empty for a single toll), so every Rates link lines up.
      '<span class="ag-end">' + links + '<span class="ag-total">' + (its.length > 1 ? fmtMoney(total) + (missing ? "+" : "") : "") + "</span></span></div></td></tr>";
  }
  // EZ TAG offer for no-tag and other-tag trips: the two prices as cards (yours in red, the
  // EZ TAG price in green with a "Save" sticker), then, when the savings come to about $10 a
  // month or more at the commute settings, a slim purple strip with the EZ TAG picture, the
  // monthly savings and a sign-up link. Smaller savings get just a link. Hidden for EZ TAG trips,
  // trips where every tag pays the same, and trips with rates that can't be checked yet.
  var EZTAG_URL = "https://www.hctra.org/NewAccount/PersonalAccount";
  function renderTagSavings() {
    var ts = $("tag-savings"), sv = lastTrip && lastTrip.savings;
    ts.hidden = true;
    $("ez-print").innerHTML = "";
    if (!sv || sv.amount < 0.01) return;
    var other = lastTrip.trip.payment === "tag";
    var days = parseInt($("commute-days").value, 10) || 5, round = $("commute-round").checked;
    var month = Math.round(sv.amount * days * (round ? 2 : 1) * 4.3);
    var how = L(days === 1 ? (round ? "Once a week, both ways" : "Once a week, one way")
      : (round ? "{n} days a week, both ways" : "{n} days a week, one way"), { n: days });
    var link = month >= 10 ? "" : '<a class="ts-link" href="' + EZTAG_URL + '" target="_blank" rel="noopener">' + L("Get an EZ TAG →") + "</a>";
    // Print: the same offer as the PDF, a purple strip at the bottom of the page.
    var long = L(days === 1 ? (round ? "if you drive this once a week, both ways." : "if you drive this once a week, one way.")
      : (round ? "if you drive this {n} days a week, both ways." : "if you drive this {n} days a week, one way."), { n: days });
    $("ez-print").innerHTML = month >= 10 ? '<div class="ezp"><img src="assets/eztag-new.jpg" alt="EZ TAG" width="447" height="170"><div>' +
      "<strong>" + L("Save about {amount} a month with an EZ TAG", { amount: "$" + month }) + "</strong><span>" +
      esc(long.charAt(0).toUpperCase() + long.slice(1) + " " + L("Tolls only; gas costs the same with any tag.")) + "</span><b>" + L("Get an EZ TAG at hctra.org") + "</b></div></div>" : "";
    ts.innerHTML =
      '<div class="ts-cards">' +
        '<div class="ts-card ts-yours"><span>' + L(other ? "Your TxTag or TollTag" : "No tag · by mail") + '</span><strong class="ts-bad">' + fmtMoney(lastTrip.priced.total) + "</strong></div>" +
        '<span class="ts-arrow" aria-hidden="true">→</span>' +
        '<div class="ts-card ts-ez"><span class="ts-rib">' + L("Save {amount}", { amount: fmtMoney(sv.amount) }) + "</span><span>" + L("With EZ TAG") + '</span><strong class="ts-good">' + fmtMoney(sv.eztag) + "</strong></div>" +
      "</div>" +
      (month >= 10 ?
        // The whole strip is the link (a big target on phones); the chevron shows it's tappable.
        '<a class="ts-ad" href="' + EZTAG_URL + '" target="_blank" rel="noopener" aria-label="' +
          esc(L("Get an EZ TAG →") + " " + L("About {amount} a month", { amount: "$" + month }) + ", " + how + ". hctra.org") + '">' +
          '<img src="assets/eztag-tag.jpg" alt="" width="337" height="138">' +
          '<span class="ts-ad-text"><strong>' + L("About {amount} a month", { amount: "$" + month }) + "</strong><span>" + how + "</span></span>" +
          '<span class="ts-chev" aria-hidden="true">›</span></a>' : "") +
      link;
    ts.hidden = false;
  }
  function showResults(tollRoute, freeRoute, priced, savings) {
    var t = routeStats(tollRoute), f = routeStats(freeRoute);
    var unpriced = unpricedOnTrip();
    $("toll-price").textContent = fmtMoney(priced.total) + (priced.pending.length || priced.missing.length || unpriced.toll.length ? "+" : "");
    $("toll-meta").textContent = fmtMeta(t);
    $("free-meta").textContent = fmtMeta(f);

    // Headline: is the toll worth it? Time saved and price, then cost per minute saved.
    var big = "", small = "", neutral = false;
    var plus = priced.pending.length || priced.missing.length || unpriced.toll.length ? "+" : "";
    if (!priced.items.length && unpriced.toll.length) { big = L("Tolls not included"); small = L("This route uses {roads}. This calculator doesn't have those toll rates yet.", { roads: roadList(unpriced.toll) }); neutral = true; }
    else if (!priced.items.length) { big = L("No tolls on this trip"); small = L("The fastest route is already toll-free."); neutral = true; }
    else if (priced.laneOptions && priced.laneOptions === priced.items.length) {
      big = L("{price} for the managed lanes", { price: fmtMoney(priced.total) + plus });
      small = L("Time saved isn't estimated: the lanes are usually faster at rush hour.");
    } else if (t.minutes != null && f.minutes != null) {
      var saved = Math.round(f.minutes - t.minutes);
      if (saved > 0) {
        big = L("Save {time} for {price}", { time: fmtTime(saved), price: fmtMoney(priced.total) + plus });
        small = L("Every minute saved costs {cost}.", { cost: fmtPerMinute(priced.total / saved) });
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
    renderViaRoads();

    // Without an EZ TAG: what the same trip would cost with one.
    renderTagSavings();

    var flags = [], warns = [];
    if (unpriced.toll.length)
      warns.push(L("The toll route uses {roads}. This calculator doesn't have toll rates for {them} yet, so the total leaves {them} out.", { roads: roadList(unpriced.toll), them: L(unpriced.toll.length > 1 ? "those roads" : "that road") }));
    if (unpriced.free.length)
      warns.push(L("The toll-free route uses {roads}, which charges a toll. This calculator doesn't have that rate yet.", { roads: roadList(unpriced.free) }));
    var sn = 0;
    midKeys.forEach(function (k) {
      if (!stops[k]) return;
      sn++;
      var road = stopTollRoad(stops[k]);
      if (road) flags.push(L("Stop {n} is on the {road}, so the toll-free route doesn't go there.", { n: sn, road: road }));
    });
    unreachedStops().forEach(function (u) {
      flags.push(L("The route doesn't go to Stop {n} ({place}): the map couldn't put that spot on a road it can drive to. Pick an address or a spot right on a street nearby, then compare again.", { n: u.n, place: u.label }));
    });
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
    var cf = lastTrip && lastTrip.tollRoute.calmFallback;
    if (cf) flags.push(L("With live traffic, Esri's route gets off the {road} and back on. The toll route shown stays on the tollway, with Esri's traffic time for the trip.", { road: cf.roads.map(tollwayName).join(" / ") }));
    var still = lastTrip && lastTrip.tollRoute.stillHops;
    if (still && still.length)
      flags.push(L("Esri's toll route still gets off the {road} and back on (via {via}), even after re-routing. Most drivers stay on the tollway, so the real trip may run a little differently.",
        { road: stillRoads(still), via: stillVia(still) }));
    else if (lastTrip && lastTrip.tollRoute.stayedOn && lastTrip.tollRoute.stayedOn.length)
      flags.push(L("Esri's fastest toll route got off the {road} onto the frontage road or side streets and back on again (to dodge traffic or a toll). Most drivers stay on unless there's a crash or closure, so the toll route here stays on the tollway.",
        { road: lastTrip.tollRoute.stayedOn.map(function (r) { return r === "Sam Houston" ? "Sam Houston Tollway" : r; }).join(" / ") }));
    if (priced.assumed) flags.push(L("{n} Fort Bend County toll point(s) on this route publish rates only up to 6 axles, so they're priced at the 6-axle rate.", { n: priced.assumed }));
    if (priced.unverified) flags.push(L("{n} toll point(s) on this route haven't been checked against their agency's published rates yet.", { n: priced.unverified }));
    $("flags").innerHTML = warns.map(function (m) { return '<div class="notice warn">' + esc(m) + "</div>"; }).join("") +
      flags.map(function (m) { return '<div class="notice info">' + esc(m) + "</div>"; }).join("");

    // Toll breakdown, grouped by agency in driving order: a header row for each agency (its
    // subtotal and links to its rates and website), then its toll points. A route that returns
    // to an agency gets that agency's header again.
    var bdRows = [], stripe = 0;
    var groups = [];
    priced.items.forEach(function (it) {
      var code = it.point.owner || "?", last = groups[groups.length - 1];
      if (last && last.code === code) last.items.push(it); else groups.push({ code: code, items: [it] });
    });
    groups.forEach(function (g) {
      var mine = g.items;
      bdRows.push(agencyHeader(g.code, mine));
      mine.forEach(function (it) {
        var p = it.point, i = priced.items.indexOf(it);
        var when = it.when ? ' <span class="tag-unverified">(' + fmtClock(it.when) + (it.note ? ", " + esc(it.note) : "") + ")</span>" : "";
        bdRows.push('<tr class="pickable' + (stripe++ % 2 ? " stripe" : "") + '" tabindex="0" data-i="' + i + '" title="' + L("Show on map") + '"><td class="bd-name">' + esc(p.name) + (p.status === "unverified" ? ' <span class="tag-unverified">' + L("(unverified)") + "</span>" : "") + when +
          '</td><td class="bd-road">' + esc(p.road) + '</td><td class="num">' + (it.rate == null ? "n/a" : fmtMoney(it.rate)) + "</td></tr>");
      });
    });
    $("breakdown").innerHTML = bdRows.join("") || '<tr><td colspan="3">' + L("No toll points crossed.") + "</td></tr>";
    $("breakdown-wrap").hidden = !priced.items.length;
    drawTripChart(t, f, priced, lastTrip ? window.TollCalc.pathMeters(lastTrip.trip.tollPath) : null);
    shownItems = priced.items;
    clearHighlight();
    $("results").hidden = false;
    if ($("trip-chart").clientWidth - 12 > 352) redrawTripChart(); // drawn while hidden: redraw at the panel's real width
  }

  // Price a routed trip and show it. Used after routing, and again when only the payment
  // type or carpool changes: those don't change the route, so the same route is repriced
  // without asking Esri again (a new request can come back as a different route).
  // After a compare, bring the "Save X min for $Y" headline to the top of the panel
  // (or the page on phones) so the results below it are in view.
  function scrollToHeadline() {
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(function () {
      var h = $("headline");
      if (window.innerWidth > 760) { // desktop: scroll the panel only (not the page, which would shake)
        var panel = document.querySelector(".panel"), bar = $("jump");
        panel.scrollTo({ top: panel.scrollTop + h.getBoundingClientRect().top - panel.getBoundingClientRect().top - (bar ? bar.offsetHeight + 8 : 0), behavior: calm ? "auto" : "smooth" });
      } else { // phone: the page scrolls; stop just below the pinned section bar
        var jb = $("jump"), gap = jb && jb.offsetHeight ? jb.offsetHeight + 8 : 8;
        window.scrollTo({ top: Math.max(0, h.getBoundingClientRect().top + window.scrollY - gap), behavior: calm ? "auto" : "smooth" });
      }
      try { $("headline").focus({ preventScroll: true }); } catch (e) {} // screen readers hear the result
    });
  }
  function priceTrip(trip, tollRoute, freeRoute) {
    var result = window.TollCalc.analyzeTrip(trip, tollPoints);
    var priced = result.priced;
    lastTrip = { trip: trip, tollRoute: tollRoute, freeRoute: freeRoute, priced: priced };
    btWindowHint();
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
    setStatus(L("Keeping the toll-free route on the feeder road…"), false, true);
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
    setStatus(L("Keeping the toll route on the tollway…"), false, true);
    var roads = [];
    hops.forEach(function (h) { if (roads.indexOf(h.road) === -1) roads.push(h.road); });
    var original = routeStats(tollRoute).minutes, originalMiles = routeStats(tollRoute).miles, originalPath = [].concat.apply([], tollRoute.geometry.paths);
    var calmRoute = null;
    return solve(tollRoute.mode, true, false, null, null, { noTraffic: true }).then(function (calm) {
      calmRoute = calm;
      var anchors = window.TollCalc.tollwayAnchors(calm.steps, tollRoute.steps, hops);
      if (!anchors.length) return blockSideStreets(tollRoute, [], roads, 0, null, calm.steps);
      var via = anchors.map(function (a) { return a.lonlat; });
      return solve(tollRoute.mode, true, DEBUG, via).then(function (g) {
        g.originalMinutes = original;
        g.anchors = via;
        return blockSideStreets(g, [], roads, 0, via, calm.steps);
      }, function (e) {
        console.warn("route through tollway points failed", e);
        return blockSideStreets(tollRoute, [], roads, 0, null, calm.steps);
      });
    }, function (e) {
      console.warn("no-traffic route failed", e);
      return blockSideStreets(tollRoute, [], roads, 0, null);
    }).then(function (g) {
      // Sanity check: forcing Esri back onto the tollway can go wrong (a point placed on the
      // other direction's lanes made one trip loop back and forth). If the result still hops,
      // or is much slower or longer than the route Esri first gave, use the no-traffic route
      // instead: it stays on the tollway, so its tolls are right, and it gets the traffic
      // route's time, since the two cover nearly the same ground.
      var st = routeStats(g), T = window.TollCalc;
      var bad = (g.stillHops && g.stillHops.length) || (st.minutes != null && original != null && st.minutes > original * 1.15 + 3) ||
        (st.miles != null && originalMiles != null && st.miles > originalMiles + 2);
      if (bad && calmRoute && calmRoute.steps && !T.findTollwayHops(calmRoute.steps).length) {
        var c = calmRoute;
        c.attributes = Object.assign({}, c.attributes, { Total_TravelTime: original });
        c.calmFallback = { roads: roads, calmMinutes: routeStats(calmRoute).minutes };
        c.mode = tollRoute.mode; c.modeNote = (tollRoute.modeNote || "") + " · no-traffic route, traffic time";
        c.originalMinutes = original;
        c.stayedOn = null;
        return c;
      }
      // Say so only when the route really changed (not when Esri's wording looked like a hop
      // but the kept route is the same roads).
      g.stayedOn = T.pathsDiffer(originalPath, [].concat.apply([], g.geometry.paths), 150) ? roads : null;
      if (g.originalMinutes == null) g.originalMinutes = original;
      return g;
    });
  }
  function blockSideStreets(tollRoute, barriers, roads, round, via, calmSteps) {
    var T = window.TollCalc, hops = T.findTollwayHops(tollRoute.steps);
    // Each re-route can turn up a new side street, so allow a few rounds.
    if (!hops.length || round >= STAY_ON_ROUNDS) {
      if (hops.length) tollRoute.stillHops = hops.map(function (h) { return { road: h.road, via: h.via }; });
      if (barriers.length) tollRoute.barriers = barriers.slice(); // reused for other departure times
      return Promise.resolve(tollRoute);
    }
    var calmLine = calmSteps ? [].concat.apply([], calmSteps.map(function (st) { return st.path || []; })) : null;
    hops.forEach(function (h) {
      // A barrier right beside the tollway can land on the tollway's own lanes and push the
      // route off it, so those are skipped (the tollway points below do the work there).
      if (!calmLine || T.distanceToPath(calmLine, h.barrier) > 80) barriers.push(h.barrier);
      if (roads.indexOf(h.road) === -1) roads.push(h.road);
    });
    return solve(tollRoute.mode, true, DEBUG, via, barriers.slice()).then(function (g) {
      g.originalMinutes = tollRoute.originalMinutes;
      g.anchors = tollRoute.anchors;
      return blockSideStreets(g, barriers, roads, round + 1, via, calmSteps);
    }).catch(function (e) {
      console.warn("stay-on-tollway route failed", e);
      return tollRoute;
    });
  }


  $("go").addEventListener("click", function () {
    var axles = parseInt($("axles").value, 10);
    var payment = paymentChoice();
    clearBack();
    backTimeSet = false;
    var via = chosenVia();
    comparedKey = placesKey(); clearTimeout(recompareTimer);
    orderPath = null;
    lookupLog = { t0: performance.now(), list: [], pageMs: performance.now() };
    departure = readDeparture();
    bestRun++;
    clearPreview(); btRows = [];
    btDefaults(departure);
    $("best-time-out").innerHTML = "";
    $("best-time").disabled = false;
    $("go").disabled = true;
    // Changing the toll road keeps the results on screen, dimmed, with a spinner by the picker.
    var keep = $("results").hidden ? null : rerouteMsg; rerouteMsg = null;
    if (keep) {
      $("results").classList.add("updating");
      $("results").setAttribute("aria-busy", "true");
      $("via-note").innerHTML = spinner() + esc(keep);
    } else $("results").hidden = true;
    setStatus(L("Finding routes…"), false, true);
    routesLayer.removeAll();
    freeGraphic = null;
    freeTraffic = [];
    clearHighlight();
    drawStops();

    loadTravelModes().then(function (modes) {
      var mode = pickMode(modes, axles);
      window.__baseMode = mode;
      return Promise.all([via ? solveFirstVia(tollVariants(mode, axles, "prefer"), [[via.lon, via.lat]]) : solveFirst(tollVariants(mode, axles, "prefer"), true),
        solveFirst(tollVariants(mode, axles, "prohibit"), true)]);
    }).then(function (routes) {
      if (midKeys.length) orderPath = [].concat.apply([], routes[0].geometry.paths);
      return Promise.all([via ? stayOnChosen(routes[0], [[via.lon, via.lat]]) : stayOnTollway(routes[0], axles), stayOnFeeder(routes[1])]);
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
      lookupLog.totalMs = performance.now() - lookupLog.t0;
      priceTrip(trip, tollRoute, freeRoute);
      trackTrip(trip, lastTrip.priced);
      drawTollTraffic(tollRoute, lastTrip.priced, window.TollCalc.pathMeters(path));
      offerTomTom(tollRoute, freeRoute);
      setStatus("");
      if (!keep) scrollToHeadline();
    }).catch(function (err) {
      console.error(err);
      setStatus(L("Couldn't get routes: {msg}", { msg: err && err.message ? err.message : L("unknown error") }), true);
      if (keep) $("via-note").textContent = L("Couldn't get routes: {msg}", { msg: err && err.message ? err.message : L("unknown error") });
    }).then(function () {
      $("results").classList.remove("updating");
      $("results").removeAttribute("aria-busy");
      updateButton();
    });
  });
});
