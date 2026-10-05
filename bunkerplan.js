/* ---------------------------------------------------------------------------------------------
   v1.62 — "Plan a bunkering": pure calculation engine (no DOM, no storage).

   Given the current plan (the same object calculateVoyage() takes) and a chosen bunkering port, it works out
   for every product (fuel oil, diesel oil, cylinder oil, ME system oil, GE system oil):
     required   = consumption still to come + reserve + unpumpable heel - ROB at departure - later planned bunkers
     suggested  = required (+ optional margin) rounded up, never above what the tanks can take
     maxReceivable = room in the eligible tanks up to the company maximum fill
   and spreads the suggested quantity over the eligible tanks (grade match, VLSFO no-mixing rule, max fill %).
   The result is verified by re-running calculateVoyage() with the plan applied at that port.

   The port can be:
     - a port already in the route            -> spec {routeIndex}
     - any other port, at a date and time     -> spec {name, etaUtc, stayHours, utcOffset}; a stop is inserted on the leg that is
                                                  being sailed at that time (position interpolated at the leg speed).
   Nothing here changes the user's plan: all work is done on a copy.
   --------------------------------------------------------------------------------------------- */
import {
  calculateVoyage, num, clampNonNegative, consumptionOrder, isConsumableTank, tankUnpumpable, maxFillFrac,
  resolveFoActiveFuel, defaultFuelType, normFuelType, fuelTypeNoMixing, tankEmptyForNoMix, HOURS_PER_DAY,
} from './core.js';

const EPS = 1e-9;
export const PRODUCT_LABEL = { fo: 'Fuel Oil', do: 'Diesel Oil', cyl: 'Cylinder Oil', mesys: 'ME System Oil', gesys: 'GE System Oil' };
const clone = o => JSON.parse(JSON.stringify(o));
const round = (v, d = 2) => { const k = 10 ** d; return Math.round((num(v) + Number.EPSILON) * k) / k; };
const ceilTo = (v, step) => { const s = step > 0 ? step : 1; return Math.ceil(v / s - 1e-9) * s; };
const sumUsage = (r, id) => num(r.seaUsage && r.seaUsage[id]) + num(r.anchorUsage && r.anchorUsage[id]) + num(r.portUsage && r.portUsage[id]);

/* A route stop that is only a point on a sea leg (no ECA flags, no bunkers, no distance of its own beyond the part of the leg sailed). */
function syntheticStop(spec, nextStop, distanceNm) {
  return {
    port: spec.name || 'Bunkering port', distanceNm, speedKn: num(nextStop.speedKn),
    anchorStayDays: 0, anchorStayHours: 0, anchorMode: 'anchor',
    portStayDays: 0, portStayHours: Math.max(0, num(spec.stayHours)),
    utcOffset: num(spec.utcOffset), notes: 'Bunkering port inserted by Plan a bunkering', eta: '',
    foActiveFuel: nextStop.foActiveFuel || 'vlsfo', bunkers: {},
    eca: { entering: { enabled: false }, leaving: { enabled: false }, port: { enabled: false, prevToLineNm: '', lineToPortNm: 0, exitNm: '' } },
  };
}

/* Decide where the chosen port sits in the route. Returns {index, inserted, note?} on the ORIGINAL route
   (inserted: a new stop goes right after `after`). */
export function locateBunkerPort(input, results, spec) {
  const n = (input.route || []).length;
  if (Number.isInteger(spec.routeIndex) && spec.routeIndex >= 0 && spec.routeIndex < n) return { inserted: false, index: spec.routeIndex };
  const T = Date.parse(spec.etaUtc);
  if (!Number.isFinite(T)) return { error: 'Enter the date and time of arrival at the bunkering port.' };
  const arr = results.map(r => Date.parse(r.arrivalUtc)), dep = results.map(r => Date.parse(r.departureUtc));
  for (let k = 0; k < n; k++) if (T >= arr[k] - 1 && T <= dep[k] + 1) return { inserted: false, index: k, note: `The date falls inside the port stay at ${results[k].port}, so that port is used.` };
  if (T < arr[0]) return { inserted: false, index: 0, note: `The date is before the first planned arrival (${results[0].port}); the plan is calculated at ${results[0].port}.` };
  if (T > dep[n - 1]) return { inserted: false, index: n - 1, note: `The date is after the last planned departure (${results[n - 1].port}); the plan is calculated at ${results[n - 1].port}.` };
  for (let k = 0; k < n - 1; k++) {
    if (T > dep[k] && T < arr[k + 1]) {
      const span = arr[k + 1] - dep[k], f = span > 0 ? (T - dep[k]) / span : 0.5, D = Math.max(0, num(input.route[k + 1].distanceNm));
      return { inserted: true, after: k, fraction: f, distanceNm: D * f, note: `${spec.name || 'The port'} is placed ${round(D * f, 0)} NM along the leg ${results[k].port} → ${results[k + 1].port} (same speed), so the ROB is taken at that point in the voyage.` };
    }
  }
  return { error: 'Could not place that date in the voyage.' };
}

function buildAugmentedRoute(input, loc, spec) {
  const aug = clone(input);
  if (!loc.inserted) { aug.route[loc.index].bunkers = {}; return { aug, index: loc.index }; }
  const next = aug.route[loc.after + 1], D = Math.max(0, num(next.distanceNm));
  const stop = syntheticStop(spec, next, loc.distanceNm);
  next.distanceNm = Math.max(0, D - loc.distanceNm);
  aug.route.splice(loc.after + 1, 0, stop);
  return { aug, index: loc.after + 1 };
}

function reserveFor(profile, fuelStatus) {
  if (fuelStatus && Number.isFinite(fuelStatus.reserveQty)) return fuelStatus.reserveQty;
  const basis = Math.max(0, num(profile.reserveRate)) || Math.max(0, num(profile.seaRate));
  return Math.max(0, num(profile.reserveDays)) * basis;
}

/* Which tanks can take this bunker, and why not for the others. */
function tankCandidates(tanksAtArrival, group, fuelType, frac) {
  const pool = consumptionOrder(tanksAtArrival.filter(t => t.group === group && isConsumableTank(t)));
  const noMix = fuelType ? fuelTypeNoMixing(fuelType) : false;
  return pool.map(t => {
    const own = t.fuelType || defaultFuelType(group), cap = Math.max(0, num(t.capacity)), rob = clampNonNegative(t.rob), limit = cap * frac, room = Math.max(0, limit - rob);
    let reason = '';
    if (fuelType && normFuelType(own) !== normFuelType(fuelType)) reason = 'different fuel type';
    else if (noMix && !tankEmptyForNoMix(t)) reason = 'holds old VLSFO — cannot be mixed';
    else if (!(cap > 0)) reason = 'no capacity entered';
    else if (room <= EPS) reason = `already at ${round(frac * 100, 0)} % or more`;
    return { tank: t, own, cap, rob, limit, room, ok: !reason, reason };
  });
}

export function planBunkering(input, spec, opts = {}) {
  const o = { marginPct: 0, roundFuel: 1, roundLube: 10, fillToMax: false, untilIndex: null, fuelTypes: {}, bunkerSulphur: {}, overrides: null, products: null, ...opts };
  if (!input || !(input.route || []).length) return { ok: false, error: 'Add at least one port on the Ports tab first.' };
  if (!(input.tanks || []).length) return { ok: false, error: 'Add your tanks on the Tanks tab first.' };
  const baseRes = calculateVoyage(clone(input));
  const loc = locateBunkerPort(input, baseRes.results, spec);
  if (loc.error) return { ok: false, error: loc.error };
  const { aug, index: ai } = buildAugmentedRoute(input, loc, spec);
  const res = calculateVoyage(clone(aug)), r = res.results[ai], lastIdx = res.results.length - 1;
  const frac = maxFillFrac(aug.meta);
  const warnings = [];
  if (loc.note) warnings.push(loc.note);
  const hadPlanned = !loc.inserted && Object.values((input.route[loc.index] || {}).bunkers || {}).some(b => b && (num(b.quantity) > 0 || (b.allocations || []).length));
  if (hadPlanned) warnings.push('A bunkering already entered for this port on the Bunkering tab is ignored here: this plan is worked out from the ROB before any bunkering at this port. Your entries are not changed.');

  /* cover-until: null = through the end of the voyage (last port departure); else the arrival at that original port index. */
  let untilAug = lastIdx, untilArrival = false, untilName = `${res.results[lastIdx].port} (end of voyage)`;
  if (o.untilIndex !== null && o.untilIndex !== undefined && Number.isInteger(o.untilIndex)) {
    let u = o.untilIndex; if (loc.inserted && u > loc.after) u += 1;
    if (u > ai && u <= lastIdx) { untilAug = u; untilArrival = true; untilName = `arrival at ${res.results[u].port}`; }
    else warnings.push('The "cover until" port must come after the bunkering port; the end of the voyage is used instead.');
  }
  const fromJ = ai + 1, toSea = untilAug, toStay = untilArrival ? untilAug - 1 : untilAug; // sea usage up to untilAug; anchor/port usage up to toStay
  const bunkerLastJ = untilArrival ? untilAug - 1 : untilAug;

  const all = [...(aug.fuels || []), ...(aug.lubes || [])].filter(p => !o.products || o.products.includes(p.id));
  const products = [], planBunkers = {};
  for (const p of all) {
    const id = p.id, isFuel = (aug.fuels || []).some(f => f.id === id), unit = p.unit || (isFuel ? 'MT' : 'L');
    const dep = num((isFuel ? r.departureFuel : r.departureLube)[id]), arrRob = num((isFuel ? r.arrivalFuel : r.arrivalLube)[id]);
    let futureCons = 0, futureBunk = 0;
    for (let j = fromJ; j <= lastIdx; j++) {
      const x = res.results[j];
      if (j <= toSea) futureCons += num(x.seaUsage[id]);
      if (j <= toStay) futureCons += num(x.anchorUsage[id]) + num(x.portUsage[id]);
      if (j <= bunkerLastJ) futureBunk += num(x.bunkerInfo[id] && x.bunkerInfo[id].allocated);
    }
    const fs = isFuel ? r.fuelStatus[id] : null, reserve = reserveFor(p, fs), unpump = tankUnpumpable(r.tankAfter, id);
    const basis = Math.max(0, num(p.reserveRate)) || Math.max(0, num(p.seaRate));
    const required = Math.max(0, futureCons + reserve + unpump - dep - futureBunk);
    /* grade of the bunker: user choice, else the grade being burned (fuel oil follows the stop's VLSFO/HFO mode), else the tank default */
    let fuelType = null;
    if (isFuel) fuelType = o.fuelTypes[id] || (id === 'fo' ? resolveFoActiveFuel(p, aug.route[Math.min(ai + 1, lastIdx)]) : defaultFuelType(id)) || defaultFuelType(id);
    const cands = tankCandidates(r.tankAtArrival, id, fuelType, frac);
    const maxReceivable = cands.filter(c => c.ok).reduce((s, c) => s + c.room, 0);
    let suggested;
    if (o.fillToMax) suggested = maxReceivable;
    else if (required > EPS) suggested = ceilTo(required * (1 + clampNonNegative(o.marginPct) / 100), isFuel ? o.roundFuel : o.roundLube);
    else suggested = 0;
    suggested = Math.min(suggested, maxReceivable);
    const shortfall = Math.max(0, required - maxReceivable);
    /* spread over the eligible tanks in consumption order, each up to the maximum fill */
    const ov = o.overrides && o.overrides[id], manual = !!ov;
    let left = suggested; const tanks = [];
    for (const c of cands) {
      /* manual quantities (typed per tank) replace the automatic spread; they may not exceed the tank's capacity */
      let q;
      if (manual) q = c.ok ? Math.min(Math.max(0, c.cap - c.rob), clampNonNegative(ov[c.tank.id])) : 0;
      else q = c.ok && left > EPS ? Math.min(c.room, left) : 0;
      left -= q;
      if (manual && q > EPS && c.rob + q > c.limit + 1e-6) warnings.push(`${PRODUCT_LABEL[id] || id}: ${c.tank.name} would be ${round((c.rob + q) / c.cap * 100, 1)} % full, above the ${round(frac * 100, 0)} % maximum fill.`);
      const dens = num(c.tank.density) > 0 && isFuel ? num(c.tank.density) : 0;
      tanks.push({
        id: c.tank.id, name: c.tank.name, fuelType: c.own, eligible: c.ok, reason: c.reason, capacity: c.cap, fillLimit: c.limit,
        density: dens || null, robArrival: c.rob, qty: q, afterLoading: c.rob + q, pctAfter: c.cap > 0 ? (c.rob + q) / c.cap * 100 : null,
        qtyM3: dens ? q / dens : null, capacityM3: num(c.tank.capacityM3) || (dens ? c.cap / dens : null),
      });
    }
    const qtyTotal = tanks.reduce((s, t) => s + t.qty, 0);
    if (manual && qtyTotal < required - 1e-6) warnings.push(`${PRODUCT_LABEL[id] || id}: the quantities entered (${round(qtyTotal)} ${unit}) are ${round(required - qtyTotal)} ${unit} short of the ${round(required)} ${unit} required.`);
    if (qtyTotal > EPS) planBunkers[id] = { quantity: round(qtyTotal, 6), entryMode: 'tanks', allocations: tanks.filter(t => t.qty > EPS).map(t => ({ tankId: t.id, quantity: t.qty })), ...(fuelType ? { fuelType } : {}), ...(o.bunkerSulphur[id] !== undefined && o.bunkerSulphur[id] !== '' ? { sulphur: o.bunkerSulphur[id] } : {}) };
    const status = shortfall > EPS ? 'limited' : required > EPS ? 'needed' : 'none';
    products.push({
      id, label: PRODUCT_LABEL[id] || p.name || id, unit, isFuel, fuelType, status, manual, bunkerSulphur: o.bunkerSulphur[id] === undefined ? '' : o.bunkerSulphur[id],
      robArrival: arrRob, robDeparture: dep, futureConsumption: futureCons, reserve, unpumpable: unpump, futureBunkers: futureBunk,
      required, suggested: qtyTotal, maxReceivable, shortfall, marginPct: o.marginPct, rounding: isFuel ? o.roundFuel : o.roundLube,
      surplus: required > EPS ? 0 : Math.max(0, dep + futureBunk - futureCons - reserve - unpump), reserveBasisRate: basis, tanks, excluded: tanks.filter(t => !t.eligible),
    });
  }

  /* verify: re-run with the plan applied at the port */
  const ver = clone(aug); ver.route[ai].bunkers = planBunkers;
  const vres = calculateVoyage(ver), vr = vres.results[ai];
  for (const pr of products) {
    const after = num((pr.isFuel ? vr.departureFuel : vr.departureLube)[pr.id]);
    pr.robDepartureAfter = after;
    pr.enduranceDays = pr.reserveBasisRate > 0 ? Math.max(0, (after - pr.unpumpable) / pr.reserveBasisRate) : null;
    pr.finalRob = num((pr.isFuel ? vres.results[lastIdx].departureFuel : vres.results[lastIdx].departureLube)[pr.id]);
    const info = vr.bunkerInfo[pr.id];
    pr.unallocated = info ? num(info.unallocated) : 0;
    for (const t of pr.tanks) {
      const ta = vr.tankAfter.find(x => x.id === t.id);
      t.robDeparture = ta ? num(ta.rob) : null;
      t.sulphurAfter = ta && ta.sulphur !== undefined && pr.isFuel ? ta.sulphur : null;
    }
    if (pr.status === 'limited') warnings.push(`${pr.label}: only ${round(pr.maxReceivable)} ${pr.unit} can be loaded (maximum fill ${round(frac * 100, 0)} % and the tank/mixing rules); ${round(pr.shortfall)} ${pr.unit} short of the ${round(pr.required)} ${pr.unit} required. Consider another bunkering port or a lower consumption.`);
    if (pr.unallocated > EPS) warnings.push(`${pr.label}: ${round(pr.unallocated)} ${pr.unit} could not be placed in the tanks when the plan was verified.`);
  }
  const before = vres.totals.shortages.filter(s => s.stopIndex < ai || (s.stopIndex === ai && s.phase !== 'bunkering')), after = vres.totals.shortages.filter(s => s.stopIndex > ai || (s.stopIndex === ai && s.phase === 'bunkering'));
  before.forEach(s => warnings.push(`ROB runs out before / during the stay at ${s.location} (${s.item}, short by ${round(s.shortage)}) — bunkering must happen earlier.`));
  after.forEach(s => warnings.push(`After this bunkering ${s.item} is still short by ${round(s.shortage)} at ${s.location}${s.message ? ' — ' + s.message : ''}.`));

  return {
    ok: true,
    port: {
      name: r.port, routeIndex: loc.inserted ? null : loc.index, inserted: !!loc.inserted, etaUtc: r.arrivalUtc, etdUtc: r.departureUtc, utcOffset: r.utcOffset,
      stayHours: (Date.parse(r.departureUtc) - Date.parse(r.arrivalUtc)) / 3600000, nextPort: res.results[ai + 1] ? res.results[ai + 1].port : null, nextEtaUtc: res.results[ai + 1] ? res.results[ai + 1].arrivalUtc : null,
    },
    basis: { coverUntil: untilName, maxFillPct: round(frac * 100, 1), marginPct: o.marginPct, fillToMax: !!o.fillToMax },
    products, warnings,
    status: before.length ? 'critical' : products.some(p => p.status === 'limited') ? 'limited' : products.some(p => p.required > EPS) ? 'needed' : 'none',
    bunkersForVerification: planBunkers, hoursPerDay: HOURS_PER_DAY,
  };
}
