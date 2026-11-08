#!/usr/bin/env node
// THE DEFAULT SWEEP for a change to how computers value cards.
//
// Every cell is measured TWICE, and the pair is the point:
//
//   MIXED     one room, half the seats on the new paradigm and half on the old,
//             bidding against each other for the same cards. This is the
//             competitive read — what happens at a real table where not
//             everybody thinks alike.
//
//   IDENTICAL the same room drafted twice off one seed, all-new and all-old,
//             each new roster then playing its OWN counterpart. Nobody ever
//             bid against the other side, so this is strength alone.
//
// The GAP between them is denial. A change that only reaches early and leaves
// rivals the dregs scores in mixed and nothing in identical: that is how the
// 1.3x reliever lift (+1.5 to +4.9 mixed, 49.6-49.9% identical) and the
// first-price estimator (+3.65 mixed, -2.43 identical) were caught, and both
// were reverted. A change that reads well in BOTH is genuinely better at
// building a roster. Reading mixed alone rewards denial; reading identical
// alone misses that the table is not uniform. So: both, always, side by side.
//
// Mixed mirrors over both parities (seats 0,2 new, then seats 1,3 new) so no
// seat or persona advantage can leak into the result.
//
// Because the change lives in valuation.js rather than draft.js, each side runs
// through its own module TREE — its own valuation, bidding and nomination. Point
// --baseline at a worktree of the commit you are measuring against:
//
//   git worktree add --detach /tmp/base HEAD
//   node scripts/valuation-sweep.mjs --baseline /tmp/base
//   node scripts/valuation-sweep.mjs --baseline /tmp/base --leagues 80 --quick

import path from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean)
  .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? "1"]));

const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BASELINE = path.resolve(args.baseline ?? path.join(HERE, "..", "mlb-showdown-baseline"));
const LEAGUES = Number(args.leagues ?? 60);
const RUNS = Number(args.runs ?? 3000);
const QUICK = args.quick != null;

const load = async (root, file) => import(pathToFileURL(path.join(root, "src", file)).href);
const NEW = await load(HERE, "rules/draft.js");
let OLD;
try {
  OLD = await load(BASELINE, "rules/draft.js");
} catch {
  console.error(`\nvaluation-sweep: no baseline tree at ${BASELINE}\n`
    + `  git worktree add --detach ${BASELINE} <commit>\n`
    + `  then re-run with --baseline ${BASELINE}\n`);
  process.exit(1);
}
const { buildDraftPool } = await load(HERE, "data/universes.js");
const { simulateBatch } = await load(HERE, "rules/batch.js");

const PERSONAS = ["balanced", "ace", "slugger", "purist"];
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const ci = (a) => 1.96 * std(a) / Math.sqrt(Math.max(1, a.length));
const sign = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;

// One night. `sideOf` picks which module a given seat thinks with; everything
// seat-specific (its bid, and what it nominates when it is on the clock) goes
// through that module. The board, the seating and the engine are shared on
// purpose: buildTeam seats by card POINTS, not by valuation, and the simulator
// is untouched, so sharing them removes differences that would only be noise.
function draftRoom(cfg, seed, sideOfSeat) {
  const pen = { bullpenSlots: cfg.pen, bullpenMin: cfg.penMin };
  const pool = buildDraftPool(cfg.universe, seed, {
    nomination: cfg.nomination, managerCount: cfg.teams, startingPitchers: cfg.sp, ...pen
  });
  const draft = NEW.createDraft(
    Array.from({ length: cfg.teams }, (unused, i) => ({ name: `T${i}`, cpu: true })),
    pool, cfg.roster, seed,
    {
      draftType: "auction", nomination: cfg.nomination, startingPitchers: cfg.sp,
      budget: cfg.budget, timer: false, snakeTimer: false, auctionPricing: cfg.pricing, ...pen
    }
  );
  const seatOf = new Map(draft.managers.map((m, i) => [m.id, i]));
  const sideOf = (m) => sideOfSeat(seatOf.get(m.id) ?? -1);
  draft.managers.forEach((m, i) => { m.persona = PERSONAS[i % PERSONAS.length]; });
  NEW.completeAuctionReview?.(draft, 0);
  let guard = 20000;
  while (!draft.complete && guard-- > 0) {
    if (!draft.auction.lot) {
      try {
        if (NEW.isRandomNomination(draft)) NEW.nominateNextQueued(draft, null, 0);
        else {
          const onClock = NEW.currentManager(draft);
          NEW.nominatePlayer(draft, sideOf(onClock).bestAutopickTarget(draft, onClock).id, 0);
        }
      } catch { break; }
      if (draft.complete || !draft.auction.lot) break;
    }
    let inner = cfg.teams * 4 + 8;
    while (draft.auction.lot && inner-- > 0) {
      const next = NEW.sealedBidder(draft);
      if (!next) break;
      NEW.placeSealedBid(draft, next.id, sideOf(next).cpuSealedBid(draft, next), 0);
    }
  }
  NEW.repairDraftRosters?.(draft);
  return draft;
}

// --- MIXED: half the room on each paradigm, fighting over the same cards ----
// Mirrored over both parities so no seat or persona can carry the result.
function runMixed(cfg, isNull) {
  const edges = [];
  const newWins = [];
  const oldWins = [];
  for (let league = 0; league < LEAGUES; league += 1) {
    const seed = `${cfg.tag}-mix-${league}`;
    const rows = [];
    for (const parity of [0, 1]) {
      const isNewSeat = (i) => i % 2 === parity;
      const draft = draftRoom(cfg, seed, (i) => (isNull || isNewSeat(i) ? NEW : OLD));
      const teams = draft.managers.map((m) => NEW.buildTeam(m, { optimize: true }));
      const win = new Map(
        simulateBatch(teams, { runs: RUNS, seed: `${seed}-sim-${parity}` }).teams.map((t) => [t.team, t.winPct])
      );
      draft.managers.forEach((m, i) => rows.push({ isNew: isNewSeat(i), win: win.get(m.name) ?? 0 }));
    }
    for (const r of rows) (r.isNew ? newWins : oldWins).push(r.win);
    const side = (f) => mean(rows.filter((r) => r.isNew === f).map((r) => r.win));
    edges.push(side(true) - side(false));
  }
  return { edges, newWins, oldWins };
}

// --- IDENTICAL: two rooms off one seed, each roster vs its own counterpart ---
function runIdentical(cfg, isNull) {
  const edges = [];
  const newWins = [];
  const oldWins = [];
  for (let league = 0; league < LEAGUES; league += 1) {
    const seed = `${cfg.tag}-abs-${league}`;
    const a = draftRoom(cfg, seed, () => NEW);
    const b = draftRoom(cfg, seed, () => (isNull ? NEW : OLD));
    let edge = 0;
    for (let i = 0; i < cfg.teams; i += 1) {
      const teams = [
        NEW.buildTeam(a.managers[i], { optimize: true }),
        NEW.buildTeam(b.managers[i], { optimize: true })
      ];
      teams[0].name = "NEW";
      teams[1].name = "OLD";
      const win = new Map(
        simulateBatch(teams, { runs: RUNS, seed: `${seed}-h2h-${i}` }).teams.map((t) => [t.team, t.winPct])
      );
      newWins.push(win.get("NEW"));
      oldWins.push(win.get("OLD"));
      edge += (win.get("NEW") - win.get("OLD")) / cfg.teams;
    }
    edges.push(edge);
  }
  return { edges, newWins, oldWins };
}

// --- the default cells ------------------------------------------------------
// Weighted toward the competitive question rather than universe coverage: three
// classic tables that differ in the things that change how a room bids (pricing
// rule, nomination, table size), and one fictional cell kept only as a check
// that nothing is specific to the real-card board.
const CELLS = [
  { tag: "c4-first", teams: 4, universe: "classic", nomination: "random", pen: "all", penMin: 2, pricing: "first" },
  { tag: "c4-vick", teams: 4, universe: "classic", nomination: "random", pen: "all", penMin: 2, pricing: null },
  { tag: "c4-man", teams: 4, universe: "classic", nomination: "manual", pen: 2, penMin: 2, pricing: null },
  { tag: "c8-man", teams: 8, universe: "classic", nomination: "manual", pen: 2, penMin: 2, pricing: null },
  { tag: "f4-man", teams: 4, universe: "fictional", nomination: "manual", pen: 2, penMin: 2, pricing: null }
];
const base = { roster: 15, sp: 4, budget: 1500 };
const cells = (QUICK ? CELLS.slice(0, 2) : CELLS).map((c) => ({ ...base, ...c }));

const label = (c) => `${c.teams} teams, ${c.universe}, ${c.nomination} nom, pen ${c.pen}/${c.penMin},`
  + ` ${c.pricing === "first" ? "first price" : "vickrey"}`;

console.log(`valuation sweep — ${LEAGUES} leagues a cell, ${RUNS} games a team`);
console.log(`  NEW ${HERE}`);
console.log(`  OLD ${BASELINE}\n`);

// Nulls first: both sides NEW. Each MUST read ~0, and their width is the
// smallest effect this sweep can resolve. A cell inside the null's interval is
// not a result, whatever its sign.
const nullCfg = cells[0];
for (const [name, fn] of [["mixed", runMixed], ["identical", runIdentical]]) {
  const r = fn(nullCfg, true);
  console.log(`  NULL ${name.padEnd(9)} ${sign(mean(r.edges) * 100)} pts  (+-${(ci(r.edges) * 100).toFixed(2)})`);
}
console.log("");

const head = ["cell", "mixed (competitive)", "identical (strength)", "denial"];
console.log(`${head[0].padEnd(58)}${head[1].padStart(22)}${head[2].padStart(22)}${head[3].padStart(10)}`);
for (const cfg of cells) {
  const m = runMixed(cfg, false);
  const a = runIdentical(cfg, false);
  const mx = mean(m.edges) * 100;
  const ab = mean(a.edges) * 100;
  console.log(
    `${label(cfg).padEnd(58)}`
    + `${`${sign(mx)} ±${(ci(m.edges) * 100).toFixed(2)}`.padStart(22)}`
    + `${`${sign(ab)} ±${(ci(a.edges) * 100).toFixed(2)}`.padStart(22)}`
    + `${sign(mx - ab).padStart(10)}`
  );
}
console.log(`\n  mixed = half the room on each paradigm, fighting over the same cards.`);
console.log(`  identical = two rooms off one seed, each roster against its own counterpart.`);
console.log(`  denial = mixed − identical: what the change wins only by taking cards off rivals.`);
