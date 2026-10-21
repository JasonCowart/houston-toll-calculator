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

  /**
   * Find the toll points a route crosses, in travel order.
   * @param {Array<[number, number]>} lonLatPath route vertices
   * @param {Array<object>} points toll points from data/toll-points.json
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
    var path = lonLatPath.map(function (p) { return proj(p[0], p[1]); });
    var pad = 0.002; // about 200 m, a cheap bounding-box filter

    var hits = [];
    points.forEach(function (pt) {
      if (pt.lon < minLon - pad || pt.lon > maxLon + pad || pt.lat < minLat - pad || pt.lat > maxLat + pad) return;
      var xy = proj(pt.lon, pt.lat);
      var near = nearestOnPath(path, xy[0], xy[1]);
      if (near.dist > maxDist) return;
      if (pt.dir && DIR_BEARING[pt.dir] !== undefined && angleDiff(near.heading, DIR_BEARING[pt.dir]) > maxTurn) return;
      hits.push({ point: pt, along: near.along, offset: near.dist });
    });
    hits.sort(function (a, b) { return a.along - b.along; });
    return hits;
  }

  /**
   * Rate for one toll point.
   * @param {object} pt toll point
   * @param {number} axles 2..8
   * @param {"eztag"|"tag"|"notag"} payment
   * @returns {number|null} null when the layer has no rate for this case
   */
  function rateFor(pt, axles, payment) {
    if (payment === "notag") return pt.notag[axles - 2];
    if (axles === 2) return payment === "eztag" ? pt.ez2 : pt.tag2;
    return pt.tag[axles - 3];
  }

  /** Price a list of crossings. */
  function price(crossings, axles, payment) {
    var total = 0, items = [], missing = [], pending = [], unverified = 0;
    crossings.forEach(function (c) {
      var pt = c.point;
      if (pt.status === "pending") { pending.push(pt); items.push({ point: pt, rate: null }); return; }
      var rate = rateFor(pt, axles, payment);
      if (rate === null || rate === undefined) { missing.push(pt); items.push({ point: pt, rate: null }); return; }
      if (pt.status === "unverified") unverified++;
      total += rate;
      items.push({ point: pt, rate: rate });
    });
    return {
      total: Math.round(total * 100) / 100,
      items: items,
      missing: missing,
      pending: pending,
      unverified: unverified,
    };
  }

  var api = { findCrossings: findCrossings, rateFor: rateFor, price: price, MATCH_METERS: MATCH_METERS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TollCalc = api;
})(this);
