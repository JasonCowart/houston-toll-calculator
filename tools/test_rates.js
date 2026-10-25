// Rate guard: every toll point whose rates were checked against the owner's published
// schedule ("verified") is recorded in tests/rates-verified.json. If a data rebuild changes
// any of those rates, drops a verified point, or moves it more than 50 m, this test fails
// and the site doesn't deploy.
//
// When an agency really does change its rates: re-check them against the published table,
// rebuild data/toll-points.json, then run `node tools/test_rates.js --update` and commit
// the new snapshot together with the data, saying in the commit message what was checked.
//
// Run: node tools/test_rates.js
const fs = require("fs");
const path = require("path");
const dataFile = path.join(__dirname, "..", "data", "toll-points.json");
const snapFile = path.join(__dirname, "..", "tests", "rates-verified.json");
const points = JSON.parse(fs.readFileSync(dataFile, "utf8")).points;

const FIELDS = ["ez2", "tag2", "tag", "notag", "next"];
const pick = (p) => ({ name: p.name, road: p.road, owner: p.owner, lon: p.lon, lat: p.lat,
  ez2: p.ez2, tag2: p.tag2, tag: p.tag, notag: p.notag, ...(p.next ? { next: p.next } : {}) });
const verified = points.filter((p) => p.status === "verified");

if (process.argv.includes("--update")) {
  const snap = {};
  verified.forEach((p) => { snap[p.id] = pick(p); });
  fs.writeFileSync(snapFile, JSON.stringify({
    note: "Rates checked against each owner's published schedule. Change only after re-checking; see tools/test_rates.js.",
    updated: new Date().toISOString().slice(0, 10),
    points: snap,
  }, null, 1) + "\n");
  console.log(`Snapshot written: ${verified.length} verified points`);
  process.exit(0);
}

const snap = JSON.parse(fs.readFileSync(snapFile, "utf8")).points;
const byId = new Map(points.map((p) => [String(p.id), p]));
const problems = [];

function meters(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const x = (b.lon - a.lon) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad), y = (b.lat - a.lat) * toRad;
  return Math.hypot(x, y) * R;
}

for (const [id, want] of Object.entries(snap)) {
  const p = byId.get(id);
  const label = `${id} ${want.name} (${want.road})`;
  if (!p) { problems.push(`${label}: missing from data`); continue; }
  if (p.status !== "verified") problems.push(`${label}: status is now "${p.status}"`);
  for (const f of FIELDS) {
    if (JSON.stringify(p[f]) !== JSON.stringify(want[f]))
      problems.push(`${label}: ${f} ${JSON.stringify(want[f])} -> ${JSON.stringify(p[f])}`);
  }
  const moved = meters(want, p);
  if (moved > 50) problems.push(`${label}: moved ${Math.round(moved)} m`);
}
const added = verified.filter((p) => !(String(p.id) in snap));
if (added.length) problems.push(`newly verified, not in snapshot yet: ${added.map((p) => p.id).join(", ")} (run with --update after checking)`);

if (problems.length) {
  console.log(`Rate guard FAILED (${problems.length}):`);
  problems.forEach((s) => console.log("  " + s));
  process.exit(1);
}
console.log(`Rate guard: ${Object.keys(snap).length} verified points unchanged`);
