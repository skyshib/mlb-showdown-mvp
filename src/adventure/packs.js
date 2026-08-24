import { createRng } from "../rules/rng.js?v=20260716-records";
import { cardPerson, personConflict, playsPosition } from "../rules/cards.js?v=20260716-records";
import { RARITY_REFERENCE, setUniverse, universePool, snapshotUniversePool, installUniversePool } from "../data/universes.js";
import { ROSTER_FORMATS, discountedRosterCost } from "./rosterFormats.js?v=20260716-records";

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
export { snapshotUniversePool, installUniversePool };

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
// of the pool rather than of one save's price noise. The NPC ladder rescales
// against this — a thin expansion franchise and the all-time pool each field
// teams sized to what their pool can actually print.
// LADDER_REFERENCE is the fictional league's ceiling, the pool everything
// was originally tuned against; REFERENCE_CAP is the cap that league was
// tuned to carry. Together they place every printed rung: the ladder runs
// from below the cap (the first scouts) to 76% of the room between the cap
// and the ceiling (the World Series). That geometry is what npcBudget()
// replays in any pool — see region.js.
export const LADDER_REFERENCE = 10500;
export const REFERENCE_CAP = 3500;

// The budget-mode roster cap: enough to field an AVERAGE legal roster — the
// mean true price at each of the thirteen slots, summed — but never less than
// the third-of-ceiling the deep leagues were tuned to carry.
//
// The cap used to be that third alone, which reads as "a median team" only in
// a pool with a long superstar tail. Thin pools have no such tail: their
// ceiling sits close to their middle, so a third of it bought a bottom-fifth
// team and a franchise run could never afford its own stars — the Rays' cap
// came to 1350 against a 4042 ceiling. Taking the larger of the two lifts
// exactly those pools and leaves every other one where it was tuned: the
// fictional league still carries 3500, the all-time set 3400. Simulated
// against the World Series boss, that is the difference between a 37% climb
// and a 19% one in a franchise, with the deep leagues untouched at ~10%.
//
// Lives here rather than state.js so the starter pack can deal under it.
export function budgetCap(format = "classic") {
  return Math.round(exactCap(format) / 50) * 50;
}

// The cap before it is rounded off. The ladder hangs every rung off THIS, not
// off the rounded figure: round the cap first and each rung inherits the error
// magnified — a 23-point rounding on the cap moved the first scout 50 points
// and bought him a different pitching staff.
export function exactCap(format = "classic") {
  // Full-roster capCalibration buys a somewhat richer-than-mean team — the
  // constant that puts the classic universe's twenty-man cap at the real
  // game's 5000 (see rosterFormats.FULL_CAP_CALIBRATION). Classic stays 1.
  const shape = ROSTER_FORMATS[format] ?? ROSTER_FORMATS.classic;
  return Math.max(
    poolMean(format) * shape.capCalibration,
    poolCeiling(format) * REFERENCE_CAP / LADDER_REFERENCE
  );
}

// Keyed on the pool itself: a new universe — or the same one under a new
// save seed — rebuilds the pool, and a fresh array means a stale number.
// One figure per roster format (the shapes price differently), so the
// caches are maps keyed by format and flushed together when the pool moves.
let poolCeilingCache = new Map();
let poolCeilingFor = null;
let poolMeanCache = new Map();
let poolMeanFor = null;

// The format's roster shape as the economy prices it: [group, weight] per
// slot, full-price slots first so the greedy ceiling draws its stars before
// the discounted bench prices what's left.
function priceSlots(format) {
  return (ROSTER_FORMATS[format] ?? ROSTER_FORMATS.classic).priceSlots;
}

export function poolCeiling(format = "classic") {
  const pool = adventurePool();
  if (poolCeilingFor !== pool) {
    poolCeilingCache = new Map();
    poolCeilingFor = pool;
  }
  if (!poolCeilingCache.has(format)) {
    const taken = new Set();
    let total = 0;
    for (const [slot, weight] of priceSlots(format)) {
      const best = pool
        .filter((card) => !taken.has(card.id) && slotMatches(slot, card))
        .sort((a, b) => b.truePoints - a.truePoints || a.name.localeCompare(b.name))[0];
      if (!best) continue;
      taken.add(best.id);
      total += weight * best.truePoints;
    }
    poolCeilingCache.set(format, total);
  }
  return poolCeilingCache.get(format);
}

// What an average legal 13-card roster costs: the mean TRUE price of every
// card eligible at each slot, summed over the slots. Slots that appear twice
// (corners, the rotation, the pen) count twice — the roster buys two of them.
// Unlike the ceiling this draws no cards, so a slot's mean is the mean of its
// whole shelf: a card that qualifies at two positions is priced into both,
// which is right, since either is a roster it could fill.
export function poolMean(format = "classic") {
  const pool = adventurePool();
  if (poolMeanFor !== pool) {
    poolMeanCache = new Map();
    poolMeanFor = pool;
  }
  if (!poolMeanCache.has(format)) {
    const means = new Map();
    let total = 0;
    for (const [slot, weight] of priceSlots(format)) {
      if (!means.has(slot)) {
        const shelf = pool.filter((card) => slotMatches(slot, card));
        const mean = shelf.length
          ? shelf.reduce((sum, card) => sum + card.truePoints, 0) / shelf.length
          : 0;
        means.set(slot, mean);
      }
      total += weight * means.get(slot);
    }
    poolMeanCache.set(format, total);
  }
  return poolMeanCache.get(format);
}

function cardsOfRarity(rarity) {
  return adventurePool().filter((card) => card.rarity === rarity);
}

function rollRarity(rng, odds) {
  const roll = rng.next();
  return odds.find(([, cumulative]) => roll < cumulative)[0];
}

// A pack deals each MAN once. Pulling the same player twice out of one wrapper
// is the flattest possible result — a slot that was going to be a card and
// turned out to be a duplicate you already have in your hand — and it is not
// even a duplicate of the CARD necessarily: in a multi-decade pool the same
// human is printed once per era, so two slots could deal you two Griffeys and
// neither is a copy. cardPerson is the human, however the league spells him.
//
// The redraw is per slot and keeps the slot's rarity: a legend slot deals
// another legend. If a tier is so thin that it cannot find anybody new (a
// franchise pool with three legends in it, say), the pack takes the duplicate
// rather than deal nothing — a card in the wrapper beats an empty slot.
export function openPack(packId, seed) {
  const pack = PACKS[packId];
  if (!pack) throw new Error(`Unknown pack ${packId}`);
  const rng = createRng(seed);
  const dealt = new Set();
  return pack.slots.map((slot) => {
    const rarity = slot === "wild" ? rollRarity(rng, scaledOdds(WILD_ODDS))
      : slot === "hit" ? rollRarity(rng, scaledOdds(HIT_ODDS))
      : slot;
    const tier = cardsOfRarity(rarity);
    let card = rng.pick(tier);
    let guard = 24;
    while (guard > 0 && dealt.has(cardPerson(card))) {
      card = rng.pick(tier);
      guard -= 1;
    }
    dealt.add(cardPerson(card));
    return card;
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

// Can this pool field a full-format roster at all? A greedy era-legal fill
// over the twenty slots — the same question minimumRoster answers for an NPC,
// asked before the new-game screen offers the format. Thin franchise pools
// (a handful of arms, a short bench shelf) are the ones that fail.
export function canFieldFullRoster(pool = adventurePool()) {
  const taken = new Set();
  const held = [];
  for (const [slot] of ROSTER_FORMATS.full.priceSlots) {
    const fit = pool.find((card) =>
      !taken.has(card.id) && slotMatches(slot, card) && !personConflict(held, card));
    if (!fit) return false;
    taken.add(fit.id);
    held.push(fit);
  }
  return true;
}

// ---- Starter pack ------------------------------------------------------------

// One slot per roster slot of the chosen format — the same shape the economy
// prices — so the sealed pack is always a legal roster: thirteen cards in the
// classic format, twenty (with a three-man pen and a four-bat bench) in full.
function starterPackSlots(format) {
  return priceSlots(format).map(([group]) => group);
}

function slotMatches(slot, card) {
  if (slot === "HITTER") return card.kind === "hitter";
  if (slot === "SP" || slot === "RP") return card.role === slot;
  return card.kind === "hitter" && playsPosition(card, slot);
}

// The sealed starter deck: like the real product, a couple of rares and the
// rest commons, randomized per save. Which slots get the rares is part of the
// luck of the draw — but only slots that actually stock a rare are in the
// running, so thin pools (small franchises, old decades) still deal a pack.
function dealStarterPack(seed, format = "classic") {
  const rng = createRng(`starter-pack:${seed}`);
  const pool = adventurePool();
  const slots = starterPackSlots(format);
  const rareCount = (ROSTER_FORMATS[format] ?? ROSTER_FORMATS.classic).rareCount;
  const rareable = slots
    .map((slot, index) => (pool.some((card) => card.rarity === "rare" && slotMatches(slot, card)) ? index : null))
    .filter((index) => index !== null);
  const rareSlots = new Set();
  let guard = 60;
  while (rareSlots.size < Math.min(rareCount, rareable.length) && guard-- > 0) {
    rareSlots.add(rareable[rng.int(0, rareable.length - 1)]);
  }
  const used = new Set();
  const dealt = [];
  // The pack doubles as the opening roster, so it obeys the roster rule
  // too: one era of a player — never two decades of the same man.
  const dealable = (card) => !used.has(card.id) && !personConflict(dealt, card);
  return slots.map((slot, index) => {
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
export function starterPack(seed, format = "classic") {
  const pack = dealStarterPack(seed, format);
  const pool = adventurePool();
  const slots = starterPackSlots(format);
  const cap = budgetCap(format);
  // What the pack costs is what the ROSTER it becomes costs: seated bats and
  // every arm at sticker, the bench at its discount — the same arithmetic the
  // cap check runs (see rosterFormats.discountedRosterCost).
  const overCap = () => discountedRosterCost(pack, {}, format) > cap;
  for (const keepRarity of [true, false]) {
    let guard = slots.length * 2;
    while (overCap() && guard-- > 0) {
      const order = [...pack.keys()].sort((a, b) => pack[b].points - pack[a].points);
      let swapped = false;
      for (const at of order) {
        const others = pack.filter((_, index) => index !== at);
        const cheaper = pool
          .filter((card) => card.points < pack[at].points &&
            (!keepRarity || card.rarity === pack[at].rarity) &&
            slotMatches(slots[at], card) &&
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
