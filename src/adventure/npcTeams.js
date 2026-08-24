import { chartSpan } from "../rules/cards.js?v=20260716-records";
import { adventurePool } from "./packs.js?v=20260716-records";
import { npcBudget, trainerById } from "./region.js?v=20260716-records";
import { createRng } from "../rules/rng.js?v=20260716-records";
import { personConflict, playsPosition } from "../rules/cards.js?v=20260716-records";
import { ROSTER_BENCH_KEY } from "../rules/draft.js?v=20260716-records";
import { claimedFrom } from "./state.js?v=20260716-records";
import { rosterFormat, formatManagerFields, benchPrice } from "./rosterFormats.js?v=20260716-records";

// One roster slot per required lineup spot plus the staff. "HITTER" is the
// DH: any bat qualifies. "BENCH" is a full-format reserve bat — also any
// hitter, but paid at the bench discount and drafted last, after the men who
// actually take the field.
const HITTER_SLOTS = ["C", "1B", "2B", "3B", "SS", "LF/RF", "LF/RF", "CF", "HITTER"];
const PITCHER_SLOTS = ["SP", "SP", "RP", "RP"];
const FULL_PITCHER_SLOTS = ["SP", "SP", "SP", "SP", "RP", "RP", "RP"];
const FULL_BENCH_SLOTS = ["BENCH", "BENCH", "BENCH", "BENCH"];

// What a slot pays for its card: bench slots buy at the discount, the same
// arithmetic the player's own cap check runs (rosterFormats.benchPrice).
function slotCost(slot, card) {
  return slot === "BENCH" ? benchPrice(card.points) : card.points;
}

function rosterCost(roster, slots) {
  return roster.reduce((total, card, index) => total + slotCost(slots[index], card), 0);
}

// Archetype scoring biases which card wins a slot; the budget keeps the roster
// legal and affordable either way. Scoring reads the PRINTED price the trainer
// actually pays — not the hidden true value — so a card the market underpriced
// this season is valued at its bargain sticker, not adored as a discounted star
// that every rival stacks onto the same slot.
const ARCHETYPES = {
  balanced: (card) => worth(card),
  contact: (card) => (card.kind === "hitter" ? card.onBase * 30 + worth(card) * 0.2 : worth(card)),
  speed: (card) => (card.kind === "hitter" ? card.speed * 25 + worth(card) * 0.3 : worth(card)),
  power: (card) => (card.kind === "hitter" ? chartSlots(card, "HR") * 90 + worth(card) * 0.4 : worth(card)),
  ace: (card) => (card.kind === "pitcher" ? worth(card) * 2 : worth(card))
};

function worth(card) {
  return card.points;
}

function chartSlots(card, result) {
  return card.chart.reduce((sum, row) => sum + (row.result === result ? chartSpan(row) : 0), 0);
}

function slotMatches(slot, card) {
  if (slot === "HITTER" || slot === "BENCH") return card.kind === "hitter";
  if (slot === "SP" || slot === "RP") return card.role === slot;
  return card.kind === "hitter" && playsPosition(card, slot);
}

// Pass the save so mode scaling applies (uncapped bosses shop richer);
// without one the printed budget stands. Team identity (seeded slot order,
// weights, picks) only shifts when the budget itself does.
export function buildNpcTeam(trainer, save = null) {
  const { roster, slots, spent } = assembleRosterCached(trainer, save);

  // Present (and bat) the squad best-first: hitters by printed points, then
  // pitchers by printed points, so the top starter also opens game 1.
  const byPoints = (a, b) => b.points - a.points || a.name.localeCompare(b.name);
  const hitters = roster.filter((card) => card.kind === "hitter").sort(byPoints);
  const pitchers = roster.filter((card) => card.kind === "pitcher").sort(byPoints);

  // A man BOUGHT for a bench slot SITS on the bench — that is the seat his
  // discounted price paid for. Without this pin the lineup would seat the
  // roster best-first, and a star bought at a fifth of sticker would start
  // while a full-price scrub sat: the budget and the team would disagree.
  const benchIds = roster.filter((card, index) => slots[index] === "BENCH").map((card) => card.id);
  const lineupAssignments = benchIds.length ? { [ROSTER_BENCH_KEY]: benchIds } : {};
  const benched = new Set(benchIds);

  return {
    id: trainer.id,
    name: trainer.name,
    roster: [...hitters, ...pitchers],
    lineupAssignments,
    battingOrder: hitters.filter((card) => !benched.has(card.id)).map((card) => card.id),
    points: spent,
    // Full-format saves hand buildTeam the whole shape: the four-man
    // rotation, however many relievers the flex bought, and the bench.
    ...formatManagerFields(save?.rosterFormat, [...hitters, ...pitchers])
  };
}

// How sharply the climb favors a weak slot over a strong one: the odds a slot
// is picked next scale with (1 - its card's positional percentile) raised to
// this power. Higher means the cheapest slots almost always go first.
const WEAK_SLOT_BIAS = 4;
// The climb stops after this many draws in a row overshoot the budget — a
// stochastic stop, so two trainers with the same budget settle differently.
const REJECT_LIMIT = 25;

// A team is a pure function of (trainer, budget, pool): it is rebuilt from a
// seeded stream, so the same inputs always yield the same roster. It is also
// expensive — the climb reads a pool of thousands — and callers hammer it: the
// winner's-pick screen rebuilds the beaten roster on every keystroke, the
// scouting screen builds it twice a render, and a summit rival recurses through
// his whole inheritance chain. So the assembled roster is memoized here, keyed
// by trainer and budget. The cache is dropped whenever the active pool object
// changes — a new save, league, or seed swaps universePool's poolCache out, and
// pool identity is the one signal that captures all three.
let rosterCache = new Map();
let rosterCachePool = null;

// A trainer's roster is otherwise identical in every save that shares a pool.
// The classic set is one fixed, unnoised deck, so its bosses came out the very
// same on every device and every playthrough — a manager who plays the ladder
// on a phone and a laptop meets the identical JOJO both times. Salt the team's
// RNG with the save's own seed so each run faces its own opponents, while a
// single run stays stable (the seed does not shift under it). Callers with no
// save (generic previews) fall back to the shared, unsalted roster.
function teamSalt(save) {
  return save?.saveSeed ? `${save.saveSeed}:` : "";
}

function assembleRosterCached(trainer, save) {
  const pool = adventurePool();
  if (pool !== rosterCachePool) {
    rosterCache = new Map();
    rosterCachePool = pool;
  }
  const key = `${trainer.id}:${rosterFormat(save).key}:${teamSalt(save)}${npcBudget(save, trainer)}:${claimKey(save, trainer)}`;
  let hit = rosterCache.get(key);
  if (!hit) {
    hit = assembleRoster(trainer, save);
    rosterCache.set(key, hit);
  }
  return hit;
}

// The roster in fill order, alongside the slot each card was bought for — an
// heir needs that pairing to keep shopping where his predecessor stopped.
function assembleRoster(trainer, save) {
  const pool = adventurePool();
  const pointBudget = npcBudget(save, trainer);
  const score = ARCHETYPES[trainer.archetype] ?? ARCHETYPES.balanced;
  // A trainer who INHERITS doesn't hold a draft: he keeps the binder he already
  // owns and spends the season's new money on it — so RIVAL CAM at the summit is
  // the Cam from Route 1, several trades richer, not a stranger wearing his
  // sprite. He opens from last round's roster and climbs it with the new budget.
  const heirloom = trainer.inherits ? assembleRosterCached(trainerById(trainer.inherits), save) : null;
  // One seeded stream feeds the slot order, the baseline fill, and every upgrade
  // draw — so a save always rebuilds the same rival, round after round.
  const rng = createRng(`npc-team:${teamSalt(save)}${trainer.teamSeed}`);
  const slots = heirloom ? heirloom.slots : draftSlots(trainer, rng, rosterFormat(save).key);
  // Bucket the pool by slot ONCE, in pool order. The minimum fill, the climb,
  // and the percentile ranking all read these buckets instead of rescanning the
  // whole pool per slot per pass. Pool order is kept exactly so the seeded draws
  // below see the same candidate order they always have — this is a speedup, not
  // a behavior change.
  const candidates = candidatesForSlots(pool, slots);
  // A fresh trainer opens from a cheap legal roster; an heir from his
  // inherited binder. The same climb spends the budget up from whichever
  // floor. The minimum fill may prune a bench slot a thin pool cannot stock,
  // so the slot list the rest of the assembly walks is the one it returns.
  const floor = heirloom
    ? { roster: [...heirloom.roster], slots: heirloom.slots }
    : minimumRoster(candidates, slots, trainer, rng, pointBudget);
  const roster = floor.roster;
  const filledSlots = floor.slots;
  const used = new Set(roster.map((card) => card.id));
  climb({ candidates, pointBudget, score, slots: filledSlots, roster, used, rng });
  // The winner's pick is paid out of THIS roster, so it is settled last: the
  // trainer shops his whole budget, then hands over the men you took off him.
  replaceClaimedCards({ trainer, save, candidates, slots: filledSlots, roster, used });
  const spent = rosterCost(roster, filledSlots);

  return { roster, slots: filledSlots, spent };
}

// A card claimed off a beaten trainer is GONE from his binder: he turns up to
// the rematch with a bargain-bin body in that slot, and his roster is that much
// poorer for it. The replacement is drawn the way the opening floor is — a
// seeded pick from the cheapest few legal fits — off its own RNG stream, so
// losing a man changes that slot and nothing else about the team.
//
// An heir inherits the hole: his heirloom roster already carries the fill-in,
// and his new budget is free to climb out of it — including, if the draws fall
// that way, by signing the very man you took. That is a rival going shopping
// with a season's money, not the claim failing to land: the card is off the
// binder by default, and it is his own budget that has to put anything back.
function replaceClaimedCards({ trainer, save, candidates, slots, roster, used }) {
  for (const cardId of claimedFrom(save, trainer.id)) {
    const index = roster.findIndex((card) => card.id === cardId);
    if (index < 0) continue; // already claimed off a predecessor, or never his
    const taken = roster[index];
    const rng = createRng(`npc-claimed:${teamSalt(save)}${trainer.teamSeed}:${cardId}`);
    const eligible = candidates.get(slots[index])
      .filter((card) => !used.has(card.id) && !personConflict(roster, card, taken.id))
      .sort((a, b) => a.points - b.points || a.name.localeCompare(b.name));
    // Nothing legal left at the slot — a league too thin to field a
    // replacement. He keeps the man rather than taking the field short.
    if (!eligible.length) continue;
    applySwap(roster, used, index, rng.pick(eligible.slice(0, CHEAP_BAND)));
    // applySwap frees the man who left the roster. He did not go back on the
    // market — he went into your binder — so he stays spoken for, and a second
    // claim at another slot cannot re-sign him as its fill-in.
    used.add(taken.id);
  }
}

// Claims belong in the roster cache key — a team is only a pure function of its
// inputs once they are one. The whole inherits chain counts: an heir opens from
// a binder his predecessor may have been robbed of after this heir was built.
function claimKey(save, trainer) {
  const parts = [];
  for (let link = trainer; link; link = link.inherits ? trainerById(link.inherits) : null) {
    const taken = claimedFrom(save, link.id);
    if (taken.length) parts.push(`${link.id}=${taken.join(",")}`);
  }
  return parts.join("|");
}

// The pool split into per-slot buckets, each holding every card that can fill
// that slot, in the pool's own order. Built once per assembly and shared across
// the fill, the climb, and the percentile ranking.
function candidatesForSlots(pool, slots) {
  const buckets = new Map();
  for (const slot of new Set(slots)) {
    buckets.set(slot, pool.filter((card) => slotMatches(slot, card)));
  }
  return buckets;
}

// Early slots see the most room, so the fill ORDER is shuffled per trainer —
// which position lands the star is part of the trainer's identity, not always
// the catcher. Ace staffs still shop for pitching first so the budget lands on
// the mound.
function draftSlots(trainer, rng, format = "classic") {
  const pitcherSlots = format === "full" ? FULL_PITCHER_SLOTS : PITCHER_SLOTS;
  const benchSlots = format === "full" ? FULL_BENCH_SLOTS : [];
  // Bench slots always draft last: the reserve is bought out of what is left
  // after the men who take the field, never instead of them.
  const active = trainer.archetype === "ace"
    ? [...shuffled(pitcherSlots, rng), ...shuffled(HITTER_SLOTS, rng)]
    : shuffled([...HITTER_SLOTS, ...pitcherSlots], rng);
  return [...active, ...benchSlots];
}

// How wide the bargain bin is: the fill draws seeded-randomly from a slot's
// cheapest few, not always its single cheapest card. Every early boss used to
// open from the SAME strict-minimum roster — the one cheapest catcher, the one
// cheapest shortstop — and their small budgets barely lifted them off it, so
// Route 1 fielded the same bargain-bin binder over and over. Picking among the
// cheapest handful keeps the floor cheap (the climb still spends up from it) but
// hands each trainer a different one, so the early ladder stops feeling cloned.
const CHEAP_BAND = 8;

// A cheap legal roster: fill every slot with a seeded pick from its cheapest
// CHEAP_BAND unused fits, one era of a player per team. This floor is what the
// climb trades up from — and it must stay affordable, since the climb only ever
// spends UP from it, so an over-budget floor is repaired back down below.
function minimumRoster(candidates, slots, trainer, rng, pointBudget) {
  const roster = [];
  const filled = [];
  const used = new Set();
  for (const slot of slots) {
    // The cheapest legal fits (points ascending, name breaking ties), then a
    // seeded draw from the cheapest handful of them.
    const eligible = candidates.get(slot)
      .filter((card) => !used.has(card.id) && !personConflict(roster, card))
      .sort((a, b) => a.points - b.points || a.name.localeCompare(b.name));
    if (!eligible.length) {
      // A bench seat a thin pool cannot stock is left empty — a short reserve
      // beats no team at all. A slot the team takes the FIELD with still throws:
      // that pool cannot host this format, and the caller must know.
      if (slot === "BENCH") continue;
      throw new Error(`NPC team for ${trainer.id} cannot fill ${slot}`);
    }
    const pick = rng.pick(eligible.slice(0, CHEAP_BAND));
    used.add(pick.id);
    roster.push(pick);
    filled.push(slot);
  }
  repairFloorToBudget(roster, used, candidates, filled, pointBudget);
  return { roster, slots: filled };
}

// The diversified floor can cost more than the strict-cheapest one it replaced,
// which would eat into — or overrun — a thin early budget. While the floor is
// over budget, drop the slot whose card strayed FURTHEST above the cheapest it
// could legally hold back to that cheapest card. Cost falls every swap, so this
// terminates; worst case it walks the whole floor back to the strict minimum,
// which is exactly the affordable roster the old code always dealt.
function repairFloorToBudget(roster, used, candidates, slots, pointBudget) {
  if (!Number.isFinite(pointBudget)) return; // uncapped: no floor to enforce
  const cost = () => rosterCost(roster, slots);
  while (cost() > pointBudget) {
    let best = null;
    for (let index = 0; index < roster.length; index += 1) {
      const cheaper = cheapestFit(candidates, slots, roster, used, index);
      if (!cheaper || cheaper.points >= roster[index].points) continue;
      const drop = slotCost(slots[index], roster[index]) - slotCost(slots[index], cheaper);
      if (!best || drop > best.drop) best = { index, cheaper, drop };
    }
    if (!best) break; // already at the cheapest legal floor
    applySwap(roster, used, best.index, best.cheaper);
  }
}

// The cheapest unused legal card for a slot other than the one it currently
// holds — the strict minimum the repair walks a strayed slot back toward.
function cheapestFit(candidates, slots, roster, used, index) {
  const current = roster[index];
  let cheapest = null;
  for (const card of candidates.get(slots[index])) {
    if (card.id === current.id || used.has(card.id)) continue;
    if (personConflict(roster, card, current.id)) continue;
    if (!cheapest || card.points < cheapest.points
      || (card.points === cheapest.points && card.name.localeCompare(cheapest.name) < 0)) {
      cheapest = card;
    }
  }
  return cheapest;
}

// The climb: from the starting roster, keep upgrading a slot at a time. The slot
// to raise is drawn at random but weighted toward whichever holds the weakest
// card FOR ITS POSITION — a scrub shortstop is far likelier to get the next
// upgrade than a slot already fielding a star, so the budget spreads and the
// floor lifts, yet a lucky slot can still climb twice into a genuine headliner.
// Within the chosen slot the replacement is weighted by archetype fit, keeping a
// power squad's bats and an ace's arm. A pick that would breach the budget is
// rejected; REJECT_LIMIT rejections in a row end the climb.
function climb({ candidates, pointBudget, score, slots, roster, used, rng }) {
  let spent = rosterCost(roster, slots);
  const percentileOf = positionalPercentile(candidates, slots);
  let rejects = 0;
  while (rejects < REJECT_LIMIT) {
    const openSlots = [];
    for (let index = 0; index < roster.length; index += 1) {
      const upgrades = slotUpgrades({ candidates, score, slots, roster, used, index });
      if (!upgrades.length) continue;
      const weakness = 1 - percentileOf(slots[index], roster[index].points);
      openSlots.push({ index, upgrades, weight: Math.max(weakness ** WEAK_SLOT_BIAS, 1e-6) });
    }
    if (!openSlots.length) break;
    const slotPick = weightedPick(openSlots, rng);
    const cardPick = weightedPick(slotPick.upgrades, rng);
    const delta = slotCost(slots[slotPick.index], cardPick.card) - slotCost(slots[slotPick.index], roster[slotPick.index]);
    if (spent + delta > pointBudget) {
      rejects += 1;
      continue;
    }
    applySwap(roster, used, slotPick.index, cardPick.card);
    spent += delta;
    rejects = 0;
  }
  return spent;
}

// Every legal upgrade for one slot: an unused card that costs MORE than the
// incumbent and fits the archetype BETTER. The weight is the fit gain, which
// biases card choice toward the trainer's strengths.
function slotUpgrades({ candidates, score, slots, roster, used, index }) {
  const current = roster[index];
  const slot = slots[index];
  const moves = [];
  // The slot's bucket is in pool order, so the moves come out in the same order
  // the old full-pool scan produced — the weighted draw downstream is unchanged.
  for (const card of candidates.get(slot)) {
    if (used.has(card.id) || card.points <= current.points) continue;
    if (personConflict(roster, card, current.id)) continue;
    const gain = score(card) - score(current);
    if (gain <= 0) continue;
    moves.push({ card, weight: gain });
  }
  return moves;
}

function applySwap(roster, used, index, card) {
  used.delete(roster[index].id);
  used.add(card.id);
  roster[index] = card;
}

// For each distinct slot label, the sorted prices of every card that can fill
// it — enough to place any card in its positional pecking order. A card at the
// 10th percentile is a bargain-bin fit; one at the 90th is a headliner.
function positionalPercentile(candidates, slots) {
  const prices = new Map();
  for (const slot of new Set(slots)) {
    prices.set(slot, candidates.get(slot).map((card) => card.points).sort((a, b) => a - b));
  }
  return (slot, points) => {
    const sorted = prices.get(slot);
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < points) lo = mid + 1;
      else hi = mid;
    }
    return sorted.length ? lo / sorted.length : 0;
  };
}

// Draw one item with probability proportional to its weight, so favorites go
// more often but the standout is never a lock — the reason rivals diverge
// instead of fielding the same binder.
function weightedPick(items, rng) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function shuffled(slots, rng) {
  const copy = [...slots];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
