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
    "Tomball Tollway": ["tomball", "eztag"], // "merge onto the highway toward TX-249 N / EZTAG" = the tolled lanes
    "SH 249 Tollway": ["249 tollway", "tollway 249", "aggie", "tomball"],
    "SH 249 Tollway Extension": ["aggie", "249 tollway", "tollway 249", "tx-249", "sh 249"],
    "Fort Bend Parkway": ["fort bend"],
    "Fort Bend Parkway Extension": ["fort bend"],
    "Grand Parkway": ["grand pkwy", "grand parkway", "tx-99", "sh 99", "sh-99"],
    "SH 288 Express Lanes": ["288"],
    "Brazoria County Expressway": ["288", "brazoria"],
    "Katy Managed Lanes": ["katy managed", "managed lanes"],
  };
  // Free roads whose names contain a toll road's name: the Beltway 8 frontage roads
  // ("N Sam Houston Pkwy W"), SH 249's free lanes ("Tomball Pkwy") and Westpark Dr.
  // They're removed before matching, so a turn onto a frontage road doesn't count as
  // entering the toll road (a West Rd entrance ramp was charged that way, Oct 22, 2026).
  var FREE_ROAD_NAMES = /\b[nsew]?\s*sam houston (pkwy|parkway)\b( [nsew]\b)?|\btomball (pkwy|parkway)\b|\bwestpark (dr|drive)\b/g;
  function mentionsRoad(text, road) {
    var a = ROAD_ALIASES[road];
    if (!a || !text) return false;
    var t = text.replace(FREE_ROAD_NAMES, " ");
    return a.some(function (n) { return t.indexOf(n) !== -1; });
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
    var lanes = points.filter(function (p) { return (p.status === "timed" || p.lane) && p.kind === "main"; });
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
    var total = 0, items = [], missing = [], pending = [], unverified = 0, timed = 0, laneOptions = 0, assumed = 0;
    var dep = ctx.departure || new Date();
    crossings.forEach(function (c) {
      var pt = c.point;
      var when = dep;
      if (ctx.routeMeters && ctx.routeMinutes && c.along != null) when = new Date(dep.getTime() + (c.along / ctx.routeMeters) * ctx.routeMinutes * 60000);
      var rate, note;
      if (pt.status === "timed") {
        var r = timedRate(pt, axles, payment, when, ctx);
        if (r) { rate = r.rate; note = r.note; timed++; }
        else { pending.push(pt); items.push({ point: pt, rate: null, along: c.along }); return; }
      } else rate = rateFor(pt, axles, payment);
      if (rate === null || rate === undefined) { missing.push(pt); items.push({ point: pt, rate: null, along: c.along }); return; }
      if (pt.status === "unverified") unverified++;
      if (pt.assumedAxles && pt.assumedAxles.indexOf(axles) !== -1) assumed++;
      total += rate;
      items.push({ point: pt, rate: rate, when: pt.status === "timed" ? when : null, note: note, laneOption: !!c.laneOption, along: c.along });
      if (c.laneOption) laneOptions++;
    });
    return {
      total: Math.round(total * 100) / 100,
      items: items,
      missing: missing,
      pending: pending,
      unverified: unverified,
      assumed: assumed,
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

  // Traffic level of each turn-by-turn step, from its traffic-based time and length (Esri
  // returns both per step). Only freeways, toll roads and highways are judged; streets have
  // too wide a range of normal speeds. Levels: null = moving (55+ mph), "moderate" 40-55,
  // "slow" 25-40, "heavy" under 25.
  var HIGHWAY_TEXT = /\b(i-\d+|interstate|highway|fwy|freeway|tollway|toll rd|toll road|tx-\d+|sh[- ]\d+|us-\d+|beltway|bw[- ]?8|grand (pkwy|parkway)|expy|expressway|express lanes|managed lanes|sam houston tollway|hardy toll)\b/;
  var NOT_HIGHWAY = /\b(frtg|frontage|service dr|access rd|feeder)\b/;
  var RAMP_MILES = 0.3, RAMP_MPH = 35;
  var TRAFFIC_MAX_MILES = 4;   // longer steps: one average speed is too coarse to color
  // "exit": onto a ramp leaving the road; "enter": onto a ramp joining a highway;
  // "continue": staying on whatever road the last step was on.
  function stepKind(text) {
    if (/merge onto|go on .*(tollway|fwy|freeway|highway|i-\d|us-\d|tx-\d)|ramp .*onto/.test(text)) return "enter";
    if (/\btake (the )?exit\b|\btake exit \d|\btake the ramp\b/.test(text)) return "exit";
    if (/^(continue|go straight|keep straight)/.test(text)) return "continue";
    return "other";
  }
  function trafficLevel(mph) {
    if (mph == null || !isFinite(mph)) return null;
    return mph < 25 ? "heavy" : mph < 40 ? "slow" : mph < 55 ? "moderate" : null;
  }
  // skip: [[from, to], ...] fractions of the route where the traffic shown would be wrong
  // (managed lanes Esri can't route on: the step times are the regular lanes').
  function trafficSegments(steps, skip) {
    if (!steps || !steps.length) return [];
    var total = 0;
    steps.forEach(function (s) { total += s.length > 0 ? s.length : 0; });
    var at = 0, out = [], off = false;
    steps.forEach(function (s) {
      var len = s.length > 0 ? s.length : 0;
      if (!len) return;
      var text = String(s.text || "").toLowerCase();
      var kind = stepKind(text);
      // Leaving the main lanes: the exit ramp and the feeder road after it (Esri names
      // the feeder after the freeway, e.g. "Continue forward on Northwest Fwy").
      if (kind === "exit") off = true;
      else if (kind === "enter") off = false;
      else if (kind !== "continue") off = false;
      var highway = HIGHWAY_TEXT.test(text) && !NOT_HIGHWAY.test(text) &&
        kind !== "exit" && !(kind === "continue" && off);
      var judged = len, mins = s.time;
      // An entrance step starts on the ramp; leave the ramp out of the speed.
      if (kind === "enter" && mins > 0) { judged = len - RAMP_MILES; mins = s.time - RAMP_MILES / RAMP_MPH * 60; }
      var mph = mins > 0 && judged > 0 ? judged / (mins / 60) : null;
      if (kind === "enter" && judged < 0.3) highway = false;
      var from = total ? at / total : 0, to = total ? (at + len) / total : 0;
      var skipped = (skip || []).some(function (r) { return from < r[1] && to > r[0]; });
      // Esri gives one time per step; over a long step the average hides where the slowdown is.
      var coarse = highway && len > TRAFFIC_MAX_MILES;
      out.push({ from: from, to: to, miles: len, mph: mph, highway: highway, skipped: skipped, coarse: coarse, text: s.text || "",
        level: highway && !skipped && !coarse && len >= 0.15 ? trafficLevel(mph) : null, path: s.path || null });
      at += len;
    });
    return out;
  }

  // Mainline plazas a toll route skips by stepping off onto a frontage road: a mainline
  // toll point heading the same way, 30-150 m from the route (beside it, not on it), on a
  // toll road the route pays on both before and after that point. Drivers stay on the
  // tollway, so the app re-routes through these plazas.
  var BYPASS_MAX_METERS = 150;
  function bypassedPlazas(path, points, counted) {
    var same = function (a, b) { return a === b || (/Sam Houston|Tapia/.test(a) && /Sam Houston|Tapia/.test(b)); };
    var mains = points.filter(function (p) { return p.kind === "main" && p.status !== "timed" && !p.lane; });
    var near = findCrossings(path, mains, { matchMeters: BYPASS_MAX_METERS });
    var paid = {};
    (counted || []).forEach(function (c) { paid[c.point.id] = true; });
    return near.filter(function (h) {
      if (paid[h.point.id] || h.offset <= MATCH_METERS) return false;
      var before = (counted || []).some(function (c) { return c.along < h.along && same(c.point.road, h.point.road); });
      var after = (counted || []).some(function (c) { return c.along > h.along && same(c.point.road, h.point.road); });
      return before && after;
    });
  }

  // Hops: a toll route that leaves a toll road and gets back on the same road a few miles
  // later (usually by the frontage road, to dodge traffic or a plaza). Found from the
  // turn-by-turn text: steps on road R, then up to 8 miles of steps not on R with no merge
  // onto another highway, then R again. Each hop gets a barrier point at the middle of its
  // longest off-road step, so a re-route can't use that detour.
  var HOP_MAX_MILES = 8;
  function stepRoad(text) {
    var t = String(text || "").toLowerCase();
    for (var r in ROAD_ALIASES) if (mentionsRoad(t, r)) return r;
    return null;
  }
  function sameRoad(a, b) {
    var g = function (r) { return /Sam Houston|Tapia/.test(r) ? "Sam Houston" : /Westpark/.test(r) ? "Westpark" : /Fort Bend/.test(r) ? "Fort Bend" : r; };
    return a && b && g(a) === g(b);
  }
  function midPoint(path) {
    if (!path || path.length < 2) return null;
    var total = pathMeters(path), half = total / 2, proj = projector(path[0][1]), at = 0;
    for (var i = 1; i < path.length; i++) {
      var a = proj(path[i - 1][0], path[i - 1][1]), b = proj(path[i][0], path[i][1]);
      var seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (at + seg >= half && seg > 0) {
        var f = (half - at) / seg;
        return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f];
      }
      at += seg;
    }
    return path[path.length - 1];
  }
  // The feeder (frontage) road a step drives, as a key: "Sam Houston Pkwy" for N/S/E/W Sam Houston
  // Pkwy, the same for Tomball Pkwy and Westpark Dr, else the name of any road called a frontage
  // or service road. null for other roads.
  function feederRoad(text) {
    var t = String(text || "").toLowerCase();
    if (/sam houston (pkwy|parkway)/.test(t) && !/tollway/.test(t)) return "Sam Houston Pkwy";
    if (/tomball (pkwy|parkway)/.test(t) && !/tollway/.test(t)) return "Tomball Pkwy";
    if (/westpark (dr|drive)/.test(t)) return "Westpark Dr";
    var m = /\b(?:on|onto|to)\s+(.+)$/.exec(t);
    var name = m ? m[1] : "";
    if (/\b(frtg|frontage|service dr|feeder|acc rd)\b/.test(name)) return name.replace(/\b[nsew]\b/g, "").replace(/\s+/g, " ").trim();
    return null;
  }
  // Toll-free routes that leave a feeder road for side streets and come back to the same feeder
  // road, up to 8 miles later. Each comes with a barrier point on the longest side street.
  // Leaving the road to stop somewhere (a stop on the trip) isn't a detour to undo.
  function visitsStop(steps) {
    return steps.some(function (s) { return s.maneuverType === "esriDMTStop" || s.maneuverType === "esriDMTDepart"; });
  }
  function findFeederDetours(steps) {
    var out = [];
    if (!steps) return out;
    var lastFeeder = null, offStart = -1;
    for (var i = 0; i < steps.length; i++) {
      var f = feederRoad(steps[i].text);
      if (f) {
        if (lastFeeder === f && offStart >= 0) {
          var off = steps.slice(offStart, i), miles = 0, best = null, highway = false;
          off.forEach(function (s) {
            miles += s.length > 0 ? s.length : 0;
            var t = String(s.text || "").toLowerCase();
            if (HIGHWAY_TEXT.test(t) && !NOT_HIGHWAY.test(t) && !/\bfm[- ]?\d/.test(t)) highway = true;
            if (s.path && s.path.length > 1 && !/Ramp|Fork/.test(s.maneuverType || "") && (!best || s.length > best.length)) best = s;
          });
          if (!highway && best && best.length > 0.3 && miles <= HOP_MAX_MILES && !visitsStop(off)) {
            var vias = [];
            off.forEach(function (s) {
              var m = /\b(?:on|onto)\s+([^()]+?)\s*(\(|$)/.exec(String(s.text || "")), name = m && m[1].trim();
              var key = function (n) { return n.toLowerCase().replace(/[^a-z0-9]/g, ""); };
              if (name && !/Ramp|Fork/.test(s.maneuverType || "") && !vias.some(function (v) { return key(v) === key(name); })) vias.push(name);
            });
            out.push({ road: f, miles: miles, fromStep: offStart, toStep: i, barrier: midPoint(best.path), via: vias });
          }
        }
        lastFeeder = f;
        offStart = -1;
      } else if (lastFeeder && offStart < 0 && steps[i].maneuverType !== "esriDMTStop") {
        offStart = i;
      }
    }
    return out;
  }

  function findTollwayHops(steps) {
    var hops = [];
    if (!steps) return hops;
    var lastRoad = null, offStart = -1;
    for (var i = 0; i < steps.length; i++) {
      var r = stepRoad(steps[i].text);
      if (r) {
        if (lastRoad && sameRoad(r, lastRoad) && offStart >= 0) {
          var off = steps.slice(offStart, i), miles = 0, otherHighway = false, best = null;
          // a real detour drives a road (frontage or street), not just a chain of ramps between toll roads
          var drivesRoad = off.some(function (s) { return !/Ramp|Fork/.test(s.maneuverType || "") && s.length > 0.05; });
          off.forEach(function (s, k) {
            miles += s.length > 0 ? s.length : 0;
            var t = String(s.text || "").toLowerCase();
            if (/merge onto/.test(t) && HIGHWAY_TEXT.test(t.replace(FREE_ROAD_NAMES, " ")) && !/the highway/.test(t)) otherHighway = true;
            // the barrier goes on the longest off-road step, skipping the exit ramp itself when there's more
            if (s.path && s.path.length > 1 && (k > 0 || off.length === 1) && (!best || s.length > best.length)) best = s;
          });
          if (drivesRoad && !otherHighway && miles > 0 && miles <= HOP_MAX_MILES && best && !visitsStop(off)) {
            hops.push({ road: lastRoad, miles: miles, fromStep: offStart, toStep: i, barrier: midPoint(best.path), via: best.text });
          }
        }
        lastRoad = r;
        offStart = -1;
      } else if (lastRoad && offStart < 0 && steps[i].maneuverType !== "esriDMTStop") {
        offStart = i;
      }
    }
    return hops;
  }

  // Points to route through so a traffic route stays on the tollway where it hopped off.
  // calmSteps: the same trip solved without traffic (it stays on the tollway). For each hop,
  // returns vertices of the calm route's own tollway line between where the traffic route
  // left and where it got back on, so a waypoint there sits exactly on Esri's main lanes and
  // can't snap to the frontage road beside them. [] if the calm route doesn't cover the hop.
  var ANCHOR_SPACING_METERS = 1500, ANCHOR_END_METERS = 150, ANCHOR_MATCH_METERS = 300;
  function tollwayAnchors(calmSteps, trafficSteps, hops) {
    var out = [];
    if (!calmSteps || !trafficSteps || !hops || !hops.length) return out;
    var first = null;
    calmSteps.some(function (s) { if (s.path && s.path.length) { first = s.path[0]; return true; } return false; });
    if (!first) return out;
    var proj = projector(first[1]);
    // the calm route as one line, each vertex tagged with its step and distance into that step
    var line = [], verts = [];
    calmSteps.forEach(function (s, si) {
      if (!s.path || s.path.length < 2) return;
      var stepLen = 0, prev = null;
      var xy = s.path.map(function (p) { return proj(p[0], p[1]); });
      xy.forEach(function (q) { if (prev) stepLen += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; });
      var into = 0; prev = null;
      xy.forEach(function (q, k) {
        if (prev) into += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        prev = q;
        line.push(q);
        verts.push({ step: si, lonlat: s.path[k], fromStart: into, toEnd: stepLen - into });
      });
    });
    var along = [0];
    for (var i = 1; i < line.length; i++) along.push(along[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    hops.forEach(function (h) {
      var before = trafficSteps[h.fromStep - 1], back = trafficSteps[h.toStep];
      if (!before || !before.path || !back || !back.path) return;
      var e = before.path[before.path.length - 1], j = back.path[0];
      var ne = nearestOnPath(line, proj(e[0], e[1])[0], proj(e[0], e[1])[1]);
      var nj = nearestOnPath(line, proj(j[0], j[1])[0], proj(j[0], j[1])[1]);
      if (ne.dist > ANCHOR_MATCH_METERS || nj.dist > ANCHOR_MATCH_METERS || nj.along <= ne.along) return;
      var span = nj.along - ne.along, margin = Math.min(300, span * 0.25);
      var picks = verts.map(function (v, k) { return { v: v, at: along[k] }; }).filter(function (c) {
        var st = calmSteps[c.v.step];
        var r = stepRoad(st.text);
        return c.at > ne.along + margin && c.at < nj.along - margin && r && sameRoad(r, h.road) &&
          c.v.fromStart >= ANCHOR_END_METERS && c.v.toEnd >= ANCHOR_END_METERS;
      });
      if (!picks.length) return;
      // one near the middle, then every ANCHOR_SPACING_METERS each way
      var mid = (ne.along + nj.along) / 2, n = Math.max(1, Math.round(span / ANCHOR_SPACING_METERS));
      var targets = [];
      for (var t = 0; t < n; t++) targets.push(ne.along + span * (t + 0.5) / n);
      if (!targets.length) targets = [mid];
      var used = {};
      targets.forEach(function (target) {
        var best = null;
        picks.forEach(function (c) { if (!best || Math.abs(c.at - target) < Math.abs(best.at - target)) best = c; });
        var key = best.v.lonlat.join(",");
        if (!used[key]) { used[key] = true; out.push({ lonlat: best.v.lonlat, road: h.road, at: best.at }); }
      });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out.map(function (a) { return { lonlat: a.lonlat, road: a.road }; });
  }

  // ---- Trip extras ----
  // Fuel defaults by vehicle class: gas for 2-3 axles, diesel for 4+. Houston-area prices,
  // Oct 2026 (regular about $3.76, diesel $5.67); users can change them.
  var FUEL_DEFAULTS = { 2: { mpg: 25, fuel: "regular" }, 3: { mpg: 13, fuel: "regular" }, 4: { mpg: 9, fuel: "diesel" },
    5: { mpg: 6.5, fuel: "diesel" }, 6: { mpg: 6, fuel: "diesel" }, 7: { mpg: 5.5, fuel: "diesel" }, 8: { mpg: 5.5, fuel: "diesel" } };
  var FUEL_PRICES = { regular: 3.76, diesel: 5.67, asOf: "Oct 2026" };
  function fuelDefaults(axles) {
    var d = FUEL_DEFAULTS[axles] || FUEL_DEFAULTS[2];
    return { mpg: d.mpg, price: FUEL_PRICES[d.fuel], fuel: d.fuel };
  }
  // Mileage depends on speed: worst in stop-and-go, best at a steady 45-60 mph, dropping again
  // at high speed. Share of the vehicle's mpg at an average speed (rounded from fuel economy vs
  // speed studies); straight lines in between.
  var MPG_BY_SPEED = [[0, 0.35], [5, 0.4], [15, 0.6], [25, 0.78], [35, 0.93], [45, 1.03], [55, 1.06], [62, 1.02], [70, 0.94], [80, 0.82]];
  function speedFactor(mph) {
    if (!(mph > 0)) return 1;
    var c = MPG_BY_SPEED;
    if (mph >= c[c.length - 1][0]) return c[c.length - 1][1];
    for (var i = 1; i < c.length; i++) if (mph <= c[i][0]) {
      var a = c[i - 1], b = c[i];
      return a[1] + (b[1] - a[1]) * (mph - a[0]) / (b[0] - a[0]);
    }
    return 1;
  }
  // Gallons for a route: each step's miles at its own average speed (Esri's step time, with
  // traffic). Without steps, the whole route at its average speed.
  function fuelGallons(steps, miles, minutes, mpg) {
    if (!(mpg > 0)) return null;
    var used = 0, counted = 0;
    (steps || []).forEach(function (s) {
      if (!(s.length > 0)) return;
      var mph = s.time > 0 ? s.length / (s.time / 60) : null;
      used += s.length / (mpg * speedFactor(mph || (minutes > 0 ? miles / (minutes / 60) : 0)));
      counted += s.length;
    });
    if (!counted) return miles > 0 ? miles / (mpg * speedFactor(minutes > 0 ? miles / (minutes / 60) : 0)) : null;
    if (miles > counted) used += (miles - counted) / mpg; // any miles the steps don't cover
    return used;
  }
  function fuelCost(miles, mpg, price) {
    if (!(miles > 0) || !(mpg > 0) || !(price >= 0)) return null;
    return Math.round(miles / mpg * price * 100) / 100;
  }
  // One trip as a commute: days a week, round trip. The trip back costs the same as the trip
  // there unless `back` (the trip back, priced for its own time) is given. Months are 52/12 weeks.
  function commute(trip, daysPerWeek, roundTrip, back) {
    var per = daysPerWeek * (roundTrip ? 2 : 1), month = 52 / 12;
    var useBack = roundTrip && back;
    function both(k) {
      var v = trip[k];
      if (useBack) {
        if (v == null && back[k] == null) return null;
        var day = (v || 0) + (back[k] || 0);
        return { week: day * daysPerWeek, month: day * daysPerWeek * month };
      }
      return v == null ? null : { week: v * per, month: v * per * month };
    }
    return { trips: per, tolls: both("toll"), minutesSaved: both("minutesSaved"), fuelExtra: both("fuelExtra"), withBack: !!useBack };
  }

  // ---- Choose a toll road ----
  // Roads a trip could be sent along, by a mainline plaza on that road going the trip's way.
  // Managed and express lanes are left out (Esri can't route on them; they're priced alongside
  // I-10 and SH 288). A road is offered when going through its plaza adds at most `maxExtra`
  // (as a share of the straight-line distance, 30% by default) plus 3 km. Closest first, at most 6.
  var VIA_SKIP = /managed lanes|express lanes/i;
  var DIR_VEC = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
  function viaPlazas(points, from, to, maxExtra) {
    maxExtra = maxExtra == null ? 0.3 : maxExtra;
    var proj = projector((from[1] + to[1]) / 2), a = proj(from[0], from[1]), b = proj(to[0], to[1]);
    var direct = Math.hypot(b[0] - a[0], b[1] - a[1]), go = [b[0] - a[0], b[1] - a[1]];
    var best = {};
    points.forEach(function (p) {
      if (p.kind !== "main" || VIA_SKIP.test(p.road) || p.lon == null) return;
      var v = DIR_VEC[p.dir];
      if (v && v[0] * go[0] + v[1] * go[1] <= 0) return; // the other direction's lanes
      var q = proj(p.lon, p.lat);
      var via = Math.hypot(q[0] - a[0], q[1] - a[1]) + Math.hypot(b[0] - q[0], b[1] - q[1]);
      var extra = via - direct;
      if (extra > direct * maxExtra + 3000) return;
      if (!best[p.road] || extra < best[p.road].extra) best[p.road] = { road: p.road, point: p, extra: extra };
    });
    return Object.keys(best).map(function (k) { return best[k]; }).sort(function (x, y) { return x.extra - y.extra; }).slice(0, 6);
  }

  // ---- TomTom traffic (debug test) ----
  // Points every `every` meters along a route path, with their distance along it.
  function sampleAlong(path, every) {
    if (!path || path.length < 2) return [];
    var proj = projector(path[0][1]), xy = path.map(function (p) { return proj(p[0], p[1]); });
    var out = [], walked = 0, next = every / 2;
    for (var i = 0; i < xy.length - 1; i++) {
      var len = Math.hypot(xy[i + 1][0] - xy[i][0], xy[i + 1][1] - xy[i][1]);
      while (len > 0 && next <= walked + len) {
        var t = (next - walked) / len;
        out.push({ lonlat: [path[i][0] + t * (path[i + 1][0] - path[i][0]), path[i][1] + t * (path[i + 1][1] - path[i][1])], along: next });
        next += every;
      }
      walked += len;
    }
    return out;
  }
  // Where along a route a road segment runs (same direction, within maxDist meters).
  // Returns { from, to } in meters along the route and the segment's points on it, or null.
  function segmentAlong(path, coords, maxDist) {
    if (!path || path.length < 2 || !coords || coords.length < 2) return null;
    maxDist = maxDist || 25;
    var proj = projector(path[0][1]), line = path.map(function (p) { return proj(p[0], p[1]); });
    var hits = [], same = 0, steps = 0;
    for (var i = 0; i < coords.length; i++) {
      var q = proj(coords[i][0], coords[i][1]), n = nearestOnPath(line, q[0], q[1]);
      if (n.dist > maxDist) continue;
      hits.push({ along: n.along, lonlat: coords[i] });
      if (i < coords.length - 1) {
        var r = proj(coords[i + 1][0], coords[i + 1][1]);
        if (Math.hypot(r[0] - q[0], r[1] - q[1]) > 1) { steps++; if (angleDiff(bearing(q[0], q[1], r[0], r[1]), n.heading) < 60) same++; }
      }
    }
    if (hits.length < 2 || (steps && same < steps * 0.6)) return null;
    var a = Math.min.apply(null, hits.map(function (h) { return h.along; })), b = Math.max.apply(null, hits.map(function (h) { return h.along; }));
    if (b - a < 30) return null;
    hits.sort(function (x, y) { return x.along - y.along; });
    return { from: a, to: b, path: hits.map(function (h) { return h.lonlat; }) };
  }
  // Where a point sits along a path: { along (m), total (m), dist (m from the path) }.
  function alongPath(path, pt) {
    if (!path || path.length < 2 || !pt) return null;
    var proj = projector(path[0][1]), line = path.map(function (p) { return proj(p[0], p[1]); }), q = proj(pt[0], pt[1]);
    var n = nearestOnPath(line, q[0], q[1]), total = 0;
    for (var i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    return { along: n.along, total: total, dist: n.dist };
  }
  // Meters from a point to a path.
  function distanceToPath(path, pt) {
    if (!path || path.length < 2 || !pt) return Infinity;
    var proj = projector(path[0][1]), q = proj(pt[0], pt[1]);
    return nearestOnPath(path.map(function (p) { return proj(p[0], p[1]); }), q[0], q[1]).dist;
  }
  // Traffic level from TomTom's current vs free-flow speed on that road (like Google's colors:
  // relative to the road's normal speed, not a fixed mph).
  function relativeLevel(current, freeFlow, closed) {
    if (closed) return "closed";
    if (!(current >= 0) || !(freeFlow > 0)) return null;
    var r = current / freeFlow;
    return r < 0.4 ? "heavy" : r < 0.6 ? "slow" : r < 0.8 ? "moderate" : null;
  }

  // The stretch of a route that runs beside managed lanes, as a fraction of the route, from
  // the first to the last managed-lane toll point it passes (priced items with laneOption).
  function laneRanges(items, routeMeters) {
    var a = (items || []).filter(function (it) { return it.laneOption && it.along != null && routeMeters; })
      .map(function (it) { return it.along / routeMeters; });
    if (!a.length) return [];
    return [[Math.max(0, Math.min.apply(null, a) - 0.01), Math.min(1, Math.max.apply(null, a) + 0.01)]];
  }

  var api = { viaPlazas: viaPlazas, speedFactor: speedFactor, fuelGallons: fuelGallons, fuelDefaults: fuelDefaults, fuelCost: fuelCost, commute: commute, FUEL_PRICES: FUEL_PRICES, alongPath: alongPath, feederRoad: feederRoad, findFeederDetours: findFeederDetours, distanceToPath: distanceToPath, sampleAlong: sampleAlong, segmentAlong: segmentAlong, relativeLevel: relativeLevel, findTollwayHops: findTollwayHops, tollwayAnchors: tollwayAnchors, bypassedPlazas: bypassedPlazas, laneRanges: laneRanges, trafficSegments: trafficSegments, trafficLevel: trafficLevel, stepKind: stepKind, analyzeTrip: analyzeTrip, findCrossings: findCrossings, managedLaneCrossings: managedLaneCrossings, dropSharedWithFree: dropSharedWithFree, rampZonesFromSteps: rampZonesFromSteps, rampZoneInfoFromSteps: rampZoneInfoFromSteps, mentionsRoad: mentionsRoad, zoneDistance: zoneDistance, rateFor: rateFor, price: price, timedRate: timedRate, setSchedules: setSchedules, pathMeters: pathMeters, houstonParts: houstonParts, MATCH_METERS: MATCH_METERS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TollCalc = api;
})(this);
