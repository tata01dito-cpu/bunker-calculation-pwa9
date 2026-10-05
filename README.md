# Bunker & ROB Planner PWA

Offline-first Progressive Web App derived from the supplied legacy Excel workbook **BUNKER CALCULATION SHEET.xls**.

## What the workbook actually does

The main workbook sheets contain:
- Voyage route rows with port name, distance from previous port, estimated speed, steaming days, at-sea consumption, port-stay days, in-port consumption and estimated date.
- Fuel ROB tracking for VLSFO and LSMGO.
- Tank-level consumption using active-tank / automatic switching behavior across storage tanks.
- Fuel tank support values such as FO settling, FO service, boiler FO service, overflow and DO service tank ROB.
- Bunker quantity input, post-voyage ROB, unpumpable quantity, sea-margin calculations and storage-capacity percentage checks.
- Cylinder-oil present ROB and cylinder-oil daily consumption.
- Separate test sheets describing a two-tank automatic-switch formula: consume the active tank until zero, then switch to the other tank; tanks may be refilled independently.

The supplied workbook does **not** contain a clearly defined ME system-oil or GE system-oil ROB module. Those are added as explicit app inventory categories and their rates are user inputs rather than assumed values.

## Core calculation behavior implemented

For every route stop:
1. Sea days = distance NM / speed kn / 24.
2. Sea consumption = sea days × at-sea daily rate.
3. Port consumption = port-stay days × in-port daily rate.
4. Arrival time = previous departure + sea passage time.
5. Departure time = arrival + port-stay duration.
6. Active fuel tanks are consumed in sequence and switch only when the current tank is exhausted.
7. Bunkering is credited to departure ROB and is distributed only within tank free capacity.
8. Reserve quantity = reserve days × reserve-rate basis/day.
9. Bunker shortfall is calculated as the additional amount needed at the current port to cover remaining planned consumption + selected reserve + configured unpumpable quantity, less current projected ROB and future planned bunker quantities.
10. Negative ROB and overfill are not silently accepted; they produce planning alerts.

## Important inputs added beyond the workbook

- Noon report date/time in local time at the present position, plus the UTC offset of the present position (used to convert it to the absolute ETA/ETD start point).
- Port UTC offset for local ETA/ETD presentation.
- Explicit tank capacity, current ROB, unpumpable quantity and consumable/support classification.
- Explicit bunker event quantity and tank allocation, with optional automatic allocation by free capacity.
- ME system oil and GE system oil inventory and daily usage/makeup rates.
- Separate reserve days and reserve-rate basis per product.
- Notes/remarks per port.

For a production version, additional fields worth adding are bunker transfer start/end time, BDN quantity/density/temperature, ROB measurement source and timestamp, fuel density conversion basis, changeover/operating mode by leg, maneuvering/idle consumption, weather/current allowance, and company-specific minimum service/settling tank limits.

## Run

Serve this directory from localhost or HTTPS, for example with any simple static web server. A service worker cannot be installed reliably from a `file://` URL.

The app has no external runtime dependencies.


## UI / usability upgrade

- Persistent sidebar navigation on desktop; compact always-visible navigation rail on phones.
- Guided explanation text for every major input variable.
- Add Tank uses a default name based on the selected group, e.g. `Fuel Oil (VLSFO/HFO) Tank 1` or `Cylinder Oil Tank 1`.
- Tank consumption sequence can be selected directly and moved earlier/later with ↑ / ↓ controls.
- Every tank shows a present-volume bar with utilization and overfill warning states.
- Tank and route deletion requires confirmation before removal.
- Dashboard includes manual vessel present position plus calculated planned voyage status and a route summary of succeeding ports, port stays and ETA/ETD.
- Everything recalculates live as inputs change; there is no Recalculate button.
- Tapping a planning alert jumps to the field that causes it and shows how to correct it (the guide confirms when the alert clears).
- Voyages are saved under a name on the device (Results tab). Excel/JSON export and import were removed in v1.16.

## Look & feel (v1.24 – v1.33)

The interface uses a premium metallic dark-red theme: crimson/burgundy background with a compass-rose watermark, frosted-glass panels with thin gold edges, brushed-gold primary buttons, a glowing bottom dock with a raised gold Home medallion (phones) and a matching glass sidebar (desktop).

- **Palette** lives in `:root` at the top of `styles.css` (`--ink`, `--surface`, `--glass`, `--gold`, `--crimson` …); v1.28 adds `--tile`, `--tile-line` and `--well` for nested cards and recessed wells.
- **Layering rule:** top-level cards use the frosted glass (blurred); cards nested inside a glass panel use the translucent `--tile` fill without a second blur, which keeps scrolling smooth on phones.
- **Route tank rows** use fixed `rem` ETA/ETD columns (not `em`/`max-content`), so the header and every row share identical columns.
- **Tab transition** (`showTab` in `app.js`, 500 ms, `TAB_SLIDE_MS`): direction follows the nav order; only the outgoing and incoming screens are rendered. The outgoing screen is pinned `position:fixed` for the slide, `.content.tab-sliding` clips horizontally, and the slide is skipped for `prefers-reduced-motion` or `showTab(id,{animate:false})`.
- **Noon report date (v1.38):** entered in LOCAL time. `state.meta.noonLocal` holds the typed local date/time and `state.meta.posUtcOffset` the UTC offset of the present position (select beside the Present position input). `state.meta.startUtc` is now a derived absolute ISO instant (`noonLocal − offset`, recomputed by `syncStartUtc()`), so `core.js` is unchanged. The local value is shown as a date chip at the top of both Logbook ROB cards (`.noon-date-chip`); the Setup "Today · 12:00 local" button writes today's date at the present position at 12:00. Plans saved before v1.38 open with their old date as local time at UTC+0:00 (`migrate`).
- **Tank condition time (v1.39):** the Tanks-tab "Save tank condition" stamp is LOCAL time plus a UTC offset. The offset is chosen directly (`#tankSaveOffset`) or by port name (`#tankSavePort`, mode toggle `data-tank-zone-mode`); in port mode `portUtcOffset()` maps the port (`PORT_TZ`, keyed by `DEFAULT_PORTS`) to an IANA zone and reads the offset with `Intl` for the chosen date, so DST is respected and it works offline. Entries store `atLocal`, `utcOffset`, `port`; older entries (`atUtc`) are migrated to local time at UTC+0. Unknown port names block the save with a message.
- **Tablet widths (v1.39):** between 761 px and 1199 px tank groups, bunker grids and allocation lists use one column (the sidebar leaves too little room for two), and date/time inputs have explicit `min-width:0`/`max-width:100%` so they cannot spill into neighbouring fields.
- **Folds auto-close** (`initFoldAutoClose` in `app.js`): a tab's open folds are closed when you leave it, and any fold untouched for `FOLD_IDLE_MS` (5 min) is closed once there has been no input for `FOLD_PAUSE_MS` (10 s). `KEEP_OPEN_KEYS` lists the two blocks that start expanded by design.
- **Form grids** align on the input line, not the bottom of the field, so notes under a field never push its neighbour out of line.
- `core.js` (all calculation logic) was not touched by the redesign; `npm test` covers it.
- The service worker cache name (`sw.js`) is bumped with each release so installed copies pick up changes.
- **Floating pill dock (v1.33):** on phones the bottom nav is a floating pill (`border-radius:999px`, 12 px side margins). `--sab` is redefined in that media query to include the float gap, so page padding, the alert guide and the tour chip clear it automatically.
- **Bar colours (v1.33):** `--bar-fo` red, `--bar-do` pink, `--bar-lo` yellow (cylinder, ME and GE system oil). Over-full bars use red/dark stripes so they differ from the FO bar.

## Bunkering: bulk / drums and by-tank entry (v1.42)

- **Lube oil – Bulk or Drums** (`mode` on a lube bunker event, default bulk). Bulk behaves as before (straight into the storage tank(s)). Drums: the quantity is added to a separate **drum stock** (it does not touch any tank ROB). It is moved into tanks only by a manual **pump-over** (`bunkers[id].transfer.allocations`, per tank) at the same or any later port. A pump-over is limited by the drum stock and by the tank's free capacity; anything that cannot move stays in the drums and raises a shortage alert. A pump-over is not counted as a second bunkering in the totals. Opening drum stock is `meta.drumRob[id]`.
- **Enter per tank** (`entryMode:'tanks'`, fuel, diesel and lube oil). The user types the quantity for each designated tank and the Bunker quantity box becomes the computed, read-only sum (`bunkerEventQuantity` in `core.js`). New VLSFO still cannot be mixed with old VLSFO, so tanks holding old VLSFO are locked in this mode.
- `calculateVoyage` returns, per lube product and port, `bunkerInfo[id].{mode, drumArrival, drumReceived, transferred, drumDeparture, bulkAllocations}`, plus `finalDrums`.


## ECA/SECA per port + report naming (v1.55; the ECA question moved to the ECA/SECA tab in v1.61)

- **Word report** is saved as `Bunker Pilot - <vessel name> - <date>.docx` (date = day of saving; characters not allowed in file names are replaced by spaces). The summary row *Route stops* is now *Number of ports*, and the ECA/SECA table also lists the distance to the ECA line and the changeover timing.
- **ECA/SECA tab (moved here from the Ports tab in v1.61):** the top of each port card asks *This port is in an ECA/SECA*, followed by the ECA line distances and the required sulphur at engine inlet. When ticked, the port stores `eca.port = {enabled, prevToLineNm, lineToPortNm, exitNm}`:
  - `prevToLineNm` - previous port to the ECA line (blank = leg distance minus `lineToPortNm`), `lineToPortNm` - ECA line to this port, `exitNm` - this port to the ECA line when leaving (blank = same as `lineToPortNm`).
  - The ECA/SECA tab no longer has the *enters / leaves* tick boxes: `ecaSyncFromPorts()` derives them. A port gets an **entering** changeover when it is an ECA port and the previous port is not (the first port is assumed already inside); it gets a **leaving** changeover when it is an ECA port and the next port is not (or it is the last port). Consecutive ECA ports mean the vessel stays inside.
  - **Entering:** the ECA line is crossed `lineToPortNm / speed` hours before the ETA. The changeover to the low-sulphur fuel must be **complete** (FOBAS time to the *required sulphur at engine inlet* + the safety margin) before that crossing, so the start time is `crossing - margin - FOBAS time`.
  - **Leaving:** the line is cleared `exitNm / next-leg speed` hours after the ETD. The changeover back to the higher-sulphur fuel starts right after it and is timed with `fobasChangeover(mode:'up')` to the user's *required sulphur at engine inlet after leaving* (blank = 95% of the way to the resume fuel, the old rule).
  - Fuel types, system rates, quantities, current/new sulphur and the safety margin stay on the ECA/SECA tab.
- `core.js`: LSMGO consumption on the leg into an entering port (and out of a leaving port) is split between the outside and inside rates by the distance sailed inside the ECA (`ecaLegFraction`); with no distances entered the behaviour is unchanged. A flagged first port starts the voyage inside the ECA.
- Plans saved before v1.55 migrate automatically: ports between an old *enters* and *leaves* flag become ECA ports with line distance 0 (the old behaviour: the line is at the port).

## Bunkering clean-up + tank graphs in the report card (v1.56)

- Bunkering tab: the cyan "ECA in / ECA out" text tags are removed from the port cards (the Bunkering tag and the cyan edge stripe stay; the tags remain on the Dashboard, Results and ECA/SECA tabs).
- Bunkering tab: the "Lube oil in drums on board now" box is removed. Drum receipts planned at a port are unaffected.
- Tanks tab: the highlighted "Tank condition report" card briefly ended with live tank graphs; these were removed again in v1.58 (too crowded).

## Lub. oil replenishment form (v1.57)

- Results tab → **Export lub. oil form** writes `Lub Oil Replenishment Form - <vessel> - <date>.docx`, laid out like form S-082001-02FRM (landscape A4), **one page per port** that has planned lube-oil replenishment or a drum pump-over.
- `lubeform.js` holds the OOXML builders (pure functions, tested by `test-lubeform.mjs`): header, bulk tank table, drum/tin table, remarks and signatures. `lfPageFromStop` maps a `calculateVoyage` result row to a page.
- Filled from the plan: port, per-tank capacity (100 %), ROB before, planned quantity and after-fill %/volume (litres converted to m³/kl), drum receipts and pump-overs. Left blank on purpose: gauges, work start/finish, temperatures, draft/trim, oil brand, densities, actual results, remarks and signatures.
- The Word package is built by `buildDocxBytes(documentXml)` in `app.js` (shared with the voyage report). `lubeform.js` is in the service-worker cache list.

## Bunkering plan form S-082000-03FRM (v1.59)

- Results tab → **Export bunkering plan form** writes `Bunkering Plan Form - <vessel> - <date>.docx`, laid out like the NYK form BUNKER/INTERNAL TRANSFER PLAN & RESULT (landscape A4, 31-column grid), **one page per port** with planned fuel or diesel bunkering.
- `bunkerform.js` holds the OOXML builders and the data mapping (`bfPageFromStop`, `bfTankSpecs`, `bfPlannedItems`); `test-bunkerform.mjs` covers both. It reuses the table helpers of `lubeform.js`.
- Filled from the plan: vessel, port, local ETA date, FO/DO **storage** tanks (capacity, filling limit = the company maximum fill from the Tanks tab, present volume/quantity/density/temperature/corr. factor/sulphur, planned volume + quantity, estimated after volume/quantity/sulphur/% capacity), TOTAL FOT / DOT, and the bunker's sulphur from the bunker event.
- Left blank on purpose: draft/trim, BDN density/temperature/volume, times, loading rates, soundings, place P/S, sequence, topping-off method, additive, every result in "Tank condition after bunkering", signature names and remarks.
- Long tank names shrink to fit; extra tanks beyond two per group use up the spare blank rows so the form stays on one page (up to 5 extra tanks).
- v1.60 QA: tested with several ports, 14 storage tanks, volume-entered ROB, tanks with no density, settling/service tanks (excluded), names containing `&` `<` `"`, and an empty vessel name. Results: XML well-formed, opens in LibreOffice and python-docx, every row covers all 31 grid columns. Up to 5 tanks beyond two per group still fit on one page; beyond that the form simply continues on a second page.
- A tank with no density cannot show volumes or capacity: the export lists those tanks in a message afterwards (quantities in MT are still filled).
- Word exports (`buildDocxBytesZ`) deflate the XML with the browser's `CompressionStream` when available (Chrome 103+, Safari 16.4+, Firefox 113+), else store it as before. `zipStore` accepts pre-deflated entries.

## Plan a bunkering (v1.62)

- **Home → Plan a bunkering** opens a pop-up that works out what to bunker at any port, for fuel oil, diesel oil, cylinder oil and ME / GE system oil.
- **Port:** any port on the route, or **Other port / date…** (port name, local arrival date/time, UTC offset — filled automatically for known ports —, and stay in hours). An off-route port is placed on the leg being sailed at that time (same speed), so ROB and remaining consumption are taken at that point of the voyage.
- **Required** = consumption still to come + reserve + unpumpable − ROB at ETD (before any bunkering at this port) − later planned bunkering. *Cover the voyage until* limits it to the arrival at a later port (e.g. the next bunkering port) instead of the end of the voyage.
- **To bunker** = required (+ optional extra margin %), rounded up (1 MT fuel / 10 L lube oil), never more than the tanks can take at the company maximum fill; or *Fill to the maximum tank fill*.
- **Per tank:** loaded in consumption order into tanks of the same grade; VLSFO only into tanks holding no old VLSFO (the same rules as the Bunkering tab). Tanks that cannot take the bunker are listed with the reason.
- The result is **verified** by re-running `calculateVoyage` with the plan applied (ROB at ETD after bunkering, shortages, endurance). A bunkering already entered for that port on the Bunkering tab is ignored by the pop-up and is not changed.
- **Export DOCX** writes `Bunkering Plan - <port> - <vessel> - <date>.docx` (landscape A4): port, ETA/ETD (local + UTC), stay, next port, summary table and a tank-by-tank table per product, planning notes.
- Code: `bunkerplan.js` (pure engine, tested by `test-bunkerplan.mjs`) and the pop-up / Word export block in `app.js` (`initPlanBunker`, `pbRender`, `pbDocxBody`, `exportPlanBunker`).
- **Chunk 2 additions:** pick the bunker **grade** (VLSFO/HFO, LSMGO/MGO/biodiesel) and its **sulphur %** per product; type your own **quantity per tank** (the rest of the product's tanks keep their current values; *Reset to automatic* undoes it; typing is checked against capacity and the maximum fill); **Use on Bunkering tab** writes the plan into that route port's bunkering entry (entered per tank) after a confirmation — only for ports on the route. A "Plan a bunkering" step was added to Guide me (13 steps) and to the Hints.
- **Chunk 3 additions:** *Compare ports* (collapsible, top of the pop-up) lists the quantity to bunker of every product at every route port side by side with a result tag (Needed / Not needed / Limited / Too late = ROB runs out before that port) and a Choose button. The latest plan from the pop-up is appended to the Word voyage report (Results → Export DOCX) as a *Plan a Bunkering* section, recalculated from the current data; it is only added if the pop-up was opened in that session.
