import { chartSpan } from "../rules/cards.js?v=20260715-a";
import { adventurePool } from "./packs.js?v=20260715-a";
import { npcBudget, trainerById } from "./region.js?v=20260715-a";
import { createRng } from "../rules/rng.js?v=20260715-a";
import { personConflict, playsPosition } from "../rules/cards.js?v=20260715-a";

// One roster slot per required lineup spot plus the four-man staff. "HITTER"
// is the DH: any bat qualifies.
const HITTER_SLOTS = ["C", "1B", "2B", "3B", "SS", "LF/RF", "LF/RF", "CF", "HITTER"];
const PITCHER_SLOTS = ["SP", "SP", "RP", "RP"];

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
  if (slot === "HITTER") return card.kind === "hitter";
  if (slot === "SP" || slot === "RP") return card.role === slot;
  return card.kind === "hitter" && playsPosition(card, slot);
}

// Pass the save so mode scaling applies (uncapped bosses shop richer);
// without one the printed budget stands. Team identity (seeded slot order,
// weights, picks) only shifts when the budget itself does.
export function buildNpcTeam(trainer, save = null) {
  const { roster, spent } = assembleRoster(trainer, save);

  // Present (and bat) the squad best-first: hitters by printed points, then
  // pitchers by printed points, so the top starter also opens game 1.
  const byPoints = (a, b) => b.points - a.points || a.name.localeCompare(b.name);
  const hitters = roster.filter((card) => card.kind === "hitter").sort(byPoints);
  const pitchers = roster.filter((card) => card.kind === "pitcher").sort(byPoints);

  return {
    id: trainer.id,
    name: trainer.name,
    roster: [...hitters, ...pitchers],
    lineupAssignments: {},
    battingOrder: hitters.map((card) => card.id),
    points: spent
  };
}

// How sharply the climb favors a weak slot over a strong one: the odds a slot
// is picked next scale with (1 - its card's positional percentile) raised to
// this power. Higher means the cheapest slots almost always go first.
const WEAK_SLOT_BIAS = 4;
// The climb stops after this many draws in a row overshoot the budget — a
// stochastic stop, so two trainers with the same budget settle differently.
const REJECT_LIMIT = 25;

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
  const heirloom = trainer.inherits ? assembleRoster(trainerById(trainer.inherits), save) : null;
  // One seeded stream feeds the slot order, the baseline fill, and every upgrade
  // draw — so a save always rebuilds the same rival, round after round.
  const rng = createRng(`npc-team:${trainer.teamSeed}`);
  const slots = heirloom ? heirloom.slots : draftSlots(trainer, rng);
  // A fresh trainer opens from the cheapest legal roster; an heir from his
  // inherited binder. The same climb spends the budget up from whichever floor.
  const roster = heirloom ? [...heirloom.roster] : minimumRoster(pool, slots, trainer);
  const used = new Set(roster.map((card) => card.id));
  const spent = climb({ pool, pointBudget, score, slots, roster, used, rng });

  return { roster, slots, spent };
}

// Early slots see the most room, so the fill ORDER is shuffled per trainer —
// which position lands the star is part of the trainer's identity, not always
// the catcher. Ace staffs still shop for pitching first so the budget lands on
// the mound.
function draftSlots(trainer, rng) {
  return trainer.archetype === "ace"
    ? [...shuffled(PITCHER_SLOTS, rng), ...shuffled(HITTER_SLOTS, rng)]
    : shuffled([...HITTER_SLOTS, ...PITCHER_SLOTS], rng);
}

// The cheapest legal roster: fill every slot with the least-expensive unused
// card that fits, one era of a player per team. This floor is what the climb
// trades up from.
function minimumRoster(pool, slots, trainer) {
  const roster = [];
  const used = new Set();
  for (const slot of slots) {
    const cheapest = pool
      .filter((card) => !used.has(card.id) && !personConflict(roster, card) && slotMatches(slot, card))
      .sort((a, b) => a.points - b.points || a.name.localeCompare(b.name))[0];
    if (!cheapest) throw new Error(`NPC team for ${trainer.id} cannot fill ${slot}`);
    used.add(cheapest.id);
    roster.push(cheapest);
  }
  return roster;
}

// The climb: from the starting roster, keep upgrading a slot at a time. The slot
// to raise is drawn at random but weighted toward whichever holds the weakest
// card FOR ITS POSITION — a scrub shortstop is far likelier to get the next
// upgrade than a slot already fielding a star, so the budget spreads and the
// floor lifts, yet a lucky slot can still climb twice into a genuine headliner.
// Within the chosen slot the replacement is weighted by archetype fit, keeping a
// power squad's bats and an ace's arm. A pick that would breach the budget is
// rejected; REJECT_LIMIT rejections in a row end the climb.
function climb({ pool, pointBudget, score, slots, roster, used, rng }) {
  let spent = roster.reduce((total, card) => total + card.points, 0);
  const percentileOf = positionalPercentile(pool, slots);
  let rejects = 0;
  while (rejects < REJECT_LIMIT) {
    const openSlots = [];
    for (let index = 0; index < roster.length; index += 1) {
      const upgrades = slotUpgrades({ pool, score, slots, roster, used, index });
      if (!upgrades.length) continue;
      const weakness = 1 - percentileOf(slots[index], roster[index].points);
      openSlots.push({ index, upgrades, weight: Math.max(weakness ** WEAK_SLOT_BIAS, 1e-6) });
    }
    if (!openSlots.length) break;
    const slotPick = weightedPick(openSlots, rng);
    const cardPick = weightedPick(slotPick.upgrades, rng);
    const delta = cardPick.card.points - roster[slotPick.index].points;
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
function slotUpgrades({ pool, score, slots, roster, used, index }) {
  const current = roster[index];
  const slot = slots[index];
  const moves = [];
  for (const card of pool) {
    if (used.has(card.id) || card.points <= current.points) continue;
    if (!slotMatches(slot, card)) continue;
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
function positionalPercentile(pool, slots) {
  const prices = new Map();
  for (const slot of new Set(slots)) {
    prices.set(slot, pool.filter((card) => slotMatches(slot, card)).map((card) => card.points).sort((a, b) => a - b));
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
