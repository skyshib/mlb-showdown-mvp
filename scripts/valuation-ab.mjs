#!/usr/bin/env node
// Head-to-head: NEW bidder (working-tree draft.js + valuation.js) vs OLD bidder
// (frozen draft.baseline.mjs + valuation.baseline.mjs), in the SAME auction.
//
// Each league runs ONE shared auction. Seats are half NEW, half OLD; only the
// BID AMOUNT is taken from each seat's module (OLD.cpuSealedBid / NEW.cpuSealedBid)
// — nomination and lot resolution are mechanical (NEW), so the only thing that
// varies per seat is the willingness/valuation. Seat assignment is swapped every
// other league to cancel seat / nomination-order effects. All seats share one
// persona so the bidder VERSION is the sole difference.
//
// Usage: node scripts/valuation-ab.mjs [--leagues N] [--runs N] [--teams N] [--budget N] [--roster N] [--universe U] [--persona P]
//
// To re-baseline before testing a NEW change (freeze the current bidder as OLD):
//   cp src/rules/valuation.js src/rules/valuation.baseline.mjs
//   sed 's#from "./valuation.js?v=[^"]*"#from "./valuation.baseline.mjs"#' src/rules/draft.js > src/rules/draft.baseline.mjs
// then edit valuation.js / draft.js (= NEW) and run this.

import * as NEW from "../src/rules/draft.js";
import * as OLD from "../src/rules/draft.baseline.mjs";
import { buildDraftPool } from "../src/data/universes.js";
import { simulateBatch } from "../src/rules/batch.js";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v])
);
const LEAGUES = Number(args.leagues ?? 60);
const RUNS = Number(args.runs ?? 1000);
const TEAMS = Number(args.teams ?? 4);
const BUDGET = Number(args.budget ?? 1000);
const ROSTER = Number(args.roster ?? 13);
const UNIVERSE = args.universe ?? "fictional";
const PERSONA = args.persona ?? "balanced";

function driveLeague(seed, newSeats) {
  const pool = buildDraftPool(UNIVERSE, seed, { nomination: "random", managerCount: TEAMS });
  const managers = Array.from({ length: TEAMS }, (_, i) => ({ name: `T${i}`, cpu: true }));
  const draft = NEW.createDraft(managers, pool, ROSTER, seed, {
    draftType: "auction", nomination: "random", budget: BUDGET, timer: false, snakeTimer: false
  });
  for (const m of draft.managers) m.persona = PERSONA;
  if (NEW.completeAuctionReview) NEW.completeAuctionReview(draft, 0);

  const bidModule = new Map(draft.managers.map((m, i) => [m.id, newSeats.has(i) ? NEW : OLD]));
  let guard = 8000;
  while (!draft.complete && guard-- > 0) {
    if (!draft.auction.lot) { NEW.nominateBestTarget(draft, 0); if (draft.complete || !draft.auction.lot) break; }
    let inner = TEAMS * 4 + 8;
    while (draft.auction.lot && inner-- > 0) {
      const next = NEW.sealedBidder(draft);
      if (!next) break;
      const mod = bidModule.get(next.id) ?? NEW;
      NEW.placeSealedBid(draft, next.id, mod.cpuSealedBid(draft, next), 0);
    }
  }
  if (NEW.repairDraftRosters) NEW.repairDraftRosters(draft);

  const teams = draft.managers.map((m) => NEW.buildTeam(m, { optimize: true }));
  const summary = simulateBatch(teams, { runs: RUNS, seed: seed + "-sim" });
  const winByName = new Map(summary.teams.map((t) => [t.team, t.winPct]));
  return draft.managers.map((m, i) => ({ isNew: newSeats.has(i), win: winByName.get(m.name) ?? 0 }));
}

const newWins = [], oldWins = [];
for (let L = 0; L < LEAGUES; L++) {
  // swap which seats are NEW every other league
  const newSeats = new Set(
    L % 2 === 0
      ? Array.from({ length: TEAMS }, (_, i) => i).filter((i) => i % 2 === 0)
      : Array.from({ length: TEAMS }, (_, i) => i).filter((i) => i % 2 === 1)
  );
  for (const r of driveLeague(`vab-${L}`, newSeats)) (r.isNew ? newWins : oldWins).push(r.win);
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const nW = mean(newWins), oW = mean(oldWins);
const se = Math.sqrt(std(newWins) ** 2 / newWins.length + std(oldWins) ** 2 / oldWins.length);

console.log(`Head-to-head: ${LEAGUES} leagues, ${TEAMS} teams, $${BUDGET}, roster ${ROSTER}, ${UNIVERSE}, persona=${PERSONA}, ${RUNS} sim games/league`);
console.log(`  NEW seats win%: ${(nW * 100).toFixed(2)}%  (n=${newWins.length})`);
console.log(`  OLD seats win%: ${(oW * 100).toFixed(2)}%  (n=${oldWins.length})`);
console.log(`  NEW − OLD:      ${((nW - oW) * 100 >= 0 ? "+" : "")}${((nW - oW) * 100).toFixed(2)} pts   (±${(1.96 * se * 100).toFixed(2)} 95% CI)`);
