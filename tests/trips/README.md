# Saved real trips

Each file is a trip saved from the site's debug view (`?debug=1` → **Save trip for testing**): the exact toll and toll-free routes Esri returned, the turn-by-turn steps, and the inputs (stops, vehicle, payment, departure time).

Add an `"expected"` block once the real toll total is confirmed:

```json
"expected": { "total": 4.63, "ids": [314, 237, 211, 223], "note": "confirmed by Jason, Oct 21, 2026" }
```

`node tools/test_trips.js` replays every file through `TollCalc.analyzeTrip`, the same code the site runs. The deploy workflow runs it on every push, so a change that fixes one trip but breaks another won't publish.
