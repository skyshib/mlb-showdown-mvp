import { createRng } from "../rules/rng.js?v=20260713-r";
import { personConflict, playsPosition } from "../rules/cards.js?v=20260713-r";
import { RARITY_REFERENCE, setUniverse, universePool } from "../data/universes.js";

// The adventure's economy on top of the shared card universes: what a card
// is worth at the shop counter, what a booster pulls, what the sealed
// starter deck holds, and what a roster may spend. The universes themselves
// — the card sets, their charts, their prices — live in data/universes.js,
// because the draft rooms deal out of the same leagues.
export {
  DECADES,
  EARLIEST_DECADE,
  FRANCHISES,
  UNIVERSES,
  cardById,
  decadeLabel,
  dualPartnerCard,
  dualPartnerId,
  dualPrimaryId,
  universeConfig,
  universeKey
} from "../data/universes.js";

// The adventure names these two after itself; the shared module speaks of
// universes generally.
export const setUniverseSeed = setUniverse;
export const adventurePool = universePool;

// Sell values run ~15% of shop price: the shop is a pawnbroker, not a buyer.
export const RARITIES = {
  common: { key: "common", label: "Common", order: 0, singlePrice: 150, sellValue: 25 },
  uncommon: { key: "uncommon", label: "Uncommon", order: 1, singlePrice: 400, sellValue: 60 },
  rare: { key: "rare", label: "Rare", order: 2, singlePrice: 900, sellValue: 140 },
  legend: { key: "legend", label: "Legend", order: 3, singlePrice: 2000, sellValue: 300 }
};

// Boosters are a gamble, not a guaranteed upgrade: four wild slots that can
// land anywhere (mostly commons) plus one slot that always hits uncommon or
// better. Odds are cumulative thresholds.
export const PACKS = {
  booster: {
    id: "booster",
    name: "Booster Pack",
    price: 500,
    slots: ["wild", "wild", "wild", "wild", "hit"]
  }
};

const WILD_ODDS = [
  ["common", 0.58],
  ["uncommon", 0.85],
  ["rare", 0.97],
  ["legend", 1]
];
const HIT_ODDS = [
  ["uncommon", 0.62],
  ["rare", 0.92],
  ["legend", 1]
];

// Legend pull odds shrink with the tier: rarity scaling already cuts a small
// pool's legend shelf to the true icons, and an unscaled 3%-per-slot pull
// against a 7-card tier would hand a player most of them by midseason. The
// same sqrt factor that shrinks the tier shrinks the roll; the lost legend
// probability falls through to the tier below.
function scaledOdds(odds) {
  const scale = Math.min(1, Math.sqrt(adventurePool().length / RARITY_REFERENCE));
  if (scale >= 1) return odds;
  const legendShare = 1 - odds[odds.length - 2][1];
  const shifted = legendShare * (1 - scale);
  return odds.map(([tier, cumulative], index) =>
    [tier, index === odds.length - 2 ? Math.min(1, cumulative + shifted) : cumulative]);
}

// The most a legal 13-card roster can cost in this universe: greedy
// best-per-slot at TRUE (noiseless) prices, so the number is a stable fact
// of the pool rather than of one save's price noise. The whole budget
// economy rescales against this — NPC ladder and player cap alike — so a
// thin expansion franchise and the all-time pool each field teams sized to
// what their pool can actually print.
// LADDER_REFERENCE is the fictional league's ceiling, the pool everything
// was originally tuned against: scale = poolCeiling() / LADDER_REFERENCE.
export const LADDER_REFERENCE = 10500;

// The budget-mode roster cap: 3500 in the fictional reference league (1.4x
// the first scout's 2500 rung), and the same fraction of any other pool's
// ceiling. Lives here rather than state.js so the starter pack can deal
// under it.
export function budgetCap() {
  return Math.round((3500 * poolCeiling() / LADDER_REFERENCE) / 50) * 50;
}

// Keyed on the pool itself: a new universe — or the same one under a new
// save seed — rebuilds the pool, and a fresh array means a stale ceiling.
let poolCeilingCache = null;
let poolCeilingFor = null;
const CEILING_SLOTS = ["C", "1B", "2B", "3B", "SS", "LF/RF", "LF/RF", "CF", "HITTER", "SP", "SP", "RP", "RP"];

export function poolCeiling() {
  const pool = adventurePool();
  if (poolCeilingCache == null || poolCeilingFor !== pool) {
    const taken = new Set();
    let total = 0;
    for (const slot of CEILING_SLOTS) {
      const best = pool
        .filter((card) => !taken.has(card.id) && slotMatches(slot, card))
        .sort((a, b) => b.truePoints - a.truePoints || a.name.localeCompare(b.name))[0];
      if (!best) continue;
      taken.add(best.id);
      total += best.truePoints;
    }
    poolCeilingCache = total;
    poolCeilingFor = pool;
  }
  return poolCeilingCache;
}

function cardsOfRarity(rarity) {
  return adventurePool().filter((card) => card.rarity === rarity);
}

function rollRarity(rng, odds) {
  const roll = rng.next();
  return odds.find(([, cumulative]) => roll < cumulative)[0];
}

export function openPack(packId, seed) {
  const pack = PACKS[packId];
  if (!pack) throw new Error(`Unknown pack ${packId}`);
  const rng = createRng(seed);
  return pack.slots.map((slot) => {
    const rarity = slot === "wild" ? rollRarity(rng, scaledOdds(WILD_ODDS))
      : slot === "hit" ? rollRarity(rng, scaledOdds(HIT_ODDS))
      : slot;
    return rng.pick(cardsOfRarity(rarity));
  });
}

// Shop singles restock deterministically as the save progresses: the cycle
// number (battles won) reshuffles the shelf, so beating anyone changes stock.
export function shopStock(saveSeed, townId, cycle, count = 4) {
  const rng = createRng(`${saveSeed}:shop:${townId}:cycle-${cycle}`);
  // The legend slot obeys the same pool scaling as pack pulls.
  const legendChance = 0.1 * Math.min(1, Math.sqrt(adventurePool().length / RARITY_REFERENCE));
  const tiers = ["common", "uncommon", "uncommon", rng.next() < legendChance ? "legend" : "rare"];
  const stock = [];
  const seen = new Set();
  for (const tier of tiers.slice(0, count)) {
    let card = rng.pick(cardsOfRarity(tier));
    let guard = 20;
    while (seen.has(card.id) && guard > 0) {
      card = rng.pick(cardsOfRarity(tier));
      guard -= 1;
    }
    seen.add(card.id);
    stock.push(card);
  }
  return stock;
}

// ---- Starter pack ------------------------------------------------------------

// One slot per required lineup spot plus the DH and the four-man staff, so the
// sealed pack is always a legal 13-card roster.
const STARTER_PACK_SLOTS = [
  "C", "1B", "2B", "3B", "SS", "LF/RF", "LF/RF", "CF", "HITTER",
  "SP", "SP", "RP", "RP"
];
const STARTER_RARE_COUNT = 2;

function slotMatches(slot, card) {
  if (slot === "HITTER") return card.kind === "hitter";
  if (slot === "SP" || slot === "RP") return card.role === slot;
  return card.kind === "hitter" && playsPosition(card, slot);
}

// The sealed starter deck: like the real product, two rares and the rest
// commons, randomized per save. Which two slots get the rares is part of the
// luck of the draw — but only slots that actually stock a rare are in the
// running, so thin pools (small franchises, old decades) still deal a pack.
function dealStarterPack(seed) {
  const rng = createRng(`starter-pack:${seed}`);
  const pool = adventurePool();
  const rareable = STARTER_PACK_SLOTS
    .map((slot, index) => (pool.some((card) => card.rarity === "rare" && slotMatches(slot, card)) ? index : null))
    .filter((index) => index !== null);
  const rareSlots = new Set();
  let guard = 60;
  while (rareSlots.size < Math.min(STARTER_RARE_COUNT, rareable.length) && guard-- > 0) {
    rareSlots.add(rareable[rng.int(0, rareable.length - 1)]);
  }
  const used = new Set();
  const dealt = [];
  // The pack doubles as the opening roster, so it obeys the roster rule
  // too: one era of a player — never two decades of the same man.
  const dealable = (card) => !used.has(card.id) && !personConflict(dealt, card);
  return STARTER_PACK_SLOTS.map((slot, index) => {
    const rarity = rareSlots.has(index) ? "rare" : "common";
    let fits = pool.filter((card) => dealable(card) && card.rarity === rarity && slotMatches(slot, card));
    if (!fits.length) {
      // Thin pool at this slot: take the cheapest few of whatever exists.
      fits = pool
        .filter((card) => dealable(card) && slotMatches(slot, card))
        .sort((a, b) => a.points - b.points)
        .slice(0, 5);
    }
    if (!fits.length) throw new Error(`Starter pack cannot fill ${slot}`);
    const card = rng.pick(fits);
    used.add(card.id);
    dealt.push(card);
    return card;
  });
}

// The sealed pack IS the opening roster, so it must fit under the budget
// cap it deals into. Deal on flavor first, then repair: while over the cap,
// swap the priciest card for the cheapest unused SAME-RARITY card that
// fills the same slot — the two rares stay rares — and only if rarity-
// preserving swaps run dry does the repair break rarity (a thin pool can
// price even commons dearly). Greedy and deterministic, so the same seed
// still deals the same pack.
export function starterPack(seed) {
  const pack = dealStarterPack(seed);
  const pool = adventurePool();
  const cap = budgetCap();
  const overCap = () => pack.reduce((sum, card) => sum + card.points, 0) > cap;
  for (const keepRarity of [true, false]) {
    let guard = STARTER_PACK_SLOTS.length * 2;
    while (overCap() && guard-- > 0) {
      const order = [...pack.keys()].sort((a, b) => pack[b].points - pack[a].points);
      let swapped = false;
      for (const at of order) {
        const others = pack.filter((_, index) => index !== at);
        const cheaper = pool
          .filter((card) => card.points < pack[at].points &&
            (!keepRarity || card.rarity === pack[at].rarity) &&
            slotMatches(STARTER_PACK_SLOTS[at], card) &&
            !others.some((held) => held.id === card.id) &&
            !personConflict(others, card))
          .sort((a, b) => a.points - b.points || a.name.localeCompare(b.name))[0];
        if (cheaper) {
          pack[at] = cheaper;
          swapped = true;
          break;
        }
      }
      if (!swapped) break; // this pass is dry; loosen or accept the pool
    }
  }
  return pack;
}
