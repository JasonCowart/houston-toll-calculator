// Tests for js/tolls.js. Run: node tools/test_tolls.js
const assert = require("assert");
const path = require("path");
const T = require(path.join(__dirname, "..", "js", "tolls.js"));
const pts = require(path.join(__dirname, "..", "data", "toll-points.json")).points;
const byId = Object.fromEntries(pts.map((p) => [p.id, p]));

// A straight route through a point, heading north (dLat > 0) or south, etc.
function lineThrough(p, dLon, dLat) {
  return [[p.lon - dLon, p.lat - dLat], [p.lon + dLon, p.lat + dLat]];
}
const ids = (hits) => hits.map((h) => h.point.id);

let passed = 0;
function test(name, fn) { fn(); passed++; console.log("ok -", name); }

// Sam Houston Central Plaza: 163 is northbound (clockwise), 162 southbound.
test("northbound route through Central Plaza picks the northbound plaza only", () => {
  const p = byId[163];
  const hits = ids(T.findCrossings(lineThrough(p, 0, 0.01), pts));
  assert(hits.includes(163), "expected 163, got " + hits);
  assert(!hits.includes(162), "should not include southbound 162");
});
test("southbound route through Central Plaza picks the southbound plaza only", () => {
  const p = byId[162];
  const hits = ids(T.findCrossings(lineThrough(p, 0, -0.01), pts));
  assert(hits.includes(162), "expected 162, got " + hits);
  assert(!hits.includes(163), "should not include northbound 163");
});
test("route 200 m away crosses nothing", () => {
  const p = byId[163];
  const off = { lon: p.lon + 0.002, lat: p.lat };
  assert.deepStrictEqual(ids(T.findCrossings(lineThrough(off, 0, 0.01), [p])), []);
});
test("crossings come back in travel order", () => {
  const a = byId[163], b = byId[158]; // Central Plaza NB, then North Plaza (clockwise = eastbound)
  const route = [[a.lon, a.lat - 0.005], [a.lon, a.lat], [b.lon - 0.005, b.lat], [b.lon, b.lat], [b.lon + 0.005, b.lat]];
  const hits = ids(T.findCrossings(route, [b, a]));
  assert.deepStrictEqual(hits, [163, 158]);
});

// Ramp rule (Jason's Montgomery -> Beltway 8 trip, Oct 21, 2026): driving straight down
// the Tomball Tollway passes ramp gantries at FM 2920, Holderrieth and Boudreaux.
// Only the mainline gantry should count.
const southThrough = (list) => {
  const s = list.map((id) => byId[id]).sort((a, b) => b.lat - a.lat);
  const first = s[0], last = s[s.length - 1];
  return [[first.lon, first.lat + 0.01], ...s.map((p) => [p.lon, p.lat]), [last.lon, last.lat - 0.01]];
};
test("straight through the Tomball Tollway: mainline only, no ramp tolls", () => {
  const route = southThrough([234, 215, 213, 211]);
  const hits = ids(T.findCrossings(route, pts, { rampZones: [] }));
  assert(hits.includes(211), "mainline 211 missing: " + hits);
  [234, 215, 213].forEach((id) => assert(!hits.includes(id), "ramp " + id + " should not count: " + hits));
});
test("a ramp gantry counts inside a ramp zone", () => {
  const route = southThrough([234, 215, 213, 211]);
  const p = byId[215];
  const zone = [[p.lon, p.lat + 0.003], [p.lon, p.lat - 0.003]];
  const hits = ids(T.findCrossings(route, pts, { rampZones: [zone] }));
  assert(hits.includes(215), "215 should count in its zone: " + hits);
  assert(!hits.includes(234) && !hits.includes(213), "other ramps should not: " + hits);
});
test("inside a ramp zone, a gantry 14+ m from the route doesn't count (passed-by ramp)", () => {
  const p = byId[232]; // Hardin Store Rd on-ramp, 14 m from Jason's route
  const off = [p.lon + 14 / 96500, p.lat];
  const route = [[off[0], off[1] + 0.01], off, [off[0], off[1] - 0.01]];
  assert.deepStrictEqual(ids(T.findCrossings(route, [p], { rampZones: [route] })), []);
  const on = [[p.lon, p.lat + 0.01], [p.lon, p.lat], [p.lon, p.lat - 0.01]];
  assert.deepStrictEqual(ids(T.findCrossings(on, [p], { rampZones: [on] })), [232]);
});
test("one ramp zone charges at most one ramp gantry (SH 249 -> Beltway 8 has two)", () => {
  const a = byId[223], b = byId[117];
  const route = [[a.lon - 0.01, a.lat], [a.lon, a.lat], [b.lon, b.lat], [b.lon + 0.01, b.lat]];
  const zone = [[a.lon - 0.005, a.lat], [a.lon, a.lat], [b.lon, b.lat]];
  const hits = T.findCrossings(route, [a, b], { rampZones: [zone], maxHeadingDiff: 180 });
  assert.strictEqual(hits.length, 1, "expected one, got " + ids(hits));
});
test("curving connector ramp still counts (SH 249 -> Beltway 8, gantry tagged West, ramp heading south)", () => {
  const p = byId[223];
  const route = [[p.lon, p.lat + 0.005], [p.lon, p.lat], [p.lon - 0.005, p.lat - 0.002]]; // heading south at the gantry
  const zone = route.slice(0, 2);
  const hits = ids(T.findCrossings(route, [p, byId[117]], { rampZones: [zone] }));
  assert.deepStrictEqual(hits, [223]);
});
test("mainline plazas keep the strict direction check", () => {
  const p = byId[163]; // northbound Central Plaza
  assert.deepStrictEqual(ids(T.findCrossings([[p.lon + 0.005, p.lat], [p.lon - 0.005, p.lat]], [p])), []); // heading west
});
test("without directions, ramp gantries need to be right on the route", () => {
  const p = byId[215];
  const off = { lon: p.lon + 0.0003, lat: p.lat }; // about 29 m east
  assert.deepStrictEqual(ids(T.findCrossings([[off.lon, off.lat + 0.01], [off.lon, off.lat - 0.01]], [p])), []);
  assert.deepStrictEqual(ids(T.findCrossings([[p.lon, p.lat + 0.01], [p.lon, p.lat - 0.01]], [p])), [215]);
});
test("ramp zones: straight-ahead steps are skipped and zones are trimmed", () => {
  const long = [[-95.5, 29.9], [-95.5, 29.8]]; // about 11 km south
  const zones = T.rampZonesFromSteps([
    { maneuverType: "esriDMTStraight", path: long },
    { maneuverType: "esriDMTRampRight", path: long },
  ], 1500);
  assert.strictEqual(zones.length, 1); // explicit 1500 m for the trim check
  const end = zones[0][zones[0].length - 1];
  const km = (29.9 - end[1]) * 111.2;
  assert(Math.abs(km - 1.5) < 0.05, "zone should be 1.5 km, got " + km.toFixed(2));
});

// Katy Freeway (Jason, Oct 21, 2026): the toll route and toll-free route were the same
// free main lanes, 15-19 m from the managed-lane canopies. Nothing should be charged.
test("toll-free route passing as close drops the point (Katy main lanes vs managed lanes)", () => {
  const p = byId[174]; // Eldridge eastbound canopy
  const lane = [[p.lon - 0.01, p.lat + 18 / 111000], [p.lon + 0.01, p.lat + 18 / 111000]]; // 18 m north, heading east
  const hits = T.findCrossings(lane, [p], {});
  assert.deepStrictEqual(ids(hits), [174]);
  const r = T.dropSharedWithFree(hits, lane);
  assert.deepStrictEqual(ids(r.kept), []);
  assert.deepStrictEqual(ids(r.dropped), [174]);
});
test("a ramp the toll route takes survives when the free route runs 25 m away", () => {
  const p = byId[215];
  const tollRoute = [[p.lon, p.lat + 0.01], [p.lon, p.lat], [p.lon, p.lat - 0.01]];
  const hits = T.findCrossings(tollRoute, [p], { rampZones: [tollRoute] });
  const frontage = tollRoute.map(([x, y]) => [x + 25 / 96500, y]);
  assert.deepStrictEqual(ids(T.dropSharedWithFree(hits, frontage).kept), [215]);
});
test("routes that split up keep every toll", () => {
  const p = byId[163];
  const hits = T.findCrossings([[p.lon, p.lat - 0.01], [p.lon, p.lat + 0.01]], [p]);
  const far = [[p.lon + 0.05, p.lat - 0.01], [p.lon + 0.05, p.lat + 0.01]];
  assert.deepStrictEqual(ids(T.dropSharedWithFree(hits, far).kept), [163]);
});

// Pricing
test("2-axle EZ TAG / TAG / no tag at a main plaza", () => {
  const c = [{ point: byId[163] }];
  assert.strictEqual(T.price(c, 2, "eztag").total, 1.35);
  assert.strictEqual(T.price(c, 2, "tag").total, 1.5);
  assert.strictEqual(T.price(c, 2, "notag").total, 1.8);
});
test("5-axle tag at a main plaza matches the published $7.00", () => {
  assert.strictEqual(T.price([{ point: byId[163] }], 5, "eztag").total, 7);
});
test("Ship Channel (Tapia) Bridge charges trucks more", () => {
  assert.strictEqual(T.price([{ point: byId[160] }], 3, "eztag").total, 4);
});
test("3-axle no-TAG fix applied at W. Lake Houston", () => {
  assert.strictEqual(T.price([{ point: byId[193] }], 3, "notag").total, 3);
});
test("Katy plazas are flagged pending, not priced", () => {
  const r = T.price([{ point: byId[174] }], 2, "eztag");
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.pending.length, 1);
});
test("non-HCTRA points count as unverified", () => {
  const p = pts.find((x) => x.status === "unverified" && x.ez2 != null);
  assert.strictEqual(T.price([{ point: p }], 2, "eztag").unverified, 1);
});
test("data sanity: every non-pending point has a 2-axle rate and coordinates in Texas", () => {
  pts.forEach((p) => {
    assert(p.lon > -99 && p.lon < -93 && p.lat > 28 && p.lat < 32, "bad coords " + p.id);
    if (p.status !== "pending") assert(p.ez2 > 0 && p.notag[0] > 0, "missing 2-axle rate " + p.id);
  });
});

// How close is the nearest opposite-direction twin for each HCTRA mainline plaza?
const twins = pts.filter((p) => p.status === "verified" && p.kind === "main");
let minGap = Infinity;
twins.forEach((a) => twins.forEach((b) => {
  if (a.id >= b.id || a.dir === b.dir || a.road !== b.road) return;
  const dx = (a.lon - b.lon) * 96500, dy = (a.lat - b.lat) * 111000;
  minGap = Math.min(minGap, Math.hypot(dx, dy));
}));
console.log("closest opposite-direction plaza pair: " + minGap.toFixed(0) + " m");
console.log(passed + " tests passed");
