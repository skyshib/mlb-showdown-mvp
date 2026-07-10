import { generatePlayerPool } from "../data/playerGeneration.js";
import { createRng } from "../rules/rng.js";
import { decodeCardRows } from "../data/realCards.js";
import { CLASSIC_CARD_ROWS } from "../data/classicCards.js";
import { MLB_HISTORY_ROWS, MLB_DECADE_ROWS, MLB_FRANCHISE_ROWS, MLB_FRANCHISE_NAMES } from "../data/mlbPools.js";

// Every save picks a league at new game. The fictional league regenerates
// from the save seed; the real leagues share fixed card sets, but the MLB
// leagues still reprice per save (the noise is seeded). Screens set the
// universe once (on boot or new game) and the pool caches until it changes.
export const UNIVERSES = {
  fictional: {
    key: "fictional",
    name: "CASCADE LEAGUE",
    blurb: "A brand-new fictional league, invented fresh for this save."
  },
  classic: {
    key: "classic",
    name: "CLASSIC SHOWDOWN",
    blurb: "Every real MLB Showdown card, 2000-2005. Authentic printed points."
  },
  "mlb-history": {
    key: "mlb-history",
    name: "MLB: ALL TIME",
    blurb: "A century of real players — stars, scrubs, and everyone between."
  }
};

// The parameterized leagues: any decade since relief pitching existed, and
// any active franchise (players rated on their years with that club).
export const DECADES = Object.keys(MLB_DECADE_ROWS).map(Number).sort((a, b) => a - b);
export const FRANCHISES = Object.keys(MLB_FRANCHISE_ROWS)
  .map((id) => ({ id, name: MLB_FRANCHISE_NAMES[id] }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Resolve any universe key — fixed, decade-YYYY, franchise-XXX, or the
// legacy mlb-2000s alias — to a descriptor, or null if unknown.
export function universeConfig(mode) {
  if (UNIVERSES[mode]) return UNIVERSES[mode];
  if (mode === "mlb-2000s") return universeConfig("decade-2000");
  // "All teams" with a decade checklist: the pool is the union of the checked
  // decade sets, one card per player per decade played.
  const multi = /^decades-([\d,]+)$/.exec(mode ?? "");
  if (multi) {
    const picked = multi[1].split(",").filter((start) => MLB_DECADE_ROWS[start]);
    if (picked.length) {
      const span = picked.length === DECADES.length
        ? "every decade"
        : picked.map((start) => `the ${start.slice(2)}s`).join(", ");
      return { key: mode, name: "MLB: ALL TEAMS", blurb: `Real players from ${span} — one card per player per decade.` };
    }
  }
  const decade = /^decade-(\d{4})$/.exec(mode ?? "");
  if (decade && MLB_DECADE_ROWS[decade[1]]) {
    return { key: mode, name: `MLB: THE ${decade[1].slice(2)}s`, blurb: `Real big leaguers rated on their ${decade[1]}-${Number(decade[1]) + 9} numbers.` };
  }
  const franchise = /^franchise-([A-Z]{2,3})$/.exec(mode ?? "");
  if (franchise && MLB_FRANCHISE_ROWS[franchise[1]]) {
    return { key: mode, name: MLB_FRANCHISE_NAMES[franchise[1]].toUpperCase(), blurb: `Every ${MLB_FRANCHISE_NAMES[franchise[1]]} of all time, rated on their years with the club.` };
  }
  return null;
}

const DEFAULT_UNIVERSE_SEED = "adventure-universe-v2";
// generatePlayerPool yields 24 cards per "team": 125 teams ≈ a 3000-card set.
const UNIVERSE_TEAMS = 125;

// ---- Pricing ----------------------------------------------------------------
//
// A card's TRUE value comes from its strength rank within its group (hitters /
// starters / relievers), mapped onto a convex price curve: stars cost far more
// than role players. The PRINTED point cost — what rosters and NPC budgets
// actually pay — is the true value plus heavy noise, so some cards are
// bargains and others are rip-offs. Rarity follows true strength, not price.
// Uncapped saves print honest stickers (no noise): with no budget to beat,
// bargain-hunting is not the game there.
const PRICE_CURVE = { base: 90, span: 810, gamma: 6 };
// Relievers live on a shorter curve: in the real Showdown sets the priciest
// RP (Sasaki '02) is 410 while hitters and starters run to 830-910. A 1-2
// inning arm never decides a game the way a star bat or ace does, so the
// best reliever in any pool tops out near the authentic scale instead of
// costing Randy Johnson money.
const RP_PRICE_CURVE = { base: 90, span: 320, gamma: 6 };
const PRICE_NOISE = 0.35;

// Rarity is a rank within each group, so relievers get legends too.
const RARITY_SHARES = [
  ["legend", 0.07],
  ["rare", 0.18],
  ["uncommon", 0.3],
  ["common", 1]
];

// Tier shares scale with the pool: the full-size sets earn their 7% legends,
// but 7% of a 300-card franchise pool would crown 21 — half its top tier.
// Shares shrink on a square root so small pools keep only the true icons,
// with a floor of one card per tier per group (packs and the shop draw by
// rarity and need every shelf stocked).
const RARITY_REFERENCE = 1600;

function scaledRarityShares(poolSize, groupSize) {
  const scale = Math.min(1, Math.sqrt(poolSize / RARITY_REFERENCE));
  return RARITY_SHARES.map(([tier, share], index) =>
    [tier, tier === "common" ? 1 : Math.max(share * scale, (index + 1) / groupSize)]);
}

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

let universeSeed = DEFAULT_UNIVERSE_SEED;
let universeMode = "fictional";
let universeNoise = true;
let poolCache = null;
let poolIndexCache = null;

// Point the adventure at a save's universe. Same seed+mode+pricing is a
// no-op; any change drops the cache so the next adventurePool() call
// rebuilds. priceNoise: false prints honest stickers (uncapped saves).
export function setUniverseSeed(seed, mode = "fictional", { priceNoise = true } = {}) {
  const nextSeed = seed || DEFAULT_UNIVERSE_SEED;
  const config = universeConfig(mode);
  const nextMode = config ? config.key : "fictional";
  if (nextSeed === universeSeed && nextMode === universeMode && priceNoise === universeNoise) return;
  universeSeed = nextSeed;
  universeMode = nextMode;
  universeNoise = priceNoise;
  poolCache = null;
  poolIndexCache = null;
  poolCeilingCache = null;
}

// The most a legal 13-card roster can cost in this universe: greedy
// best-per-slot at printed prices. Uncapped NPC budgets scale against this so
// the ladder keeps escalating even in small pools (a franchise universe tops
// out near 9k, not the fictional set's ceiling).
let poolCeilingCache = null;
const CEILING_SLOTS = ["C", "1B", "2B", "3B", "SS", "LF/RF", "LF/RF", "CF", "HITTER", "SP", "SP", "RP", "RP"];

export function poolCeiling() {
  if (poolCeilingCache == null) {
    const pool = adventurePool();
    const taken = new Set();
    let total = 0;
    for (const slot of CEILING_SLOTS) {
      const best = pool
        .filter((card) => !taken.has(card.id) &&
          (slot === "HITTER" ? card.kind === "hitter"
            : slot === "SP" || slot === "RP" ? card.role === slot
            : card.kind === "hitter" && card.position === slot))
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))[0];
      if (!best) continue;
      taken.add(best.id);
      total += best.points;
    }
    poolCeilingCache = total;
  }
  return poolCeilingCache;
}

export function universeKey() {
  return universeMode;
}

export function adventurePool() {
  if (!poolCache) {
    const decade = /^decade-(\d{4})$/.exec(universeMode);
    const multi = /^decades-([\d,]+)$/.exec(universeMode);
    const franchise = /^franchise-([A-Z]{2,3})$/.exec(universeMode);
    if (universeMode === "classic") {
      // Real Showdown cards keep their authentic printed points — no noise.
      poolCache = assignAuthenticRarity(decodeCardRows(CLASSIC_CARD_ROWS));
    } else if (universeMode === "mlb-history" || decade || multi || franchise) {
      // Real players, but the bargain economy stays: rate-derived quality
      // runs through the same curve + seeded price noise as the fictional set.
      const rows = decade ? MLB_DECADE_ROWS[decade[1]]
        : multi ? multi[1].split(",").filter((start) => MLB_DECADE_ROWS[start]).flatMap((start) => MLB_DECADE_ROWS[start])
        : franchise ? MLB_FRANCHISE_ROWS[franchise[1]]
        : MLB_HISTORY_ROWS;
      poolCache = calibrateUniverse(decodeCardRows(rows), `${universeMode}:${universeSeed}`);
    } else {
      const raw = generatePlayerPool(`universe:${universeSeed}`, UNIVERSE_TEAMS, 13);
      poolCache = calibrateUniverse(raw, universeSeed);
    }
    poolIndexCache = new Map(poolCache.map((card) => [card.id, card]));
  }
  return poolCache;
}

// Classic cards are the real thing: rarity ranks true strength via the raw
// formula-free signal we have (the printed points ARE the truth), so both
// truePoints and points stay authentic.
function assignAuthenticRarity(pool) {
  const groups = [
    pool.filter((card) => card.kind === "hitter"),
    pool.filter((card) => card.role === "SP"),
    pool.filter((card) => card.role === "RP")
  ];
  const tiers = new Map();
  for (const group of groups) {
    const ranked = [...group].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    ranked.forEach((card, index) => {
      const fromTop = (index + 1) / ranked.length;
      tiers.set(card.id, RARITY_SHARES.find(([, share]) => fromTop <= share)[0]);
    });
  }
  return pool.map((card) => ({ ...card, rarity: tiers.get(card.id), truePoints: card.points }));
}

export function cardById(id) {
  adventurePool();
  return poolIndexCache.get(id) ?? null;
}

// Rank each group by the generator's raw quality score, then price the rank:
// truePoints from the curve, printed points with seeded noise on top.
function calibrateUniverse(pool, seed) {
  const rng = createRng(`universe-prices:${seed}`);
  const groups = [
    [pool.filter((card) => card.kind === "hitter"), PRICE_CURVE],
    [pool.filter((card) => card.role === "SP"), PRICE_CURVE],
    [pool.filter((card) => card.role === "RP"), RP_PRICE_CURVE]
  ];
  const priced = new Map();
  for (const [group, curve] of groups) {
    const ranked = [...group].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    const shares = scaledRarityShares(pool.length, ranked.length);
    ranked.forEach((card, index) => {
      const fromTop = (index + 1) / ranked.length;
      const rarity = shares.find(([, share]) => fromTop <= share)[0];
      const strength = (ranked.length - index) / ranked.length;
      const truePoints = Math.round(curve.base + curve.span * strength ** curve.gamma);
      const noise = 1 + (rng.next() * 2 - 1) * PRICE_NOISE;
      const points = universeNoise ? Math.max(10, Math.round(truePoints * noise)) : truePoints;
      priced.set(card.id, { rarity, truePoints, points });
    });
  }
  return pool.map((card) => ({ ...card, ...priced.get(card.id) }));
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
  return card.kind === "hitter" && card.position === slot;
}

// The sealed starter deck: like the real product, two rares and the rest
// commons, randomized per save. Which two slots get the rares is part of the
// luck of the draw — but only slots that actually stock a rare are in the
// running, so thin pools (small franchises, old decades) still deal a pack.
export function starterPack(seed) {
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
  return STARTER_PACK_SLOTS.map((slot, index) => {
    const rarity = rareSlots.has(index) ? "rare" : "common";
    let fits = pool.filter((card) => !used.has(card.id) && card.rarity === rarity && slotMatches(slot, card));
    if (!fits.length) {
      // Thin pool at this slot: take the cheapest few of whatever exists.
      fits = pool
        .filter((card) => !used.has(card.id) && slotMatches(slot, card))
        .sort((a, b) => a.points - b.points)
        .slice(0, 5);
    }
    if (!fits.length) throw new Error(`Starter pack cannot fill ${slot}`);
    const card = rng.pick(fits);
    used.add(card.id);
    return card;
  });
}
