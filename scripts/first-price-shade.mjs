#!/usr/bin/env node
// Should a computer SHADE its bid in a first-price room?
//
// Under the house Vickrey rule the winner pays the second bid plus a point, so
// naming your true number costs you nothing — you never pay it. Under first
// price you write the cheque you named, and the question becomes a real one.
//
// *** WHY THIS IS NOT bidder-duel.mjs. ***
//
// A duel upgrades every seat at once, and a uniform shade is INVISIBLE to that:
// an auction allocates by relative worth, so if all four seats multiply their
// bids by the same k the same cards land in the same seats and only the prices
// move. The duel would read zero for a shade that is worth ten points against a
// table that did not get it. So this seats the ARMS AGAINST EACH OTHER — one
// per seat, rotated so each arm sits in each seat equally often — and asks the
// question that actually matters: does a shader beat a truthteller in the room?
//
// That makes it valuation-ab's design, with two differences. Every arm runs out
// of the WORKING TREE (the shade is applied to cpuSealedBid's answer here in the
// harness), so there is no frozen baseline module to keep in step. And a Latin
// square over N arms in N seats cancels the seat exactly within each block of N
// leagues, where valuation-ab only alternates two configurations.
//
// *** RUN THE NULL. *** --null puts the same arm in every seat. Its spread is
// the harness's own noise floor, and nothing narrower than it is a result. A
// null that does not read ~0 means the rotation is not cancelling and the cell
// is worthless (valuation-ab's once read -10.10 when it had to be 0).
//
// *** RUN --pricing vickrey. *** It is the falsification control. Shading must
// LOSE under Vickrey — you forfeit cards you would have won at a price you were
// happy to pay. An arm that wins under both rules is not measuring first-price
// strategy at all; it is a pacing change wearing a shade's clothes.
//
// Usage: node scripts/first-price-shade.mjs [--leagues N] [--runs N] [--budget N]
//        [--roster N] [--universe U] [--persona P] [--temperature N] [--tag T]
//        [--sp N] [--pen N|all] [--penmin N] [--pricing first|vickrey] [--arms a,b,c] [--null]

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
// One shared persona by default, so the ARM is the only difference. `--persona
// mixed` instead leaves createDraft's own seeded deal in place, which is what a
// real room does — and is the only fair cell for an estimator that assumes its
// rivals value cards the way it does. With one persona across the table that
// assumption is very nearly TRUE, and the estimator is graded on its own premise.
const PERSONA = args.persona ?? "balanced";
const MIXED_PERSONAS = PERSONA === "mixed";
const TEMPERATURE = Number(args.temperature ?? 0);
const TAG = args.tag ?? "fps";
const SP = Number(args.sp ?? ROSTER - 11);
const PRICING = args.pricing === "vickrey" ? "vickrey" : "first";
const NULL_RUN = Boolean(args.null);
const PEN = args.pen == null ? {} : { bullpenSlots: args.pen === "all" ? "all" : Number(args.pen), bullpenMin: args.penmin == null ? undefined : Number(args.penmin) };

// ---- the arms -------------------------------------------------------------
//
// Each arm takes the bid the computer would have made and returns the one it
// actually enters. `true` is the control: the bidder exactly as it ships.
//
// The legality rails live in applyArm below, not in here: an arm may return any
// number it likes and still never bid over its budget, never turn a live bid
// into a pass, and never drop under a rebid round's floor.
const ARMS = {
  // Bid the plan. auctionWillingness is not "what is this card worth" but
  // "what share of my bankroll have I set aside for it", which is already a
  // first-price number — pay it on every card you win and you end with a full
  // roster and an empty wallet, which is the plan.
  true: (bid) => bid,
  "flat-95": (bid) => bid * 0.95,
  "flat-90": (bid) => bid * 0.90,
  "flat-80": (bid) => bid * 0.80,
  "flat-70": (bid) => bid * 0.70,
  "flat-55": (bid) => bid * 0.55,
  // The textbook first-price answer: against n-1 rivals with independent values
  // drawn uniformly, bid (n-1)/n of your value. Values here are anything but
  // independent — every seat reads the same card with a perturbed copy of the
  // same model — so this is expected to over-shade. It is in as the reference
  // point, not as a favourite.
  "rivals": (bid, { bidders }) => bid * ((bidders - 1) / bidders),
  // Half as far: the same shape, damped for how strongly correlated the room's
  // valuations really are.
  "rivals-half": (bid, { bidders }) => bid * (1 - 0.5 / bidders),

  // Pay up for starting pitching. The bidder puts ~0.43-0.54 dollars behind an
  // arm per unit of engine value against ~0.45-0.50 behind a bat, and across
  // seven live rooms the teams that bought arms won. Either the discount is a
  // real correction (pitcher value metrics are known to overstate) and a table
  // that all paid up would gain nothing, or it is too deep. Only the ABSOLUTE
  // duel can tell those apart — a mixed table rewards whoever is out of step
  // with a field that is underpaying.
  "sp-lift-13": spLift(1.3),
  "sp-lift-16": spLift(1.6),
  "sp-lift-20": spLift(2.0),

  // ---- differential shades: less on cards with a substitute coming, full
  // freight on the ones with none. A uniform shade is a disturbance the pacing
  // loop rejects (it regulates total spend and has no per-card term); only a
  // shade that moves money BETWEEN cards can survive it.

  // *** CHEATS, DELIBERATELY. *** Reads every rival's willingness and bids one
  // over the best of them: wins exactly the lots it would have won, at exactly
  // the Vickrey price, which is the most any "guess the runner-up" strategy
  // could ever be worth. No real bidder can see this, so it is not a candidate
  // to ship — it is the ceiling on the whole family. If the oracle cannot beat
  // bidding the plan, nothing in the family can, and phase 2 is dead.
  "oracle": (bid, { draft, manager, lot }) => {
    const eligible = [...new Set([...lot.pending, ...Object.keys(lot.bids)])].filter((id) => id !== manager.id);
    let best = 0;
    for (const id of eligible) {
      const rival = draft.managers.find((m) => m.id === id);
      if (rival) best = Math.max(best, D.cpuSealedBid(draft, rival));
    }
    return Math.min(bid, best + 1);
  },

  // The shippable candidate. Same shape as the oracle — bid one over the best
  // rival — but it may only use what the table can SEE: every rival's budget and
  // roster, read through the bidder's OWN valuation model. The persona swap is
  // the mechanical way to say "price his open slots the way I price mine"; it
  // reads his public state and never his hidden archetype, which is restored
  // before anything else can observe it.
  //
  // Grade this ONLY under `--persona mixed`. With one archetype across the table
  // the assumption it rests on is nearly true, and it collapses into the oracle.
  "est": estimatorArm(1.00),
  // The same estimate paid over the odds, because a runner-up you have guessed
  // low on costs you the whole card while one you have guessed high only costs
  // you the difference. The errors are not symmetric, so the hedge may be worth
  // more than the sharper estimate.
  "est-hedge": estimatorArm(1.15),

  // ---- decomposing the oracle -------------------------------------------
  //
  // The oracle does two separable things. It bids the FLOOR on a lot nobody
  // else wants — under Vickrey an uncontested card costs $1 however hard you
  // bid for it, so the shipped bidder never had to notice; under first price it
  // charges you every dollar you named. And on a contested lot it matches the
  // runner-up to the dollar. These two want completely different machinery: the
  // first only asks "will anyone bid at all", a yes/no read of public budgets
  // and open slots, while the second needs a rival's number to the dollar.
  //
  // So split them. Both arms below still cheat (they read the true persona);
  // each is the ceiling for its half, and the pair says which half is worth
  // building for real.
  "oracle-floor": (bid, context) => (anyRivalBids(context) ? bid : AUCTION_FLOOR),
  "oracle-match": (bid, context) => (anyRivalBids(context) ? ARMS.oracle(bid, context) : bid),

  // Shade by how little losing costs. If an equally good card at this card's
  // group is still on the board, walking away is cheap, so shade hard; if he is
  // the last of his kind, pay. (The real thing would weight substitutes by
  // their chance of actually coming up, which is forthcomingPlayers' job and
  // is not exported — this reads the whole board instead, so it OVERSTATES how
  // available the substitutes are and shades a little too freely.)
  "regret-20": regretArm(0.20),
  "regret-35": regretArm(0.35),
  "regret-50": regretArm(0.50)
};

const AUCTION_FLOOR = 1;

// Does ANY rival want this card at all? The cheap half of the oracle's read.
function anyRivalBids({ draft, manager, lot }) {
  for (const rival of eligibleRivals(draft, manager, lot)) {
    if (D.cpuSealedBid(draft, rival) > 0) return true;
  }
  return false;
}

// Who else is live on this lot. Public: the room watches the bidding.
function eligibleRivals(draft, manager, lot) {
  return [...new Set([...lot.pending, ...Object.keys(lot.bids)])]
    .filter((id) => id !== manager.id)
    .map((id) => draft.managers.find((m) => m.id === id))
    .filter(Boolean);
}

function estimatorArm(hedge) {
  return (bid, { draft, manager, lot }) => {
    let best = 0;
    for (const rival of eligibleRivals(draft, manager, lot)) {
      const hidden = rival.persona;
      rival.persona = manager.persona;
      try { best = Math.max(best, D.cpuSealedBid(draft, rival)); } finally { rival.persona = hidden; }
    }
    return Math.min(bid, Math.round(best * hedge) + 1);
  };
}

function spLift(factor) {
  return (bid, { draft }) => {
    const card = D.auctionLotPlayer(draft);
    return card?.kind === "pitcher" && card.role === "SP" ? bid * factor : bid;
  };
}

function regretArm(theta) {
  return (bid, { draft, manager, lot }) => {
    const card = D.auctionLotPlayer(draft);
    if (!card) return bid;
    const model = D.managerValuation(draft, manager);
    const value = model.value(card);
    if (!(value > 0)) return bid;
    const group = D.poolGroup(card);
    let best = 0;
    for (const other of D.availablePlayers(draft)) {
      if (other.id === card.id || D.poolGroup(other) !== group) continue;
      const v = model.value(other);
      if (v > best) best = v;
    }
    // 1 when he is the last of his kind, 0 when his equal is still on the board.
    const regret = Math.max(0, Math.min(1, (value - best) / value));
    return bid * (1 - theta * (1 - regret));
  };
}
const ARM_KEYS = args.arms ? args.arms.split(",") : ["true", "flat-90", "flat-80", "flat-70"];
for (const key of ARM_KEYS) if (!ARMS[key]) throw new Error(`Unknown arm "${key}". Known: ${Object.keys(ARMS).join(", ")}`);
// One seat per arm in a mixed table. In --duel mode the arms are not seated
// against each other at all (every seat runs one of them), so the table size is
// free and must stay a realistic room rather than collapsing to two.
const TEAMS = (args.duel || args.duelpersonas) ? Number(args.teams ?? 4) : ARM_KEYS.length;

// An arm shapes the bid; it never breaks the room's rules. A pass stays a pass
// (shading a 0 is still 0, and a shaded bid that rounds under the minimum is a
// manager who has talked himself out of the card). A rebid round has a floor —
// you are re-entering a tie you already made — so an arm cannot shade below it.
function applyArm(armKey, bid, context) {
  if (bid <= 0) return 0;
  const shaped = Math.round(ARMS[armKey](bid, context));
  const { draft, manager, lot } = context;
  const floor = lot.round === 2 ? lot.tie.amount : 1;
  return Math.max(floor, Math.min(D.auctionMaxBid(draft, manager), shaped));
}

// --duel a,b: the ABSOLUTE test. A mixed table measures whether an arm beats
// rivals who lack it; that can be pure denial. This runs each league TWICE off
// one seed — every seat on arm A, then every seat on arm B — and plays each
// seat's A roster against its OWN B counterpart. The board cancels exactly, so
// what is left is whether a table of A-bidders builds BETTER TEAMS than a table
// of B-bidders. A change shipping to every CPU has to clear this, not just the
// mixed table.
function driveLeague(seed, armForSeat, options = {}) {
  const pool = buildDraftPool(UNIVERSE, seed, {
    nomination: "random", managerCount: TEAMS, startingPitchers: SP, temperature: TEMPERATURE, ...PEN
  });
  const managers = Array.from({ length: TEAMS }, (_, i) => ({ name: `S${i}`, cpu: true }));
  const draft = D.createDraft(managers, pool, ROSTER, seed, {
    draftType: "auction", nomination: "random", startingPitchers: SP,
    budget: BUDGET, auctionPricing: PRICING, timer: false, snakeTimer: false, ...PEN
  });
  // One persona across the table, so the ARM is the only thing that differs —
  // unless the cell asked for the real room's mixed deal.
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
      // How many managers this lot was opened to — those still to bid plus
      // those already in. Not a peek: the room can see who is bidding.
      const bidders = lot.pending.length + Object.keys(lot.bids).length;
      const base = D.cpuSealedBid(draft, next);
      D.placeSealedBid(draft, next.id, applyArm(armOf.get(next.id), base, { draft, manager: next, lot, bidders }), 0);
    }
  }
  if (D.repairDraftRosters) D.repairDraftRosters(draft);
  if (options.teamsOnly) return draft.managers.map((m) => D.buildTeam(m, { optimize: true }));

  // One neutral model for the whole league, so "what did this seat end up
  // fielding" is measured on the same ruler for every arm.
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
      // What the seat actually fields, and what it paid to field it. A shade
      // that wins should show up here as the same nine for less money, or a
      // better nine for the same — not merely as rivals made poorer.
      seated: fielded.reduce((sum, card) => sum + model.value(card), 0),
      spent: BUDGET - D.auctionBudget(draft, m),
      cards: m.roster.length
    };
  });
}

// --duelpersonas A,B: the ABSOLUTE archetype test. Every seat plays archetype A,
// then every seat plays archetype B off the same seed and deck, and each seat's
// A roster meets its own B counterpart. A mixed table only shows STANDINGS,
// which are field-dependent by construction — this asks the different question
// of whether a table of A-drafters builds better TEAMS than a table of B.
if (args.duelpersonas) {
  const [PA, PB] = String(args.duelpersonas).split(",");
  const wins = [];
  for (let L = 0; L < LEAGUES; L++) {
    const seed = `${TAG}-${L}`;
    const a = driveLeague(seed, Array(TEAMS).fill(ARM_KEYS[0]), { teamsOnly: true, persona: PA });
    const b = driveLeague(seed, Array(TEAMS).fill(ARM_KEYS[0]), { teamsOnly: true, persona: PB });
    for (let seat = 0; seat < TEAMS; seat++) {
      const summary = simulateBatch([{ ...a[seat], name: "A" }, { ...b[seat], name: "B" }],
        { runs: RUNS, seed: `${seed}-pduel-${seat}` });
      wins.push(summary.teams.find((t) => t.team === "A")?.winPct ?? 0.5);
    }
  }
  const m = wins.reduce((x, y) => x + y, 0) / wins.length;
  const sd = Math.sqrt(wins.reduce((x, y) => x + (y - m) ** 2, 0) / wins.length);
  console.log(`Absolute archetype duel: a table of ${PA} vs a table of ${PB} — ${LEAGUES} leagues x ${TEAMS} seats, ${PRICING}, ${UNIVERSE}, $${BUDGET}, roster ${ROSTER} (${SP} SP), pen=${PEN.bullpenSlots ?? 2}/${PEN.bullpenMin ?? "-"}, ${RUNS} games/duel`);
  console.log(`  ${PA} beats its own ${PB} counterpart: ${(m * 100).toFixed(2)}%  (n=${wins.length})`);
  console.log(`  edge: ${((m - 0.5) * 100 >= 0 ? "+" : "")}${((m - 0.5) * 100).toFixed(2)} pts  (±${(1.96 * sd / Math.sqrt(wins.length) * 100).toFixed(2)} 95% CI)`);
  process.exit(0);
}

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
  const dmean = wins.reduce((x, y) => x + y, 0) / wins.length;
  const dstd = Math.sqrt(wins.reduce((x, y) => x + (y - dmean) ** 2, 0) / wins.length);
  console.log(`Absolute duel: every seat ${A} vs every seat ${B} — ${LEAGUES} leagues x ${TEAMS} seats, ${PRICING}, persona=${PERSONA}, tag=${TAG}, ${RUNS} games/duel`);
  console.log(`  a table of ${A} beats its own ${B} counterpart: ${(dmean * 100).toFixed(2)}%  (n=${wins.length})`);
  console.log(`  edge over even: ${((dmean - 0.5) * 100 >= 0 ? "+" : "")}${((dmean - 0.5) * 100).toFixed(2)} pts  (±${(1.96 * dstd / Math.sqrt(wins.length) * 100).toFixed(2)} 95% CI)`);
  process.exit(0);
}

const rows = new Map(ARM_KEYS.map((key) => [key, []]));
for (let L = 0; L < LEAGUES; L++) {
  // Latin square: arm a sits in seat (a + L) % TEAMS. Over any block of TEAMS
  // leagues every arm has sat in every seat exactly once, so nomination order
  // and bid order cancel instead of averaging out slowly.
  const armForSeat = Array.from({ length: TEAMS }, (_, seat) => ARM_KEYS[(seat + L) % TEAMS]);
  // Under --null every seat really runs arm 0, but the rows are still filed
  // under the arm whose SEAT it was — so the spread the table reports is the
  // harness's own noise, measured through the same rotation as a live cell.
  const results = driveLeague(`${TAG}-${L}`, NULL_RUN ? armForSeat.map(() => ARM_KEYS[0]) : armForSeat);
  results.forEach((row, seat) => rows.get(armForSeat[seat]).push(row));
}

// With `--persona mixed` the table also answers a question of its own: does the
// PRICING RULE change which archetype wins? Archetype standings are already known
// to be field-dependent and to invert by universe, so a rule that reprices every
// lot is a fair suspect. Read this only off a --null cell, where every seat bids
// the same way and the persona is the only thing left.
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

console.log(`First-price shade: ${LEAGUES} leagues x ${TEAMS} seats, ${PRICING} pricing, $${BUDGET}, roster ${ROSTER} (${SP} SP), ${UNIVERSE}, temp=${TEMPERATURE}, pen=${PEN.bullpenSlots ?? 2}/${PEN.bullpenMin ?? "-"}, persona=${PERSONA}, tag=${TAG}, ${RUNS} games/league${NULL_RUN ? "   *** NULL: every seat is arm " + ARM_KEYS[0] + " ***" : ""}`);
console.log(`  ${"arm".padEnd(13)}${"win%".padStart(8)}${"±95%".padStart(8)}${"seated".padStart(10)}${"spent".padStart(9)}${"cards".padStart(7)}`);
const base = mean(rows.get(ARM_KEYS[0]).map((r) => r.win));
for (const key of ARM_KEYS) {
  const list = rows.get(key);
  const w = list.map((r) => r.win);
  const ci = 1.96 * std(w) / Math.sqrt(w.length);
  const delta = key === ARM_KEYS[0] ? "" : `  (${(mean(w) - base) * 100 >= 0 ? "+" : ""}${((mean(w) - base) * 100).toFixed(2)} vs ${ARM_KEYS[0]})`;
  console.log(`  ${key.padEnd(13)}${(mean(w) * 100).toFixed(2).padStart(8)}${("±" + (ci * 100).toFixed(2)).padStart(8)}${mean(list.map((r) => r.seated)).toFixed(0).padStart(10)}${mean(list.map((r) => r.spent)).toFixed(0).padStart(9)}${mean(list.map((r) => r.cards)).toFixed(1).padStart(7)}${delta}`);
}

if (MIXED_PERSONAS) {
  const byPersona = new Map();
  for (const list of rows.values()) {
    for (const row of list) {
      if (!byPersona.has(row.persona)) byPersona.set(row.persona, []);
      byPersona.get(row.persona).push(row);
    }
  }
  console.log(`  --- by archetype (${PRICING}) ---`);
  for (const [persona, list] of [...byPersona].sort((a, b) => mean(b[1].map((r) => r.win)) - mean(a[1].map((r) => r.win)))) {
    const w = list.map((r) => r.win);
    console.log(`  ${String(persona).padEnd(13)}${(mean(w) * 100).toFixed(2).padStart(8)}${("±" + (1.96 * std(w) / Math.sqrt(w.length) * 100).toFixed(2)).padStart(8)}${mean(list.map((r) => r.seated)).toFixed(0).padStart(10)}${mean(list.map((r) => r.spent)).toFixed(0).padStart(9)}${mean(list.map((r) => r.cards)).toFixed(1).padStart(7)}   n=${w.length}`);
  }
}
