#!/usr/bin/env node
// Should a computer SHOVE on its last roster slot?
//
// Money left at the last out is money you never had. In a CAPPED room it is not
// even dilutable into bench depth — the roster is full, so it simply goes
// unspent. Measured over 40 manual-nomination leagues ($1500, 15-man, 4 seats):
// a seat carries out $142 under first price and $300 under Vickrey, and on its
// FINAL slot it bids $50 of a $135 legal maximum. A quarter of the lots it
// loses there went for a price it could have beaten with money it then threw
// away.
//
// Why it happens, and why it is not a strategic choice: under manual nomination
// forthcomingPlayers prices EVERY unpicked card at even odds, so a manager with
// one hole and nine lots left in the whole draft budgets against the best of 87
// cards — most of which will never be called, and the best of which his $135
// could not win against a field holding $417. The share denominator is a plan
// for a draft that is not going to happen.
//
// *** THIS IS NOT A PRICING-RULE QUESTION. *** The leak is bigger under Vickrey
// than under first price, so --pricing is a cell here, not the subject. See
// docs/first-price-bidding-spec.md for the shading study, which is settled.
//
// *** RUN THE NULL (--null). *** Its spread is the harness's noise floor and
// nothing narrower than it is a result.
//
// *** RUN THE DUEL (--duel true,arm). *** A mixed table measures whether an arm
// beats rivals who lack it, which can be pure denial. A change shipping to every
// CPU must also build BETTER TEAMS when everybody has it.
//
// Usage: node scripts/endgame-bidding.mjs [--leagues N] [--runs N] [--budget N]
//        [--roster N] [--teams N] [--universe U] [--persona P] [--tag T] [--sp N]
//        [--pen N|all] [--penmin N] [--nomination manual|random]
//        [--pricing first|vickrey] [--arms a,b,c] [--null] [--duel a,b]

import * as D from "../src/rules/draft.js";
import { buildDraftPool } from "../src/data/universes.js";
import { simulateBatch } from "../src/rules/batch.js";

const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? "yes"])
);
const LEAGUES = Number(args.leagues ?? 120);
const RUNS = Number(args.runs ?? 600);
const BUDGET = Number(args.budget ?? 1500);
const ROSTER = Number(args.roster ?? 15);
const UNIVERSE = args.universe ?? "fictional";
const PERSONA = args.persona ?? "balanced";
const MIXED_PERSONAS = PERSONA === "mixed";
const TAG = args.tag ?? "eg";
const SP = Number(args.sp ?? ROSTER - 11);
const PRICING = args.pricing === "vickrey" ? "vickrey" : "first";
// Manual nomination is the default here because it is the shape with the leak:
// a capped roster, so the money has nowhere to go but unspent.
const NOMINATION = args.nomination === "random" ? "random" : "manual";
const NULL_RUN = Boolean(args.null);
const PEN = args.pen == null ? {} : { bullpenSlots: args.pen === "all" ? "all" : Number(args.pen), bullpenMin: args.penmin == null ? undefined : Number(args.penmin) };

// ---- the arms -------------------------------------------------------------
//
// Each arm takes the bid the computer would have made and returns the one it
// enters. Legality rails live in applyArm: a pass stays a pass, no bid clears
// auctionMaxBid, and a rebid round's floor is never cut through. So an arm may
// return Infinity and mean "everything I have".

// The most any bid could ever need to be. Under first price the winner pays his
// own number, so a dollar over the richest answer the live field could legally
// make wins outright and every dollar past it is burnt; under Vickrey the bid is
// not a cheque at all, so the whole stack is free.
function shove(draft, manager, lot) {
  if (!D.isFirstPriceAuction(draft)) return Infinity;
  const rivals = [...new Set([...lot.pending, ...Object.keys(lot.bids)])].filter((id) => id !== manager.id);
  const richest = rivals.reduce((best, id) => {
    const rival = draft.managers.find((m) => m.id === id);
    return rival ? Math.max(best, D.auctionMaxBid(draft, rival)) : best;
  }, 0);
  return richest + 1;
}

const openSlotsOf = (draft, manager) => ROSTER - D.rosterPlayerCount(manager);

// Shove once the roster is down to `slots` holes or fewer. The blunt form of
// the hypothesis: on your last slot the money is dead, so there is no downside.
// The downside it ignores is that more lots are still coming and one of them
// may be a better card — which is exactly what the share denominator is for.
function allIn(slots) {
  return (bid, { draft, manager, lot }) =>
    (openSlotsOf(draft, manager) <= slots ? shove(draft, manager, lot) : bid);
}

// Shove on the last slot only when the card on the block is nearly the best one
// still on the board, so waiting cannot buy much. This is the gated form: it
// keeps the stopping rule the share denominator was reaching for and drops only
// the pretence that the money has a later use.
function allInTop(theta, slots = 1) {
  return (bid, { draft, manager, lot }) => {
    if (openSlotsOf(draft, manager) > slots) return bid;
    const card = D.auctionLotPlayer(draft);
    if (!card) return bid;
    const model = D.managerValuation(draft, manager);
    const value = model.value(card);
    if (!(value > 0)) return bid;
    let best = 0;
    for (const other of D.availablePlayers(draft)) {
      if (other.id === card.id) continue;
      const v = model.value(other);
      if (v > best) best = v;
    }
    return value >= theta * best ? shove(draft, manager, lot) : bid;
  };
}

// Spend the bankroll down instead of shoving: bid what the remaining budget
// divided over the remaining holes says, floored at the bid it would have made.
// The pacing terms already do this and are CLAMPED (auctionPace at 1.8); this
// asks whether the clamp is what is holding the endgame back.
function spendDown(slots) {
  return (bid, { draft, manager }) => {
    const open = openSlotsOf(draft, manager);
    if (open > slots || open <= 0) return bid;
    return Math.max(bid, D.auctionBudget(draft, manager) / open);
  };
}

const ARMS = {
  true: (bid) => bid,
  "allin-1": allIn(1),
  "allin-2": allIn(2),
  "allin-3": allIn(3),
  "allin-1-top60": allInTop(0.60),
  "allin-1-top75": allInTop(0.75),
  "allin-1-top90": allInTop(0.90),
  "allin-2-top75": allInTop(0.75, 2),
  "spend-1": spendDown(1),
  "spend-2": spendDown(2),
  "spend-3": spendDown(3)
};

const ARM_KEYS = args.duel ? String(args.duel).split(",") : (args.arms ? args.arms.split(",") : ["true", "allin-1", "allin-1-top75", "spend-2"]);
for (const key of ARM_KEYS) if (!ARMS[key]) throw new Error(`Unknown arm "${key}". Known: ${Object.keys(ARMS).join(", ")}`);
const TEAMS = args.duel ? Number(args.teams ?? 4) : (Number(args.teams ?? 0) || ARM_KEYS.length);

function applyArm(armKey, bid, context) {
  if (bid <= 0) return 0;
  const { draft, manager, lot } = context;
  const shaped = ARMS[armKey](bid, context);
  const floor = lot.round === 2 ? lot.tie.amount : 1;
  return Math.max(floor, Math.min(D.auctionMaxBid(draft, manager), Math.round(Number.isFinite(shaped) ? shaped : D.auctionMaxBid(draft, manager))));
}

function driveLeague(seed, armForSeat, options = {}) {
  const pool = buildDraftPool(UNIVERSE, seed, {
    nomination: NOMINATION, managerCount: TEAMS, startingPitchers: SP, temperature: 0, ...PEN
  });
  const managers = Array.from({ length: TEAMS }, (_, i) => ({ name: `S${i}`, cpu: true }));
  const draft = D.createDraft(managers, pool, ROSTER, seed, {
    draftType: "auction", nomination: NOMINATION, startingPitchers: SP,
    budget: BUDGET, auctionPricing: PRICING, timer: false, snakeTimer: false, ...PEN
  });
  const seatPersona = options.persona ?? (MIXED_PERSONAS ? null : PERSONA);
  if (seatPersona) for (const m of draft.managers) m.persona = seatPersona;
  const armOf = new Map(draft.managers.map((m, i) => [m.id, armForSeat[i]]));
  D.completeAuctionReview(draft, 0);

  let guard = 8000;
  while (!draft.complete && guard-- > 0) {
    if (!draft.auction.lot) { D.nominateBestTarget(draft, 0); if (draft.complete || !draft.auction.lot) break; }
    let inner = TEAMS * 4 + 8;
    while (draft.auction.lot && inner-- > 0) {
      const next = D.sealedBidder(draft);
      if (!next) break;
      const lot = draft.auction.lot;
      const base = D.cpuSealedBid(draft, next);
      D.placeSealedBid(draft, next.id, applyArm(armOf.get(next.id), base, { draft, manager: next, lot }), 0);
    }
  }
  if (D.repairDraftRosters) D.repairDraftRosters(draft);
  if (options.teamsOnly) return draft.managers.map((m) => D.buildTeam(m, { optimize: true }));

  const model = D.managerValuation(draft, draft.managers[0]);
  const teams = draft.managers.map((m) => D.buildTeam(m, { optimize: true }));
  const summary = simulateBatch(teams, { runs: RUNS, seed: `${seed}-sim` });
  const winByName = new Map(summary.teams.map((t) => [t.team, t.winPct]));
  return draft.managers.map((m, i) => {
    const team = teams[i];
    const fielded = [...team.lineup, ...team.starters, ...team.bullpen];
    return {
      arm: armForSeat[i],
      persona: m.persona,
      win: winByName.get(m.name) ?? 0,
      seated: fielded.reduce((sum, card) => sum + model.value(card), 0),
      spent: BUDGET - D.auctionBudget(draft, m),
      left: D.auctionBudget(draft, m),
      cards: m.roster.length
    };
  });
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// The ABSOLUTE test. A mixed table says whether an arm beats rivals who lack it;
// this says whether a table that ALL has it fields better teams, which is what
// shipping to every CPU actually does.
if (args.duel) {
  const [A, B] = ARM_KEYS;
  const wins = [];
  for (let L = 0; L < LEAGUES; L++) {
    const seed = `${TAG}-${L}`;
    const teamsA = driveLeague(seed, Array(TEAMS).fill(A), { teamsOnly: true });
    const teamsB = driveLeague(seed, Array(TEAMS).fill(B), { teamsOnly: true });
    for (let seat = 0; seat < TEAMS; seat++) {
      const summary = simulateBatch(
        [{ ...teamsA[seat], name: "A" }, { ...teamsB[seat], name: "B" }],
        { runs: RUNS, seed: `${seed}-duel-${seat}` }
      );
      wins.push(summary.teams.find((t) => t.team === "A")?.winPct ?? 0.5);
    }
  }
  const m = mean(wins);
  console.log(`Absolute duel: every seat ${A} vs every seat ${B} — ${LEAGUES} lg x ${TEAMS} seats, ${PRICING}/${NOMINATION}, $${BUDGET}, roster ${ROSTER} (${SP} SP), ${UNIVERSE}, persona=${PERSONA}, tag=${TAG}, ${RUNS} games/duel`);
  console.log(`  a table of ${A} beats its own ${B} counterpart: ${(m * 100).toFixed(2)}%  (n=${wins.length})`);
  console.log(`  edge: ${((m - 0.5) * 100 >= 0 ? "+" : "")}${((m - 0.5) * 100).toFixed(2)} pts  (±${(1.96 * std(wins) / Math.sqrt(wins.length) * 100).toFixed(2)} 95% CI)`);
  process.exit(0);
}

const rows = new Map(ARM_KEYS.map((key) => [key, []]));
for (let L = 0; L < LEAGUES; L++) {
  // Latin square: arm a sits in seat (a + L) % TEAMS, so over any block of
  // TEAMS leagues every arm has sat in every seat exactly once.
  const armForSeat = Array.from({ length: TEAMS }, (_, seat) => ARM_KEYS[(seat + L) % ARM_KEYS.length]);
  const results = driveLeague(`${TAG}-${L}`, NULL_RUN ? armForSeat.map(() => ARM_KEYS[0]) : armForSeat);
  results.forEach((row, seat) => rows.get(armForSeat[seat]).push(row));
}

console.log(`Endgame bidding: ${LEAGUES} leagues x ${TEAMS} seats, ${PRICING}/${NOMINATION}, $${BUDGET}, roster ${ROSTER} (${SP} SP), ${UNIVERSE}, pen=${PEN.bullpenSlots ?? 2}/${PEN.bullpenMin ?? "-"}, persona=${PERSONA}, tag=${TAG}, ${RUNS} games/league${NULL_RUN ? "   *** NULL: every seat is arm " + ARM_KEYS[0] + " ***" : ""}`);
console.log(`  ${"arm".padEnd(15)}${"win%".padStart(8)}${"±95%".padStart(8)}${"seated".padStart(10)}${"spent".padStart(9)}${"left".padStart(7)}${"cards".padStart(7)}`);
const base = mean(rows.get(ARM_KEYS[0]).map((r) => r.win));
for (const key of ARM_KEYS) {
  const list = rows.get(key);
  const w = list.map((r) => r.win);
  const ci = 1.96 * std(w) / Math.sqrt(w.length);
  const delta = key === ARM_KEYS[0] ? "" : `  (${(mean(w) - base) * 100 >= 0 ? "+" : ""}${((mean(w) - base) * 100).toFixed(2)} vs ${ARM_KEYS[0]})`;
  console.log(`  ${key.padEnd(15)}${(mean(w) * 100).toFixed(2).padStart(8)}${("±" + (ci * 100).toFixed(2)).padStart(8)}${mean(list.map((r) => r.seated)).toFixed(0).padStart(10)}${mean(list.map((r) => r.spent)).toFixed(0).padStart(9)}${mean(list.map((r) => r.left)).toFixed(0).padStart(7)}${mean(list.map((r) => r.cards)).toFixed(1).padStart(7)}${delta}`);
}
