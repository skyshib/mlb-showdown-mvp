import { generatePlayerPool } from "../data/playerGeneration.js";
import { createRng } from "../rules/rng.js";

// The adventure keeps one persistent card universe (like the fictional
// league): every save meets the same cards, so collection knowledge carries
// across playthroughs. Bump the seed version for a new card series.
const ADVENTURE_UNIVERSE_SEED = "adventure-universe-v1";
const ADVENTURE_UNIVERSE_TEAMS = 16;

// Relievers score far below hitters on raw points, so rarity is a rank within
// each group (hitters / starters / relievers), not a global points threshold.
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

export const PACKS = {
  booster: {
    id: "booster",
    name: "Booster Pack",
    price: 500,
    slots: ["common", "common", "common", "uncommon", "premium"]
  }
};

// The premium slot: mostly rare, occasional legend.
const PREMIUM_LEGEND_CHANCE = 0.12;

let poolCache = null;
let poolIndexCache = null;

export function adventurePool() {
  if (!poolCache) {
    const raw = generatePlayerPool(ADVENTURE_UNIVERSE_SEED, ADVENTURE_UNIVERSE_TEAMS, 13);
    poolCache = assignRarities(raw);
    poolIndexCache = new Map(poolCache.map((card) => [card.id, card]));
  }
  return poolCache;
}

export function cardById(id) {
  adventurePool();
  return poolIndexCache.get(id) ?? null;
}

function assignRarities(pool) {
  const groups = [
    pool.filter((card) => card.kind === "hitter"),
    pool.filter((card) => card.role === "SP"),
    pool.filter((card) => card.role === "RP")
  ];
  const rarityById = new Map();
  for (const group of groups) {
    const ranked = [...group].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    ranked.forEach((card, index) => {
      const fraction = (index + 1) / ranked.length;
      const tier = RARITY_SHARES.find(([, share]) => fraction <= share)[0];
      rarityById.set(card.id, tier);
    });
  }
  return pool.map((card) => ({ ...card, rarity: rarityById.get(card.id) }));
}

function cardsOfRarity(rarity) {
  return adventurePool().filter((card) => card.rarity === rarity);
}

export function openPack(packId, seed) {
  const pack = PACKS[packId];
  if (!pack) throw new Error(`Unknown pack ${packId}`);
  const rng = createRng(seed);
  return pack.slots.map((slot) => {
    const rarity = slot === "premium"
      ? (rng.next() < PREMIUM_LEGEND_CHANCE ? "legend" : "rare")
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

// ---- Starter flow ----------------------------------------------------------

const STARTER_SLOTS = [
  ["C", 1],
  ["1B", 1],
  ["2B", 1],
  ["3B", 1],
  ["SS", 1],
  ["LF/RF", 2],
  ["CF", 1]
];

// The farm team: the cheapest legal roster the universe can field. One extra
// cheap hitter covers DH. Deterministic, no seed involved.
export function starterCommons() {
  const pool = adventurePool();
  const used = new Set();
  const cheapestBy = (filter) =>
    pool
      .filter((card) => !used.has(card.id) && filter(card))
      .sort((a, b) => a.points - b.points || a.name.localeCompare(b.name))[0];
  const roster = [];
  const take = (card) => {
    if (!card) throw new Error("Adventure pool cannot field a starter roster");
    used.add(card.id);
    roster.push(card);
  };

  for (const [position, copies] of STARTER_SLOTS) {
    for (let i = 0; i < copies; i += 1) {
      take(cheapestBy((card) => card.kind === "hitter" && card.position === position));
    }
  }
  take(cheapestBy((card) => card.kind === "hitter"));
  take(cheapestBy((card) => card.role === "SP"));
  take(cheapestBy((card) => card.role === "SP"));
  take(cheapestBy((card) => card.role === "RP"));
  take(cheapestBy((card) => card.role === "RP"));
  return roster;
}

// The 1-of-3 franchise star moment. Stars come from the rare tier (legends
// stay in packs): the best rare ace, slugger, and speedster in the universe.
export function starterChoices() {
  const rares = adventurePool().filter((card) => card.rarity === "rare");
  const best = (candidates, score) =>
    [...candidates].sort((a, b) => score(b) - score(a) || b.points - a.points || a.name.localeCompare(b.name))[0];
  return [
    {
      key: "ace",
      title: "The Ace",
      blurb: "A starter who owns the mound.",
      card: best(rares.filter((card) => card.role === "SP"), (card) => card.points)
    },
    {
      key: "slugger",
      title: "The Slugger",
      blurb: "A center fielder with light-tower power.",
      card: best(rares.filter((card) => card.position === "CF"), (card) => card.points)
    },
    {
      key: "speedster",
      title: "The Speedster",
      blurb: "A shortstop who turns walks into doubles.",
      card: best(rares.filter((card) => card.position === "SS"), (card) => card.speed)
    }
  ];
}

// Fold the chosen star into the farm team: it replaces the weakest card of
// its own kind (same position for hitters, same role for pitchers) so the
// roster stays exactly legal.
export function starterRosterWith(starCard) {
  const commons = starterCommons();
  const matches = (card) =>
    starCard.kind === "pitcher" ? card.role === starCard.role : card.position === starCard.position;
  const weakest = commons
    .filter(matches)
    .sort((a, b) => a.points - b.points)[0];
  return commons.map((card) => (card.id === weakest.id ? starCard : card));
}
