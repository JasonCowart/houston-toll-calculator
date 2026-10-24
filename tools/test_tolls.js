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

// Katy corridor (Jason, Oct 21, 2026): Esri has no drivable line for the managed lanes; the
// route runs on the main lanes 15-45 m from the canopies. The toll route should include them.
test("managed lanes alongside an eastbound I-10 route are included, westbound ones are not", () => {
  const e1 = byId[174], e2 = byId[178], e3 = byId[176];
  const off = (p, m) => [p.lon, p.lat + m / 111000];
  const route = [[e1.lon - 0.01, e1.lat + 40 / 111000], off(e1, 40), off(e2, 18), off(e3, 15), [e3.lon + 0.01, e3.lat + 15 / 111000]];
  const hits = T.managedLaneCrossings(route, pts);
  assert.deepStrictEqual(ids(hits), [174, 178, 176]);
  assert(hits.every((h) => h.laneOption));
  const westbound = route.slice().reverse();
  assert.deepStrictEqual(ids(T.managedLaneCrossings(westbound, pts)).filter((id) => [174, 178, 176].includes(id)), []);
});
test("managed-lane tolls price by time and count as lane options", () => {
  const c = T.managedLaneCrossings([[byId[174].lon - 0.01, byId[174].lat], [byId[174].lon + 0.01, byId[174].lat]], [byId[174]]);
  const r = T.price(c, 2, "eztag", { departure: new Date("2026-10-21T13:00:00Z") }); // Wed 8:00 AM
  assert.strictEqual(r.total, 2.6);
  assert.strictEqual(r.laneOptions, 1);
});

// Road rule (Jason, Oct 21, 2026, 5:42 PM): on the Hufsmith route the toll route turns onto
// SH 249 and merges onto the Tomball Tollway through a free ramp, passing the FM 2920 *exit*
// gantry (234) 15 m away. An exit gantry needs the route to have been on its toll road.
test("road rule: merging onto the Tomball Tollway doesn't charge the FM 2920 exit gantry beside it", () => {
  const a = byId[234];
  const near = [a.lon + 15 / 96500, a.lat];
  const before = [[near[0], near[1] + 0.02], [near[0], near[1] + 0.01]];
  const merge = [[near[0], near[1] + 0.01], near, [near[0], near[1] - 0.01]];
  const steps = [
    { maneuverType: "esriDMTTurnLeft", text: "At the traffic light, turn left on State Highway 249 (TX-249)", path: before },
    { maneuverType: "esriDMTRampLeft", text: "Keep left to merge onto Tomball Pkwy (Tomball Tollway S)", path: merge },
  ];
  const zones = T.rampZoneInfoFromSteps(steps);
  assert.deepStrictEqual(ids(T.findCrossings(before.concat(merge), [a], { rampZones: zones })), []);
});
test("road rule: an entry gantry counts when the step gets onto its road, even 15 m off Esri's line", () => {
  const p = byId[232]; // Hardin Store Rd southbound entrance, Tomball Tollway (MCTRA)
  const near = [p.lon + 15 / 96500, p.lat];
  const merge = [[near[0], near[1] + 0.01], near, [near[0], near[1] - 0.01]];
  const steps = [
    { maneuverType: "esriDMTTurnLeft", text: "Turn left on State Highway 249 (TX-249)", path: [[near[0], near[1] + 0.02], merge[0]] },
    { maneuverType: "esriDMTRampLeft", text: "Bear left to merge onto Tomball Pkwy (Tomball Tollway S)", path: merge },
  ];
  const hits = T.findCrossings(merge, [p], { rampZones: T.rampZoneInfoFromSteps(steps) });
  assert.deepStrictEqual(ids(hits), [232]);
  assert(/entering Tomball Tollway/.test(hits[0].rule));
});
test("road rule: 'take the exit on the right' isn't read as a road name", () => {
  const z = T.rampZoneInfoFromSteps([
    { maneuverType: "esriDMTForkRight", text: "Keep right at the fork to merge onto Sam Houston Tollway N", path: [[0, 0], [0, 1]] },
    { maneuverType: "esriDMTRampRight", text: "Take the exit on the right to TX-249 N", path: [[0, 1], [0, 2]] },
    { maneuverType: "esriDMTForkLeft", text: "Keep left at the fork toward TX-249 N / EZTAG", path: [[0, 2], [0, 3]] },
  ]);
  assert(T.mentionsRoad(z[2].prev, "Sam Houston"), "look-back should reach the Sam Houston step: " + z[2].prev);
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
// Time-of-day pricing. Times are Houston clock times (CDT = UTC-5 in October; CST = UTC-6 in Nov-Mar).
T.setSchedules({ sh288: require(path.join(__dirname, "..", "data", "sh288-rates.json")) });
const at = (iso) => new Date(iso);
const timed = (id, axles, pay, iso, opts) => T.timedRate(byId[id], axles, pay, at(iso), opts);
test("Katy: Eldridge eastbound, Wed 7:30 AM peak = $3.20; Wirt/Wilcrest = $1.90", () => {
  assert.strictEqual(timed(174, 2, "eztag", "2026-10-21T12:30:00Z").rate, 3.2);
  assert.strictEqual(timed(176, 2, "eztag", "2026-10-21T12:30:00Z").rate, 1.9);
});
test("Katy: westbound Wilcrest Fri 5 PM = $1.90; Saturday = $0.30; Eldridge off-peak = $0.40", () => {
  assert.strictEqual(timed(179, 2, "eztag", "2026-10-23T22:00:00Z").rate, 1.9);
  assert.strictEqual(timed(179, 2, "eztag", "2026-10-24T22:00:00Z").rate, 0.3);
  assert.strictEqual(timed(175, 2, "eztag", "2026-10-21T15:00:00Z").rate, 0.4);
});
test("Katy: trucks $7.00 any time; no tag +25%; carpool free only in HOV hours", () => {
  assert.strictEqual(timed(174, 5, "eztag", "2026-10-24T03:00:00Z").rate, 7);
  assert.strictEqual(timed(174, 2, "notag", "2026-10-21T12:30:00Z").rate, 4);
  assert.strictEqual(timed(174, 2, "eztag", "2026-10-21T12:30:00Z", { carpool: true }).rate, 0);
  assert.strictEqual(timed(174, 2, "eztag", "2026-10-22T02:00:00Z", { carpool: true }).rate, 0.4); // 9 PM
});
test("SH 288: Holly Hall NB Mon 7:00 AM = $8.76; 5 axles x4; no tag x1.5", () => {
  assert.strictEqual(timed(308, 2, "eztag", "2026-10-19T12:00:00Z").rate, 8.76);
  assert.strictEqual(timed(308, 5, "eztag", "2026-10-19T12:00:00Z").rate, 35.04);
  assert.strictEqual(timed(308, 2, "notag", "2026-10-19T12:00:00Z").rate, 13.14);
});
test("SH 288: half-hour slots, weekends and holidays (Thanksgiving 2026 = Nov 26)", () => {
  assert.strictEqual(timed(311, 2, "eztag", "2026-10-19T12:29:00Z").rate, 3.26); // 7:29 AM Mon
  assert.strictEqual(timed(311, 2, "eztag", "2026-10-24T12:00:00Z").rate, 1.05); // 7:00 AM Sat
  assert.strictEqual(timed(311, 2, "eztag", "2026-11-26T13:00:00Z").rate, 1.46); // 7:00 AM CST Thanksgiving
  assert.strictEqual(timed(299, 2, "eztag", "2026-10-21T08:00:00Z").rate, 3.02); // BW 8 connector, flat
});
test("time-of-day tolls are priced when the car reaches the gantry, not at departure", () => {
  // Leave Mon 6:45 AM on a 30-minute route; Brays NB sits halfway, so it's passed at 7:00 AM.
  const c = [{ point: byId[311], along: 5000 }];
  const r = T.price(c, 2, "eztag", { departure: at("2026-10-19T11:45:00Z"), routeMeters: 10000, routeMinutes: 30 });
  assert.strictEqual(r.total, 3.26);
  assert.strictEqual(r.timed, 1);
});
test("non-HCTRA points count as unverified", () => {
  const p = pts.find((x) => x.status === "unverified" && x.ez2 != null);
  assert.strictEqual(T.price([{ point: p }], 2, "eztag").unverified, 1);
});
test("data sanity: every point has a 2-axle rate (or a time-of-day schedule) and coordinates in Texas", () => {
  pts.forEach((p) => {
    assert(p.lon > -99 && p.lon < -93 && p.lat > 28 && p.lat < 32, "bad coords " + p.id);
    if (p.status === "timed") {
      for (const ax of [2, 5]) for (const pay of ["eztag", "notag"]) {
        const r = T.timedRate(p, ax, pay, new Date("2026-10-21T13:00:00Z"));
        assert(r && r.rate > 0, "no time-of-day rate for " + p.id + " " + p.schedule);
      }
    } else assert(p.ez2 > 0 && p.notag[0] > 0, "missing 2-axle rate " + p.id);
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

test("Beltway 8 frontage roads don't count as the Sam Houston Tollway", () => {
  assert(!T.mentionsRoad("turn right onto n sam houston pkwy w", "Sam Houston"), "frontage name matched");
  assert(!T.mentionsRoad("continue on sam houston parkway", "Sam Houston"), "frontage name matched");
  assert(!T.mentionsRoad("turn left onto tomball pkwy", "Tomball Tollway"), "Tomball Pkwy matched");
  assert(T.mentionsRoad("keep right at the fork to merge onto sam houston tollway n", "Sam Houston"), "tollway not matched");
  assert(T.mentionsRoad("take the exit on the right to tx-8 beltway n / sam houston tollway", "Sam Houston"), "tollway not matched");
});

test("traffic levels from step speeds: freeways only, frontage roads skipped", () => {
  const segs = T.trafficSegments([
    { text: "Start at Location 1", time: 0, length: 0 },
    { text: "Keep left to merge onto I-10 E", time: 5.6, length: 3.6 },          // 38 mph
    { text: "Continue on Katy Fwy", time: 2.0, length: 2.0 },                    // 60 mph
    { text: "Take exit 764 to Washington Ave", time: 0.8, length: 0.27 },        // street-ish, not judged
    { text: "Continue on Katy Fwy Frtg Rd", time: 3, length: 0.5 },              // frontage: skipped
    { text: "Merge onto Sam Houston Tollway N", time: 6, length: 2 },            // 20 mph
    { text: "Keep left on I-10 E", time: 1.4, length: 1.1 },                     // 47 mph
  ]);
  assert(segs.length === 6, "steps with length: " + segs.length);
  assert(segs[0].level === "slow", "38 mph freeway = slow: " + segs[0].level);
  assert(segs[1].level === null, "60 mph = moving");
  assert(segs[2].level === null, "street not judged");
  assert(segs[3].level === null && !segs[3].highway, "frontage skipped");
  assert(segs[4].level === "heavy", "20 mph = heavy");
  assert(segs[5].level === "moderate", "47 mph = moderate");
  assert(Math.abs(segs[5].to - 1) < 1e-9 && segs[0].from === 0, "fractions run 0 to 1");
});

test("exit ramps and the feeder road after them aren't graded as freeway", () => {
  const segs = T.trafficSegments([
    { text: "Keep left at the fork to merge onto US-290 E toward Downtown", time: 6, length: 6 },  // 60+ mph
    { text: "Take the exit on the right toward W Tidwell Rd / Hollister Rd", time: 1.2, length: 0.6 }, // exit ramp
    { text: "Continue forward on Northwest Fwy", time: 2.4, length: 1.0 },  // feeder, named after the freeway
    { text: "Keep left to merge onto US-290 E", time: 3, length: 3 },       // back on the main lanes
    { text: "Continue forward on Northwest Fwy", time: 2, length: 1.0 },    // main lanes, 30 mph
  ]);
  assert(!segs[1].highway && !segs[2].highway, "exit and feeder skipped");
  assert(segs[2].level === null, "feeder not colored");
  assert(segs[3].level === null, "main lanes moving");
  assert(segs[4].highway && segs[4].level === "slow", "a continue on the main lanes is still graded");
});

test("the entrance ramp's slow curve doesn't color a moving tollway", () => {
  // 1.5 mi in 1.75 min = 51 mph overall, but the first 0.3 mi is the ramp (58 mph after it).
  const segs = T.trafficSegments([{ text: "Take the ramp on the right and go on TX-249 Tollway N", time: 1.75, length: 1.5 }]);
  assert(segs[0].highway && segs[0].level === null, "ramp-start step colored " + segs[0].level + " at " + segs[0].mph.toFixed(0));
  const short = T.trafficSegments([{ text: "Keep left to merge onto I-10 E", time: 1, length: 0.5 }]);
  assert(short[0].level === null, "short merge step not judged");
});

test("no traffic color on a long stretch: one average over many miles hides where it's slow", () => {
  // Hardy Toll Rd at evening rush: Esri's one step is 21.4 mi at 47 mph; Google showed it moving except near Beltway 8.
  const segs = T.trafficSegments([{ text: "Go forward on Hardy Toll Rd N", time: 27.07, length: 21.39 },
    { text: "Take exit 60D on the right to merge onto TX-8 Beltway E", time: 6.69, length: 2.44 }]);
  assert(segs[0].coarse && segs[0].level === null, "21 mi step not colored");
  assert(!segs[1].coarse && segs[1].level === "heavy", "2.4 mi step at 22 mph still colored");
});

test("no traffic colors where the route runs beside managed lanes", () => {
  const steps = [
    { text: "Keep left to merge onto I-10 E", time: 4, length: 2 },   // 30 mph, before the lanes
    { text: "Keep left to merge onto I-10 E", time: 8, length: 4 },   // 30 mph, beside the lanes
    { text: "Keep left to merge onto I-10 E", time: 4, length: 2 },   // 30 mph, after
  ];
  const skip = T.laneRanges([{ laneOption: true, along: 2800 }, { laneOption: true, along: 5200 }, { laneOption: false, along: 7000 }], 8000);
  const segs = T.trafficSegments(steps, skip);
  assert(segs[0].level === "slow" && segs[2].level === "slow", "outside the lanes still colored");
  assert(segs[1].level === null && segs[1].skipped, "beside the lanes not colored");
  assert(T.laneRanges([], 1000).length === 0, "no lanes, no range");
});

test("spots evening-rush hops off the Sam Houston Tollway: Little York to Gulf Bank, and the Gessner ramp weave", () => {
  const t = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "tests", "trips", "2026-10-22-1751-bw8-nb-little-york-hop.json"), "utf8"));
  const hops = T.findTollwayHops(t.toll.steps);
  assert(hops.length === 2 && hops.every((h) => h.road === "Sam Houston"), "two Sam Houston hops: " + JSON.stringify(hops.map((h) => h.via)));
  assert(/Little York/.test(hops[0].via), "barrier on Little York: " + hops[0].via);
  assert(hops[0].miles > 2.5 && hops[0].miles < 3.5, "about 3 miles off the tollway: " + hops[0].miles);
  // The short weave through the Gessner exit ramp (pays the $1.08 ramp toll) and back on.
  assert(/Sam Houston Pkwy/.test(hops[1].via) && hops[1].miles < 1, "Gessner frontage weave: " + hops[1].via);
});

test("routing points that keep a traffic route on the tollway sit on the tollway's own line", () => {
  const fs = require("fs"), path = require("path"), dir = path.join(__dirname, "..", "tests", "trips");
  const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const calm = load("2026-10-22-1031-bw8-sb-stays-on-tollway.json");            // stays on: stands in for the no-traffic route
  const hopper = load("2026-10-22-0924-bw8-sb-frontage-clay-rd-reentry.json");   // left at Clay Rd, back on further south
  const hops = T.findTollwayHops(hopper.toll.steps);
  const a = T.tollwayAnchors(calm.toll.steps, hopper.toll.steps, hops);
  assert(a.length >= 1 && a.every((x) => x.road === "Sam Houston"), "anchors on the Sam Houston Tollway: " + JSON.stringify(a));
  const onCalm = calm.toll.path.some((p) => p[0] === a[0].lonlat[0] && p[1] === a[0].lonlat[1]);
  assert(onCalm, "anchor is a vertex of the calm route's tollway line");
  // Within the stretch the traffic route skipped: between where it left and got back on.
  const lat = a[0].lonlat[1], left = hopper.toll.steps[hops[0].fromStep - 1].path.slice(-1)[0][1], back = hopper.toll.steps[hops[0].toStep].path[0][1];
  assert(lat < left && lat > back, "anchor between exit (" + left + ") and re-entry (" + back + "): " + lat);
  assert(T.tollwayAnchors(calm.toll.steps, hopper.toll.steps, []).length === 0, "no hops, no anchors");
  // The calm route must run the same way: a northbound route gives no points for a southbound hop.
  const nb = load("2026-10-22-1751-bw8-nb-little-york-hop.json");
  assert(T.tollwayAnchors(nb.toll.steps, hopper.toll.steps, hops).length === 0, "opposite direction gives no anchors");
});

test("spots a toll route that skips a mainline plaza on the frontage road", () => {
  const points = require(require("path").join(__dirname, "..", "data", "toll-points.json")).points;
  const t = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "tests", "trips", "2026-10-22-0853-bw8-sb-frontage-around-central-plaza.json"), "utf8"));
  const r = T.analyzeTrip({ tollPath: t.toll.path, freePath: t.free.path, steps: t.toll.steps, departure: t.input.departure,
    routeMinutes: t.toll.minutes, axles: 2, payment: "eztag" }, points);
  const b = T.bypassedPlazas(t.toll.path, points, r.crossings);
  assert(b.length === 1 && b[0].point.id === 162, "Central Plaza southbound bypassed: " + b.map((x) => x.point.id));
  // Trips that stay on the tollway report nothing.
  for (const f of ["2026-10-21-1855-westpark-eastbound-to-sam-houston.json", "2026-10-21-1902-grand-parkway-tomball-to-new-caney.json", "2026-10-22-0510-sam-houston-to-montgomery-past-west-rd.json"]) {
    const u = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "tests", "trips", f), "utf8"));
    const ru = T.analyzeTrip({ tollPath: u.toll.path, freePath: u.free.path, steps: u.toll.steps, departure: u.input.departure, routeMinutes: u.toll.minutes, axles: 2, payment: "eztag" }, points);
    assert(T.bypassedPlazas(u.toll.path, points, ru.crossings).length === 0, "no bypass expected in " + f);
  }
});

test("finds toll routes that leave a tollway and get back on", () => {
  const fs = require("fs"), path = require("path"), dir = path.join(__dirname, "..", "tests", "trips");
  const hopTrip = JSON.parse(fs.readFileSync(path.join(dir, "2026-10-22-0853-bw8-sb-frontage-around-central-plaza.json"), "utf8"));
  const hops = T.findTollwayHops(hopTrip.toll.steps);
  assert(hops.length === 2 && hops.every((h) => h.road === "Sam Houston"), "two Sam Houston frontage detours: " + JSON.stringify(hops.map((h) => h.via)));
  assert(hops[0].barrier[1] > 29.85 && hops[0].barrier[1] < 29.91, "first barrier on the frontage road by Central Plaza");
  // Connector ramps between toll roads (SH 249 to Sam Houston) and ordinary trips aren't hops.
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !/frontage-|-hop\.json$/.test(f))) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert(T.findTollwayHops(t.toll.steps).length === 0, "no hop expected in " + f);
  }
});

test("TomTom road segments line up with the route they run along, same direction only", () => {
  const path = [[-95.60, 29.70], [-95.55, 29.70], [-95.50, 29.70]];   // eastbound, about 9.7 km
  const pts = T.sampleAlong(path, 1000);
  assert(pts.length === 10 && Math.abs(pts[0].along - 500) < 1, "a point every 1 km starting at 500 m: " + pts.length);
  const east = T.segmentAlong(path, [[-95.58, 29.70005], [-95.57, 29.70005], [-95.56, 29.70005]]);
  assert(east && east.from > 1800 && east.to < 4100 && east.to - east.from > 1800, "eastbound segment matched: " + JSON.stringify(east && [east.from, east.to]));
  assert(T.segmentAlong(path, [[-95.56, 29.70005], [-95.57, 29.70005], [-95.58, 29.70005]]) === null, "westbound (other side of the road) not matched");
  assert(T.segmentAlong(path, [[-95.58, 29.7012], [-95.56, 29.7012]]) === null, "a road 130 m away not matched");
  assert(T.relativeLevel(20, 60) === "heavy" && T.relativeLevel(30, 60) === "slow" && T.relativeLevel(42, 60) === "moderate" && T.relativeLevel(55, 60) === null, "levels by share of free-flow speed");
  assert(T.relativeLevel(0, 60, true) === "closed", "closed road");
  assert(Math.abs(T.distanceToPath(path, [-95.57, 29.7003]) - 33) < 2, "point 33 m off the route: " + T.distanceToPath(path, [-95.57, 29.7003]));
});

test("spots a toll-free route that leaves the Beltway 8 feeder road for side streets and comes back", () => {
  const fs = require("fs"), path = require("path"), dir = path.join(__dirname, "..", "tests", "trips");
  const t = JSON.parse(fs.readFileSync(path.join(dir, "2026-10-23-1103-bw8-east-free-route-leaves-feeder.json"), "utf8"));
  const d = T.findFeederDetours(t.free.steps);
  assert(d.length === 1 && d[0].road === "Sam Houston Pkwy", "one feeder detour: " + JSON.stringify(d.map((x) => x.via)));
  assert(d[0].via.length === 2 && /King/.test(d[0].via[0]) && /Tidwell/.test(d[0].via[1]), "via C.E. King and Tidwell: " + d[0].via);
  assert(d[0].barrier[1] < 29.89 && d[0].barrier[1] > 29.85, "barrier on C.E. King, away from the Beltway");
  assert(T.feederRoad("Keep left at the fork onto N Sam Houston Pkwy E") === "Sam Houston Pkwy" && T.feederRoad("Go on TX-8 Beltway E (Sam Houston Tollway)") === null, "feeder names");
  // No other saved trip's toll-free route does this.
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !/leaves-feeder/.test(f))) {
    const x = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    assert(T.findFeederDetours(x.free && x.free.steps).length === 0, "no feeder detour expected in " + f);
  }
});

test("fuel cost and commute totals", () => {
  assert(T.fuelCost(47.3, 25, 3.76) === 7.11, "47.3 mi at 25 mpg, $3.76: " + T.fuelCost(47.3, 25, 3.76));
  assert(T.fuelCost(0, 25, 3.76) === null && T.fuelCost(10, 0, 3.76) === null, "no miles or mpg, no estimate");
  const d2 = T.fuelDefaults(2), d5 = T.fuelDefaults(5);
  assert(d2.fuel === "regular" && d2.mpg === 25 && d5.fuel === "diesel" && d5.price === T.FUEL_PRICES.diesel, "defaults by axles");
  const c = T.commute({ toll: 4.63, minutesSaved: 7, fuelExtra: 0.6 }, 5, true);
  assert(c.trips === 10 && Math.abs(c.tolls.week - 46.3) < 1e-9, "10 trips a week, $46.30: " + c.tolls.week);
  assert(Math.abs(c.tolls.month - 46.3 * 52 / 12) < 1e-9 && Math.abs(c.minutesSaved.week - 70) < 1e-9, "month = 52/12 weeks; 70 min saved a week");
  assert(T.commute({ toll: 2, minutesSaved: null, fuelExtra: null }, 3, false).minutesSaved === null, "missing values stay missing");
});

test("commute with the trip back priced for its own time", () => {
  const there = { toll: 2.43, minutesSaved: 6, fuelExtra: 0.3 }, back = { toll: 3.78, minutesSaved: 18, fuelExtra: -0.1 };
  const c = T.commute(there, 5, true, back);
  assert(c.withBack && c.trips === 10, "10 trips, using the trip back");
  assert(Math.abs(c.tolls.week - (2.43 + 3.78) * 5) < 1e-9, "tolls: (there + back) x 5 days: " + c.tolls.week);
  assert(Math.abs(c.minutesSaved.week - 120) < 1e-9 && Math.abs(c.fuelExtra.week - 1) < 1e-9, "time and gas add both ways");
  const one = T.commute(there, 5, false, back);
  assert(!one.withBack && Math.abs(one.tolls.week - 2.43 * 5) < 1e-9, "one-way ignores the trip back");
  const gap = T.commute({ toll: 2, minutesSaved: null, fuelExtra: null }, 1, true, { toll: 1, minutesSaved: 5, fuelExtra: null });
  assert(gap.minutesSaved.week === 5 && gap.fuelExtra === null, "a value missing one way counts as 0; missing both ways stays missing");
});

test("gas counts slow traffic: stop-and-go burns more per mile than a steady tollway", () => {
  assert(T.speedFactor(50) > 1 && T.speedFactor(10) < 0.55 && T.speedFactor(25) < 0.8 && T.speedFactor(75) < 0.95, "mileage by speed");
  // Same 10 miles at 25 mpg: steady 55 mph vs crawling at 12 mph.
  const steady = T.fuelGallons([{ length: 10, time: 10.9 }], 10, 10.9, 25), crawl = T.fuelGallons([{ length: 10, time: 50 }], 10, 50, 25);
  assert(steady < 0.4 && crawl > 0.7, "steady " + steady.toFixed(2) + " gal, crawl " + crawl.toFixed(2) + " gal");
  // A longer tollway trip can use less gas than a shorter stop-and-go one.
  const toll = T.fuelGallons([{ length: 42, time: 46 }], 42, 46, 25), free = T.fuelGallons([{ length: 37.5, time: 90 }], 37.5, 90, 25);
  assert(toll < free, "42 mi at 55 mph (" + toll.toFixed(2) + ") < 37.5 mi at 25 mph (" + free.toFixed(2) + ")");
  assert(T.fuelGallons(null, 20, 20, 25) > 0 && T.fuelGallons([], 0, 0, 25) === null, "without steps: whole route at its average speed");
});


test("choose a toll road: plazas going the trip's way, near enough to the trip", () => {
  const pts = require("../data/toll-points.json").points;
  // Katy-area (Westpark & Hwy 6) to the Galleria: heading east.
  const opts = T.viaPlazas(pts, [-95.6435, 29.7105], [-95.4614, 29.7398]);
  const roads = opts.map(o => o.road);
  assert(roads.includes("Westpark Tollway"), "Westpark is offered: " + roads.join(", "));
  const wp = opts.find(o => o.road === "Westpark Tollway").point;
  assert(wp.dir === "E", "eastbound plaza for an eastbound trip, got " + wp.dir);
  assert(!roads.some(r => /Managed|Express/.test(r)), "managed and express lanes aren't offered");
  assert(!roads.includes("Hardy Toll Rd") && !roads.includes("SH 130"), "far-off roads aren't offered: " + roads.join(", "));
  // IAH to Hobby, heading south: the Hardy plaza offered is southbound.
  const h = T.viaPlazas(pts, [-95.3414, 29.9902], [-95.2789, 29.6454]).find(o => o.road === "Hardy Toll Rd");
  assert(h && h.point.dir === "S", "southbound Hardy plaza");
});

test("a stop on the trip isn't a tollway hop", () => {
  const step = (text, len, type) => ({ text, length: len, maneuverType: type || "esriDMTStraight", path: [[-95.5, 29.7], [-95.49, 29.7]] });
  const hop = [step("Go east on Westpark Tollway", 2), step("Take the exit toward Fondren Rd", 0.3, "esriDMTRampRight"),
    step("Turn right on Fondren Rd", 0.6, "esriDMTTurnRight"), step("Turn left to merge onto Westpark Tollway", 0.3, "esriDMTRampLeft"), step("Continue on Westpark Tollway", 3)];
  assert(T.findTollwayHops(hop).length === 1, "off and back on is a hop");
  const visit = hop.slice(0, 3).concat([step("Arrive at Stop 2", 0, "esriDMTStop"), step("Depart Stop 2", 0.4, "esriDMTDepart")], hop.slice(3));
  assert(T.findTollwayHops(visit).length === 0, "off to a stop and back on is not a hop");
});

test("Google Maps points: stops, then each toll on the route line, at most 9", () => {
  const path = []; for (let i = 0; i <= 100; i++) path.push([-95.6 + i * 0.002, 29.8]); // a straight road, about 19 km
  const tolls = [[-95.58, 29.8003], [-95.55, 29.7998], [-95.52, 29.8002]]; // a few meters off the line
  const w = T.googleWaypoints(path, tolls, [], 9);
  assert(w.length === 4 && Math.abs(w[0][1] - 29.8) < 1e-6 && Math.abs(w[0][0] + 95.58) < 1e-4 && Math.abs(w[2][0] + 95.52) < 1e-4,
    "each toll, moved onto the route line: " + JSON.stringify(w));
  assert(w[3][0] > -95.45, "plus a point in the long toll-free stretch at the end (5/6 of the way): " + JSON.stringify(w[3]));
  const many = []; for (let i = 0; i < 20; i++) many.push([-95.598 + i * 0.009, 29.8]);
  const six = [[-95.59, 29.8], [-95.57, 29.8], [-95.55, 29.8], [-95.53, 29.8], [-95.51, 29.8], [-95.49, 29.8]];
  const w2 = T.googleWaypoints(path, many, six, 9);
  assert(w2.length === 9, "6 stops + 3 tolls = 9, got " + w2.length);
  six.forEach(s => assert(w2.some(p => Math.abs(p[0] - s[0]) < 1e-9), "every stop is kept"));
  assert(w2.every((p, i) => i === 0 || p[0] >= w2[i - 1][0]), "in route order");
  const free = T.googleWaypoints(path, [], [], 9);
  assert(free.length === 3, "no tolls: 3 points along the route, got " + free.length);
});

test("Beltway 8 to Westpark connector ('turn right to Rogerdale Rd') isn't a hop", () => {
  const step = (text, len, type) => ({ text, length: len, maneuverType: type || "esriDMTStraight", path: [[-95.55, 29.72], [-95.551, 29.72]] });
  const steps = [step("Take the exit on the left to merge onto N Beltway 8 W / Sam Houston Tollway W", 16.3, "esriDMTRampLeft"),
    step("Take the exit on the right to merge onto Westpark Tollway W", 0.55, "esriDMTRampRight"),
    step("Turn right to Rogerdale Rd", 0.08, "esriDMTTurnRight"),
    step("Keep left at the fork to Westpark Tollway W", 0.09, "esriDMTForkLeft"),
    step("Merge onto Westpark Tollway W", 4.7)];
  assert(T.findTollwayHops(steps).length === 0, "connector wording is not a hop");
  const path = [[-95.6, 29.8], [-95.5, 29.8]], near = [[-95.6, 29.8005], [-95.5, 29.8005]], other = [[-95.6, 29.8], [-95.55, 29.81], [-95.5, 29.8]];
  assert(!T.pathsDiffer(path, near, 150) && T.pathsDiffer(path, other, 150), "routes 55 m apart are the same; 1 km apart differ");
});

console.log(passed + " tests passed");
