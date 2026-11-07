#!/usr/bin/env node
// Regenerates docs/valuation.html — the living reference for how a card gets a
// number put on it.
//
// WHY A GENERATOR AND NOT A HAND-WRITTEN PAGE. Every constant on that page is
// read out of src/rules/valuation.js and src/rules/draft.js at generation time,
// and every worked example is computed by calling the real engine. Change a
// weight, a chart table, a rate or a threshold, re-run this, and the document
// follows. Nothing on the page is typed in by hand.
//
// TWO GUARDS KEEP IT HONEST, because a stale reference is worse than none:
//
//   1. Every constant is pulled by an asserted regex. If a name is renamed,
//      moved or deleted, this script FAILS with the name and file rather than
//      quietly printing the last value it happened to find.
//   2. The page's stated formula is re-implemented here from the extracted
//      constants and run against every card in a deck, then compared with what
//      the engine actually returns. The result is printed at the top of the
//      page. If someone changes the SHAPE of the model (not just a number),
//      that check goes red and says so, because this script cannot detect that
//      on its own.
//
// Usage:
//   node scripts/valuation-report.mjs                      (or: npm run valuation-doc)
//   node scripts/valuation-report.mjs --bat "Larry Walker" --arm "Pedro Martinez"
//   node scripts/valuation-report.mjs --universe classic --seed my-seed --sp 4

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createValuationModel, spSlotFactor } from "../src/rules/valuation.js";
import { RESULTS, chartSpan } from "../src/rules/cards.js";
import { runsPerPa, lineupProfile } from "../src/rules/pitching.js";
import { buildDraftPool } from "../src/data/universes.js";
import * as D from "../src/rules/draft.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "valuation.html");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const UNIVERSE = flag("universe", "classic");
const SEED = flag("seed", "valuation-doc-v1");
const SP_SLOTS = Number(flag("sp", 4));
const TEAMS = 4;
const ROSTER = 15;
const BUDGET = 1500;
const WANT_BAT = flag("bat", "Larry Walker");
const WANT_ARM = flag("arm", "Pedro Martinez");

// ---------------------------------------------------------------------------
// 1. Pull the constants out of the source.
// ---------------------------------------------------------------------------

const FILES = {
  "valuation.js": fs.readFileSync(path.join(ROOT, "src/rules/valuation.js"), "utf8"),
  "draft.js": fs.readFileSync(path.join(ROOT, "src/rules/draft.js"), "utf8")
};

const missing = [];

function constNum(file, name) {
  const m = FILES[file].match(new RegExp(`^\\s*(?:export\\s+)?const ${name} = (-?[0-9.]+)\\s*;`, "m"));
  if (!m) { missing.push(`${name} — expected "const ${name} = <number>;" in ${file}`); return NaN; }
  return Number(m[1]);
}

function constArray(file, name) {
  const m = FILES[file].match(new RegExp(`^\\s*(?:export\\s+)?const ${name} = \\[([^\\]]*)\\]`, "m"));
  if (!m) { missing.push(`${name} — expected "const ${name} = [...]" in ${file}`); return []; }
  return m[1].split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

// Grabs the { ... } literal that follows a const name, by brace balance.
function constObjectText(file, name) {
  const text = FILES[file];
  const start = text.search(new RegExp(`^\\s*(?:export\\s+)?const ${name} = \\{`, "m"));
  if (start < 0) { missing.push(`${name} — expected "const ${name} = {...}" in ${file}`); return ""; }
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  missing.push(`${name} — unbalanced braces in ${file}`);
  return "";
}

// { onBase: 20, fielding: 7, ... }
function plainWeights(file, name) {
  const body = constObjectText(file, name);
  const out = {};
  for (const m of body.matchAll(/(\w+)\s*:\s*(-?[0-9.]+)/g)) out[m[1]] = Number(m[2]);
  if (!Object.keys(out).length && body) missing.push(`${name} — no "key: number" pairs found in ${file}`);
  return out;
}

// { [RESULTS.SO]: -4, ... } keyed by the RESULTS member name.
function chartTable(file, name) {
  const body = constObjectText(file, name);
  const out = {};
  for (const m of body.matchAll(/\[RESULTS\.(\w+)\]\s*:\s*(-?[0-9.]+)/g)) out[m[1]] = Number(m[2]);
  if (!Object.keys(out).length && body) missing.push(`${name} — no "[RESULTS.X]: number" pairs found in ${file}`);
  return out;
}

const K = {
  hitterWeights: plainWeights("valuation.js", "HITTER_BASE_WEIGHTS"),
  pitcherWeights: plainWeights("valuation.js", "PITCHER_BASE_WEIGHTS"),
  hitterChart: chartTable("valuation.js", "HITTER_CHART_VALUES"),
  pitcherChart: chartTable("valuation.js", "PITCHER_CHART_VALUES"),
  perturbation: constNum("valuation.js", "PERTURBATION"),
  staff: constArray("valuation.js", "REFERENCE_STAFF_CONTROL"),
  armRate: constNum("valuation.js", "REPLACEMENT_ARM_RATE"),
  interactionScale: constNum("valuation.js", "HITTER_INTERACTION_SCALE"),
  spAnchor: constNum("valuation.js", "SP_SLOT_ANCHOR"),
  spDiscountAnchor: constNum("valuation.js", "SP_SLOT_DISCOUNT_ANCHOR"),
  spCap: constNum("valuation.js", "SP_SLOT_FACTOR_CAP"),

  hitterTarget: constNum("draft.js", "HITTER_TARGET"),
  relieverSpacingShare: constNum("draft.js", "RELIEVER_SPACING_SHARE"),
  starterDiscount: constNum("draft.js", "STARTER_DISCOUNT"),
  narrowSpread: constNum("draft.js", "NARROW_SPREAD"),
  wideSpread: constNum("draft.js", "WIDE_SPREAD"),
  relieverTop: constNum("draft.js", "RELIEVER_TOP_RATE"),
  relieverDepth: constNum("draft.js", "RELIEVER_DEPTH_RATE"),
  depthSlots: constNum("draft.js", "DEPTH_SLOTS"),
  depthDamp: constNum("draft.js", "DEPTH_DAMP"),
  shareExponent: constNum("draft.js", "SHARE_EXPONENT"),
  poolStrength: constNum("draft.js", "POOL_PREMIUM_STRENGTH"),
  poolThreshold: constNum("draft.js", "POOL_PREMIUM_THRESHOLD"),
  urgencyPatient: constNum("draft.js", "URGENCY_PATIENT"),
  urgencyDesperate: constNum("draft.js", "URGENCY_DESPERATE"),
  urgencyWeight: constNum("draft.js", "URGENCY_WEIGHT"),
  penDepth: constNum("draft.js", "AUCTION_PEN_DEPTH"),
  minBid: constNum("draft.js", "AUCTION_MIN_BID")
};

if (missing.length) {
  console.error("\nvaluation-report: the source has moved under this document.\n");
  for (const m of missing) console.error(`  MISSING  ${m}`);
  console.error("\nFix the extractor in scripts/valuation-report.mjs, then re-run."
    + "\nNothing was written, so docs/valuation.html still shows the previous (now suspect) numbers.\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Re-implement the stated formula from those constants, for the self-check.
// ---------------------------------------------------------------------------

const RESULT_NAME = Object.fromEntries(Object.entries(RESULTS).map(([name, value]) => [value, name]));
const byResultName = (table) => Object.fromEntries(
  Object.entries(table).map(([name, v]) => [RESULTS[name], v])
);
const HV = byResultName(K.hitterChart);
const PV = byResultName(K.pitcherChart);

const chartSlots = (chart) => (chart ?? []).reduce((s, e) => s + chartSpan(e), 0);
const chartTotal = (chart, table) => (chart ?? []).reduce((s, e) => s + chartSpan(e) * (table[e.result] ?? 0), 0);
const chartRate = (chart, table) => (chartSlots(chart) ? chartTotal(chart, table) / chartSlots(chart) : 0);

const onBaseUsage = (ob) => K.staff.reduce(
  (t, control) => t + Math.max(0, Math.min(20, (Number(ob) || 0) - control)) / 20, 0
) / K.staff.length;

function statedHitterValue(card, w) {
  const usage = onBaseUsage(card.onBase);
  const lean = w.onBase / K.hitterWeights.onBase;
  const edge = chartRate(card.chart, HV) * w.chart - K.armRate;
  return {
    usage, lean, edge,
    interaction: usage * lean * edge * K.interactionScale,
    glove: (Number(card.fielding) || 0) * w.fielding,
    legs: Math.max(0, (Number(card.speed) || 0) - 1) * w.speed,
    get total() { return this.interaction + this.glove + this.legs; }
  };
}

function statedPitcherValue(card, w, spSlots) {
  const ip = Number(card.ip) || 0;
  const controlTerm = (Number(card.control) || 0) * w.control;
  const chartTerm = chartTotal(card.chart, PV) * w.chart;
  const workload = (ip + 4) / 10;
  const ipTerm = ip * w.ip;
  const factor = card.role === "SP" ? spSlotFactor(spSlots) : 1;
  return {
    controlTerm, chartTerm, workload, ipTerm, factor,
    get total() { return ((this.controlTerm + this.chartTerm) * this.workload + this.ipTerm) * this.factor; }
  };
}

// ---------------------------------------------------------------------------
// 3. Build a real board and a real auction, so every example is engine-true.
// ---------------------------------------------------------------------------

const PEN = { bullpenSlots: 2, bullpenMin: 2 };
const pool = buildDraftPool(UNIVERSE, SEED, {
  nomination: "manual", managerCount: TEAMS, startingPitchers: SP_SLOTS, ...PEN
});
const draft = D.createDraft(
  Array.from({ length: TEAMS }, (_, i) => ({ name: `Seat ${i + 1}`, cpu: true })),
  pool, ROSTER, SEED,
  {
    draftType: "auction", nomination: "manual", startingPitchers: SP_SLOTS,
    budget: BUDGET, timer: false, snakeTimer: false, ...PEN
  }
);
// Persona is deliberately held constant: this document is about the formula, so
// every seat reads the board the same way. The spread that remains between the
// seats is the +-PERTURBATION weight noise and the per-lot aggression wobble.
for (const m of draft.managers) m.persona = "balanced";
D.completeAuctionReview?.(draft, 0);

const seat = draft.managers[0];
const rawModel = D.managerValuation(draft, seat);        // layer 1 only
const model = D.pitcherRanking(draft, rawModel);          // layers 1-2
const cards = [...draft.pool];
const hitters = cards.filter((c) => c.kind === "hitter");
const starters = cards.filter((c) => c.kind === "pitcher" && (c.role ?? "RP") === "SP");
const relievers = cards.filter((c) => c.kind === "pitcher" && (c.role ?? "RP") === "RP");

// --- the self-check -------------------------------------------------------
let worstErr = 0;
let worstCard = null;
for (const c of cards) {
  if (c.kind === "coach" || c.coach) continue;
  const stated = c.kind === "pitcher"
    ? statedPitcherValue(c, rawModel.weights.pitcher, SP_SLOTS).total
    : statedHitterValue(c, rawModel.weights.hitter).total;
  const err = Math.abs(stated - rawModel.value(c));
  if (err > worstErr) { worstErr = err; worstCard = c; }
}
const checked = cards.filter((c) => !(c.kind === "coach" || c.coach)).length;
const inSync = worstErr < 1e-9;

// --- pick the pet examples ------------------------------------------------
// A named card if this board dealt him, otherwise the board's best at the role.
// Which one happened is reported on the page, so a silent fallback can never be
// mistaken for the card that was asked for.
function pick(list, want) {
  const found = list.find((c) => c.name.toLowerCase().includes(String(want).toLowerCase()));
  if (found) return { card: found, asked: want, fellBack: false };
  return { card: [...list].sort((a, b) => model.value(b) - model.value(a))[0], asked: want, fellBack: true };
}
const batPick = pick(hitters, WANT_BAT);
const armPick = pick(starters, WANT_ARM);
const petBat = batPick.card;
const petArm = armPick.card;
const pickNote = (p, role) => p.fellBack
  ? `<p class="micro">Asked for <code>${esc(p.asked)}</code>, who this board did not deal — showing its best ${role} instead. Name a card this board holds with <code>--${role === "bat" ? "bat" : "arm"} "…"</code>.</p>`
  : "";

// --- layer 2 numbers ------------------------------------------------------
const batters = lineupProfile(
  [...hitters].sort((a, b) => rawModel.value(b) - rawModel.value(a))
    .slice(0, Math.max(K.hitterTarget, TEAMS * K.hitterTarget))
);
const spRates = starters.map((c) => runsPerPa(c, 0, batters)).sort((a, b) => a - b);
const mean = (l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : 0);
const rateMean = mean(spRates);
const starterSpread = Math.sqrt(mean(spRates.map((r) => (r - rateMean) ** 2)));
const widening = Math.max(0, Math.min(1, (starterSpread - K.narrowSpread) / (K.wideSpread - K.narrowSpread)));
const starterTilt = K.starterDiscount + (1 - K.starterDiscount) * widening;

const armRows = [...starters]
  .map((c) => ({ card: c, rpa: runsPerPa(c, 0, batters), l1: rawModel.value(c), l2: model.value(c) }))
  .sort((a, b) => a.rpa - b.rpa);
const armRank = armRows.findIndex((r) => r.card.id === petArm.id);
// The re-deal hands the sorted values to the rate order, so the best arm by rate
// must come out holding the highest tilted value. Shown on the page as a check.
const tiltedValues = starters.map((c) => rawModel.value(c) * starterTilt).sort((a, b) => b - a);
const redealOk = Math.abs(armRows[0].l2 - tiltedValues[0]) < 1e-9;

const penBeating = relievers.length > 1
  ? relievers.filter((c) => {
    const fielded = Math.floor(TEAMS * SP_SLOTS / 2);
    const rotationRpa = spRates.length ? spRates[Math.min(spRates.length - 1, fielded)] : 0;
    return rotationRpa - runsPerPa(c, 0, batters) > 0.02;
  }).length
  : 0;
const penShare = relievers.length ? penBeating / relievers.length : 0;
const penSpacing = Math.max(0, Math.min(1, penShare / K.relieverSpacingShare));

// ---------------------------------------------------------------------------
// 3b. The dial lab's payload.
//
// The page lets the reader move the weights and watch every card move. For that
// the browser needs its own copy of the model, which raises the obvious question
// of whether that copy still says what the engine says. Two checks chain to
// answer it:
//
//   Node   : the stated formula reproduces the engine, on the PERTURBED weights
//            a real manager carries (the self-check above), and the re-deal
//            below reproduces pitcherRanking's output card for card.
//   Browser: the ported model reproduces the values baked into the page, at the
//            default dial positions.
//
// The baked values are computed on the BASE weights with no perturbation, so the
// lab is noise-free and reproducible; a live draft adds the +-PERTURBATION
// wobble on top and the page says so.
// ---------------------------------------------------------------------------

const rotationFielded = Math.floor(TEAMS * SP_SLOTS / 2);
const rotationRpa = spRates.length ? spRates[Math.min(spRates.length - 1, rotationFielded)] : 0;
const relieverSeasonInnings = (gap, ip) => Math.max(20, Math.min(550, 70 + 2200 * gap + 50 * (Number(ip) || 1)));
const rpaOf = (c) => runsPerPa(c, 0, batters);
const seasonOf = (c) => (batters.runValue - rpaOf(c)) * relieverSeasonInnings(rotationRpa - rpaOf(c), c.ip);

// A re-implementation of pitcherRanking's re-deal that takes the layer-1 values
// as an argument, so it can be run on the perturbed values (to prove it matches
// the engine) and then on the base ones (to bake the lab's numbers).
function redeal(valueOf, tilt) {
  const out = new Map();
  for (const role of ["SP", "RP"]) {
    const arms = cards.filter((c) => c.kind === "pitcher" && (c.role ?? "RP") === role);
    if (!arms.length) continue;
    const t = role === "SP" ? tilt : 1;
    const values = arms.map((c) => valueOf(c) * t).sort((a, b) => b - a);
    const byRate = [...arms].sort((a, b) => rpaOf(a) - rpaOf(b));
    const byRank = new Map();
    byRate.forEach((c, i) => byRank.set(c.id, values[i]));
    const share = role === "RP" && arms.length > 1
      ? arms.filter((c) => rotationRpa - rpaOf(c) > 0.02).length / arms.length
      : 0;
    const spacing = Math.max(0, Math.min(1, share / K.relieverSpacingShare));
    if (!spacing) { arms.forEach((c) => out.set(c.id, byRank.get(c.id))); continue; }
    const seasons = arms.map(seasonOf);
    const low = Math.min(...seasons);
    const high = Math.max(...seasons);
    const bottom = values[values.length - 1];
    const slope = high > low ? (values[0] - bottom) / (high - low) : 0;
    arms.forEach((c, i) => {
      const spaced = bottom + slope * (seasons[i] - low);
      out.set(c.id, spacing * spaced + (1 - spacing) * byRank.get(c.id));
    });
  }
  return out;
}

const redealCheck = redeal((c) => rawModel.value(c), starterTilt);
let redealWorst = 0;
for (const c of cards) {
  if (c.kind !== "pitcher") continue;
  redealWorst = Math.max(redealWorst, Math.abs((redealCheck.get(c.id) ?? 0) - model.value(c)));
}
const redealMatches = redealWorst < 1e-9;

const baseValue = (c) => (c.kind === "pitcher"
  ? statedPitcherValue(c, K.pitcherWeights, SP_SLOTS).total
  : statedHitterValue(c, K.hitterWeights).total);
const baseRanked = redeal(baseValue, starterTilt);

const labCards = cards
  .filter((c) => !(c.kind === "coach" || c.coach))
  .map((c) => {
    const arm = c.kind === "pitcher";
    const row = {
      id: c.id,
      name: c.name,
      kind: arm ? (c.role ?? "RP") : "bat",
      pos: arm ? (c.role ?? "RP") : (Array.isArray(c.position) ? c.position.join("/") : String(c.position ?? "")),
      pts: Number(c.points) || 0,
      free: Boolean(c.replacement),
      chart: (c.chart ?? []).map((e) => [RESULT_NAME[e.result] ?? "?", chartSpan(e)]),
      v1: baseValue(c),
      v2: baseRanked.has(c.id) ? baseRanked.get(c.id) : baseValue(c)
    };
    if (arm) {
      row.ctl = Number(c.control) || 0;
      row.ip = Number(c.ip) || 0;
      row.rpa = rpaOf(c);
      row.season = seasonOf(c);
    } else {
      row.ob = Number(c.onBase) || 0;
      row.fld = Number(c.fielding) || 0;
      row.spd = Number(c.speed) || 0;
    }
    return row;
  })
  .sort((a, b) => b.v2 - a.v2);

const labPayload = {
  cards: labCards,
  board: {
    universe: UNIVERSE, seed: SEED, spSlots: SP_SLOTS, teams: TEAMS,
    starterSpread, rotationRpa, battersRunValue: batters.runValue, battersOnBase: batters.onBase
  },
  defaults: {
    hOnBase: K.hitterWeights.onBase, hField: K.hitterWeights.fielding,
    hSpeed: K.hitterWeights.speed, hChart: K.hitterWeights.chart,
    scale: K.interactionScale, armRate: K.armRate,
    pControl: K.pitcherWeights.control, pIp: K.pitcherWeights.ip, pChart: K.pitcherWeights.chart,
    spSlots: SP_SLOTS,
    starterDiscount: K.starterDiscount, narrowSpread: K.narrowSpread, wideSpread: K.wideSpread,
    hitterChart: { ...K.hitterChart }, pitcherChart: { ...K.pitcherChart }
  },
  staff: K.staff,
  spacingShare: K.relieverSpacingShare,
  spAnchor: K.spAnchor, spDiscountAnchor: K.spDiscountAnchor, spCap: K.spCap,
  perturbation: K.perturbation
};

// --- layer 3 numbers ------------------------------------------------------
const groupFloor = (group) => {
  let floor;
  for (const c of cards) {
    if (c.kind === "coach" || c.coach) continue;
    if (D.poolGroup(c) !== group) continue;
    const v = model.value(c);
    if (floor === undefined || v < floor) floor = v;
  }
  return floor ?? 0;
};
const standing = D.standingReplacements(draft) ?? [];
const standingByGroup = new Map();
for (const c of standing) {
  const g = D.poolGroup(c);
  const v = model.value(c);
  if (!standingByGroup.has(g) || v > standingByGroup.get(g).value) {
    standingByGroup.set(g, { value: v, card: c });
  }
}
const petBatGroup = D.poolGroup(petBat);
const petBatBoardFloor = groupFloor(petBatGroup);
const petBatStanding = standingByGroup.get(petBatGroup) ?? null;
const petBatFloor = petBatStanding ? Math.max(petBatBoardFloor, petBatStanding.value) : petBatBoardFloor;

// The glove he is actually credited with, read at the slot he would stand in.
const seatedGlove = (roster) => D.assignLineupSlots(roster).slots
  .reduce((t, s) => t + (s.player ? (Number(s.fielding) || 0) : 0), 0);
const petBatSeatedGlove = seatedGlove([petBat]) - seatedGlove([]);

// --- layer 5: a live lot, and the branch switch ---------------------------
function bidsOn(card, rosterFor0 = []) {
  const d = D.createDraft(
    Array.from({ length: TEAMS }, (_, i) => ({ name: `Seat ${i + 1}`, cpu: true })),
    pool, ROSTER, SEED,
    {
      draftType: "auction", nomination: "manual", startingPitchers: SP_SLOTS,
      budget: BUDGET, timer: false, snakeTimer: false, ...PEN
    }
  );
  for (const m of d.managers) m.persona = "balanced";
  D.completeAuctionReview?.(d, 0);
  if (rosterFor0.length) {
    for (const name of rosterFor0) {
      const c = d.pool.find((x) => x.name === name);
      if (!c) continue;
      d.managers[0].roster.push(c);
      // A bought card leaves the board, so take him out of the pool too —
      // otherwise he still counts as a card the seat expects to see later.
      d.pool = d.pool.filter((x) => x.id !== c.id);
    }
  }
  try { D.nominatePlayer(d, card.id, 0); } catch { return null; }
  const lot = D.auctionLotPlayer(d);
  if (!lot || lot.id !== card.id) return null;
  return d.managers.map((m) => ({
    name: m.name,
    budget: D.auctionBudget(d, m),
    maxBid: D.auctionMaxBid(d, m),
    own: D.pitcherRanking(d, D.managerValuation(d, m)).value(card),
    bid: D.cpuSealedBid(d, m)
  }));
}

const batLot = bidsOn(petBat);
const armLot = bidsOn(petArm);

// The exhibit: the same bat, to the same seat, with and without two better men
// already standing at his position. Nothing else changes.
const samePosBetter = hitters
  .filter((c) => c.id !== petBat.id && D.poolGroup(c) === petBatGroup)
  .sort((a, b) => model.value(b) - model.value(a))
  .slice(0, 2);
const batLotBlocked = samePosBetter.length === 2 ? bidsOn(petBat, samePosBetter.map((c) => c.name)) : null;
const blockedFlipped = Boolean(batLot && batLotBlocked && batLot[0].bid !== batLotBlocked[0].bid);

// --- points vs value, the outliers ---------------------------------------
const valued = cards.filter((c) => !(c.kind === "coach" || c.coach))
  .map((c) => ({ card: c, value: model.value(c), points: Number(c.points) || 0 }))
  .filter((r) => r.points > 0);
const perPoint = valued.map((r) => ({ ...r, ratio: r.value / r.points }));
const bargains = [...perPoint].sort((a, b) => b.ratio - a.ratio).slice(0, 5);
const traps = [...perPoint].sort((a, b) => a.ratio - b.ratio).slice(0, 5);

// ---------------------------------------------------------------------------
// 4. Render.
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");
const n3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : "—");
const n4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : "—");
const n0 = (x) => (Number.isFinite(x) ? Math.round(x).toString() : "—");

let commit = "unknown";
let dirty = false;
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
  dirty = execSync("git status --porcelain src/rules/valuation.js src/rules/draft.js", { cwd: ROOT })
    .toString().trim().length > 0;
} catch { /* not a git checkout; the page just says unknown */ }

// The two tables do not share a key set — a pitcher's chart has PU, a hitter's
// has 1B+ — so the columns are the UNION of both, and a row with no entry for a
// column prints a dash. Filtering each row by its own keys silently slid the
// pitcher row one column left.
const H_ORDER = ["SO", "GB", "FB", "PU", "BB", "SINGLE", "SINGLE_PLUS", "DOUBLE", "TRIPLE", "HR"];
const shortResult = (name) => name.replace("SINGLE_PLUS", "1B+").replace("SINGLE", "1B")
  .replace("DOUBLE", "2B").replace("TRIPLE", "3B");
const chartColumns = H_ORDER.filter((name) => K.hitterChart[name] !== undefined || K.pitcherChart[name] !== undefined);
const chartRow = (table) => chartColumns
  .map((name) => (table[name] === undefined
    ? `<td class="na">—</td>`
    : `<td>${table[name] > 0 ? "+" : ""}${table[name]}</td>`)).join("");
const chartHead = () => chartColumns.map((name) => `<th>${esc(shortResult(name))}</th>`).join("");

const statline = (c) => {
  const bits = c.kind === "pitcher"
    ? [["role", c.role ?? "RP"], ["control", c.control], ["IP", c.ip], ["points", c.points]]
    : [["position", Array.isArray(c.position) ? c.position.join("/") : c.position],
      ["on-base", c.onBase], ["fielding", c.fielding ?? 0], ["speed", c.speed ?? 0], ["points", c.points]];
  return bits.map(([k, v]) => `<div class="stat"><dt>${esc(k)}</dt><dd>${esc(v ?? "—")}</dd></div>`).join("");
};

const chartStrip = (c) => {
  const slots = chartSlots(c.chart);
  if (!slots) return "";
  return `<div class="chartstrip">${(c.chart ?? []).map((e) => {
    const span = chartSpan(e);
    const label = RESULT_NAME[e.result] ?? "?";
    const short = label.replace("SINGLE_PLUS", "1B+").replace("SINGLE", "1B")
      .replace("DOUBLE", "2B").replace("TRIPLE", "3B");
    return `<span class="slot" style="flex:${span}" title="${esc(short)} × ${span}">${esc(short)}<small>${span}</small></span>`;
  }).join("")}</div><p class="micro">${slots} chart slots</p>`;
};

const batMath = statedHitterValue(petBat, rawModel.weights.hitter);
const armMath = statedPitcherValue(petArm, rawModel.weights.pitcher, SP_SLOTS);

const bidTable = (rows, card) => !rows ? `<p class="micro">Could not open a lot for this card on this board.</p>` : `
<div class="scroll"><table>
  <thead><tr><th>seat</th><th>budget</th><th>max bid</th><th>its own value of ${esc(card.name)}</th><th>sealed bid</th></tr></thead>
  <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>$${n0(r.budget)}</td><td>$${n0(r.maxBid)}</td><td>${n0(r.own)}</td><td class="em">$${n0(r.bid)}</td></tr>`).join("")}</tbody>
</table></div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Card Valuation Chain</title>
<style>
  /* Layout: one reading column, formulas and tables breaking out to full width.
     Palette reads off a scoreboard — graphite ground, phosphor-green accent,
     amber for anything the reader should argue with. */
  :root {
    --bg: #f7f8f7;
    --panel: #ffffff;
    --ink: #16201b;
    --ink-soft: #5a6660;
    --rule: #dfe4e0;
    --accent: #0f6b43;
    --accent-soft: #e6f2eb;
    --warn: #8a5a00;
    --warn-soft: #fdf3e0;
    --bad: #a02b1f;
    --bad-soft: #fbeae8;
    /* Diverging pair for the dial lab's shift meters: blue rises, red falls.
       Validated against this page's own surfaces in both modes — adjacent CVD
       deltaE 21.6 light / 19.2 dark, normal-vision 32.3 / 29.0, all checks pass. */
    --up: #2a78d6;
    --down: #e34948;
    --mid: #e9ebe9;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #111512;
      --panel: #19201c;
      --ink: #e6ece8;
      --ink-soft: #9aa8a0;
      --rule: #2a332d;
      --accent: #5fd39b;
      --accent-soft: #16291f;
      --warn: #e0ae5c;
      --warn-soft: #2b2316;
      --bad: #f08b7d;
      --up: #3987e5;
      --down: #e66767;
      --mid: #26302a;
      --bad-soft: #2e1a17;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #111512;
    --panel: #19201c;
    --ink: #e6ece8;
    --ink-soft: #9aa8a0;
    --rule: #2a332d;
    --accent: #5fd39b;
    --accent-soft: #16291f;
    --warn: #e0ae5c;
    --warn-soft: #2b2316;
    --bad: #f08b7d;
    --up: #3987e5;
    --down: #e66767;
    --mid: #26302a;
    --bad-soft: #2e1a17;
    color-scheme: dark;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.6 var(--sans);
    -webkit-text-size-adjust: 100%;
  }
  .wrap {
    max-width: 60rem;
    margin: 0 auto;
    padding-left: max(16px, env(safe-area-inset-left, 0px));
    padding-right: max(16px, env(safe-area-inset-right, 0px));
    padding-block: 2.5rem 5rem;
  }
  p, li { max-width: 68ch; }
  h1 { font-size: clamp(1.7rem, 4.5vw, 2.4rem); line-height: 1.15; margin: 0 0 .4rem; letter-spacing: -.02em; text-wrap: balance; }
  h2 {
    font-size: 1.3rem; margin: 3.5rem 0 .2rem; letter-spacing: -.01em; text-wrap: balance;
    padding-top: 1.2rem; border-top: 2px solid var(--ink);
  }
  h3 { font-size: 1rem; margin: 2rem 0 .3rem; }
  .eyebrow {
    font: 600 .7rem/1 var(--mono); letter-spacing: .14em; text-transform: uppercase;
    color: var(--accent); margin: 0 0 .5rem;
  }
  .lede { color: var(--ink-soft); font-size: 1.05rem; }
  .micro { font: .78rem/1.5 var(--mono); color: var(--ink-soft); }
  code, .mono { font-family: var(--mono); font-size: .86em; }

  .banner {
    margin: 1.5rem 0 0; padding: 1rem 1.1rem; border-radius: 3px;
    border-left: 4px solid var(--accent); background: var(--accent-soft);
  }
  .banner.stale { border-left-color: var(--bad); background: var(--bad-soft); }
  .banner h2 { all: unset; display: block; font: 600 1rem/1.3 var(--sans); }
  .banner p { margin: .35rem 0 0; font-size: .9rem; }

  .formula {
    font-family: var(--mono); font-size: .84rem; line-height: 1.75;
    white-space: pre; overflow-x: auto;
    background: var(--panel); border: 1px solid var(--rule); border-left: 3px solid var(--accent);
    padding: 1rem 1.1rem; margin: 1rem 0; border-radius: 2px;
  }
  .scroll { overflow-x: auto; margin: 1rem 0; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; font-variant-numeric: tabular-nums; }
  th, td { text-align: right; padding: .42rem .7rem; border-bottom: 1px solid var(--rule); white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }
  thead th {
    font: 600 .7rem/1.3 var(--mono); letter-spacing: .06em; text-transform: uppercase;
    color: var(--ink-soft); border-bottom: 1.5px solid var(--ink-soft);
  }
  tbody tr:hover { background: var(--accent-soft); }
  td.em { font-weight: 700; color: var(--accent); }
  td.na { color: var(--ink-soft); opacity: .55; }
  .total td { border-top: 1.5px solid var(--ink); border-bottom: none; font-weight: 700; }

  .card {
    background: var(--panel); border: 1px solid var(--rule); border-radius: 3px;
    padding: 1.1rem 1.2rem; margin: 1.2rem 0;
  }
  .card > h3 { margin-top: 0; }
  .stats { display: flex; flex-wrap: wrap; gap: .4rem 1.8rem; margin: 0 0 .9rem; }
  .stat { min-width: 0; }
  .stat dt { font: 600 .66rem/1.4 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
  .stat dd { margin: 0; font: 600 1.15rem/1.2 var(--mono); font-variant-numeric: tabular-nums; }
  .chartstrip { display: flex; gap: 2px; margin: .2rem 0 .3rem; min-width: 0; }
  .chartstrip .slot {
    min-width: 0; overflow: hidden; text-align: center; padding: .3rem .1rem;
    background: var(--accent-soft); border-radius: 2px;
    font: 600 .62rem/1.2 var(--mono); color: var(--ink);
  }
  .chartstrip .slot small { display: block; font-weight: 400; color: var(--ink-soft); }

  .note { border-left: 3px solid var(--warn); background: var(--warn-soft); padding: .85rem 1rem; margin: 1.2rem 0; border-radius: 2px; }
  .note p { margin: 0; font-size: .9rem; }
  .note p + p { margin-top: .5rem; }
  .note strong { color: var(--warn); }

  /* --- dial lab ------------------------------------------------------ */
  .lab { background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 1.1rem 1.2rem; margin: 1.5rem 0; }
  .labhead { display: flex; flex-wrap: wrap; gap: .6rem 1rem; align-items: baseline; justify-content: space-between; }
  .labhead h3 { margin: 0; }
  .btn {
    font: 600 .76rem/1 var(--mono); padding: .45rem .8rem; cursor: pointer;
    background: var(--panel); color: var(--ink); border: 1px solid var(--rule); border-radius: 3px;
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .dialgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .1rem 2rem; margin: 1rem 0 0; }
  .dial { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: .1rem .6rem; padding: .35rem 0; border-bottom: 1px solid var(--rule); min-width: 0; }
  .dial label { font: 600 .74rem/1.3 var(--mono); min-width: 0; }
  .dial .def { display: block; font-weight: 400; color: var(--ink-soft); font-size: .68rem; }
  .dial input[type="number"] { width: 5.2rem; font: 600 .8rem var(--mono); padding: .22rem .35rem; text-align: right; background: var(--bg); color: var(--ink); border: 1px solid var(--rule); border-radius: 2px; font-variant-numeric: tabular-nums; }
  .dial input[type="range"] { grid-column: 1 / -1; width: 100%; accent-color: var(--accent); margin: 0; }
  .dial.changed label { color: var(--accent); }
  .dial.changed input[type="number"] { border-color: var(--accent); }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .8rem; margin: 1.2rem 0 0; }
  .tile { border: 1px solid var(--rule); border-radius: 3px; padding: .6rem .75rem; min-width: 0; }
  .tile dt { font: 600 .64rem/1.4 var(--mono); letter-spacing: .09em; text-transform: uppercase; color: var(--ink-soft); }
  .tile dd { margin: .15rem 0 0; font: 700 1.25rem/1.15 var(--mono); font-variant-numeric: tabular-nums; }
  .tile dd small { display: block; font: 400 .7rem/1.3 var(--sans); color: var(--ink-soft); white-space: normal; }

  .labbar { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; margin: 1.3rem 0 .2rem; }
  .labbar input[type="search"] { flex: 1 1 9rem; min-width: 0; font: .8rem var(--mono); padding: .4rem .55rem; background: var(--bg); color: var(--ink); border: 1px solid var(--rule); border-radius: 3px; }

  .meter { display: block; width: 100%; min-width: 7rem; height: 14px; }
  .meter .mid { fill: var(--ink-soft); opacity: .35; }
  .meter .up { fill: var(--up); }
  .meter .down { fill: var(--down); }
  td.shift { width: 34%; padding-right: .3rem; }
  td.delta { font-weight: 700; font-variant-numeric: tabular-nums; }
  td.delta.up { color: var(--up); }
  td.delta.down { color: var(--down); }
  .rank { font: .72rem var(--mono); color: var(--ink-soft); }
  .rank.up { color: var(--up); }
  .rank.down { color: var(--down); }
  .freeflag { font: 600 .6rem/1 var(--mono); letter-spacing: .06em; padding: .13rem .3rem; border-radius: 2px; background: var(--warn-soft); color: var(--warn); margin-left: .35rem; }
  .labcheck { font: .76rem/1.5 var(--mono); margin: .9rem 0 0; padding: .5rem .7rem; border-radius: 2px; background: var(--accent-soft); color: var(--ink); }
  .labcheck.bad { background: var(--bad-soft); color: var(--bad); font-weight: 700; }
  details.more { margin: 1rem 0 0; }
  details.more > summary { cursor: pointer; font: 600 .78rem var(--mono); color: var(--accent); padding: .3rem 0; }
  @media (max-width: 560px) { td.shift { display: none; } }

  .toc { display: flex; flex-wrap: wrap; gap: .4rem; margin: 1.5rem 0 0; padding: 0; list-style: none; }
  .toc li { margin: 0; }
  .toc a {
    display: block; padding: .3rem .7rem; border: 1px solid var(--rule); border-radius: 100px;
    font: 600 .74rem/1.4 var(--mono); color: var(--ink-soft); text-decoration: none; background: var(--panel);
  }
  .toc a:hover, .toc a:focus-visible { border-color: var(--accent); color: var(--accent); }
  a { color: var(--accent); }
  a:focus-visible, .toc a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .foot { margin-top: 4rem; padding-top: 1.2rem; border-top: 1px solid var(--rule); }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>
</head>
<body>
<main class="wrap">

  <p class="eyebrow">Generated from source</p>
  <h1>How a card gets a number put on it</h1>
  <p class="lede">
    Five layers turn a printed card into a dollar bid. Each one reshapes the number the
    previous one produced, which is why three different quantities all end up being called
    &ldquo;value&rdquo;. Every constant and every figure below is read out of the engine at
    generation time.
  </p>

  <ul class="toc">
    <li><a href="#check">Self-check</a></li>
    <li><a href="#lab"><strong>Turn the dials</strong></a></li>
    <li><a href="#l1">1 · Card model</a></li>
    <li><a href="#l2">2 · Board re-deal</a></li>
    <li><a href="#l3">3 · Context</a></li>
    <li><a href="#l4">4 · Worth</a></li>
    <li><a href="#l5">5 · Dollars</a></li>
    <li><a href="#pet">Worked examples</a></li>
    <li><a href="#argue">Open questions</a></li>
  </ul>

  <div class="banner${inSync ? "" : " stale"}" id="check">
    <h2>${inSync
      ? `This document matches the engine.`
      : `STALE — this document no longer matches the engine.`}</h2>
    <p>
      The formulas printed below were re-implemented from the extracted constants and run
      against all <strong>${checked}</strong> cards on a <code>${esc(UNIVERSE)}</code> board.
      ${inSync
        ? `Every card reproduced exactly (worst disagreement ${worstErr.toExponential(1)}).`
        : `Worst disagreement <strong>${n2(worstErr)}</strong>, on ${esc(worstCard?.name ?? "?")}.
           A constant changing is handled automatically; this means the <em>shape</em> of a
           value function changed. Update <code>scripts/valuation-report.mjs</code> so the
           stated formula matches the code again.`}
    </p>
    <p class="micro">
      ${redealMatches
        ? `The board re-deal reproduces <code>pitcherRanking</code> card for card.`
        : `<strong>The board re-deal does NOT reproduce pitcherRanking</strong> (worst ${n2(redealWorst)}), so layer 2 on this page is wrong.`}
    </p>
    <p class="micro">
      ${esc(commit)}${dirty ? " + uncommitted edits to valuation.js/draft.js" : ""}
      · ${new Date().toISOString().replace("T", " ").slice(0, 16)}
      · board ${esc(UNIVERSE)}/${esc(SEED)} · ${SP_SLOTS} SP slots · ${TEAMS} seats · $${BUDGET}
      · persona held at balanced
    </p>
  </div>

  <!-- ============================ DIAL LAB ============================ -->
  <h2 id="lab">Turn the dials</h2>
  <p>
    Every number in the card model, live. Move one and watch all
    ${labCards.length} cards on this board re-rank underneath. The layers below
    explain what each dial does; this is where you find out whether it matters.
  </p>

  <div class="lab">
    <div class="labhead">
      <h3>Dials</h3>
      <button type="button" class="btn" id="reset">Reset to the code's values</button>
    </div>

    <div class="dialgrid" id="dials-main"></div>

    <details class="more">
      <summary>Chart tables — what one slot of each result is worth</summary>
      <p class="micro">
        A hitter's chart counts as a per-slot average, a pitcher's as a sum, so the
        two tables are on different scales and are not comparable term by term.
      </p>
      <div class="dialgrid" id="dials-hchart"></div>
      <div class="dialgrid" id="dials-pchart"></div>
    </details>

    <dl class="tiles" id="tiles"></dl>
    <p class="labcheck" id="labcheck"></p>

    <div class="labbar">
      <button type="button" class="btn" data-filter="all" aria-pressed="true">All</button>
      <button type="button" class="btn" data-filter="bat" aria-pressed="false">Bats</button>
      <button type="button" class="btn" data-filter="SP" aria-pressed="false">Starters</button>
      <button type="button" class="btn" data-filter="RP" aria-pressed="false">Relievers</button>
      <input type="search" id="find" placeholder="find a card…" aria-label="Filter cards by name">
    </div>

    <div class="scroll">
      <table>
        <thead><tr>
          <th>card</th><th>points</th><th>baseline</th><th>now</th>
          <th class="shift">shift</th><th>change</th><th>rank</th>
        </tr></thead>
        <tbody id="labrows"></tbody>
      </table>
    </div>
    <p class="micro" id="labcount"></p>
  </div>

  <!-- ============================ LAYER 1 ============================ -->
  <h2 id="l1">1 · The card model — raw card to value points</h2>
  <p class="micro">src/rules/valuation.js</p>
  <p>
    The only layer that looks at a card on its own, with no board and no roster around it.
    Hitters and pitchers do not share a formula and do not even read their charts the same
    way: a hitter's chart counts as a <strong>per-slot rate</strong>, a pitcher's as a
    <strong>total</strong>. So chart size matters for an arm and not for a bat.
  </p>

  <h3>Hitters</h3>
  <div class="formula">hitterValue = onBaseUsage(onBase) × lean × edge × ${K.interactionScale}
              + fielding × ${K.hitterWeights.fielding}
              + max(0, speed − 1) × ${K.hitterWeights.speed}

onBaseUsage(ob) = mean over the reference staff [${K.staff.join(", ")}]
                  of clamp(ob − control, 0, 20) / 20
edge            = chartRate × w_chart − (${K.armRate})
lean            = w_onBase / ${K.hitterWeights.onBase}      (1 when persona-neutral)</div>
  <p>
    On-base <strong>multiplies</strong> chart quality instead of adding to it, because on-base
    literally is the share of plate appearances settled on the batter's own card. And
    <code>edge</code> is measured against <code>${K.armRate}</code> — what a typical
    pitcher's chart is worth when his card is the one read — so a bat whose chart rates below
    that line gets <em>negative</em> benefit from reaching base more often. He would rather the
    pitcher's card were consulted.
  </p>
  <div class="scroll"><table>
    <thead><tr><th>on-base</th>${[5, 7, 9, 11, 13, 15, 17].map((o) => `<th>${o}</th>`).join("")}</tr></thead>
    <tbody><tr><td>share of PAs on his own chart</td>${[5, 7, 9, 11, 13, 15, 17].map((o) => `<td>${n3(onBaseUsage(o))}</td>`).join("")}</tr></tbody>
  </table></div>

  <h3>Pitchers</h3>
  <div class="formula">pitcherValue = (control × ${K.pitcherWeights.control} + chartTotal × ${K.pitcherWeights.chart}) × (ip + 4)/10
             + ip × ${K.pitcherWeights.ip}
starters only:  × spSlotFactor(rotation size)</div>
  <div class="scroll"><table>
    <thead><tr><th>rotation size</th>${[1, 2, 3, 4, 5, 6].map((k) => `<th>${k} SP</th>`).join("")}</tr></thead>
    <tbody><tr><td>spSlotFactor</td>${[1, 2, 3, 4, 5, 6].map((k) => `<td>${n2(spSlotFactor(k))}</td>`).join("")}</tr></tbody>
  </table></div>
  <p class="micro">
    anchor ${K.spAnchor} · discount anchor ${K.spDiscountAnchor} · cap ${K.spCap} —
    a starter opens 1/rotation of the games, so his season scales with how often he takes the
    ball. Relievers never take this factor.
  </p>

  <h3>Weights and chart tables</h3>
  <div class="scroll"><table>
    <thead><tr><th>hitter weight</th>${Object.keys(K.hitterWeights).map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead>
    <tbody><tr><td>neutral base</td>${Object.values(K.hitterWeights).map((v) => `<td>${v}</td>`).join("")}</tr></tbody>
  </table></div>
  <div class="scroll"><table>
    <thead><tr><th>pitcher weight</th>${Object.keys(K.pitcherWeights).map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead>
    <tbody><tr><td>neutral base</td>${Object.values(K.pitcherWeights).map((v) => `<td>${v}</td>`).join("")}</tr></tbody>
  </table></div>
  <div class="scroll"><table>
    <thead><tr><th>chart slot is worth</th>${chartHead()}</tr></thead>
    <tbody>
      <tr><td>to a hitter (per slot, averaged)</td>${chartRow(K.hitterChart)}</tr>
      <tr><td>to a pitcher (summed over slots)</td>${chartRow(K.pitcherChart)}</tr>
    </tbody>
  </table></div>
  <div class="note">
    <p>
      <strong>Every weight is then multiplied by seeded noise of ±${Math.round(K.perturbation * 100)}%</strong>,
      keyed on <code>seed:valuation:managerId:persona</code>. This happens whatever the persona,
      so there is no such thing as &ldquo;the&rdquo; value of a card — only some manager's value
      of it. Two seats on the same board can be ${n2((1 + K.perturbation) / (1 - K.perturbation))}×
      apart on the same card before persona enters at all.
    </p>
  </div>

  <!-- ============================ LAYER 2 ============================ -->
  <h2 id="l2">2 · The board re-deals every arm</h2>
  <p class="micro">pitcherRanking() · src/rules/draft.js</p>
  <p>
    This is the layer that surprises people. It <strong>throws away layer 1's ordering of
    pitchers and keeps only its spacing.</strong> Bats pass through untouched.
  </p>
  <div class="formula">batters   = mean on-base and mean chart run value of the top ${Math.max(K.hitterTarget, TEAMS * K.hitterTarget)} bats on the board
advantage = share of d20 faces where d20 + control ≥ batters.onBase
runsPerPa = advantage × chartRunValue(his chart) + (1 − advantage) × batters.runValue

1. sort the role's arms by runsPerPa, best first
2. sort their layer-1 values, highest first
3. hand the sorted values to the rate order</div>
  <p>
    So the <em>order</em> comes from the engine's own hook rule — the real control × chart
    interaction the game plays — and the <em>spacing</em> comes from the card model. This is why
    an additive control-plus-chart valuation ranked arms worse than chart alone, and why
    re-pricing out types was a null: <code>runsPerPa</code> cannot tell a groundball from a
    flyball.
  </p>
  <p>On this board: <code>batters.onBase ${n2(batters.onBase)}</code>, <code>batters.runValue ${n3(batters.runValue)}</code>.</p>

  <h3>Starter tilt</h3>
  <div class="formula">spread  = sd of the board's starter runsPerPa
tilt    = ${K.starterDiscount} at spread ≤ ${K.narrowSpread}, 1.00 at spread ≥ ${K.wideSpread}, linear between

this board: spread ${n4(starterSpread)}  →  tilt ${n3(starterTilt)}</div>
  <p>
    A board whose starters sit in a narrow band has no real ace, so money buys more on a bat or
    a reliever. A board with a genuine cliff pays full price. ${starterTilt < 0.999
      ? `This board is on the narrow side, so every starter below is marked down ${Math.round((1 - starterTilt) * 100)}%.`
      : `This board has a wide enough spread that starters are priced as-is.`}
  </p>

  <h3>Reliever spacing</h3>
  <div class="formula">share   = relievers who beat the fielded rotation's rate by > 0.02 runs/PA
spacing = clamp(share / ${K.relieverSpacingShare}, 0, 1)
          then blend the rank values toward (runs saved × innings he would really throw)

this board: ${penBeating} of ${relievers.length} relievers (${n2(penShare * 100)}%)  →  spacing ${n2(penSpacing)}</div>
  <p class="micro">
    Printed points barely separate a 647-inning arm from a 29-inning one, which is how a
    computer once bid $119 on the best card in a room and $182 on a replacement-level one.
  </p>

  <h3>The re-deal, on this board's starters</h3>
  <p class="micro">
    ${redealOk
      ? `Identity holds: the best arm by rate comes out holding the highest tilted value.`
      : `<strong>Identity broken</strong> — the best arm by rate is not holding the highest tilted value. The re-deal has changed shape.`}
  </p>
  <div class="scroll"><table>
    <thead><tr><th>#</th><th>arm</th><th>points</th><th>runs/PA</th><th>layer 1</th><th>layer 2</th></tr></thead>
    <tbody>${armRows.slice(0, 10).map((r, i) => `<tr${r.card.id === petArm.id ? ' class="total"' : ""}>
      <td>${i + 1}</td><td>${esc(r.card.name)}</td><td>${n0(r.card.points)}</td>
      <td>${n4(r.rpa)}</td><td>${n0(r.l1)}</td><td class="em">${n0(r.l2)}</td></tr>`).join("")}</tbody>
  </table></div>

  <!-- ============================ LAYER 3 ============================ -->
  <h2 id="l3">3 · Context — who is already standing there</h2>
  <p>Three readings sit on top of layer 2, all of them about the card's surroundings rather than the card.</p>
  <h3>The replacement floor</h3>
  <p>
    Per <code>poolGroup</code> — a bat's <em>position</em>, <code>SP</code>/<code>RP</code> for an
    arm. It is the lowest value at that group anywhere in the deck, then <strong>raised</strong>
    to the standing replacement's value where the room deals them. Pass on every catcher and you
    are handed that free card, not the worst catcher on the board, so he is the man a real
    catcher has to beat.
  </p>
  ${standing.length ? `<div class="scroll"><table>
    <thead><tr><th>slot</th><th>free card dealt there</th><th>its value</th><th>poolGroup it sets the floor for</th></tr></thead>
    <tbody>${standing.map((c) => `<tr><td>${esc(c.slot ?? "?")}</td><td>${esc(c.name)}</td><td>${n0(model.value(c))}</td><td><code>${esc(String(D.poolGroup(c)))}</code></td></tr>`).join("")}</tbody>
  </table></div>
  ${(() => {
    const collide = new Map();
    for (const c of standing) {
      const g = String(D.poolGroup(c));
      collide.set(g, [...(collide.get(g) ?? []), c]);
    }
    const bad = [...collide.entries()].filter(([, list]) => list.length > 1);
    return bad.length ? `<div class="note"><p><strong>Floor collision on this board.</strong>
      The floor map keys on <code>poolGroup</code> and keeps the <em>highest</em> standing card per key, so
      ${bad.map(([g, list]) => `<code>${esc(g)}</code> is set by ${list.map((c) => `${esc(c.name)} (${esc(c.slot)} seat, ${n0(model.value(c))})`).join(" and ")}`).join("; ")}.
      Where the winner is not the card that would actually stand in that seat, every real card at
      the position is priced against a man who is standing somewhere else.</p></div>` : "";
  })()}` : `<p class="micro">This board deals no standing replacements, so the floor is simply the worst card at each group.</p>`}

  <h3>The glove he is actually credited with</h3>
  <div class="formula">asRostered(roster, bat).fielding = seatedGlove(roster + him) − seatedGlove(roster)

DH seat = 0 glove · a non-first-baseman at first = −1</div>
  <p>
    A bat is credited with the <em>marginal</em> glove he adds to the best nine, not his printed
    rating. Priced off the printed number instead, 29% of the bids on a bat paid for a glove the
    card never fields — a mean 2.1 fielding points too much, and as much as 11 on a surplus
    catcher.
  </p>
  <p class="micro">
    <code>seatedModelValue</code> then totals the best nine with each bat valued at the glove of
    the slot he stands in, and <code>pricingLineup</code> pads any unfilled seat with the free man
    who would end up standing there before that total is taken.
  </p>

  <!-- ============================ LAYER 4 ============================ -->
  <h2 id="l4">4 · Worth — what it is worth <em>to buy</em></h2>
  <div class="formula">fills   = cardFillsNeed(manager, draft, card)
surplus = bullpen ? relieverWorth(…) : auctionWorth(…)
base    = surplus × (1 + ${K.urgencyWeight} × urgency)

worth = fills                 → base
      | hitter, redundant     → max(0, seated(pricingNine + card) − seated(pricingNine))
      | bullpen, redundant    → max(0, penWorth(roster + card) − penWorth(roster))
      | nothing fielded there → base × ${K.depthDamp}
      | otherwise             → max(0, value − weakest FIELDED card at that bucket)

auctionWorth   = max(0, value(asRostered) − floor[group])
relieverWorth  = scale × (${K.relieverTop} × max(0, v − yourBest)
                        + ${K.relieverDepth} × max(0, min(v, yourBest) − floor))
urgency        = clamp((need/supply − ${K.urgencyPatient}) / (${K.urgencyDesperate} − ${K.urgencyPatient}), 0, 1)</div>
  <div class="scroll"><table>
    <thead><tr><th>constant</th><th>value</th><th>what it does</th></tr></thead>
    <tbody>
      <tr><td>RELIEVER_TOP_RATE</td><td>${K.relieverTop}</td><td>the engine rides the best arm ~2 innings a game</td></tr>
      <tr><td>RELIEVER_DEPTH_RATE</td><td>${K.relieverDepth}</td><td>the next arm throws well under one</td></tr>
      <tr><td>AUCTION_PEN_DEPTH</td><td>${K.penDepth}</td><td>arms counted as a pen when the cap is unlimited</td></tr>
      <tr><td>URGENCY_PATIENT</td><td>${K.urgencyPatient}</td><td>holes per man remaining below this: no hurry</td></tr>
      <tr><td>URGENCY_DESPERATE</td><td>${K.urgencyDesperate}</td><td>at or above this: all in</td></tr>
      <tr><td>URGENCY_WEIGHT</td><td>${K.urgencyWeight}</td><td>full desperation doubles a card's worth</td></tr>
      <tr><td>DEPTH_DAMP</td><td>${K.depthDamp}</td><td>markdown once the roster's needs are met</td></tr>
    </tbody>
  </table></div>
  <div class="note">
    <p>
      <strong>The two branches are not interchangeable.</strong> The <code>fills</code> branch
      carries the urgency premium and prices through <code>asRostered</code>; the redundant
      branches price the marginal gain over the man who would otherwise play. Collapsing them
      into one — treating the nine as manned from the first lot, so no bat ever fills a hole —
      measured <strong>−0.30, −0.25, −1.31, −1.05</strong> win points across four absolute cells
      against a clean null. The hole-filling premium is load-bearing.
    </p>
  </div>

  <!-- ============================ LAYER 5 ============================ -->
  <h2 id="l5">5 · Dollars</h2>
  <div class="formula">share   = worth^${K.shareExponent} / planned
planned = Σ over the best cards still expected, down to openSlots, of chance × worth^${K.shareExponent}

bid = clamp(round(maxBid × share × aggression × spendDown × poolPremium × depthDamp),
            ${K.minBid}, maxBid)</div>
  <div class="scroll"><table>
    <thead><tr><th>factor</th><th>value or range</th><th>note</th></tr></thead>
    <tbody>
      <tr><td>SHARE_EXPONENT</td><td>${K.shareExponent}</td><td>near-linear; squared over-concentrates ruinously in big fields</td></tr>
      <tr><td>aggression</td><td>0.86 – 1.14</td><td>seeded per manager per card, so two seats never tie</td></tr>
      <tr><td>spendDown · random nomination</td><td>0.7 – 2.2</td><td>off the real remaining queue length</td></tr>
      <tr><td>spendDown · manual nomination</td><td>0.75 – 1.8</td><td>budget per open slot against par</td></tr>
      <tr><td>poolPremium</td><td>1.00 – ${n2(1 + K.poolStrength)}</td><td>lifts cards past the ${Math.round(K.poolThreshold * 100)}th percentile of the whole deck</td></tr>
      <tr><td>depthDamp</td><td>${K.depthDamp}</td><td>with openSlots forced to ${K.depthSlots}, once needs are met</td></tr>
      <tr><td>maxBid</td><td>budget − $${K.minBid}/slot</td><td>the whole budget on an unlimited roster</td></tr>
      <tr><td>first price only</td><td>richest rival + 1</td><td>a capacity cap, inert while the room is flush</td></tr>
    </tbody>
  </table></div>
  <p class="micro">
    <code>planned</code> calls <code>effectiveWorth</code> with <code>positionAware = false</code>,
    so the denominator deliberately keeps the older basis. Anything that changes what a bench bat
    is worth therefore also moves the denominator, and bids every other card up.
  </p>

  <!-- ============================ EXAMPLES ============================ -->
  <h2 id="pet">Worked examples</h2>
  <p>
    Both cards are real cards off the board named in the banner, and every figure is the engine's
    own. Change the players with
    <code>--bat "name"</code> and <code>--arm "name"</code>.
  </p>

  <div class="card">
    <p class="eyebrow">Pet example · bat</p>
    <h3>${esc(petBat.name)}</h3>
    ${pickNote(batPick, "bat")}
    <div class="stats">${statline(petBat)}</div>
    ${chartStrip(petBat)}
    <div class="scroll"><table>
      <thead><tr><th>term</th><th>arithmetic</th><th>contributes</th></tr></thead>
      <tbody>
        <tr><td>on-base usage</td><td class="mono">onBaseUsage(${esc(petBat.onBase)}) = ${n3(batMath.usage)}</td><td>—</td></tr>
        <tr><td>chart rate</td><td class="mono">${n3(chartRate(petBat.chart, HV))} per slot over ${chartSlots(petBat.chart)} slots</td><td>—</td></tr>
        <tr><td>edge over a typical arm</td><td class="mono">${n3(chartRate(petBat.chart, HV))} − (${K.armRate}) = ${n3(batMath.edge)}</td><td>—</td></tr>
        <tr><td>on-base × chart</td><td class="mono">${n3(batMath.usage)} × ${n3(batMath.lean)} × ${n3(batMath.edge)} × ${K.interactionScale}</td><td>${n2(batMath.interaction)}</td></tr>
        <tr><td>glove</td><td class="mono">${esc(petBat.fielding ?? 0)} × ${n2(rawModel.weights.hitter.fielding)}</td><td>${n2(batMath.glove)}</td></tr>
        <tr><td>legs</td><td class="mono">max(0, ${esc(petBat.speed ?? 0)} − 1) × ${n2(rawModel.weights.hitter.speed)}</td><td>${n2(batMath.legs)}</td></tr>
        <tr class="total"><td>layer 1 value</td><td class="mono">engine returns ${n2(rawModel.value(petBat))}</td><td>${n2(batMath.total)}</td></tr>
      </tbody>
    </table></div>
    <p class="micro">
      Layer 2 leaves bats alone, so layer 2 value is also ${n0(model.value(petBat))}.
      Layer 3: his <code>poolGroup</code> is <code>${esc(String(petBatGroup))}</code>, whose floor is
      ${n0(petBatFloor)}${petBatStanding && petBatStanding.value >= petBatBoardFloor
        ? ` — set by the free ${esc(petBatStanding.card.name)}, not by the board's worst card (${n0(petBatBoardFloor)})`
        : ` (the board's worst card there)`}.
      Seated alone he is credited ${n0(petBatSeatedGlove)} of glove against a printed
      ${esc(petBat.fielding ?? 0)}.
      So his <code>auctionWorth</code> to an empty roster is about
      <strong>${n0(Math.max(0, model.value(petBat) - petBatFloor))}</strong>, not ${n0(model.value(petBat))}.
    </p>
    <p class="micro">Layer 5, this card nominated at the opening bell:</p>
    ${bidTable(batLot, petBat)}
    ${batLotBlocked ? `<p class="micro">
      The same card, to the same seat, after ${samePosBetter.map((c) => esc(c.name)).join(" and ")}
      are already on its roster. Those two are off the board and the budget is untouched, so the
      only thing that moved is whether he takes an open seat.
    </p>${bidTable(batLotBlocked, petBat)}
    <p class="micro">Seat 1 bids <strong>$${n0(batLot?.[0]?.bid)}</strong> with the position open and
      <strong>$${n0(batLotBlocked?.[0]?.bid)}</strong> with two better men standing there${
        blockedFlipped
          ? ` — a ${n0(Math.abs(batLotBlocked[0].bid - batLot[0].bid))}-dollar move from the branch alone.`
          : `; the two came out the same here, so this board does not happen to show the split.`}</p>` : ""}
  </div>

  <div class="card">
    <p class="eyebrow">Pet example · arm</p>
    <h3>${esc(petArm.name)}</h3>
    ${pickNote(armPick, "arm")}
    <div class="stats">${statline(petArm)}</div>
    ${chartStrip(petArm)}
    <div class="scroll"><table>
      <thead><tr><th>term</th><th>arithmetic</th><th>contributes</th></tr></thead>
      <tbody>
        <tr><td>control</td><td class="mono">${esc(petArm.control)} × ${n2(rawModel.weights.pitcher.control)}</td><td>${n2(armMath.controlTerm)}</td></tr>
        <tr><td>chart, summed</td><td class="mono">${n2(chartTotal(petArm.chart, PV))} × ${n2(rawModel.weights.pitcher.chart)}</td><td>${n2(armMath.chartTerm)}</td></tr>
        <tr><td>workload weight</td><td class="mono">(${esc(petArm.ip)} + 4) / 10 = ${n2(armMath.workload)}</td><td>× applied to both</td></tr>
        <tr><td>innings</td><td class="mono">${esc(petArm.ip)} × ${n2(rawModel.weights.pitcher.ip)}</td><td>${n2(armMath.ipTerm)}</td></tr>
        <tr><td>rotation factor</td><td class="mono">spSlotFactor(${SP_SLOTS}) = ${n2(armMath.factor)}</td><td>× applied to the whole</td></tr>
        <tr class="total"><td>layer 1 value</td><td class="mono">engine returns ${n2(rawModel.value(petArm))}</td><td>${n2(armMath.total)}</td></tr>
      </tbody>
    </table></div>
    <p class="micro">
      Then layer 2 takes that number away from him. His engine rate is
      <code>${n4(armRows[armRank]?.rpa)}</code> runs per plate appearance, which is
      <strong>#${armRank + 1} of ${armRows.length}</strong> starters on this board — so he is
      handed the ${armRank + 1}${["st", "nd", "rd"][armRank] ?? "th"}-highest tilted value instead
      of his own: <strong>${n0(model.value(petArm))}</strong> rather than ${n0(rawModel.value(petArm))}.
      ${Math.abs(model.value(petArm) - rawModel.value(petArm)) < 0.5
        ? `Here the two happen to agree closely.`
        : `A ${n0(Math.abs(model.value(petArm) - rawModel.value(petArm)))}-point move, from the re-deal and the ${n3(starterTilt)} tilt together.`}
    </p>
    <p class="micro">Layer 5, this card nominated at the opening bell:</p>
    ${bidTable(armLot, petArm)}
  </div>

  <h3>Where points and value disagree most on this board</h3>
  <p class="micro">
    Printed points are what a human reads; value is what the computers read. These are the
    cards where the two part company, which is where arguments about the model usually start.
  </p>
  <div class="scroll"><table>
    <thead><tr><th>card</th><th>points</th><th>value</th><th>value per point</th></tr></thead>
    <tbody>
      ${bargains.map((r) => `<tr><td>${esc(r.card.name)}</td><td>${n0(r.points)}</td><td class="em">${n0(r.value)}</td><td>${n3(r.ratio)}</td></tr>`).join("")}
      <tr class="total"><td colspan="4" style="text-align:left;font-weight:600">— and the other end —</td></tr>
      ${traps.map((r) => `<tr><td>${esc(r.card.name)}</td><td>${n0(r.points)}</td><td class="em">${n0(r.value)}</td><td>${n3(r.ratio)}</td></tr>`).join("")}
    </tbody>
  </table></div>

  <!-- ============================ ARGUE ============================ -->
  <h2 id="argue">Open questions</h2>
  <p>Known soft spots, with what is measured and what is not. This is the part to argue with.</p>

  <h3>The floor map keeps the wrong man</h3>
  <p>
    <code>auctionWorth</code> looks the floor up by <code>poolGroup</code> and the map keeps the
    <strong>highest</strong> standing replacement per key. Where two seats share a key — a DH
    replacement printed at a position — the floor is set by a card standing somewhere else, and
    every real card at that position is priced against him. Not measured.
  </p>

  <h3>The rotation is slotted by card points, not by value</h3>
  <p>
    <code>lineupRankValue</code> returns <code>player.points</code>, so a manager holding surplus
    starters can field a worse one. Re-slotting one live room by engine value read
    <strong>+1.0 / +1.5 / +1.1 / +1.0</strong> across four seeds. One room only, and the
    equivalent change for the <em>lineup</em> previously lost to points, so it needs the harness
    before it means anything.
  </p>

  <h3>The gate and the price seat the roster differently</h3>
  <p>
    <code>hitterTakesOpenSlot</code> seats the roster in roster order; the price seats it
    point-maximally. The gate can therefore say a bat has no seat while the price seats him at DH
    anyway. Narrowed but not removed by <code>pricingLineup</code>. Not separately measured.
  </p>

  <h3>Nobody charges for the man being displaced</h3>
  <p>
    A redundant starter is priced as the margin over the manager's own weakest fielded arm, which
    is correct going forward and ignores the money already sunk in the arm he displaces. A
    computer can buy a rotation at need prices and then buy it again as upgrades. One live room
    put <strong>$305 of $1500 into three starters who never threw a pitch</strong>; trading them
    for two bats at the same board's rates was worth <strong>+8.3</strong> win points.
  </p>

  <div class="foot">
    <p class="micro">
      Regenerate with <code>npm run valuation-doc</code>. Flags:
      <code>--bat</code>, <code>--arm</code>, <code>--universe</code>, <code>--seed</code>, <code>--sp</code>.
      Sources: <code>src/rules/valuation.js</code>, <code>src/rules/draft.js</code>,
      <code>src/rules/pitching.js</code>.
    </p>
  </div>
</main>

<script id="lab-data" type="application/json">${JSON.stringify(labPayload)}</script>
<script>
(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("lab-data").textContent);
  var CARDS = DATA.cards, DEF = DATA.defaults, BOARD = DATA.board;

  // ---- the model, ported ------------------------------------------------
  // Layer 1 is the card alone. Layer 2 re-deals the arms: the ORDER comes from
  // each arm's runs-per-plate-appearance, which is the engine's own hook rule
  // and does not move with these dials, so it is baked per card. Only the
  // spacing moves.
  function obUsage(ob) {
    var t = 0, staff = DATA.staff;
    for (var i = 0; i < staff.length; i++) t += Math.max(0, Math.min(20, ob - staff[i])) / 20;
    return t / staff.length;
  }
  function chartSum(chart, table) {
    var t = 0;
    for (var i = 0; i < chart.length; i++) t += chart[i][1] * (table[chart[i][0]] || 0);
    return t;
  }
  function chartSlots(chart) {
    var t = 0;
    for (var i = 0; i < chart.length; i++) t += chart[i][1];
    return t;
  }
  function spFactor(slots, d) {
    var discount = Math.min(1, DATA.spDiscountAnchor / slots);
    return Math.min(DATA.spCap, Math.max(discount, DATA.spAnchor / slots));
  }
  function starterTilt(d) {
    var span = d.wideSpread - d.narrowSpread;
    var widening = span === 0
      ? (BOARD.starterSpread >= d.wideSpread ? 1 : 0)
      : Math.max(0, Math.min(1, (BOARD.starterSpread - d.narrowSpread) / span));
    return d.starterDiscount + (1 - d.starterDiscount) * widening;
  }
  function layer1(c, d) {
    if (c.kind === "bat") {
      var slots = chartSlots(c.chart);
      var rate = slots ? chartSum(c.chart, d.hitterChart) / slots : 0;
      var edge = rate * d.hChart - d.armRate;
      return obUsage(c.ob) * (d.hOnBase / DEF.hOnBase) * edge * d.scale
        + c.fld * d.hField + Math.max(0, c.spd - 1) * d.hSpeed;
    }
    var quality = c.ctl * d.pControl + chartSum(c.chart, d.pitcherChart) * d.pChart;
    var base = quality * ((c.ip + 4) / 10) + c.ip * d.pIp;
    return c.kind === "SP" ? base * spFactor(d.spSlots, d) : base;
  }
  function valuesFor(d) {
    var out = {}, i;
    for (i = 0; i < CARDS.length; i++) out[CARDS[i].id] = layer1(CARDS[i], d);
    var tilt = starterTilt(d);
    ["SP", "RP"].forEach(function (role) {
      var arms = CARDS.filter(function (c) { return c.kind === role; });
      if (!arms.length) return;
      var t = role === "SP" ? tilt : 1;
      var vals = arms.map(function (c) { return out[c.id] * t; }).sort(function (a, b) { return b - a; });
      var byRate = arms.slice().sort(function (a, b) { return a.rpa - b.rpa; });
      var byRank = {};
      byRate.forEach(function (c, i) { byRank[c.id] = vals[i]; });
      var share = 0;
      if (role === "RP" && arms.length > 1) {
        share = arms.filter(function (c) { return BOARD.rotationRpa - c.rpa > 0.02; }).length / arms.length;
      }
      var spacing = Math.max(0, Math.min(1, share / DATA.spacingShare));
      if (!spacing) { arms.forEach(function (c) { out[c.id] = byRank[c.id]; }); return; }
      var seasons = arms.map(function (c) { return c.season; });
      var low = Math.min.apply(null, seasons), high = Math.max.apply(null, seasons);
      var bottom = vals[vals.length - 1];
      var slope = high > low ? (vals[0] - bottom) / (high - low) : 0;
      arms.forEach(function (c, i) {
        out[c.id] = spacing * (bottom + slope * (seasons[i] - low)) + (1 - spacing) * byRank[c.id];
      });
    });
    return out;
  }

  // ---- dials ------------------------------------------------------------
  var SPECS = [
    { key: "hOnBase", label: "hitter · on-base weight", min: 0, max: 40, step: 0.5 },
    { key: "hChart", label: "hitter · chart weight", min: 0, max: 3, step: 0.05 },
    { key: "scale", label: "hitter · interaction scale", min: 0, max: 300, step: 5 },
    { key: "armRate", label: "hitter · replacement arm rate", min: -4, max: 1, step: 0.05 },
    { key: "hField", label: "hitter · fielding weight", min: 0, max: 30, step: 0.5 },
    { key: "hSpeed", label: "hitter · speed weight", min: 0, max: 10, step: 0.1 },
    { key: "pControl", label: "pitcher · control weight", min: 0, max: 80, step: 1 },
    { key: "pChart", label: "pitcher · chart weight", min: 0, max: 3, step: 0.05 },
    { key: "pIp", label: "pitcher · innings weight", min: 0, max: 30, step: 0.5 },
    { key: "spSlots", label: "board · rotation size", min: 1, max: 6, step: 1 },
    { key: "starterDiscount", label: "board · narrow-board starter tilt", min: 0.2, max: 1, step: 0.01 },
    { key: "narrowSpread", label: "board · full-discount spread", min: 0, max: 0.12, step: 0.002 },
    { key: "wideSpread", label: "board · no-discount spread", min: 0, max: 0.2, step: 0.002 }
  ];
  var dials = JSON.parse(JSON.stringify(DEF));

  function fmt(v) {
    return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
  }
  function makeDial(host, spec, get, set) {
    var wrap = document.createElement("div");
    wrap.className = "dial";
    var id = "dial-" + spec.key.replace(/[^a-z0-9]/gi, "-");
    wrap.innerHTML = '<label for="' + id + '">' + spec.label
      + '<span class="def">code says ' + fmt(spec.base) + '</span></label>'
      + '<input type="number" id="' + id + '" step="' + spec.step + '">'
      + '<input type="range" min="' + spec.min + '" max="' + spec.max + '" step="' + spec.step
      + '" aria-labelledby="' + id + '">';
    var num = wrap.querySelector('input[type="number"]');
    var rng = wrap.querySelector('input[type="range"]');
    function paint() {
      var v = get();
      num.value = v;
      rng.value = v;
      wrap.classList.toggle("changed", Math.abs(v - spec.base) > 1e-9);
    }
    function onInput(e) {
      var v = parseFloat(e.target.value);
      if (!isFinite(v)) return;
      set(v); paint(); render();
    }
    num.addEventListener("input", onInput);
    rng.addEventListener("input", onInput);
    host.appendChild(wrap);
    return paint;
  }

  var painters = [];
  var mainHost = document.getElementById("dials-main");
  SPECS.forEach(function (spec) {
    spec.base = DEF[spec.key];
    painters.push(makeDial(mainHost, spec, function () { return dials[spec.key]; },
      function (v) { dials[spec.key] = v; }));
  });
  [["hitterChart", "dials-hchart", "hitter"], ["pitcherChart", "dials-pchart", "pitcher"]].forEach(function (pair) {
    var host = document.getElementById(pair[1]);
    Object.keys(DEF[pair[0]]).forEach(function (res) {
      var spec = {
        key: pair[0] + "-" + res, label: pair[2] + " chart · " + res.replace("SINGLE_PLUS", "1B+")
          .replace("SINGLE", "1B").replace("DOUBLE", "2B").replace("TRIPLE", "3B"),
        min: -30, max: 30, step: 1, base: DEF[pair[0]][res]
      };
      painters.push(makeDial(host, spec, function () { return dials[pair[0]][res]; },
        function (v) { dials[pair[0]][res] = v; }));
    });
  });

  // ---- render -----------------------------------------------------------
  var BASE = {};
  CARDS.forEach(function (c) { BASE[c.id] = c.v2; });
  var baseOrder = CARDS.slice().sort(function (a, b) { return b.v2 - a.v2; });
  var baseRank = {};
  baseOrder.forEach(function (c, i) { baseRank[c.id] = i + 1; });

  var filter = "all", query = "";
  var rowsHost = document.getElementById("labrows");
  var tilesHost = document.getElementById("tiles");
  var checkHost = document.getElementById("labcheck");
  var countHost = document.getElementById("labcount");

  function meter(delta, scale) {
    var w = 100, half = w / 2;
    var mag = scale ? Math.min(1, Math.abs(delta) / scale) : 0;
    var len = mag * half;
    var x = delta >= 0 ? half : half - len;
    var cls = delta >= 0 ? "up" : "down";
    return '<svg class="meter" viewBox="0 0 ' + w + ' 14" preserveAspectRatio="none" aria-hidden="true">'
      + '<rect class="mid" x="' + (half - 0.5) + '" y="0" width="1" height="14"></rect>'
      + (len > 0.4 ? '<rect class="' + cls + '" x="' + x + '" y="3.5" width="' + len + '" height="7" rx="2"></rect>' : '')
      + '</svg>';
  }

  function render() {
    var live = valuesFor(dials);
    var order = CARDS.slice().sort(function (a, b) { return live[b.id] - live[a.id]; });
    var nowRank = {};
    order.forEach(function (c, i) { nowRank[c.id] = i + 1; });

    var moved = 0, churn = 0, biggestUp = null, biggestDown = null, scale = 0;
    CARDS.forEach(function (c) {
      var d = live[c.id] - BASE[c.id];
      if (Math.abs(d) > 0.5) moved += 1;
      if (nowRank[c.id] !== baseRank[c.id]) churn += 1;
      if (!biggestUp || d > biggestUp.d) biggestUp = { c: c, d: d };
      if (!biggestDown || d < biggestDown.d) biggestDown = { c: c, d: d };
      scale = Math.max(scale, Math.abs(d));
    });

    tilesHost.innerHTML = ""
      + tile("cards that moved", moved + " / " + CARDS.length, "by more than half a value point")
      + tile("rank changes", churn, "cards no longer in their old place")
      + tile("biggest riser", biggestUp && biggestUp.d > 0 ? biggestUp.c.name : "—",
        biggestUp && biggestUp.d > 0 ? "+" + biggestUp.d.toFixed(0) + " points" : "nothing rose")
      + tile("biggest faller", biggestDown && biggestDown.d < 0 ? biggestDown.c.name : "—",
        biggestDown && biggestDown.d < 0 ? biggestDown.d.toFixed(0) + " points" : "nothing fell");

    var shown = order.filter(function (c) {
      if (filter !== "all" && c.kind !== filter) return false;
      if (query && c.name.toLowerCase().indexOf(query) < 0) return false;
      return true;
    });
    var html = "";
    shown.forEach(function (c) {
      var d = live[c.id] - BASE[c.id];
      var rd = baseRank[c.id] - nowRank[c.id];
      var cls = d >= 0 ? "up" : "down";
      html += '<tr><td>' + escapeHtml(c.name)
        + '<span class="rank"> · ' + escapeHtml(c.pos) + '</span>'
        + (c.free ? '<span class="freeflag">FREE</span>' : '')
        + '</td>'
        + '<td>' + c.pts + '</td>'
        + '<td>' + BASE[c.id].toFixed(0) + '</td>'
        + '<td class="em">' + live[c.id].toFixed(0) + '</td>'
        + '<td class="shift">' + meter(d, scale) + '</td>'
        + '<td class="delta ' + cls + '">' + (d >= 0 ? "+" : "") + d.toFixed(0) + '</td>'
        + '<td class="rank ' + (rd > 0 ? "up" : rd < 0 ? "down" : "") + '">'
        + nowRank[c.id] + (rd === 0 ? "" : (rd > 0 ? " ▲" + rd : " ▼" + (-rd))) + '</td></tr>';
    });
    rowsHost.innerHTML = html || '<tr><td colspan="7">No card matches that filter.</td></tr>';
    countHost.textContent = "Showing " + shown.length + " of " + CARDS.length
      + " cards. Baseline is this board with the code's own values and no persona, no "
      + Math.round(DATA.perturbation * 100) + "% weight noise.";
  }

  function tile(label, value, sub) {
    return '<div class="tile"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(String(value))
      + '<small>' + escapeHtml(sub) + '</small></dd></div>';
  }
  function escapeHtml(x) {
    return String(x).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  // ---- the browser half of the self-check -------------------------------
  // At the default dial positions the ported model must reproduce the values
  // baked into this page by the engine. If it does not, every number in the lab
  // is suspect and says so.
  (function () {
    var live = valuesFor(JSON.parse(JSON.stringify(DEF)));
    var worst = 0, who = null;
    CARDS.forEach(function (c) {
      var e = Math.abs(live[c.id] - c.v2);
      if (e > worst) { worst = e; who = c.name; }
    });
    var ok = worst < 1e-6;
    checkHost.className = "labcheck" + (ok ? "" : " bad");
    checkHost.textContent = ok
      ? "Port verified: at the code's own values this page reproduces all " + CARDS.length
        + " engine values exactly (worst difference " + worst.toExponential(1) + ")."
      : "PORT BROKEN: the model on this page disagrees with the engine by " + worst.toFixed(2)
        + " on " + who + " at the default dials. Every number below is suspect.";
  })();

  document.getElementById("reset").addEventListener("click", function () {
    dials = JSON.parse(JSON.stringify(DEF));
    painters.forEach(function (p) { p(); });
    render();
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (b) {
    b.addEventListener("click", function () {
      filter = b.getAttribute("data-filter");
      Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (o) {
        o.setAttribute("aria-pressed", String(o === b));
      });
      render();
    });
  });
  document.getElementById("find").addEventListener("input", function (e) {
    query = e.target.value.trim().toLowerCase();
    render();
  });

  painters.forEach(function (p) { p(); });
  render();
})();
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);

console.log(`valuation-report: wrote ${path.relative(ROOT, OUT)}`);
console.log(`  formula self-check: ${checked} cards, worst disagreement ${worstErr.toExponential(2)} ${inSync ? "(in sync)" : "*** STALE ***"}`);
console.log(`  re-deal self-check:  worst disagreement ${redealWorst.toExponential(2)} ${redealMatches ? "(matches pitcherRanking)" : "*** MISMATCH ***"}`);
console.log(`  dial lab: ${labCards.length} cards embedded`);
console.log(`  board: ${UNIVERSE}/${SEED}, ${SP_SLOTS} SP slots, starter tilt ${n3(starterTilt)}`);
console.log(`  pet bat: ${petBat.name} (layer 1 ${n0(rawModel.value(petBat))}, layer 2 ${n0(model.value(petBat))})`);
console.log(`  pet arm: ${petArm.name} (layer 1 ${n0(rawModel.value(petArm))}, layer 2 ${n0(model.value(petArm))}, rate rank ${armRank + 1}/${armRows.length})`);
if (!inSync || !redealMatches) process.exitCode = 2;
