#!/usr/bin/env node
// Paired bidder duel — a far quieter measurement than valuation-ab's mixed table.
//
// valuation-ab seats NEW and OLD bidders at the SAME auction and compares their
// win%. That works, but the contrast carries all the league-to-league noise of
// which seat happened to draw the better board: with three teams its noise floor
// is ±5 win points over 60 leagues, which is wider than any effect worth
// shipping. (Measured: a NULL run, NEW code identical to OLD, read −3.53 ± 5.40.)
//
// This runs each league TWICE off one seed — once with every seat bidding NEW,
// once with every seat bidding OLD — so both tables see the identical deck and
// the identical nomination order. Then it plays each seat's NEW roster against
// its OWN old counterpart. The board cancels exactly, and what is left is the
// bidder.
//
// *** READ THIS BEFORE TRUSTING A ZERO FROM THIS SCRIPT. ***
//
// Upgrading every seat at once is BLIND to a pure valuation change. An auction
// allocates by RELATIVE worth: if every bidder re-ranks the board the same way,
// the same cards land in the same seats and only the prices move. A change that
// reads dead flat here can still be worth fifteen win points against rivals who
// did not get it. Measured, on the very same code: this harness said +0.47 for
// the on-base interaction model, while the mixed table said +14 against its
// matched null.
//
// So use this one for changes to the BIDDING MECHANICS — pacing, depth
// discounts, share denominators — where the question really is "does a table
// of new bidders build better rosters than a table of old ones". For a change
// to what a CARD IS WORTH, use scripts/valuation-ab.mjs, which seats the two
// models against each other — and always run its null (make NEW identical to
// OLD) in the same cell, same --tag, same league count, because its own noise
// floor is several win points wide.
//
// Usage: node scripts/bidder-duel.mjs [--leagues N] [--runs N] [--teams N]
//        [--budget N] [--roster N] [--temperature N] [--universe U] [--persona P] [--tag T]
//
// Baselines (regenerate before testing a change, delete before commit):
//   cp src/rules/valuation.js src/rules/valuation.baseline.mjs
//   sed 's#from "./valuation.js?v=[^"]*"#from "./valuation.baseline.mjs"#' src/rules/draft.js > src/rules/draft.baseline.mjs

import * as NEW from "../src/rules/draft.js";
import * as OLD from "../src/rules/draft.baseline.mjs";
import { buildDraftPool } from "../src/data/universes.js";
import { simulateBatch } from "../src/rules/batch.js";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v])
);
const LEAGUES = Number(args.leagues ?? 40);
const RUNS = Number(args.runs ?? 400);
const TEAMS = Number(args.teams ?? 4);
const BUDGET = Number(args.budget ?? 1500);
const ROSTER = Number(args.roster ?? 15);
const TEMPERATURE = Number(args.temperature ?? 0);
const UNIVERSE = args.universe ?? "fictional";
const PERSONA = args.persona ?? "balanced";
const TAG = args.tag ?? "duel";
const SP = Number(args.sp ?? ROSTER - 11);

// Drive one whole auction with every seat bidding out of ONE module.
function driveLeague(seed, bidder) {
  const pool = buildDraftPool(UNIVERSE, seed, {
    nomination: "random", managerCount: TEAMS, startingPitchers: SP, temperature: TEMPERATURE
  });
  const managers = Array.from({ length: TEAMS }, (_, i) => ({ name: `T${i}`, cpu: true }));
  const draft = NEW.createDraft(managers, pool, ROSTER, seed, {
    draftType: "auction", nomination: "random", startingPitchers: SP,
    budget: BUDGET, timer: false, snakeTimer: false
  });
  for (const m of draft.managers) m.persona = PERSONA;
  if (NEW.completeAuctionReview) NEW.completeAuctionReview(draft, 0);
  let guard = 8000;
  while (!draft.complete && guard-- > 0) {
    if (!draft.auction.lot) { NEW.nominateBestTarget(draft, 0); if (draft.complete || !draft.auction.lot) break; }
    let inner = TEAMS * 4 + 8;
    while (draft.auction.lot && inner-- > 0) {
      const next = NEW.sealedBidder(draft);
      if (!next) break;
      NEW.placeSealedBid(draft, next.id, bidder.cpuSealedBid(draft, next), 0);
    }
  }
  if (NEW.repairDraftRosters) NEW.repairDraftRosters(draft);
  return draft.managers.map((m) => NEW.buildTeam(m, { optimize: true }));
}

const wins = [];
for (let L = 0; L < LEAGUES; L++) {
  const seed = `${TAG}-${L}`;
  const newTeams = driveLeague(seed, NEW);
  const oldTeams = driveLeague(seed, OLD);
  // Each seat's NEW roster plays its OWN old counterpart: same seed, same deck,
  // same nomination order, same seat. Nothing left but the bidder.
  for (let seat = 0; seat < TEAMS; seat++) {
    const a = { ...newTeams[seat], name: "NEW" };
    const b = { ...oldTeams[seat], name: "OLD" };
    const summary = simulateBatch([a, b], { runs: RUNS, seed: `${seed}-duel-${seat}` });
    wins.push(summary.teams.find((t) => t.team === "NEW")?.winPct ?? 0.5);
  }
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const m = mean(wins);
const se = std(wins) / Math.sqrt(wins.length);
console.log(`Paired duel: ${LEAGUES} leagues x ${TEAMS} seats, $${BUDGET}, roster ${ROSTER} (${SP} SP), ${UNIVERSE}, temp=${TEMPERATURE}, persona=${PERSONA}, tag=${TAG}, ${RUNS} games/duel`);
console.log(`  NEW beats its own OLD counterpart: ${(m * 100).toFixed(2)}%  (n=${wins.length})`);
console.log(`  edge over even:                    ${((m - 0.5) * 100 >= 0 ? "+" : "")}${((m - 0.5) * 100).toFixed(2)} pts   (±${(1.96 * se * 100).toFixed(2)} 95% CI)`);
