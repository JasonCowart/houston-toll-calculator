# Backlog

Ideas, open work and decisions on hold for the Toll Calculator. Each item says **what** it is, **why** we want it, and what it's **waiting on**. When something ships, move it to the Done list at the bottom with the date.

Last updated: Nov 1, 2026

## Ready to do

| Item | What | Why | Waiting on |
| --- | --- | --- | --- |
| EZ TAG savings using the real trip back | The monthly "Save about $X/mo" figure in the EZ TAG offer assumes the trip back costs the same as the trip there. The commute section can already price the real trip back; use that figure in the offer when it's available. | One-way tolls and time-of-day lanes (SH 288, Katy Managed Lanes) can make the trip home cost quite differently, so the monthly savings can be off. | Nothing |

## Waiting on HCTRA or others

| Item | What | Why | Waiting on |
| --- | --- | --- | --- |
| Scam text warning | A short note in the app such as "HCTRA never asks for payment by text. Pay only at hctra.org or in the EZ TAG app." Wording and placement not settled. | Fake "unpaid toll" texts are common in Texas. People checking toll costs are a good audience for the warning. | HCTRA approval of the wording, and whether it belongs in the calculator at all. *Note: the original discussion was lost when the chat was condensed. This is the best reconstruction.* |
| Sharper EZ TAG picture | Replace `assets/eztag-new.jpg` and `assets/eztag-tag.jpg` with an official high-resolution image of the new tag. | The current crop comes from a web image and looks soft in the PDF. | HCTRA marketing |
| Translation review | Native speakers check `js/lang-vi.js`, `js/lang-zh-hans.js` and `js/lang-zh-hant.js`, including the recent EZ TAG, QR code and Best time wording. | They are draft translations. | Native-speaker reviewers |
| Live traffic from TomTom or Waze | TomTom traffic is built in but only shows in debug mode. | It would improve time estimates and the Best time to leave results. | Legal review of the TomTom and Waze terms |
| Confirm 7 saved test trips | 7 trips in `tests/trips` have no confirmed expected total yet. | They protect against routing or toll-detection mistakes coming back. | Someone checking each trip's tolls against a real statement or the HCTRA rate tables |
| Pay-by-mail fees | Show the extra fees for paying by mail. | The no-tag price is understated today. | HCTRA fee amounts |

## Coverage gaps (roads not priced yet)

| Area | Roads | Waiting on |
| --- | --- | --- |
| Tyler | Toll 49 (NET RMA) | Rate chart (published only as an image) and gantry locations |
| Austin | 183 Toll, 183A, 290 Toll, 45SW, 71 Toll Lane, MoPac Express (CTRMA) | Gantry data request |
| DFW | TEXpress Lanes; International Parkway | Dynamic and time-of-day pricing data |
| Houston | METRO HOV/HOT lanes on I-45 N and S, US 290, US 59 | Time-of-day pricing data |
| Brownsville | I-169 / SH 550 | Rates and gantry locations |
| Galveston | San Luis Pass–Vacek Bridge | One toll point to add |
| Partner states | Florida's Turnpike first, then E-470 and Colorado express lanes; Kansas and Oklahoma need agency data | Confirm with HCTRA which roads take EZ TAG |

## Handover to HCTRA

- Transfer the GitHub repo to HCTRA and add HCTRA staff as maintainers.
- Create ArcGIS and TomTom keys owned by HCTRA, then replace both GitHub secrets. Keep pay-as-you-go and billing off.
- Set `REPORT_EMAIL` to a shared HCTRA inbox. This turns on "Report a wrong toll".
- Make sure the repo owner gets GitHub issue emails, which carry the weekly rate-watch alerts.
- Decide on the final web address, then update the key referrers to match.
- Create a GoatCounter account for HCTRA and set `GOATCOUNTER_CODE`.

## Rules that stay in force

- The app must stay free: GitHub Pages, the Esri free tier, and the TomTom free tier with billing off.
- Keys live only in GitHub secrets.
- Don't store Waze or TomTom data in the repo.
- Don't use HCTRA purple for other agencies' items on the map.
- Every change goes to the `preview` branch (`/preview/`) first. It goes to `main` only after review.

## Done

| Date | Item |
| --- | --- |
| Nov 1, 2026 | Picker: Recent and Common places on a light purple band that wraps the list when open; Toll breakdown heading now as bold as the other two |
| Nov 1, 2026 | Picker: Recent keeps the last 6 places that aren't saved; fold rows read "Recent (4)" with a larger arrow in a circle |
| Nov 1, 2026 | Picker: Recent and Common places start folded (with counts); areas are small headings inside Common places |
| Nov 1, 2026 | Picker: recent places that are already saved no longer repeat under Recent |
| Nov 1, 2026 | Custom place and vehicle picker on the preview (sheet on phones, dropdown on desktop; save, rename and remove inside it). Jason to try it and ask for tweaks. The old Edit my places / Edit my vehicles windows are no longer opened by the menus and can be removed once the picker settles. |
| Nov 1, 2026 | My places gets a Save/Edit dialog like My vehicles (rename, remove, save a recent place); Save and Edit moved to the top of both menus |
| Nov 1, 2026 | Reloading the page starts fresh (it used to reopen the last trip like a shared link); the trip still comes back if the phone drops the tab while the PDF is open |
| Nov 1, 2026 | PDF and print: map runs to the bottom of the QR code, map note under it above the banner (print gets the note too, in all languages) |
| Oct 31, 2026 | QR code on the PDF; Hardin Store exit missed after adding a stop; faster PDF and waiting screen; iPhone print fixes |
| Oct 31, 2026 | Admin guide and staff deck updated for the EZ TAG offer, the shorter form, the section glow, the Best time markers, the QR code and "Departure" |
