import { generatePlayerPool } from "../data/playerGeneration.js";
import { createRng } from "../rules/rng.js";
import { decodeCardRows } from "../data/realCards.js";
import { CLASSIC_CARD_ROWS } from "../data/classicCards.js";
import { MLB_HISTORY_ROWS, MLB_2000S_ROWS } from "../data/mlbPools.js";

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
  "mlb-2000s": {
    key: "mlb-2000s",
    name: "MLB: THE 2000s",
    blurb: "Real big leaguers rated on their 2000-2009 numbers."
  },
  "mlb-history": {
    key: "mlb-history",
    name: "MLB: ALL TIME",
    blurb: "A century of real players — stars, scrubs, and everyone between."
  }
};

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
const PRICE_CURVE = { base: 90, span: 810, gamma: 6 };
const PRICE_NOISE = 0.35;

// Rarity is a rank within each group, so relievers get legends too.
const RARITY_SHARES = [
  ["legend", 0.07],
  ["rare", 0.18],
  ["uncommon", 0.3],
  ["common", 1]
];

export const RARITIES = {
  common: { key: "common", label: "Common", order: 0, singlePrice: 150, sellValue: 50 },
  uncommon: { key: "uncommon", label: "Uncommon", order: 1, singlePrice: 400, sellValue: 125 },
  rare: { key: "rare", label: "Rare", order: 2, singlePrice: 900, sellValue: 275 },
  legend: { key: "legend", label: "Legend", order: 3, singlePrice: 2000, sellValue: 600 }
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

let universeSeed = DEFAULT_UNIVERSE_SEED;
let universeMode = "fictional";
let poolCache = null;
let poolIndexCache = null;

// Point the adventure at a save's universe. Same seed+mode is a no-op; any
// change drops the cache so the next adventurePool() call rebuilds.
export function setUniverseSeed(seed, mode = "fictional") {
  const nextSeed = seed || DEFAULT_UNIVERSE_SEED;
  const nextMode = UNIVERSES[mode] ? mode : "fictional";
  if (nextSeed === universeSeed && nextMode === universeMode) return;
  universeSeed = nextSeed;
  universeMode = nextMode;
  poolCache = null;
  poolIndexCache = null;
}

export function universeKey() {
  return universeMode;
}

export function adventurePool() {
  if (!poolCache) {
    if (universeMode === "classic") {
      // Real Showdown cards keep their authentic printed points — no noise.
      poolCache = assignAuthenticRarity(decodeCardRows(CLASSIC_CARD_ROWS));
    } else if (universeMode === "mlb-2000s" || universeMode === "mlb-history") {
      // Real players, but the bargain economy stays: rate-derived quality
      // runs through the same curve + seeded price noise as the fictional set.
      const rows = universeMode === "mlb-2000s" ? MLB_2000S_ROWS : MLB_HISTORY_ROWS;
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
    pool.filter((card) => card.kind === "hitter"),
    pool.filter((card) => card.role === "SP"),
    pool.filter((card) => card.role === "RP")
  ];
  const priced = new Map();
  for (const group of groups) {
    const ranked = [...group].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    ranked.forEach((card, index) => {
      const fromTop = (index + 1) / ranked.length;
      const rarity = RARITY_SHARES.find(([, share]) => fromTop <= share)[0];
      const strength = (ranked.length - index) / ranked.length;
      const truePoints = Math.round(PRICE_CURVE.base + PRICE_CURVE.span * strength ** PRICE_CURVE.gamma);
      const noise = 1 + (rng.next() * 2 - 1) * PRICE_NOISE;
      const points = Math.max(10, Math.round(truePoints * noise));
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
    const rarity = slot === "wild" ? rollRarity(rng, WILD_ODDS)
      : slot === "hit" ? rollRarity(rng, HIT_ODDS)
      : slot;
    return rng.pick(cardsOfRarity(rarity));
  });
}

// Shop singles restock deterministically as the save progresses: the cycle
// number (battles won) reshuffles the shelf, so beating anyone changes stock.
export function shopStock(saveSeed, townId, cycle, count = 4) {
  const rng = createRng(`${saveSeed}:shop:${townId}:cycle-${cycle}`);
  const tiers = ["common", "uncommon", "uncommon", rng.next() < 0.1 ? "legend" : "rare"];
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
// luck of the draw.
export function starterPack(seed) {
  const rng = createRng(`starter-pack:${seed}`);
  const rareSlots = new Set();
  while (rareSlots.size < STARTER_RARE_COUNT) {
    rareSlots.add(rng.int(0, STARTER_PACK_SLOTS.length - 1));
  }
  const pool = adventurePool();
  const used = new Set();
  return STARTER_PACK_SLOTS.map((slot, index) => {
    const rarity = rareSlots.has(index) ? "rare" : "common";
    const fits = pool.filter((card) => !used.has(card.id) && card.rarity === rarity && slotMatches(slot, card));
    if (!fits.length) throw new Error(`Starter pack cannot fill ${slot} with a ${rarity}`);
    const card = rng.pick(fits);
    used.add(card.id);
    return card;
  });
}
