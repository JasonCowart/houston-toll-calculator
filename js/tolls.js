/*
 * Toll matching and pricing. No map or network code here, so it can be
 * tested on its own (see tools/test_tolls.js).
 *
 * A route is a list of [lon, lat] vertices. A toll point is "crossed" when the
 * route passes within MATCH_METERS of it while heading in the point's direction
 * of travel (within MAX_HEADING_DIFF degrees).
 */
(function (root) {
  "use strict";

  var MATCH_METERS = 30;
  var MAX_HEADING_DIFF = 80;
  var RAMP_ZONE_METERS = 3000;     // how far past a maneuver a ramp gantry can sit
  var RAMP_IN_ZONE_METERS = 12;    // inside a zone, a ramp gantry must be this close to the route (real ramps: 3-5 m; passed-by ramps: 14+ m)
  var RAMP_TEXT_METERS = 30;       // ramp gantry on the right road for the maneuver: loose distance check only
  // Names Esri's turn-by-turn directions use for each toll road in the layer (lowercase substrings).
  var ROAD_ALIASES = {
    "Sam Houston": ["sam houston", "beltway 8", "tx-8", "bw 8", "bw-8"],
    "Dr. Richard A. Tapia Bridge": ["sam houston", "beltway 8", "tx-8", "tapia", "ship channel"],
    "Hardy Toll Rd": ["hardy toll", "hardy tollway"],
    "Airport Connector": ["airport connector", "hardy toll", "hardy airport"],
    "Westpark Tollway": ["westpark"],
    "Westpark Tollway Extension": ["westpark"],
    "Tomball Tollway": ["tomball"],
    "SH 249 Tollway": ["249 tollway", "tollway 249", "aggie", "tomball"],
    "SH 249 Tollway Extension": ["aggie", "249 tollway", "tollway 249", "tx-249", "sh 249"],
    "Fort Bend Parkway": ["fort bend"],
    "Fort Bend Parkway Extension": ["fort bend"],
    "Grand Parkway": ["grand pkwy", "grand parkway", "tx-99", "sh 99", "sh-99"],
    "SH 288 Express Lanes": ["288"],
    "Brazoria County Expressway": ["288", "brazoria"],
    "Katy Managed Lanes": ["katy managed", "managed lanes"],
  };
  function mentionsRoad(text, road) {
    var a = ROAD_ALIASES[road];
    if (!a || !text) return false;
    return a.some(function (n) { return text.indexOf(n) !== -1; });
  }
  var RAMP_FALLBACK_METERS = 8;    // ramp gantries without directions: must be right on the route
  // Ramps curve, so a ramp gantry's road direction (e.g. "West" for the SH 249 to
  // Beltway 8 connector) can be 90+ degrees off the ramp's heading at the gantry.
  var RAMP_MAX_HEADING_DIFF = 135;
  var SHARED_SLACK_METERS = 3;
  var MANAGED_LANE_METERS = 60;    // Katy canopies sit 15-45 m from Esri's I-10 main-lane line      // toll-free route "as close" = within this of the toll route's offset
  var DIR_BEARING = { N: 0, E: 90, S: 180, W: 270 };
  var R = 6371008.8;

  function toRad(d) { return (d * Math.PI) / 180; }

  // Project lon/lat to local meters around a reference latitude (fine at city scale).
  function projector(refLat) {
    var kx = R * Math.cos(toRad(refLat)) * Math.PI / 180;
    var ky = R * Math.PI / 180;
    return function (lon, lat) { return [lon * kx, lat * ky]; };
  }

  function bearing(ax, ay, bx, by) {
    var b = (Math.atan2(bx - ax, by - ay) * 180) / Math.PI; // 0 = north, 90 = east
    return (b + 360) % 360;
  }

  function angleDiff(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  // Returns {dist, along, heading} for the closest point on the path.
  function nearestOnPath(path, px, py) {
    var best = { dist: Infinity, along: 0, heading: null };
    var walked = 0;
    for (var i = 0; i < path.length - 1; i++) {
      var ax = path[i][0], ay = path[i][1], bx = path[i + 1][0], by = path[i + 1][1];
      var dx = bx - ax, dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var len = Math.sqrt(len2);
      if (len === 0) continue;
      var t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      var cx = ax + t * dx, cy = ay + t * dy;
      var d = Math.hypot(px - cx, py - cy);
      if (d < best.dist) best = { dist: d, along: walked + t * len, heading: bearing(ax, ay, bx, by) };
      walked += len;
    }
    return best;
  }

  // Closest approach of a path to a point, if it's close enough and heading the point's way.
  function matchOnPath(path, xy, pt, maxDist, maxTurn) {
    var near = nearestOnPath(path, xy[0], xy[1]);
    if (near.dist > maxDist) return null;
    if (pt.dir && DIR_BEARING[pt.dir] !== undefined && angleDiff(near.heading, DIR_BEARING[pt.dir]) > maxTurn) return null;
    return near;
  }

  /**
   * Find the toll points a route crosses, in travel order.
   *
   * Mainline gantries count when the route passes them. Ramp gantries sit next
   * to the mainline, so a ramp gantry only counts inside a "ramp zone": the
   * stretch of route right after a maneuver (take ramp, exit, fork, merge...),
   * taken from the routing service's turn-by-turn directions. Each ramp zone
   * charges at most one ramp gantry, the closest. Without ramp zones, ramp
   * gantries only count when the route runs right over them (RAMP_FALLBACK_METERS).
   *
   * @param {Array<[number, number]>} lonLatPath route vertices
   * @param {Array<object>} points toll points from data/toll-points.json
   * @param {{rampZones?: Array<Array<[number, number]>>, matchMeters?: number, maxHeadingDiff?: number}} [opts]
   */
  function findCrossings(lonLatPath, points, opts) {
    opts = opts || {};
    var maxDist = opts.matchMeters || MATCH_METERS;
    var maxTurn = opts.maxHeadingDiff || MAX_HEADING_DIFF;
    if (!lonLatPath || lonLatPath.length < 2) return [];

    var minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    lonLatPath.forEach(function (p) {
      minLon = Math.min(minLon, p[0]); maxLon = Math.max(maxLon, p[0]);
      minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]);
    });
    var proj = projector((minLat + maxLat) / 2);
    var toXY = function (p) { return proj(p[0], p[1]); };
    var path = lonLatPath.map(toXY);
    // Zones are plain paths (distance rule) or {path, enter, prev} from rampZoneInfoFromSteps (road rule).
    var zoneInfo = opts.rampZones ? opts.rampZones.map(function (z) { return Array.isArray(z) ? { path: z } : z; })
      .filter(function (z) { return z && z.path && z.path.length > 1; }) : null;
    var zones = zoneInfo ? zoneInfo.map(function (z) { return z.path.map(toXY); }) : null;
    var pad = 0.002; // about 200 m, a cheap bounding-box filter

    var hits = [];
    var bestPerZone = zones ? zones.map(function () { return null; }) : null;

    points.forEach(function (pt) {
      if (pt.lon < minLon - pad || pt.lon > maxLon + pad || pt.lat < minLat - pad || pt.lat > maxLat + pad) return;
      var xy = proj(pt.lon, pt.lat);
      var turn = pt.kind === "main" ? maxTurn : Math.max(maxTurn, opts.rampMaxHeadingDiff || RAMP_MAX_HEADING_DIFF);
      var onRoute = matchOnPath(path, xy, pt, maxDist, turn);
      if (!onRoute) return;
      if (pt.kind === "main") {
        hits.push({ point: pt, along: onRoute.along, offset: onRoute.dist, rule: "mainline" });
        return;
      }
      if (!zones) {
        if (onRoute.dist <= RAMP_FALLBACK_METERS) hits.push({ point: pt, along: onRoute.along, offset: onRoute.dist, rule: "ramp (close)" });
        return;
      }
      zones.forEach(function (zone, zi) {
        var info = zoneInfo[zi], limit = opts.rampInZoneMeters || RAMP_IN_ZONE_METERS, rule = "ramp";
        if (info.enter != null && ROAD_ALIASES[pt.road]) {
          // Road rule: an entry gantry needs a step getting onto its toll road; an exit gantry
          // needs the route to have been on its toll road just before this step.
          if (pt.kind === "on" && mentionsRoad(info.enter, pt.road)) rule = "ramp, entering " + pt.road;
          else if (pt.kind === "off" && mentionsRoad(info.prev, pt.road)) rule = "ramp, leaving " + pt.road;
          else return;
          limit = RAMP_TEXT_METERS;
        }
        var m = matchOnPath(zone, xy, pt, limit, turn);
        if (!m) return;
        var cur = bestPerZone[zi];
        if (!cur || m.dist < cur.offset) bestPerZone[zi] = { point: pt, along: onRoute.along, offset: m.dist, rule: rule };
      });
    });

    if (bestPerZone) {
      var seen = {};
      bestPerZone.forEach(function (h) { if (h && !seen[h.point.id]) { seen[h.point.id] = true; hits.push(h); } });
    }
    hits.sort(function (a, b) { return a.along - b.along; });
    return hits;
  }

  /**
   * Turn turn-by-turn direction steps into ramp zones: the first `zoneMeters`
   * of every step that starts with a maneuver other than "go straight".
   * @param {Array<{maneuverType: string, path: Array<[number, number]>}>} steps
   */
  function rampZonesFromSteps(steps, zoneMeters) {
    zoneMeters = zoneMeters || RAMP_ZONE_METERS;
    var skip = { esriDMTStraight: 1, esriDMTDepart: 1, esriDMTStop: 1 };
    var zones = [];
    (steps || []).forEach(function (s) {
      if (!s || !s.path || s.path.length < 2 || skip[s.maneuverType]) return;
      zones.push(trimPath(s.path, zoneMeters));
    });
    return zones;
  }

  /**
   * Ramp zones with the road context the road rule needs: what the step gets onto
   * ("enter": its own text) and the road the route was on before it ("prev": earlier
   * step texts back to the last one that names a road with "onto"/"on", not counting
   * "on the right/left"). The exit gantry can sit a step later than "take the exit":
   * at SH 249 it's past the "keep left toward TX-249 N / EZTAG" fork.
   */
  function rampZoneInfoFromSteps(steps, zoneMeters) {
    zoneMeters = zoneMeters || RAMP_ZONE_METERS;
    var skip = { esriDMTStraight: 1, esriDMTDepart: 1, esriDMTStop: 1 };
    var out = [];
    (steps || []).forEach(function (s, i) {
      if (!s || !s.path || s.path.length < 2 || skip[s.maneuverType]) return;
      var prev = [];
      for (var j = i - 1; j >= 0 && prev.length < 4; j--) {
        var t = (steps[j].text || "").toLowerCase();
        prev.push(t);
        if (/\bonto\b| on (?!the (right|left)\b)/.test(" " + t + " ")) break; // "on the right" isn't a road
      }
      out.push({ path: trimPath(s.path, zoneMeters), enter: (s.text || "").toLowerCase(), prev: prev.join(" | ") });
    });
    return out;
  }

  /**
   * Drop crossings the toll-free route passes just as closely. The toll-free
   * route never pays a toll, so a point it passes as close as the toll route
   * does must be on a parallel free road: Katy Managed Lanes canopies sit
   * 15-19 m from the free I-10 main lanes. A ramp the toll route really takes
   * (gantry 3-5 m away) survives, since the free route passes it farther off.
   * @returns {{kept: Array, dropped: Array}}
   */
  function dropSharedWithFree(crossings, freeLonLatPath, opts) {
    opts = opts || {};
    var slack = opts.slackMeters == null ? SHARED_SLACK_METERS : opts.slackMeters;
    var kept = [], dropped = [];
    crossings.forEach(function (c) {
      var probe = Object.assign({}, c.point, { kind: "main" });
      var turn = c.point.kind === "main" ? MAX_HEADING_DIFF : RAMP_MAX_HEADING_DIFF;
      var f = findCrossings(freeLonLatPath, [probe], { matchMeters: MATCH_METERS, maxHeadingDiff: turn })[0];
      if (f && f.offset <= c.offset + slack) dropped.push(Object.assign({}, c, { freeOffset: f.offset }));
      else kept.push(c);
    });
    return { kept: kept, dropped: dropped };
  }

  /**
   * Managed-lane plazas (Katy, SH 288 mainline) alongside a route. Esri's map has no
   * separate drivable line for these lanes, so a route on the freeway runs 15-45 m
   * beside the canopies. Taking the lanes is a lane choice on the same freeway, so
   * the toll route includes these plazas when it runs alongside them, same direction.
   */
  function managedLaneCrossings(lonLatPath, points, opts) {
    var lanes = points.filter(function (p) { return p.status === "timed" && p.kind === "main"; });
    return findCrossings(lonLatPath, lanes, { matchMeters: (opts && opts.meters) || MANAGED_LANE_METERS })
      .map(function (c) { return Object.assign(c, { rule: "managed lanes alongside", laneOption: true }); });
  }

  /** Length of a lon/lat path in meters. */
  function pathMeters(lonLatPath) {
    if (!lonLatPath || lonLatPath.length < 2) return 0;
    var proj = projector(lonLatPath[0][1]), m = 0;
    for (var i = 1; i < lonLatPath.length; i++) {
      var a = proj(lonLatPath[i - 1][0], lonLatPath[i - 1][1]), b = proj(lonLatPath[i][0], lonLatPath[i][1]);
      m += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return m;
  }

  /** Distance (m) from a toll point to the nearest ramp zone, ignoring direction. For the debug view. */
  function zoneDistance(pt, zones) {
    if (!zones || !zones.length) return null;
    var proj = projector(pt.lat), xy = proj(pt.lon, pt.lat), best = Infinity;
    zones.forEach(function (z) {
      if (z && !Array.isArray(z)) z = z.path;
      if (!z || z.length < 2) return;
      best = Math.min(best, nearestOnPath(z.map(function (p) { return proj(p[0], p[1]); }), xy[0], xy[1]).dist);
    });
    return best;
  }

  // First `meters` of a lon/lat path.
  function trimPath(lonLatPath, meters) {
    var proj = projector(lonLatPath[0][1]);
    var out = [lonLatPath[0]], walked = 0;
    for (var i = 1; i < lonLatPath.length; i++) {
      var a = proj(lonLatPath[i - 1][0], lonLatPath[i - 1][1]), b = proj(lonLatPath[i][0], lonLatPath[i][1]);
      var seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (walked + seg >= meters) {
        var t = seg ? (meters - walked) / seg : 0;
        out.push([lonLatPath[i - 1][0] + t * (lonLatPath[i][0] - lonLatPath[i - 1][0]), lonLatPath[i - 1][1] + t * (lonLatPath[i][1] - lonLatPath[i - 1][1])]);
        return out;
      }
      walked += seg;
      out.push(lonLatPath[i]);
    }
    return out;
  }

  // ---- Time-of-day pricing (Katy Managed Lanes, SH 288 Express Lanes) ----

  var schedules = { sh288: null };
  function setSchedules(s) { if (s && s.sh288) schedules.sh288 = s.sh288; }

  // Katy Managed Lanes, HCTRA rate chart effective Sept 7, 2013 (unchanged as of Oct 2026).
  // Weekday peak windows by direction; [startHour, endHour, Eldridge, Wilcrest/Wirt].
  var KATY = {
    eb: [[6, 7, 2.10, 1.20], [7, 8, 3.20, 1.90], [8, 9, 2.60, 1.70], [9, 10, 1.50, 1.00]],
    wb: [[15, 16, 2.10, 1.20], [16, 18, 3.20, 1.90], [18, 19, 2.10, 1.20]],
    offPeak: [0.40, 0.30],
    truck: 7.00,          // 3+ axles or towing, all times, each plaza
    noTagFactor: 1.25,    // violation / non-tag = posted + 25%
    hov: [[5, 11], [14, 20]], // carpool 2+ and motorcycles free, Mon-Fri
  };

  // Clock time in Houston, whatever the viewer's device time zone.
  function houstonParts(date) {
    var f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hour12: false, weekday: "short" });
    var o = {};
    f.formatToParts(date).forEach(function (p) { o[p.type] = p.value; });
    var dow = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[o.weekday];
    return { y: +o.year, m: +o.month, d: +o.day, hour: (+o.hour) % 24, minute: +o.minute, dow: dow };
  }

  // National holidays in Texas Government Code 662.003(a), used by SH 288's "Holidays" column.
  function isTexasNationalHoliday(y, m, d) {
    function nth(month, weekday, n) { // weekday 0 = Sunday
      var first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
      return 1 + ((weekday - first + 7) % 7) + 7 * (n - 1);
    }
    function last(month, weekday) {
      var days = new Date(Date.UTC(y, month, 0)).getUTCDate();
      var lastDow = new Date(Date.UTC(y, month - 1, days)).getUTCDay();
      return days - ((lastDow - weekday + 7) % 7);
    }
    var list = [[1, 1], [1, nth(1, 1, 3)], [2, nth(2, 1, 3)], [5, last(5, 1)], [7, 4], [9, nth(9, 1, 1)],
      [11, 11], [11, nth(11, 4, 4)], [12, 25]];
    return list.some(function (h) { return h[0] === m && h[1] === d; });
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  /**
   * Rate at a time-of-day toll point, or null if it can't be priced.
   * @param {Date} when when the vehicle passes the gantry
   * @returns {{rate: number, note: string}|null}
   */
  function timedRate(pt, axles, payment, when, opts) {
    opts = opts || {};
    var t = houstonParts(when || new Date());
    var key = pt.schedule || "";
    if (key.indexOf("katy-") === 0) {
      var weekday = t.dow <= 4, h = t.hour + t.minute / 60;
      if (axles > 2) return { rate: round2(KATY.truck * (payment === "notag" ? KATY.noTagFactor : 1)), note: "3+ axles" };
      if (opts.carpool && weekday && KATY.hov.some(function (w) { return h >= w[0] && h < w[1]; })) return { rate: 0, note: "carpool, HOV hours" };
      var col = key.indexOf("eldridge") > 0 ? 0 : 1;
      var dir = /-eb$/.test(key) ? "eb" : "wb";
      var posted = KATY.offPeak[col], peak = false;
      if (weekday) KATY[dir].forEach(function (w) { if (h >= w[0] && h < w[1]) { posted = w[2 + col]; peak = true; } });
      return { rate: round2(posted * (payment === "notag" ? KATY.noTagFactor : 1)), note: peak ? "weekday peak" : "off-peak" };
    }
    var grid = schedules.sh288 && schedules.sh288.gantries[key];
    if (!grid) return null;
    var slot = Math.min(47, t.hour * 2 + (t.minute >= 30 ? 1 : 0));
    var holiday = isTexasNationalHoliday(t.y, t.m, t.d);
    var base = grid[slot][holiday ? 7 : t.dow];
    var factor = Math.min(5, axles - 1); // TxDOT class factor: 2 axles = 1 ... 6+ axles = 5
    return { rate: round2(base * factor * (payment === "notag" ? 1.5 : 1)), note: holiday ? "holiday rate" : "time-of-day" };
  }

  /**
   * Rate for one toll point.
   * @param {object} pt toll point
   * @param {number} axles 2..8
   * @param {"eztag"|"tag"|"notag"} payment
   * @returns {number|null} null when the layer has no rate for this case
   */
  function rateFor(pt, axles, payment, when, opts) {
    if (pt.status === "timed") { var r = timedRate(pt, axles, payment, when, opts); return r ? r.rate : null; }
    if (payment === "notag") return pt.notag[axles - 2];
    if (axles === 2) return payment === "eztag" ? pt.ez2 : pt.tag2;
    return pt.tag[axles - 3];
  }

  /**
   * Price a list of crossings.
   * @param {object} [ctx] {departure: Date, routeMeters, routeMinutes, carpool}. Time-of-day
   *   tolls are priced at the estimated time the vehicle reaches each gantry.
   */
  function price(crossings, axles, payment, ctx) {
    ctx = ctx || {};
    var total = 0, items = [], missing = [], pending = [], unverified = 0, timed = 0, laneOptions = 0;
    var dep = ctx.departure || new Date();
    crossings.forEach(function (c) {
      var pt = c.point;
      var when = dep;
      if (ctx.routeMeters && ctx.routeMinutes && c.along != null) when = new Date(dep.getTime() + (c.along / ctx.routeMeters) * ctx.routeMinutes * 60000);
      var rate, note;
      if (pt.status === "timed") {
        var r = timedRate(pt, axles, payment, when, ctx);
        if (r) { rate = r.rate; note = r.note; timed++; }
        else { pending.push(pt); items.push({ point: pt, rate: null }); return; }
      } else rate = rateFor(pt, axles, payment);
      if (rate === null || rate === undefined) { missing.push(pt); items.push({ point: pt, rate: null }); return; }
      if (pt.status === "unverified") unverified++;
      total += rate;
      items.push({ point: pt, rate: rate, when: pt.status === "timed" ? when : null, note: note, laneOption: !!c.laneOption });
      if (c.laneOption) laneOptions++;
    });
    return {
      total: Math.round(total * 100) / 100,
      items: items,
      missing: missing,
      pending: pending,
      unverified: unverified,
      timed: timed,
      laneOptions: laneOptions,
    };
  }

  /**
   * The whole toll calculation for one trip: the one function both the site and the
   * saved-trip tests run, so a replayed trip goes through exactly the same steps.
   * @param {object} trip {tollPath, freePath, steps, departure (Date|ISO), routeMinutes, axles, payment, carpool}
   * @param {Array<object>} points toll points
   * @returns {{crossings, dropped, rampZones, priced}}
   */
  function analyzeTrip(trip, points) {
    var path = trip.tollPath;
    var hasSteps = trip.steps && trip.steps.some(function (s) { return s.path && s.path.length > 1; });
    var rampZones = hasSteps ? rampZoneInfoFromSteps(trip.steps) : null;
    var raw = findCrossings(path, points, { rampZones: rampZones });
    var split = trip.freePath && trip.freePath.length > 1 ? dropSharedWithFree(raw, trip.freePath) : { kept: raw, dropped: [] };
    var crossings = split.kept.slice();
    // Managed-lane plazas the route runs alongside (a lane choice on the same freeway).
    var have = {};
    crossings.forEach(function (c) { have[c.point.id] = true; });
    managedLaneCrossings(path, points).forEach(function (c) { if (!have[c.point.id]) crossings.push(c); });
    crossings.sort(function (a, b) { return a.along - b.along; });
    var priced = price(crossings, trip.axles, trip.payment, {
      departure: trip.departure ? new Date(trip.departure) : new Date(),
      routeMeters: pathMeters(path), routeMinutes: trip.routeMinutes, carpool: !!trip.carpool,
    });
    return { crossings: crossings, dropped: split.dropped, rampZones: rampZones, priced: priced };
  }

  var api = { analyzeTrip: analyzeTrip, findCrossings: findCrossings, managedLaneCrossings: managedLaneCrossings, dropSharedWithFree: dropSharedWithFree, rampZonesFromSteps: rampZonesFromSteps, rampZoneInfoFromSteps: rampZoneInfoFromSteps, mentionsRoad: mentionsRoad, zoneDistance: zoneDistance, rateFor: rateFor, price: price, timedRate: timedRate, setSchedules: setSchedules, pathMeters: pathMeters, houstonParts: houstonParts, MATCH_METERS: MATCH_METERS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TollCalc = api;
})(this);
