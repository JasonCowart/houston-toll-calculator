// Replays real trips saved from the site's debug view ("Save trip for testing")
// through the same toll calculation the site runs (TollCalc.analyzeTrip).
//
// Files: tests/trips/*.json. A trip with an "expected" block is a test:
//   "expected": { "total": 4.63, "ids": [314, 237, 211, 223], "note": "confirmed by Jason, Oct 21, 2026" }
// "ids" is optional: the toll points that should be charged, in any order.
// Trips without "expected" are listed with their current result but don't fail.
//
// Run: node tools/test_trips.js
const fs = require("fs");
const path = require("path");
const T = require(path.join(__dirname, "..", "js", "tolls.js"));
const points = require(path.join(__dirname, "..", "data", "toll-points.json")).points;
T.setSchedules({ sh288: require(path.join(__dirname, "..", "data", "sh288-rates.json")) });

const dir = path.join(__dirname, "..", "tests", "trips");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
let failed = 0, passed = 0, unconfirmed = 0;


function check(label, trip, expected) {
  const r = T.analyzeTrip(trip, points).priced;
  const got = r.items.filter((i) => i.rate != null).map((i) => i.point.id);
  if (!expected) {
    unconfirmed++;
    console.log(`?  ${label}: $${r.total.toFixed(2)} [${got.join(", ")}] (no expected total yet)`);
    return;
  }
  const problems = [];
  if (Math.abs(r.total - expected.total) > 0.005) problems.push(`total $${r.total.toFixed(2)}, expected $${expected.total.toFixed(2)}`);
  if (expected.ids) {
    const want = new Set(expected.ids), have = new Set(got);
    const missing = [...want].filter((i) => !have.has(i)), extra = [...have].filter((i) => !want.has(i));
    if (missing.length) problems.push("missing " + missing.join(", "));
    if (extra.length) problems.push("extra " + extra.join(", "));
  }
  if (problems.length) { failed++; console.log(`FAIL ${label}: ${problems.join("; ")}`); }
  else { passed++; console.log(`ok   ${label}: $${r.total.toFixed(2)}`); }
}

for (const f of files) {
  const t = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const trip = {
    tollPath: t.toll.path, freePath: t.free && t.free.path, steps: t.toll.steps,
    departure: t.input.departure, routeMinutes: t.toll.minutes,
    axles: t.input.axles, payment: t.input.payment, carpool: t.input.carpool,
  };
  check(`${f} (${t.input.fromLabel || "?"} -> ${t.input.toLabel || "?"})`, trip, t.expected);
  // Variants: the same route priced with other settings (axles, payment, departure, carpool).
  // Each expected total is worked out by hand from the owner's published rate table.
  for (const v of t.variants || []) {
    const vt = Object.assign({}, trip);
    ["axles", "payment", "departure", "carpool"].forEach((k) => { if (v[k] !== undefined) vt[k] = v[k]; });
    check(`  ${f} [${v.label}]`, vt, v.expected);
  }
}
console.log(`${passed} checks passed, ${failed} failed, ${unconfirmed} unconfirmed (${files.length} saved trips)`);
process.exit(failed ? 1 : 0);
