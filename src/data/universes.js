import { generatePlayerPool } from "./playerGeneration.js";
import { createRng } from "../rules/rng.js?v=20260716-records";
import { decodeCardRows } from "./realCards.js";
import { CLASSIC_CARD_ROWS } from "./classicCards.js";
import { MLB_HISTORY_ROWS, MLB_DECADE_ROWS, MLB_FRANCHISE_ROWS, MLB_FRANCHISE_NAMES, MLB_DUAL_PERSONS } from "./mlbPools.js";
import { cardPerson, playerIdentity } from "../rules/cards.js?v=20260716-records";
import { poolGroup, poolGroupMatches, randomNominationQuotas } from "../rules/draft.js?v=20260716-records";
import { authenticPoints } from "../rules/pricing.js?v=20260716-records";
import { PRICE_MODEL } from "./priceModel.js";

// The card universes — the leagues both games are played in. A universe is a
// card set plus its prices: the adventure picks one at new game and lives in
// it, and a draft room picks one at setup and deals a deck out of it. Same
// keys, same cards, same charts, same points on both sides.
//
// The fictional league regenerates from the seed; the real leagues share
// fixed card sets, but the MLB leagues still reprice per seed (the noise is
// seeded). One universe is active at a time and its pool caches until it
// changes.
export const UNIVERSES = {
  fictional: {
    key: "fictional",
    name: "FICTIONAL PLAYERS",
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

// The parameterized leagues: one section per decade since relief pitching
// existed — the earliest folds everything through 1919 into one combined
// pool ("the 1910s & earlier") — and any active franchise (players rated
// on their years with that club).
export const DECADES = Object.keys(MLB_DECADE_ROWS).map(Number).sort((a, b) => a - b);
export const EARLIEST_DECADE = DECADES[0];
export const decadeLabel = (start) =>
  Number(start) === EARLIEST_DECADE ? `${start}s & EARLIER` : `${start}s`;
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
        : picked.map((start) => Number(start) === EARLIEST_DECADE ? `the ${start.slice(2)}s & earlier` : `the ${start.slice(2)}s`).join(", ");
      return { key: mode, name: "MLB: BY DECADE", blurb: `Real players from ${span} — one card per player per decade.` };
    }
  }
  const decade = /^decade-(\d{4})$/.exec(mode ?? "");
  if (decade && MLB_DECADE_ROWS[decade[1]]) {
    const early = Number(decade[1]) === EARLIEST_DECADE;
    return {
      key: mode,
      name: `MLB: THE ${decade[1].slice(2)}s${early ? " & EARLIER" : ""}`,
      blurb: early
        ? `Real big leaguers rated on their numbers through ${EARLIEST_DECADE + 9} — the dead-ball era and everything before it.`
        : `Real big leaguers rated on their ${decade[1]}-${Number(decade[1]) + 9} numbers.`
    };
  }
  const franchise = /^franchise-([A-Z]{2,3})$/.exec(mode ?? "");
  if (franchise && MLB_FRANCHISE_ROWS[franchise[1]]) {
    return { key: mode, name: MLB_FRANCHISE_NAMES[franchise[1]].toUpperCase(), blurb: `Every ${MLB_FRANCHISE_NAMES[franchise[1]]} of all time, rated on their years with the club.` };
  }
  return null;
}

export const DEFAULT_UNIVERSE_SEED = "adventure-universe-v2";
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
export const RARITY_REFERENCE = 1600;

function scaledRarityShares(poolSize, groupSize) {
  const scale = Math.min(1, Math.sqrt(poolSize / RARITY_REFERENCE));
  return RARITY_SHARES.map(([tier, share], index) =>
    [tier, tier === "common" ? 1 : Math.max(share * scale, (index + 1) / groupSize)]);
}

const DUAL_PERSONS = new Set(MLB_DUAL_PERSONS);

// ---- The active universe -----------------------------------------------------

let universeSeed = DEFAULT_UNIVERSE_SEED;
let universeMode = "fictional";
let universeNoise = true;
let poolCache = null;
let poolIndexCache = null;

// Point the games at a universe. Same seed+mode+pricing is a no-op; any
// change drops the cache so the next universePool() call rebuilds.
// priceNoise: false prints honest stickers (uncapped saves, draft rooms).
export function setUniverse(seed, mode = "fictional", { priceNoise = true } = {}) {
  const nextSeed = seed || DEFAULT_UNIVERSE_SEED;
  const config = universeConfig(mode);
  const nextMode = config ? config.key : "fictional";
  if (nextSeed === universeSeed && nextMode === universeMode && priceNoise === universeNoise) return;
  universeSeed = nextSeed;
  universeMode = nextMode;
  universeNoise = priceNoise;
  poolCache = null;
  poolIndexCache = null;
}

export function universeKey() {
  return universeMode;
}

// The pool is otherwise a pure function of the seed AND the generators — the
// name lists, the card kinds, the pricing pass. Change any of those and the same
// seed re-rolls into a different league, silently swapping an existing save's
// universe out from under it. snapshot/install let a save store the exact cards
// it was built with and load them back verbatim, so a frozen universe never
// re-derives no matter how the generators drift.
export function snapshotUniversePool() {
  // Shallow-copy each card so the stored array is decoupled from the live cache.
  return universePool().map((card) => ({ ...card }));
}

// Seat a previously snapshotted pool AS the active universe, bypassing
// generation. Seed/mode/pricing are recorded to match setUniverse's own state so
// universeKey() and a later same-coordinates setUniverse() behave as usual; a
// DIFFERENT universe still swaps this out and regenerates.
export function installUniversePool(cards, { seed, mode = "fictional", priceNoise = true } = {}) {
  const config = universeConfig(mode);
  universeSeed = seed || DEFAULT_UNIVERSE_SEED;
  universeMode = config ? config.key : "fictional";
  universeNoise = priceNoise;
  poolCache = cards;
  poolIndexCache = new Map(cards.map((card) => [card.id, card]));
}

export function universePool() {
  if (!poolCache) {
    const decade = /^decade-(\d{4})$/.exec(universeMode);
    const multi = /^decades-([\d,]+)$/.exec(universeMode);
    const franchise = /^franchise-([A-Z]{2,3})$/.exec(universeMode);
    if (universeMode === "classic") {
      // Real Showdown cards keep their authentic printed points — no noise.
      poolCache = assignAuthenticRarity(decodeCardRows(CLASSIC_CARD_ROWS));
    } else if (universeMode === "mlb-history" || decade || multi || franchise) {
      // Real players price on the AUTHENTIC Showdown scale (the classic-set
      // model), so a Control 5 starter costs Wakefield money in any pool;
      // the bargain economy stays via the same seeded price noise.
      const rows = decade ? MLB_DECADE_ROWS[decade[1]]
        : multi ? multi[1].split(",").filter((start) => MLB_DECADE_ROWS[start]).flatMap((start) => MLB_DECADE_ROWS[start])
        : franchise ? MLB_FRANCHISE_ROWS[franchise[1]]
        : MLB_HISTORY_ROWS;
      poolCache = calibrateUniverse(decodeCardRows(rows), `${universeMode}:${universeSeed}`, { authentic: true });
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
  universePool();
  return poolIndexCache.get(id) ?? null;
}

// Price each group, then noise the stickers. Two scales:
// - authentic (MLB pools): truePoints from the classic-set price model — a
//   card's mechanics cost what the real 2000-2005 printings charged for
//   them, the same in every pool. Rarity still ranks within THIS pool, so a
//   franchise league keeps commons and legends.
// - rank curve (fictional pool): the generator's raw scores have no
//   authentic meaning, so truePoints come from strength rank on a convex
//   curve, as ever.
function calibrateUniverse(pool, seed, { authentic = false } = {}) {
  const rng = createRng(`universe-prices:${seed}`);
  const groups = [
    [pool.filter((card) => card.kind === "hitter"), PRICE_CURVE],
    [pool.filter((card) => card.role === "SP"), PRICE_CURVE],
    [pool.filter((card) => card.role === "RP"), RP_PRICE_CURVE]
  ];
  const priced = new Map();
  const modelPoints = authentic ? new Map(pool.map((card) => [card.id, authenticPoints(card, PRICE_MODEL)])) : null;
  const score = (card) => (authentic ? modelPoints.get(card.id) : card.points);
  for (const [group, curve] of groups) {
    const ranked = [...group].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
    const shares = scaledRarityShares(pool.length, ranked.length);
    ranked.forEach((card, index) => {
      const fromTop = (index + 1) / ranked.length;
      const rarity = shares.find(([, share]) => fromTop <= share)[0];
      const strength = (ranked.length - index) / ranked.length;
      const truePoints = authentic
        ? modelPoints.get(card.id)
        : Math.round(curve.base + curve.span * strength ** curve.gamma);
      const noise = 1 + (rng.next() * 2 - 1) * PRICE_NOISE;
      const points = universeNoise ? Math.max(10, Math.round(truePoints * noise)) : truePoints;
      priced.set(card.id, { rarity, truePoints, points });
    });
  }
  // Bundle discount: the weaker half of a simultaneous two-way pair prices
  // at 60% AFTER the curve — the pair is one purchase, and full freight for
  // both halves would price the duo out of budget play. Rarity keeps the
  // honest rank; only the sticker softens.
  const byId = new Map(pool.map((card) => [card.id, card]));
  for (const bat of pool) {
    if (!String(bat.id).endsWith("-bat")) continue;
    if (!dualIdentity(bat.id)) continue;
    const arm = byId.get(String(bat.id).slice(0, -4));
    if (!arm) continue;
    const entry = priced.get((bat.points <= arm.points ? bat : arm).id);
    entry.truePoints = Math.max(10, Math.round(entry.truePoints * 0.6));
    entry.points = Math.max(10, Math.round(entry.points * 0.6));
  }
  return pool.map((card) => ({ ...card, ...priced.get(card.id) }));
}

// ---- Simultaneous two-way pairs ----------------------------------------------
//
// Two kinds of printing merge into ONE owned card: career-long duals
// (players whose bat and arm value came at the same time — decided at build
// time, MLB_DUAL_PERSONS) and windowed two-way cards (the "tw" slice, rated
// on just the simultaneous years — 1915-19 Ruth — which exists only as
// bat/arm pairs). The pool still carries a bat half and an arm half, and
// they still roster separately (playing both roles costs both slots), but
// acquiring either grants the pair, selling one sells both, and browse
// screens show a single combined face. A pool bundles only when it holds
// both halves; sequential converts (Ankiel) and the CAREER printings of
// windowed players (Ruth's separate career bat and arm) stay unmerged.

// The person behind a mergeable printing, or null when the pair stays split.
function dualIdentity(id) {
  const identity = playerIdentity(id);
  if (!identity) return null;
  return identity.slice === "tw" || DUAL_PERSONS.has(identity.person) ? identity : null;
}

export function dualPartnerId(id) {
  if (!dualIdentity(id)) return null;
  const partner = String(id).endsWith("-bat") ? String(id).slice(0, -4) : `${id}-bat`;
  return cardById(partner) ? partner : null;
}

export function dualPartnerCard(id) {
  const partner = dualPartnerId(id);
  return partner ? cardById(partner) : null;
}

// The half that fronts the pair in lists: the stronger card by printed
// points (the bat half on a tie). The other half is the "shadow".
export function dualPrimaryId(id) {
  const partner = dualPartnerId(id);
  if (!partner) return id;
  const self = cardById(id);
  const other = cardById(partner);
  if (self.points !== other.points) return self.points > other.points ? id : partner;
  return String(id).endsWith("-bat") ? id : partner;
}

// ---- The draft deck ----------------------------------------------------------
//
// A draft night sees a DECK, not the whole universe: a seeded slice with
// position depth to spare, so every manager can field a legal roster and the
// same seed deals the same deck.
//
// Within a position the draw is straight random. The board is a slice of the
// league and reads like one: mostly the players a league is mostly made of,
// with a star on it when the set happens to deal one. Nothing reaches into the
// top of the ladder to make sure a Griffey turns up — if he does, he was drawn
// like everybody else.
//
// These are the quotas for a room of eight, and they are a quarter deeper than
// eight rosters need: eight catchers are wanted and ten are dealt, so the last
// manager picking still has a choice rather than a leftover.
const DECK_BASELINE_MANAGERS = 8;
const DECK_QUOTAS = [
  ["C", 10],
  ["1B", 10],
  ["2B", 10],
  ["3B", 10],
  ["SS", 10],
  ["LF/RF", 20],
  ["CF", 10],
  // Thinner than one per manager on purpose: the DH group is whoever the
  // position groups left behind, and every roster's spare bat can take the spot.
  ["DH", 6],
  ["SP", 20],
  ["RP", 18]
];

// The board is dealt TO THE ROOM. The quotas above were a fixed 124 cards no
// matter how many managers sat down, which quietly capped a draft at nine — and
// no card set could lift it, because the deck never grew: ten thousand cards
// still dealt a 124-card board. So the quotas scale with the room.
//
// They scale UP only. A board thinner than today's is a board with less choice
// on it, and a three-manager night should not be punished for being small: it
// keeps the same deep board it has always had. Rooms of eight or fewer deal
// exactly the cards they dealt before, down to the card.
function deckQuotas(managerCount, startingPitchers = 2) {
  const managers = Math.max(1, Math.round(Number(managerCount) || DECK_BASELINE_MANAGERS));
  const starterScale = Math.max(1, Math.round(Number(startingPitchers) || 2)) / 2;
  const starterAdjusted = starterScale === 1
    ? DECK_QUOTAS
    : DECK_QUOTAS.map(([group, quota]) => [group, group === "SP" ? Math.ceil(quota * starterScale) : quota]);
  if (managers <= DECK_BASELINE_MANAGERS) return starterAdjusted;
  return starterAdjusted.map(([group, quota]) => [
    group,
    Math.ceil((quota * managers) / DECK_BASELINE_MANAGERS)
  ]);
}

// Fisher-Yates on a copy, driven by the seeded rng.
function shuffled(cards, rng) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// One position's share of the deck: drawn at random from everyone who plays
// there. No thumb on the scale for the good cards — the deck is a slice of the
// league, so the mix of stars and role players on the board is whatever the
// mix in the card set is. A position the set is thin at deals what it has.
//
// A man deals once, so the draw walks the shuffle and skips anyone already
// taken — by an earlier group or by this one. Slicing the top of the shuffle
// instead would deal a set's five printings of one reliever to one bullpen.
function dealGroupCards(cards, quota, rng, people) {
  const dealt = [];
  for (const card of shuffled(cards, rng)) {
    if (dealt.length >= quota) break;
    const person = cardPerson(card);
    if (person && people.has(person)) continue;
    if (person) people.add(person);
    dealt.push(card);
  }
  return dealt;
}

// Deals a deck to a quota table off the ACTIVE universe.
function dealDeckToQuotas(quotas, rngKey) {
  const pool = universePool();
  const rng = createRng(rngKey);
  // Groups deal in order and a card deals once. The position groups are
  // disjoint anyway, but the DH slot draws on every hitter in the set, so it
  // has to take from whoever the position groups left behind.
  //
  // A PERSON deals once too. The multi-era sets print the same man in three
  // decades and the Showdown sets print him in five seasons; the board keeps
  // whichever one the deal turned up first and passes on the rest, so the era
  // rule lives HERE, at the deal, and nowhere downstream. His two-way half is
  // the one exception, and it follows him in below.
  const used = new Set();
  const people = new Set();
  const dealt = quotas.flatMap(([group, quota]) => {
    const candidates = pool.filter((card) =>
      !used.has(card.id) && !people.has(cardPerson(card)) && poolGroupMatches(card, group));
    const cards = dealGroupCards(candidates, quota, rng, people);
    for (const card of cards) used.add(card.id);
    // Every card remembers the slot it was DEALT to fill, which is not always
    // the slot it is printed at: the DH group takes its bats from whoever the
    // position groups left, so a card tagged HITTER may well be a center
    // fielder. The nomination queue has to read the tag rather than re-derive
    // the group from the card, or its own DH draw reaches back into the
    // center-field pile and spends the reserve the board was sized to keep.
    return cards.map((card) => ({ ...card, slot: group }));
  });
  // A two-way player is one card in two halves: if the deal turned up his
  // bat, his arm comes along, and vice versa — otherwise the board would
  // print a combined 2-way face for a card whose other half can't be had.
  const held = new Set(dealt.map((card) => card.id));
  for (const card of [...dealt]) {
    const partner = dualPartnerCard(card.id);
    if (partner && !held.has(partner.id)) {
      held.add(partner.id);
      dealt.push({ ...partner, slot: poolGroup(partner) });
    }
  }
  return dealt.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

// The deck one draft night sees. Deals from the ACTIVE universe, so callers
// point setUniverse() at the room's league first.
//
// The room's size is salted into the deal ONLY when it changes the quotas. A
// room of eight or fewer deals the very same cards it dealt before this took a
// manager count at all — same seed, same salt, same board.
export function dealDraftDeck(seed, managerCount = DECK_BASELINE_MANAGERS, startingPitchers = 2) {
  const quotas = deckQuotas(managerCount, startingPitchers);
  const defaultRotation = Math.round(Number(startingPitchers) || 2) === 2;
  const salt = quotas === DECK_QUOTAS
    ? ""
    : `${managerCount > DECK_BASELINE_MANAGERS ? `:m${Math.round(managerCount)}` : ""}${defaultRotation ? "" : `:sp${Math.round(startingPitchers)}`}`;
  return dealDeckToQuotas(quotas, `deck-deal:${universeKey()}:${seed}${salt}`);
}

// The board a random-nomination room reads. Unlike the standard deck this one
// is sized to the ROOM: every roster slot gets its visible quota of cards, wide
// enough that the closing sweep can always finish everybody (see
// randomNominationCounts). Three managers see twelve starters; eight of them
// will come up for bid, and the other four sit there all night as insurance.
export function dealRandomNominationDeck(seed, managerCount, startingPitchers = 2) {
  const { visible } = randomNominationQuotas(managerCount, startingPitchers);
  const rotationSalt = Math.round(Number(startingPitchers) || 2) === 2 ? "" : `:sp${Math.round(startingPitchers)}`;
  return dealDeckToQuotas(visible, `deck-deal:${universeKey()}:${seed}:random-nomination:${managerCount}${rotationSalt}`);
}

// Build a room's deck in one call: point the universe at the room's league
// and seed, then deal. Draft rooms print honest stickers — there is no shop
// to hunt bargains in, and a card's price is what the auction bids in.
export function buildDraftPool(mode, seed, options = {}) {
  setUniverse(seed, mode, { priceNoise: false });
  if (options.nomination === "random") {
    return dealRandomNominationDeck(seed, options.managerCount, options.startingPitchers);
  }
  return dealDraftDeck(seed, options.managerCount, options.startingPitchers);
}

// A deck that was already dealt, rebuilt card for card from the ids it dealt.
// The seed does not remember a board — the CODE that dealt it does, and that
// code moves: retune a quota, stop the draw favouring the top of the ladder,
// and the same seed deals a different eighteen dozen cards. A saved room whose
// board is re-dealt from its seed comes back holding cards it never held, and
// its own action log then nominates a card that is no longer on it. So a room
// records the cards it dealt, and those ids outrank the seed for ever after.
// What a room writes down for one dealt card. The SLOT rides along with the id,
// because the slot a card was dealt to fill is not always readable off the card
// — the DH group's bats are whoever the position groups left behind — and the
// nomination queue draws on the tag, not on the card's printed position. A deck
// that came back untagged would deal its DH bats out of the center-field
// reserve, which is the whole thing the tag exists to prevent.
export function deckEntry(card) {
  return card.slot ? { id: card.id, slot: card.slot } : card.id;
}

export function deckFromIds(mode, seed, entries) {
  setUniverse(seed, mode, { priceNoise: false });
  // Rooms saved before the tag existed wrote bare ids. They come back untagged
  // and deal exactly as they always did — an old room's log still replays.
  return entries.map((entry) => {
    const id = typeof entry === "string" ? entry : entry?.id;
    const card = cardById(id);
    if (!card) throw new Error(`Deck card ${id} is not in the ${mode} set`);
    const slot = typeof entry === "string" ? null : entry?.slot ?? null;
    return slot ? { ...card, slot } : card;
  });
}

// The deck's shape is a constant of the quota table, so the setup screen can
// promise a manager limit without dealing a card.
export const DECK_SIZE = DECK_QUOTAS.reduce((sum, [, quota]) => sum + quota, 0);
