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
