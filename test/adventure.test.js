import test from "node:test";
import assert from "node:assert/strict";
import {
  adventurePool,
  cardById,
  openPack,
  shopStock,
  starterPack,
  setUniverseSeed,
  RARITIES,
  PACKS
} from "../src/adventure/packs.js";
import { applyOutcome } from "../src/adventure/ui/battleScreen.js";
import { recordCompletedRun, loadHallOfFame, hallOfFameByMode, mergeEntries } from "../src/adventure/hallOfFame.js";
import { hallOfFameScreen, hofTeamScreen } from "../src/adventure/ui/hallOfFameScreen.js";
import {
  createSave,
  persistSave,
  loadSave,
  exportSaveCode,
  importSaveCode,
  addCardToCollection,
  removeCardFromCollection,
  collectionCards,
  ownedCount,
  setRoster,
  setBattingOrder,
  rosterPoints,
  rosterCards,
  managerFor,
  ensureSeasonStats,
  recordGameStats,
  seasonHitters,
  seasonPitchers,
  pointCap,
  startSeries,
  clearSeries,
  recordSeriesGame,
  seriesNeeded,
  attemptNumber,
  grantCoins,
  spendCoins
} from "../src/adventure/state.js";
import { TRAINERS, trainerById, isTrainerUnlocked, rewardCoins, pendingAmbush, ambushSprung, springAmbush } from "../src/adventure/region.js";
import { buildNpcTeam } from "../src/adventure/npcTeams.js";
import {
  createBattle,
  battlePhase,
  actSwing,
  actPitch,
  actSteal,
  actAdvance,
  actChangePitcher,
  fastForward,
  runSimSeries
} from "../src/adventure/battle/controller.js";
import { validateRoster, buildTeam } from "../src/rules/draft.js";
import {
  stealCandidates,
  attemptSteal,
  playPlateAppearance,
  changePitcher,
  pitcherStatus,
  isGameOver,
  createInitialState,
  simulateGame,
  canBunt,
  attemptBunt,
  buntSuccessChance,
  intentionalWalk,
  applySingle,
  resolveAdvanceDecision
} from "../src/rules/game.js";
import { createRng } from "../src/rules/rng.js";

// Every test runs in the same fixed universe unless it explicitly swaps seeds
// (and swaps back before returning).
setUniverseSeed("test-seed");

function testSave() {
  const save = createSave({ name: "TEST", saveSeed: "test-seed" });
  const roster = starterPack(save.saveSeed);
  for (const card of roster) addCardToCollection(save, card.id);
  setRoster(save, roster.map((card) => card.id));
  return save;
}

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

// Node's experimental localStorage global throws without a backing file; give
// screens that persist mid-flow (pack opening) a working in-memory one.
Object.defineProperty(globalThis, "localStorage", { value: fakeStorage(), configurable: true });

// ---- Pool and rarity -------------------------------------------------------

test("the universe holds 3000 cards, each with a rarity and a resolvable id", () => {
  const pool = adventurePool();
  assert.equal(pool.length, 3000);
  for (const card of pool) {
    assert.ok(RARITIES[card.rarity], `${card.id} has rarity ${card.rarity}`);
    assert.equal(cardById(card.id)?.id, card.id);
  }
});

test("printed points carry heavy noise around true value; rarity tracks true strength", () => {
  const pool = adventurePool();
  for (const card of pool) {
    assert.ok(card.truePoints >= 90 && card.truePoints <= 900, `${card.id} true value in range (${card.truePoints})`);
    const drift = Math.abs(card.points / card.truePoints - 1);
    assert.ok(drift <= 0.36, `${card.id} noise within ±35% (${drift.toFixed(2)})`);
  }
  assert.ok(pool.some((card) => card.points < card.truePoints * 0.8), "real bargains exist");
  assert.ok(pool.some((card) => card.points > card.truePoints * 1.2), "real rip-offs exist");
  // Within each group, every higher tier is truly stronger than the tier below.
  const order = ["common", "uncommon", "rare", "legend"];
  for (const group of [
    pool.filter((card) => card.kind === "hitter"),
    pool.filter((card) => card.role === "SP"),
    pool.filter((card) => card.role === "RP")
  ]) {
    for (let tier = 1; tier < order.length; tier += 1) {
      const lowerMax = Math.max(...group.filter((c) => c.rarity === order[tier - 1]).map((c) => c.truePoints));
      const upperMin = Math.min(...group.filter((c) => c.rarity === order[tier]).map((c) => c.truePoints));
      assert.ok(upperMin >= lowerMax, `${order[tier]} outranks ${order[tier - 1]}`);
    }
  }
});

test("an even-rarity 13-card roster costs about the 5000-point budget", () => {
  const pool = adventurePool();
  const tierMean = (tier) => {
    const cards = pool.filter((card) => card.rarity === tier);
    return cards.reduce((sum, card) => sum + card.points, 0) / cards.length;
  };
  const evenMix = 13 * (["common", "uncommon", "rare", "legend"].reduce((sum, tier) => sum + tierMean(tier), 0) / 4);
  assert.ok(evenMix > 4400 && evenMix < 5700, `even mix ≈ ${Math.round(evenMix)}`);
});

test("each save seed generates its own universe, deterministically", () => {
  const names = () => adventurePool().slice(0, 25).map((card) => `${card.name}:${card.points}`);
  const original = names();
  try {
    setUniverseSeed("another-save");
    const other = names();
    assert.notDeepEqual(other, original, "different seed, different league");
    setUniverseSeed("test-seed");
    assert.deepEqual(names(), original, "same seed regenerates the same league");
  } finally {
    setUniverseSeed("test-seed");
  }
});

test("rarity is ranked within groups, so relievers get legends too", () => {
  const pool = adventurePool();
  for (const group of ["SP", "RP"]) {
    const cards = pool.filter((card) => card.role === group);
    assert.ok(cards.some((card) => card.rarity === "legend"), `${group} has legends`);
    assert.ok(cards.some((card) => card.rarity === "common"), `${group} has commons`);
  }
  const hitters = pool.filter((card) => card.kind === "hitter");
  const legendShare = hitters.filter((card) => card.rarity === "legend").length / hitters.length;
  assert.ok(legendShare > 0.04 && legendShare < 0.1, `legend share ${legendShare}`);
});

// ---- Packs -----------------------------------------------------------------

test("pack pulls are deterministic per seed, varied, with one guaranteed hit", () => {
  const first = openPack("booster", "seed-1");
  const second = openPack("booster", "seed-1");
  const other = openPack("booster", "seed-2");
  assert.deepEqual(first.map((card) => card.id), second.map((card) => card.id));
  assert.notDeepEqual(first.map((card) => card.id), other.map((card) => card.id));
  assert.equal(first.length, PACKS.booster.slots.length);
  // Wild slots can land anywhere; the last slot always hits uncommon+.
  const rarities = new Set();
  for (let i = 0; i < 40; i += 1) {
    const cards = openPack("booster", `spread-${i}`);
    for (const card of cards) rarities.add(card.rarity);
    assert.ok(["uncommon", "rare", "legend"].includes(cards[4].rarity), "hit slot never pulls a common");
  }
  assert.deepEqual([...rarities].sort(), ["common", "legend", "rare", "uncommon"], "packs span every tier");
});

test("shop stock is deterministic and restocks by cycle", () => {
  const a = shopStock("s", "town", 0);
  const b = shopStock("s", "town", 0);
  const c = shopStock("s", "town", 1);
  assert.deepEqual(a.map((card) => card.id), b.map((card) => card.id));
  assert.notDeepEqual(a.map((card) => card.id), c.map((card) => card.id));
  assert.equal(new Set(a.map((card) => card.id)).size, a.length, "no duplicate singles on the shelf");
});

// ---- Starter flow ----------------------------------------------------------

test("the starter pack is a legal 13-card roster: two rares, eleven commons, under budget", () => {
  for (const seed of ["seed-a", "seed-b", "seed-c"]) {
    const roster = starterPack(seed);
    assert.equal(roster.length, 13);
    assert.equal(validateRoster({ roster }).length, 0, `${seed} roster legal`);
    assert.equal(roster.filter((card) => card.rarity === "rare").length, 2, `${seed} has two rares`);
    assert.equal(roster.filter((card) => card.rarity === "common").length, 11, `${seed} rest are commons`);
    const points = roster.reduce((sum, card) => sum + card.points, 0);
    assert.ok(points <= pointCap(), `${seed} under the ${pointCap()} cap (${points})`);
  }
  assert.deepEqual(
    starterPack("seed-a").map((card) => card.id),
    starterPack("seed-a").map((card) => card.id),
    "same seed, same pack"
  );
  assert.notDeepEqual(
    starterPack("seed-a").map((card) => card.id),
    starterPack("seed-b").map((card) => card.id),
    "new seed, new pack"
  );
});

test("the budget-mode point cap scales with the pool: 1.4x the first scout's rung", async () => {
  const { poolCeiling, LADDER_REFERENCE } = await import("../src/adventure/packs.js");
  const save = testSave();
  const expected = Math.round((3500 * poolCeiling() / LADDER_REFERENCE) / 50) * 50;
  assert.equal(pointCap(save), expected, "3500 in the reference league, the same fraction elsewhere");
  save.player.badges = ["ironwood", "galehook", "cascade", "pennant", "trophy"];
  assert.equal(pointCap(save), expected, "badges do not move the cap");
});

test("uncapped mode drops the player's cap and swells boss budgets", async () => {
  const { npcBudget } = await import("../src/adventure/region.js");
  const save = testSave();
  save.mode = "uncapped";
  assert.equal(pointCap(save), Infinity, "no roster limit in uncapped");

  const jojo = trainerById("scout-jojo");
  const worldSeries = trainerById("post-worldseries");
  // Budget mode reads the printed ladder RESCALED to this pool's best-13
  // ceiling: same shape, sized to what the pool can actually field.
  const { poolCeiling, LADDER_REFERENCE } = await import("../src/adventure/packs.js");
  const scale = poolCeiling() / LADDER_REFERENCE;
  assert.equal(
    npcBudget(testSave(), worldSeries),
    Math.round((worldSeries.pointBudget * scale) / 50) * 50,
    "budget mode reads the pool-scaled ladder"
  );
  assert.ok(Math.abs(npcBudget(save, jojo) - jojo.pointBudget * scale) <= 50, "the first scout stays winnable");
  // The summit swells to the POOL's best-13 ceiling (within rounding), not an
  // absolute figure: small universes escalate all the way up instead of every
  // late boss fielding the same maxed team from mid-ladder on.
  const scaled = npcBudget(save, worldSeries);
  assert.ok(scaled > npcBudget(testSave(), worldSeries), `the summit swells past its budget-mode self (${scaled})`);
  assert.ok(Math.abs(scaled - poolCeiling()) <= 50, `and lands at the pool ceiling (${scaled} vs ${poolCeiling()})`);
  // The ladder still climbs in the same order, just steeper.
  const ladder = [...TRAINERS].sort((a, b) => a.pointBudget - b.pointBudget);
  for (let i = 1; i < ladder.length; i += 1) {
    assert.ok(npcBudget(save, ladder[i]) >= npcBudget(save, ladder[i - 1]), "scaling keeps the progression monotone");
    assert.ok(npcBudget(save, ladder[i]) >= npcBudget(testSave(), ladder[i]), "no boss dips under his budget-mode self");
  }
  // Teams still build legal at the scaled budget — and actually spend it.
  const rich = buildNpcTeam(worldSeries, save);
  assert.equal(validateRoster(rich).length, 0, "the uncapped boss fields a legal team");
  assert.ok(rich.points <= scaled, "and stays inside the scaled budget");
  assert.ok(rich.points > buildNpcTeam(worldSeries).points, "outspending his budget-mode self");

  // Uncapped repricing prints honest stickers: no bargain noise on points.
  try {
    setUniverseSeed("uncapped-prices", "fictional", { priceNoise: false });
    assert.ok(adventurePool().every((card) => card.points === card.truePoints), "uncapped stickers tell the truth");
    setUniverseSeed("uncapped-prices", "fictional");
    assert.ok(adventurePool().some((card) => card.points !== card.truePoints), "budget mode keeps its bargains");
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("the opening menus offer budget and uncapped rules", async () => {
  const { modeSelectScreen, leagueSelectScreen } = await import("../src/adventure/ui/titleScreens.js");
  try {
    const app = { save: null, screen: { name: "leagueSelect", playerName: "TEST", menuIndex: 4 }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
    leagueSelectScreen.key(app, "a"); // pick FICTIONAL PLAYERS, last on the list
    assert.equal(app.screen.name, "modeSelect", "the league pick leads to the rules pick");
    const html = modeSelectScreen.render(app);
    assert.ok(html.includes("BUDGET LEAGUE") && html.includes("UNCAPPED"), "both rule sets are offered");
    modeSelectScreen.key(app, "down");
    modeSelectScreen.key(app, "a");
    assert.equal(app.screen.name, "starterReveal", "picking rules opens the starter pack");
    assert.equal(app.save.mode, "uncapped", "the choice lands on the save");
    assert.equal(pointCap(app.save), Infinity);
  } finally {
    setUniverseSeed("test-seed");
  }
});

test("beating a trainer for the first time earns a card claim; repeats do not", () => {
  const save = testSave();
  const app = { save };
  const trainer = trainerById("scout-jojo");
  const first = applyOutcome(app, trainer, true);
  assert.equal(first.cardClaim, true, "first win claims a card");
  const rematch = applyOutcome(app, trainer, true);
  assert.equal(rematch.cardClaim, false, "rematch pays coins only");
  const loss = applyOutcome(app, trainerById("scout-mabel"), false);
  assert.equal(loss.cardClaim ?? false, false, "losses claim nothing");
  // The claimable roster is deterministic, so the pick is honored later.
  const boss = buildNpcTeam(trainer);
  const stolen = boss.roster[0];
  addCardToCollection(save, stolen.id);
  assert.equal(ownedCount(save, stolen.id) >= 1, true);
});

test("the postseason chain runs division series, championship, then world series", () => {
  const save = testSave();
  const division = trainerById("post-division");
  const championship = trainerById("post-championship");
  const worldSeries = trainerById("post-worldseries");
  assert.equal(division.battleFormat.bestOf, 5);
  assert.equal(championship.battleFormat.bestOf, 7);
  assert.equal(worldSeries.battleFormat.bestOf, 7);
  assert.equal(isTrainerUnlocked(save, division), false, "October waits for the summit");
  save.progress.trainersBeaten["boss-vale"] = 1;
  assert.equal(isTrainerUnlocked(save, division), true);
  assert.equal(isTrainerUnlocked(save, worldSeries), false);
  save.progress.trainersBeaten["post-division"] = 1;
  save.progress.trainersBeaten["post-championship"] = 1;
  assert.equal(isTrainerUnlocked(save, worldSeries), true);
});

test("the rival reappears at milestones with a growing budget", () => {
  const rivals = TRAINERS.filter((trainer) => trainer.title === "Rival");
  assert.equal(rivals.length, 4);
  for (let i = 1; i < rivals.length; i += 1) {
    assert.ok(rivals[i].pointBudget > rivals[i - 1].pointBudget, "each rival encounter is richer");
  }
  assert.ok(rivals.every((trainer) => trainer.name === "RIVAL CAM"), "same rival every time");
  assert.ok(rivals.every((trainer) => trainer.ambush), "every rival bout is an ambush");
  assert.ok(rivals.every((trainer) => trainer.battleFormat.type === "game"), "rival bouts are always a single game");
  assert.equal(TRAINERS.some((trainer) => trainer.battleFormat.type === "simSeries"), false, "the sim-series farm boss is gone");
});

test("rival bouts are one-and-done: a loss removes the bout for good", async () => {
  const { isTrainerAvailable, markAmbushDone, ambushDone } = await import("../src/adventure/region.js");
  const save = testSave();
  const app = { save };
  save.progress.trainersBeaten["scout-jojo"] = 1;
  const rival = trainerById("rival-1");
  springAmbush(save, rival.id);
  assert.equal(isTrainerAvailable(save, rival), true, "sprung rival is challengeable");
  const loss = applyOutcome(app, rival, false);
  assert.equal(loss.won, false);
  assert.equal(ambushDone(save, rival.id), true, "the bout is spent");
  assert.equal(isTrainerAvailable(save, rival), false, "no rematch after a loss");
  assert.equal(pendingAmbush(save), null, "he does not ambush again either");
  springAmbush(save, rival.id);
  assert.equal(ambushDone(save, rival.id), true, "re-springing cannot revive a finished bout");
  // Regular trainers keep retries after losses.
  const mabel = trainerById("scout-mabel");
  applyOutcome(app, mabel, false);
  assert.equal(isTrainerAvailable(save, mabel), true, "non-rival losses stay retryable");
  // A won bout is also done, and marks normally.
  markAmbushDone(save, "rival-2");
  assert.equal(isTrainerAvailable(save, trainerById("rival-2")), false);
});

test("rival ambushes hide until sprung, spring once, then never again", () => {
  const save = testSave();
  assert.equal(pendingAmbush(save), null, "nobody jumps a fresh rookie");
  save.progress.trainersBeaten["scout-jojo"] = 1;
  const ambush = pendingAmbush(save);
  assert.equal(ambush?.id, "rival-1", "beating Jojo springs the first rival");
  assert.equal(ambushSprung(save, "rival-1"), false);
  springAmbush(save, "rival-1");
  assert.equal(ambushSprung(save, "rival-1"), true);
  assert.equal(pendingAmbush(save), null, "a sprung ambush never re-fires");
  save.progress.trainersBeaten["scout-mabel"] = 1;
  save.progress.trainersBeaten["gym-garrick"] = 1;
  assert.equal(pendingAmbush(save)?.id, "rival-2", "the next milestone springs the next bout");
});

test("pack reveals can rewind with the left arrow without re-adding cards", async () => {
  const { packOpenScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  save.pendingPacks.push({ packId: "booster", seed: "rewind-pack" });
  const cards = openPack("booster", "rewind-pack");
  const app = { save, screen: { name: "packOpen", revealed: 0, returnTo: "map" }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };
  const before = { ...save.collection };
  packOpenScreen.key(app, "a");
  packOpenScreen.key(app, "a");
  assert.equal(app.screen.revealed, 2, "two cards ripped");
  packOpenScreen.key(app, "left");
  assert.equal(app.screen.viewing, 1, "left rewinds to the first pull");
  assert.ok(packOpenScreen.render(app).includes("CARD 1 OF 2"), "the rewind position shows");
  packOpenScreen.key(app, "a");
  assert.equal(app.screen.viewing, 2, "Z walks forward through seen cards");
  assert.equal(app.screen.revealed, 2, "walking forward does not rip a new card");
  packOpenScreen.key(app, "a");
  assert.equal(app.screen.revealed, 3, "at the front, Z rips the next card");
  const added = Object.keys(save.collection).filter((id) => (save.collection[id] ?? 0) > (before[id] ?? 0));
  assert.equal(added.length, new Set(cards.slice(0, 3).map((card) => card.id)).size, "each pull was added exactly once");
});

// ---- NPC teams -------------------------------------------------------------

test("every trainer builds a legal team within budget, deterministically", async () => {
  const { npcBudget } = await import("../src/adventure/region.js");
  for (const trainer of TRAINERS) {
    const budget = npcBudget(null, trainer); // the pool-scaled ladder rung
    const npc = buildNpcTeam(trainer);
    assert.equal(validateRoster(npc).length, 0, `${trainer.id} legal`);
    assert.ok(npc.points <= budget, `${trainer.id} within budget (${npc.points}/${budget})`);
    const again = buildNpcTeam(trainer);
    assert.deepEqual(npc.roster.map((card) => card.id), again.roster.map((card) => card.id));
  }
});

test("trainer lineups bat best-first and the star position varies by trainer", () => {
  const starPositions = new Set();
  for (const trainer of TRAINERS) {
    const npc = buildNpcTeam(trainer);
    const lineup = buildTeam(npc).lineup;
    for (let spot = 1; spot < lineup.length; spot += 1) {
      assert.ok(lineup[spot - 1].points >= lineup[spot].points, `${trainer.id} bats by points (spot ${spot})`);
    }
    const hitters = npc.roster.filter((card) => card.kind === "hitter");
    const star = hitters.reduce((best, card) => (card.truePoints > best.truePoints ? card : best));
    starPositions.add(star.position);
  }
  assert.ok(starPositions.size >= 2, `the best hitter is not always the same slot (${[...starPositions].join(", ")})`);
});

// ---- Save layer ------------------------------------------------------------

test("the title menu offers save backup, and import screens explain themselves", async () => {
  const { titleScreen, exportSaveScreen, importSaveScreen } = await import("../src/adventure/ui/titleScreens.js");
  const withSave = { save: testSave(), screen: { name: "title", menuIndex: 0 }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  const html = titleScreen.render(withSave);
  assert.ok(html.includes("EXPORT SAVE") && html.includes("IMPORT SAVE"), "backup lives on the title menu");
  const fresh = { save: null, screen: { name: "title", menuIndex: 0 }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  const freshHtml = titleScreen.render(fresh);
  assert.ok(!freshHtml.includes("EXPORT SAVE"), "nothing to export without a save");
  assert.ok(freshHtml.includes("IMPORT SAVE"), "import is always there for a new device");
  assert.ok(exportSaveScreen.render(withSave).includes("SAVE CODE"), "export shows the code box");
  assert.ok(importSaveScreen.render(withSave).includes("REPLACES YOUR CURRENT SAVE"), "import warns before overwriting");
  assert.ok(!importSaveScreen.render(fresh).includes("REPLACES"), "no warning when there's nothing to lose");
});

test("saves round-trip through storage and export codes", () => {
  const storage = fakeStorage();
  const save = testSave();
  grantCoins(save, 500);
  persistSave(save, storage);
  const loaded = loadSave(storage);
  assert.deepEqual(loaded, save);
  const imported = importSaveCode(exportSaveCode(save));
  assert.deepEqual(imported, save);
  assert.equal(importSaveCode("not a save"), null);
});

test("sell-all clears every duplicate at the pawn rate, keeping first copies", async () => {
  const { sellAllDuplicates } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const rosterCard = save.roster.cardIds[0];
  const spare = adventurePool().find((card) => !save.roster.cardIds.includes(card.id));
  addCardToCollection(save, rosterCard, 2); // two extra copies of a roster card
  addCardToCollection(save, spare.id, 3); // three copies of a bench card
  const before = save.player.coins;
  const rosterValue = RARITIES[cardById(rosterCard).rarity].sellValue;
  const spareValue = RARITIES[spare.rarity].sellValue;
  const coins = sellAllDuplicates(save);
  assert.equal(coins, rosterValue * 2 + spareValue * 2, "every copy past the first sells");
  assert.equal(save.player.coins, before + coins);
  assert.equal(ownedCount(save, rosterCard), 1, "roster card keeps a copy");
  assert.equal(ownedCount(save, spare.id), 1, "bench card keeps a copy");
  assert.equal(sellAllDuplicates(save), 0, "second pass finds nothing");
  assert.ok(RARITIES.common.sellValue <= 30, "the shop pays pawn rates now");
});

test("stars flag keepers in binder and catalog; the sell sweeps can spare them", async () => {
  const { binderScreen, catalogScreen, sellScreen, sellAllCards, sellAllDuplicates } = await import("../src/adventure/ui/collectionScreens.js");
  const { isStarred } = await import("../src/adventure/state.js");
  const save = testSave();
  const keeper = adventurePool().find((card) => !save.roster.cardIds.includes(card.id));
  addCardToCollection(save, keeper.id, 2);
  const app = { save, screen: { name: "binder", index: 0, filter: "ALL" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };

  // The * key stars the cursor card in the binder; again unstars.
  const binderRowsNow = collectionCards(save);
  app.screen.index = binderRowsNow.findIndex(({ card }) => card.id === keeper.id);
  binderScreen.typed(app, "*");
  assert.equal(isStarred(save, keeper.id), true, "* stars the keeper");
  assert.ok(binderScreen.render(app).includes("&#9733;"), "the binder shows the star");
  binderScreen.typed(app, "*");
  assert.equal(isStarred(save, keeper.id), false, "* again unstars");
  binderScreen.key(app, "a");
  assert.equal(isStarred(save, keeper.id), true, "ENTER stars the keeper too");

  // The catalog stars through its action menu: Z/ENTER opens it, and the
  // star toggle is the first action (the letter shortcuts are gone here).
  const catApp = { save, screen: { name: "catalog", index: 0, filter: "ALL", query: keeper.name }, go() {}, rerender() {} };
  assert.ok(catalogScreen.render(catApp).includes("&#9733;"), "the catalog shows the star");
  catalogScreen.key(catApp, "a");
  assert.equal(catApp.screen.actionMenu, true, "Z opens the card actions");
  assert.ok(catalogScreen.render(catApp).includes("UNSTAR KEEPER"), "the menu offers the star toggle");
  catalogScreen.key(catApp, "a");
  assert.equal(isStarred(save, keeper.id), false, "the catalog toggles the same flag");
  assert.equal(catApp.screen.actionMenu, false, "acting closes the menu");
  catalogScreen.typed(catApp, "*");
  assert.equal(isStarred(save, keeper.id), false, "the * shortcut is retired in the catalog");
  catalogScreen.key(catApp, "a");
  catalogScreen.key(catApp, "a");

  // Sweeps spare starred keepers while the shield is up, and only then.
  const sellApp = { save, screen: { name: "sell", index: 0 }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  assert.ok(sellScreen.render(sellApp).includes("PROTECT STARRED"), "the sell screen offers the shield");
  assert.equal(sellApp.screen.spareStarred ?? true, true, "the shield defaults on");
  sellAllDuplicates(save, { spareStarred: true });
  assert.equal(ownedCount(save, keeper.id), 2, "protected keepers dodge the duplicate sweep");
  sellAllCards(save, { spareStarred: true });
  assert.equal(ownedCount(save, keeper.id), 2, "and the full sweep");
  sellAllCards(save, { spareStarred: false });
  assert.equal(ownedCount(save, keeper.id), 0, "shield down, the keeper sells");
});

test("the shop never lists roster cards, hovers its rows, and sell-all wants a confirm", async () => {
  const { sellScreen, sellAllCards } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const rosterCard = save.roster.cardIds[0];
  const spare = adventurePool().find((card) => !save.roster.cardIds.includes(card.id));
  addCardToCollection(save, rosterCard, 1); // one spare of a rostered card
  addCardToCollection(save, spare.id, 2);   // two copies of a bench card
  const app = { save, screen: { name: "sell", index: 0 }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };

  // Roster cards themselves never list: only the spare copy shows, marked.
  const html = sellScreen.render(app);
  assert.ok(html.includes("x1 SPARE"), "the rostered card lists only its spare");
  assert.ok(html.includes("SELL ALL CARDS"), "the sell-everything button exists");
  // Thirteen roster cards, all single copies except our two additions: the
  // list is exactly the spare + the bench card.
  assert.ok(sellScreen.hoverCard(app, 0), "rows hover their card");
  const listed = [sellScreen.hoverCard(app, 0)?.id, sellScreen.hoverCard(app, 1)?.id];
  assert.deepEqual(new Set(listed), new Set([rosterCard, spare.id]), "only the spare and the bench card list");
  assert.equal(sellScreen.hoverCard(app, 2), null, "action rows hover nothing");

  // SELL ALL CARDS asks twice, X backs out without selling or leaving.
  const rows = 2;
  app.screen.index = rows + 1; // SELL ALL CARDS
  sellScreen.key(app, "a");
  assert.equal(app.screen.confirmSellAll, true, "first Z arms the confirm");
  assert.ok(sellScreen.render(app).includes("Z again to confirm"), "and says so");
  sellScreen.key(app, "b");
  assert.equal(app.screen.confirmSellAll, false, "X disarms it");
  assert.equal(app.screen.name, "sell", "without leaving the shop");
  assert.equal(ownedCount(save, spare.id), 2, "nothing sold");

  // Confirmed: everything sellable goes, roster copies survive.
  app.screen.index = rows + 1;
  sellScreen.key(app, "a");
  sellScreen.key(app, "a");
  assert.equal(ownedCount(save, spare.id), 0, "bench cards sell to zero");
  assert.equal(ownedCount(save, rosterCard), 1, "the roster copy survives");
  for (const id of save.roster.cardIds) {
    assert.ok(ownedCount(save, id) >= 1, "every roster card keeps its copy");
  }
  assert.equal(sellAllCards(save), 0, "a second sweep finds nothing");
});

test("two-way players field both halves: bat card at DH, arm on the staff", () => {
  try {
    setUniverseSeed("two-way-test", "decade-2020");
    const pool = adventurePool();
    const bat = pool.find((card) => card.id === "mlb-d2020-ohtansh01-bat");
    const arm = pool.find((card) => card.id === "mlb-d2020-ohtansh01");
    assert.ok(bat && arm, "both Ohtani halves live in the pool");
    assert.equal(bat.name, arm.name, "one name, two cards");
    assert.equal(bat.kind, "hitter");
    assert.equal(bat.position, "DH", "the bat half occupies the DH slot");
    assert.equal(arm.kind, "pitcher");
    // Roster both halves — playing him two-way costs two of the thirteen
    // spots — and the lineup builder seats the bat while the arm pitches.
    const taken = new Set([bat.id, arm.id]);
    const roster = [bat, arm];
    for (const [slot, byRole] of [["C"], ["1B"], ["2B"], ["3B"], ["SS"], ["LF/RF"], ["LF/RF"], ["CF"], ["SP", true], ["RP", true], ["RP", true]]) {
      const fit = pool.find((card) => !taken.has(card.id) &&
        (byRole ? card.role === slot : card.kind === "hitter" && card.position === slot));
      assert.ok(fit, `pool covers ${slot}`);
      taken.add(fit.id);
      roster.push(fit);
    }
    const manager = { id: "p", name: "P", roster, lineupAssignments: {}, battingOrder: [] };
    assert.equal(validateRoster(manager).length, 0, "both halves fit one legal roster");
    const team = buildTeam(manager);
    assert.ok(team.lineup.some((card) => card.id === bat.id), "the bat half is in the batting order");
    // Rostering only one half works too: drop the bat card, DH someone else.
    const replacementDh = pool.find((card) => card.kind === "hitter" && !taken.has(card.id));
    const soloArm = { ...manager, roster: roster.filter((card) => card.id !== bat.id).concat(replacementDh) };
    assert.equal(validateRoster(soloArm).length, 0, "the arm plays alone just fine");
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("boss rosters spread the budget instead of stars-and-scrubs", () => {
  for (const trainer of TRAINERS) {
    const npc = buildNpcTeam(trainer);
    const mean = npc.points / npc.roster.length;
    const scrubs = npc.roster.filter((card) => card.points < mean * 0.25).length;
    assert.ok(scrubs <= 2, `${trainer.id}: at most a couple of bargain-bin fillers (${scrubs})`);
    const priciest = Math.max(...npc.roster.map((card) => card.points));
    assert.ok(priciest <= mean * 4, `${trainer.id}: no card hogs the whole checkbook`);
  }
});

test("selling never strips the roster copy of a card", () => {
  const save = testSave();
  const rosterCard = save.roster.cardIds[0];
  assert.equal(removeCardFromCollection(save, rosterCard), false, "single roster copy is locked");
  addCardToCollection(save, rosterCard);
  assert.equal(removeCardFromCollection(save, rosterCard), true, "spare copy sells");
  assert.equal(ownedCount(save, rosterCard), 1);
});

test("coins cannot go negative through spending", () => {
  const save = testSave();
  grantCoins(save, 100);
  assert.equal(spendCoins(save, 500), false);
  assert.equal(save.player.coins, 100);
  assert.equal(spendCoins(save, 100), true);
  assert.equal(save.player.coins, 0);
});

test("series bookkeeping clinches at the majority and salts attempts", () => {
  const save = testSave();
  const series = startSeries(save, "gym-garrick", 3);
  assert.equal(seriesNeeded(series), 2);
  assert.equal(recordSeriesGame(save, true), "live");
  assert.equal(recordSeriesGame(save, false), "live");
  assert.equal(recordSeriesGame(save, true), "won");
  const firstAttempt = series.attempt;
  const rematch = startSeries(save, "gym-garrick", 3);
  assert.equal(rematch.attempt, firstAttempt + 1, "attempt counter moves forward");
});

test("repeatable rewards diminish but never fall below the floor", () => {
  const save = testSave();
  const farm = { id: "test-farm", repeatable: true, rewards: { coins: 200 } };
  assert.equal(rewardCoins(save, farm), 200);
  save.progress.trainersBeaten[farm.id] = 1;
  assert.equal(rewardCoins(save, farm), 150);
  save.progress.trainersBeaten[farm.id] = 20;
  assert.equal(rewardCoins(save, farm), 50);
});

test("gym unlock requires both route scouts", () => {
  const save = testSave();
  const gym = trainerById("gym-garrick");
  assert.equal(isTrainerUnlocked(save, gym), false);
  save.progress.trainersBeaten["scout-jojo"] = 1;
  assert.equal(isTrainerUnlocked(save, gym), false);
  save.progress.trainersBeaten["scout-mabel"] = 1;
  assert.equal(isTrainerUnlocked(save, gym), true);
});

// ---- Engine hooks ----------------------------------------------------------

function hookTeams() {
  const save = testSave();
  const player = { ...managerFor(save) };
  const npc = buildNpcTeam(trainerById("scout-jojo"));
  return { player, npc };
}

test("stealCandidates lists every open-base runner; attemptSteal forces the run", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "hook-steal" });
  const state = battle.state;
  state.bases[0] = { id: "r1", name: "Runner One", speed: 15 };
  const candidates = stealCandidates(state);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].fromIndex, 0);
  assert.ok(candidates[0].safeChance >= 0 && candidates[0].safeChance <= 1);
  const event = attemptSteal(state, 0, createRng("steal-roll"));
  assert.equal(event.type, "steal");
  assert.ok(["SB", "CS"].includes(event.result));
  assert.equal(attemptSteal(state, 2, createRng("x")), null, "no candidate on that base");
});

test("third tightens as outs mount; NPC profiles bend the matrix, not replace it", async () => {
  const { advanceDecisionMinimum } = await import("../src/rules/game.js");
  const { npcMaybeSteal, AI_PROFILES } = await import("../src/adventure/battle/ai.js");

  assert.equal(advanceDecisionMinimum(0, "third"), 0.65, "bold to third early");
  assert.equal(advanceDecisionMinimum(1, "third"), 0.75);
  assert.equal(advanceDecisionMinimum(2, "third"), 0.85, "never make the third out at third");
  assert.equal(advanceDecisionMinimum(2, "home"), 0.4, "two outs, send him");
  assert.equal(advanceDecisionMinimum(0, "second"), 0.9);
  assert.equal(advanceDecisionMinimum(5, "second"), 1, "unknown rows never go");

  // NPC steals read the same table, shifted by personality. Find a runner
  // speed whose safe chance sits between the aggressive and balanced bars
  // for stealing second at 0 outs (0.78 vs 0.9).
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "steal-bias" });
  const state = battle.state;
  state.outs = 0;
  let chance = null;
  for (let speed = 8; speed <= 28 && chance === null; speed += 1) {
    state.bases = [{ id: "swiper", name: "Swiper", speed }, null, null];
    const [candidate] = stealCandidates(state);
    if (candidate && candidate.safeChance > 0.79 && candidate.safeChance < 0.89) chance = candidate.safeChance;
  }
  assert.ok(chance !== null, "found a runner in the gap between profiles");
  assert.equal(npcMaybeSteal(state, createRng("bias-roll"), AI_PROFILES.balanced), null, "the balanced skipper holds him");
  const sent = npcMaybeSteal(state, createRng("bias-roll"), AI_PROFILES.aggressive);
  assert.ok(sent, "the aggressive skipper shaves the same bar and sends him");
});

test("a runner gets one steal attempt per at-bat, refreshed by the next batter", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "steal-once" });
  const state = battle.state;
  state.outs = 0;
  state.bases = [{ id: "r1", name: "Runner One", speed: 28 }, null, null];

  const event = attemptSteal(state, 0, createRng("steal-once-roll"));
  assert.ok(event, "the first attempt goes");
  assert.deepEqual(state.stealAttemptsThisPA, ["r1"], "the attempt is on the books");
  if (event.result === "SB") {
    assert.equal(state.bases[1]?.id, "r1", "safe at second");
    assert.equal(stealCandidates(state).length, 0, "no second bite this at-bat");
    assert.equal(attemptSteal(state, 1, createRng("x")), null, "forcing it is refused");
  }

  // A different runner still gets his own green light — and open-base checks
  // read real occupancy, so nobody is waved into an occupied bag.
  state.bases[0] = { id: "r2", name: "Runner Two", speed: 15 };
  const others = stealCandidates(state);
  if (state.bases[1]) {
    assert.equal(others.length, 0, "second is occupied; r2 has nowhere to go");
  } else {
    assert.deepEqual(others.map((c) => c.runner.id), ["r2"], "r2 may still run");
  }

  // The next plate appearance clears the slate.
  playPlateAppearance(state, createRng("steal-once-pa"));
  assert.deepEqual(state.stealAttemptsThisPA, [], "a new batter refreshes everyone");
});

test("changePitcher walks the staff and stops at the last arm", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "hook-pen" });
  const staffSize = battle.state.away.pitchers.length;
  assert.equal(staffSize, 3, "starter plus two relievers");
  let changes = 0;
  while (changePitcher(battle.state, "away")) changes += 1;
  assert.equal(changes, staffSize - 1);
  const status = pitcherStatus(battle.state, "away");
  assert.equal(status.hasReliefAvailable, false);
  assert.equal(status.outsRecorded, 0);
});

test("auto sim is untouched by the hooks: seeded games still reproduce", () => {
  const { player, npc } = hookTeams();
  const battle1 = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "same" });
  const teams = [battle1.state.away, battle1.state.home];
  const a = simulateGame({ ...teams[0] }, { ...teams[1] }, "regression-seed");
  const b = simulateGame({ ...teams[0] }, { ...teams[1] }, "regression-seed");
  assert.equal(a.winner, b.winner);
  assert.deepEqual(a.boxScore.away.hitters, b.boxScore.away.hitters);
});

test("the skipper can call for a specific reliever; skipped arms stay available", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "pick-pen" });
  const state = battle.state;
  const staff = state.away.pitchers;
  assert.equal(staff.length, 3);
  const secondReliever = staff[2];
  const firstReliever = staff[1];
  const brought = changePitcher(state, "away", 2);
  assert.equal(brought.id, secondReliever.id, "the chosen arm takes the hill");
  assert.equal(pitcherStatus(state, "away").pitcher.id, secondReliever.id);
  assert.equal(pitcherStatus(state, "away").hasReliefAvailable, true, "the skipped arm is still in the pen");
  const next = changePitcher(state, "away");
  assert.equal(next.id, firstReliever.id, "and comes in next");
  assert.equal(changePitcher(state, "away", 99), null, "bogus targets are refused");
});

test("stealing third is tougher than stealing second for the same runner", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "steal-third" });
  const state = battle.state;
  const runner = { id: "r1", name: "Runner One", speed: 15 };
  state.bases = [runner, null, null];
  const second = stealCandidates(state)[0];
  state.bases = [null, runner, null];
  const third = stealCandidates(state)[0];
  assert.equal(second.target, runner.speed, "second base is a straight speed check");
  assert.equal(third.target, runner.speed - 5, "the catcher gets +5 on the throw to third");
  assert.ok(third.safeChance < second.safeChance);
});

test("manual pitching keeps every arm in until pulled — yours by hand, theirs by the AI", async () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "manual-pen" });
  const state = battle.state;
  const starter = pitcherStatus(state, "away").pitcher;
  state.pitching.away.outsRecorded = starter.plannedOuts + 6;
  state.pitching.away.battersFaced = starter.ip * 4 + 2;
  assert.equal(pitcherStatus(state, "away").pitcher.id, starter.id, "player's starter stays until pulled");
  assert.ok(pitcherStatus(state, "away").fatiguePenalty >= 1, "and pays for it in fatigue");
  // The NPC mound runs manual too: their starter stays in (and tires) until
  // the AI skipper pulls him — no silent plan-based swaps.
  const npcStarter = pitcherStatus(state, "home").pitcher;
  state.pitching.home.outsRecorded = npcStarter.plannedOuts;
  state.pitching.home.battersFaced = npcStarter.ip * 4 + 1;
  assert.equal(pitcherStatus(state, "home").pitcher.id, npcStarter.id, "NPC arm stays until the AI pulls it");
  assert.ok(pitcherStatus(state, "home").fatiguePenalty >= 1, "and shows real fatigue while he waits");
  const { npcMaybePullPitcher, AI_PROFILES } = await import("../src/adventure/battle/ai.js");
  const pulled = npcMaybePullPitcher(state, "home", AI_PROFILES.conservative);
  assert.ok(pulled, "a tired NPC arm gets pulled by the profile");
  assert.notEqual(pitcherStatus(state, "home").pitcher.id, npcStarter.id);
});

test("a sacrifice bunt trades an out to move the runners", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "bunt-seed" });
  const state = battle.state;
  assert.equal(canBunt(state), false, "nobody on, nothing to bunt for");
  state.bases[0] = { id: "r1", name: "Runner One", speed: 12 };
  assert.equal(canBunt(state), true);
  state.bases[2] = { id: "r3", name: "Runner Three", speed: 12 };
  assert.equal(canBunt(state), false, "no squeeze plays: a runner on third kills the bunt");
  state.bases[2] = null;
  const linesBefore = state.stats.hitters.get?.("x") ?? null;
  const event = attemptBunt(state);
  assert.equal(event.type, "bunt");
  assert.equal(event.result, "SAC", "traditional Showdown: the sacrifice always gets down");
  assert.equal(state.outs, 1);
  assert.equal(state.lineupIndex.away, 1, "the bunt consumed the plate appearance");
  assert.equal(state.bases[1]?.id, "r1", "runner moved up");
  assert.equal(state.bases[0], null, "batter is out, no roll about it");
  assert.equal(linesBefore, null);

  // Runners on first and second both move up; buntSuccessChance reads 1.
  state.outs = 0;
  state.bases = [{ id: "a1", name: "A", speed: 8 }, { id: "a2", name: "B", speed: 8 }, null];
  assert.equal(buntSuccessChance(state), 1, "the menu shows a sure thing");
  attemptBunt(state);
  assert.deepEqual([state.bases[0], state.bases[1]?.id, state.bases[2]?.id], [null, "a1", "a2"], "everyone moves up");

  state.outs = 2;
  assert.equal(canBunt(state), false, "no bunting with two down");
});

test("an intentional walk is free and forces a run with the bases full", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "ibb-seed" });
  const state = battle.state;
  const event = intentionalWalk(state);
  assert.equal(event.result, "IBB");
  assert.equal(state.bases[0]?.name, event.batter, "batter takes first");
  // No pitches thrown: the walk is charged, but the arm faced nobody — the
  // box score and the fatigue tank both stay put.
  assert.equal(state.pitching.home.battersFaced, 0, "the fatigue tank does not move");
  const armLine = [...state.stats.pitchers.values()][0];
  assert.equal(armLine.bb, 1, "the walk is charged");
  assert.equal(armLine.bf, 0, "but no batter faced");
  state.bases[1] = { id: "r2", name: "Runner Two", speed: 10 };
  state.bases[2] = { id: "r3", name: "Runner Three", speed: 10 };
  const scoreBefore = state.score.away;
  const forced = intentionalWalk(state);
  assert.equal(forced.runs, 1, "bases-loaded IBB forces the run home");
  assert.equal(state.score.away, scoreBefore + 1);
});

test("hits defer the extra-base call to the player, who can hold or send", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "defer-seed" });
  const state = battle.state;
  const batter = state.away.lineup[0];
  const pitcher = pitcherStatus(state, "home").pitcher;

  state.bases[1] = { id: "r2", name: "Runner Two", speed: 14 };
  applySingle(state, batter, "away", "home", createRng("adv-roll"), pitcher);
  assert.ok(state.pendingAdvance, "the send-or-hold call is pending");
  assert.equal(state.pendingAdvance.candidates[0].runner.id, "r2");
  assert.equal(state.pendingAdvance.candidates[0].toIndex, 3, "lead runner is eyeing home");

  const held = resolveAdvanceDecision(state, 0, createRng("x"));
  assert.equal(held, null, "holding is quiet");
  assert.equal(state.pendingAdvance, null);
  assert.equal(state.bases[2]?.id, "r2", "runner parked at third");

  state.bases = [null, { id: "r5", name: "Runner Five", speed: 20 }, null];
  applySingle(state, state.away.lineup[1], "away", "home", createRng("adv-roll-2"), pitcher);
  const outsBefore = state.outs;
  const scoreBefore = state.score.away;
  const event = resolveAdvanceDecision(state, 1, createRng("send-roll"));
  assert.equal(event.type, "advance");
  const scoredOrOut = state.score.away === scoreBefore + 1 || state.outs === outsBefore + 1;
  assert.ok(scoredOrOut, "the send either scores or costs an out");
});

test("auto play never defers: simulated games leave no pending decisions", () => {
  const { player, npc } = hookTeams();
  const result = simulateGame(buildTeam(player), buildTeam(npc), "no-defer-seed");
  assert.ok(result.events.length > 0);
});

test("a saved batting order reorders the lineup for future games", () => {
  const save = testSave();
  const defaultLineup = buildTeam(managerFor(save)).lineup;
  assert.equal(defaultLineup.length, 9);
  const reversed = [...defaultLineup].reverse().map((player) => player.id);
  setBattingOrder(save, reversed);
  const lineup = buildTeam(managerFor(save)).lineup;
  assert.deepEqual(lineup.map((player) => player.id), reversed, "lineup bats in the saved order");
  const battle = createBattle({
    playerManager: managerFor(save),
    npcManager: buildNpcTeam(trainerById("scout-jojo")),
    trainer: trainerById("scout-jojo"),
    seed: "order-seed"
  });
  assert.deepEqual(battle.state.away.lineup.map((player) => player.id), reversed, "battles honor it too");
});

// ---- Season stats ------------------------------------------------------------

test("game box scores fold into rolling season stats with batch-style rates", async () => {
  const { gameStars } = await import("../src/adventure/ui/statsScreens.js");
  const save = testSave();
  delete save.seasonStats;
  assert.equal(ensureSeasonStats(save).games, 0, "older saves grow the field in place");

  const { player, npc } = hookTeams();
  const first = simulateGame(buildTeam(player), buildTeam(npc), "season-g1");
  const second = simulateGame(buildTeam(player), buildTeam(npc), "season-g2");
  recordGameStats(save, first.boxScore.away);
  recordGameStats(save, second.boxScore.away);

  assert.equal(save.seasonStats.games, 2);
  const hitters = seasonHitters(save);
  assert.ok(hitters.length >= 9, "every hitter has a season line");
  const paTotal = first.boxScore.away.hitters.reduce((sum, line) => sum + line.pa, 0)
    + second.boxScore.away.hitters.reduce((sum, line) => sum + line.pa, 0);
  assert.equal(hitters.reduce((sum, line) => sum + line.pa, 0), paTotal, "PAs accumulate across games");
  for (const line of hitters) {
    assert.ok(line.avg >= 0 && line.avg <= 1);
    assert.ok(line.ops >= 0, `${line.name} has an OPS`);
    assert.equal(line.games, 2);
  }
  const wpaTotal = first.boxScore.away.hitters.reduce((sum, line) => sum + line.wpa, 0)
    + second.boxScore.away.hitters.reduce((sum, line) => sum + line.wpa, 0);
  const seasonWpa = hitters.reduce((sum, line) => sum + line.wpa, 0);
  assert.ok(Math.abs(seasonWpa - wpaTotal) < 1e-9, "WPA accumulates across games");
  const pitchers = seasonPitchers(save);
  assert.ok(pitchers.length >= 1);
  const outsTotal = first.boxScore.away.pitchers.reduce((sum, line) => sum + line.outs, 0)
    + second.boxScore.away.pitchers.reduce((sum, line) => sum + line.outs, 0);
  assert.equal(pitchers.reduce((sum, line) => sum + line.outs, 0), outsTotal, "outs accumulate");

  const stars = gameStars(first.boxScore, "away");
  assert.equal(stars.length, 3);
  assert.ok(stars[0].wpa >= stars[1].wpa && stars[1].wpa >= stars[2].wpa, "stars rank by WPA");
  assert.ok(stars.every((star) => star.summary.length > 0));
});

test("season stats scope to the roster, search by name, and sort by column", async () => {
  const { seasonStatsScreen, seasonLines } = await import("../src/adventure/ui/statsScreens.js");
  const save = testSave();
  const { player, npc } = hookTeams();
  const result = simulateGame(buildTeam(player), buildTeam(npc), "season-screen");
  recordGameStats(save, result.boxScore.away);
  // A player who has since left the roster still lives in the season book.
  save.seasonStats.hitters.departed = {
    id: "departed", name: "Gone Guy", games: 1, pa: 4, ab: 4, h: 4, d: 0, t: 0, hr: 9, bb: 0, so: 0, r: 1, rbi: 2, sb: 0, cs: 0, gidp: 0, wpa: 0.4
  };
  const app = { save, screen: { name: "seasonStats", index: 0, view: "hitters" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };

  // Default scope is the active roster: the departed man doesn't show.
  assert.ok(seasonLines(app).lines.length >= 9, "the roster's hitters all show");
  assert.ok(!seasonLines(app).lines.some((line) => line.id === "departed"), "ex-roster players hide by default");
  seasonStatsScreen.key(app, "right");
  assert.equal(app.screen.scope, "all");
  assert.ok(seasonLines(app).lines.some((line) => line.id === "departed"), "ALL PLAYERS brings them back");

  // Type-to-search narrows by name; X clears it before leaving.
  seasonStatsScreen.typed(app, "g");
  seasonStatsScreen.typed(app, "o");
  seasonStatsScreen.typed(app, "n");
  assert.deepEqual(seasonLines(app).lines.map((line) => line.id), ["departed"], "search finds Gone Guy");
  seasonStatsScreen.key(app, "b");
  assert.equal(app.screen.query, "", "X clears the search");
  assert.equal(app.screen.name, "seasonStats", "without leaving");

  // Digits sort; the same digit again flips the direction.
  seasonStatsScreen.typed(app, "4"); // HR
  const byHr = seasonLines(app);
  assert.equal(byHr.sort.key, "hr");
  assert.equal(byHr.lines[0].id, "departed", "the 9-homer man leads the HR sort");
  for (let i = 1; i < byHr.lines.length; i += 1) {
    assert.ok(byHr.lines[i - 1].hr >= byHr.lines[i].hr, "descending by HR");
  }
  seasonStatsScreen.typed(app, "4");
  const flipped = seasonLines(app);
  assert.equal(flipped.lines[flipped.lines.length - 1].id, "departed", "again flips to ascending");

  // Z swaps to arms and resets the sort to the default RA9 ordering.
  seasonStatsScreen.key(app, "a");
  assert.equal(app.screen.view, "pitchers");
  assert.equal(app.screen.sortKey, null, "the sort resets with the view");
  assert.ok(seasonLines(app).lines.length >= 1, "the arms show");
});

test("the series break offers stats folded from this series alone", async () => {
  const { seriesStatLines } = await import("../src/adventure/ui/statsScreens.js");
  const { seriesBreakScreen, recordFinishedGame } = await import("../src/adventure/ui/battleScreen.js");
  const save = testSave();
  const { player, npc } = hookTeams();
  const finish = (trainer, seed, won) => {
    const result = simulateGame(buildTeam(player), buildTeam(npc), seed);
    recordGameStats(save, result.boxScore.away);
    recordFinishedGame(save, {
      trainer, boxScore: result.boxScore, playerSide: "away", events: [],
      score: { away: won ? 1 : 0, home: won ? 0 : 1 }, innings: 9, won
    });
    return result;
  };

  // A game BEFORE the series must not leak into the series book.
  finish(trainerById("scout-jojo"), "series-stats-pre", true);
  startSeries(save, "gym-garrick", 5);
  const g1 = finish(trainerById("gym-garrick"), "series-stats-g1", true);
  recordSeriesGame(save, true);
  const g2 = finish(trainerById("gym-garrick"), "series-stats-g2", false);
  recordSeriesGame(save, false);

  const { hitters, pitchers, games } = seriesStatLines(save);
  assert.equal(games, 2, "the series book holds exactly this series' games");
  const paTotal = [g1, g2].reduce((sum, game) => sum + game.boxScore.away.hitters.reduce((s, l) => s + l.pa, 0), 0);
  assert.equal(hitters.reduce((sum, line) => sum + line.pa, 0), paTotal, "PAs fold from the two series games only");
  assert.ok(pitchers.length >= 1, "the arms show too");

  // The screen: a SERIES STATS entry opens a browsable, hoverable list.
  const app = { save, screen: { name: "seriesBreak", trainerId: "gym-garrick", lastWon: false, score: { away: 0, home: 1 }, playerSide: "away", menuIndex: 0 }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  assert.ok(seriesBreakScreen.render(app).includes("SERIES STATS"), "the menu offers it");
  app.screen.menuIndex = 2;
  seriesBreakScreen.key(app, "a");
  assert.equal(app.screen.mode, "stats");
  const html = seriesBreakScreen.render(app);
  assert.ok(html.includes("YOUR BATS") && html.includes("YOUR ARMS"), "bats and arms section");
  assert.ok(seriesBreakScreen.hoverCard(app, 0), "rows hover their card");
  seriesBreakScreen.key(app, "b");
  assert.equal(app.screen.mode, null, "X returns to the break menu");
  assert.equal(app.screen.name, "seriesBreak");
});

test("sim series carry per-game box scores so season stats include them", () => {
  const save = testSave();
  const { player, npc } = hookTeams();
  const series = runSimSeries({ playerManager: player, npcManager: npc, bestOf: 3, seed: "sim-stats" });
  for (const game of series.games) {
    assert.ok(game.boxScore, `game ${game.gameNumber} has a box score`);
    recordGameStats(save, game.playerIsAway ? game.boxScore.away : game.boxScore.home);
  }
  assert.equal(save.seasonStats.games, series.games.length);
  assert.ok(seasonHitters(save).every((line) => line.games === series.games.length));
});

test("replacement picks default to the outgoing card's position; 'all' widens to the kind", async () => {
  const { benchCards } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const roster = save.roster.cardIds.map((id) => cardById(id));
  const pool = adventurePool();
  const spare = (filter) => pool.find((card) => filter(card) && !save.roster.cardIds.includes(card.id));
  const spares = [
    spare((card) => card.position === "C"),
    spare((card) => card.position === "1B"),
    spare((card) => card.role === "SP"),
    spare((card) => card.role === "RP")
  ];
  for (const card of spares) addCardToCollection(save, card.id);

  const catcher = roster.find((card) => card.position === "C");
  const positionOnly = benchCards(save, catcher, "position");
  assert.ok(positionOnly.length >= 1);
  assert.ok(positionOnly.every((card) => card.position === "C"), "default view is same-position only");
  const allBats = benchCards(save, catcher, "all");
  assert.ok(allBats.some((card) => card.position === "1B"), "'all' shows other positions");
  assert.ok(allBats.every((card) => card.kind === "hitter"), "'all' stays within the kind");

  const starter = roster.find((card) => card.role === "SP");
  assert.ok(benchCards(save, starter, "position").every((card) => card.role === "SP"), "pitchers filter by role");
  assert.ok(benchCards(save, starter, "all").some((card) => card.role === "RP"), "'all' shows the whole pen");
});

test("the team menu swaps the rotation and flips the DH, legally and durably", async () => {
  const { rotationCards, swapRotation, dhFlipOptions, flipDhWith } = await import("../src/adventure/ui/collectionScreens.js");
  const { canPlayerFillLineupSlot, assignLineupSlots } = await import("../src/rules/draft.js");
  const save = testSave();

  // Rotation: roster SP order is the rotation; the swap flips game 1.
  const [sp1, sp2] = rotationCards(save);
  assert.ok(sp1 && sp2, "the starter roster carries two SPs");
  assert.equal(buildTeam(managerFor(save)).pitchers[0].id, sp1.id);
  assert.equal(swapRotation(save), true);
  assert.equal(buildTeam(managerFor(save)).pitchers[0].id, sp2.id, "the other arm takes game 1");
  assert.deepEqual(rotationCards(save).map((card) => card.id), [sp2.id, sp1.id]);
  assert.equal(buildTeam(managerFor(save), { starterIndex: 1 }).pitchers[0].id, sp1.id, "game 2 goes to the old game-1 arm");

  // DH flips: every offered flip is legal, and applying one moves both men.
  const flips = dhFlipOptions(save);
  assert.ok(flips.length >= 1, "the 1B flip at minimum is always on the table");
  assert.ok(flips.every((flip) => canPlayerFillLineupSlot(flip.dh, flip.label)), "only legal flips are offered");
  assert.ok(flips.some((flip) => flip.label === "1B"), "anyone can take first");
  const target = flips[0];
  const before = buildTeam(managerFor(save)).lineup;
  assert.equal(before.find((player) => player.assignedPosition === "DH").id, target.dh.id);
  assert.equal(flipDhWith(save, target.label), true);
  const after = buildTeam(managerFor(save)).lineup;
  assert.equal(after.find((player) => player.assignedPosition === "DH").id, target.player.id, "the fielder now DHs");
  assert.equal(after.find((player) => player.assignedPosition === target.label).id, target.dh.id, "the old DH takes the field");

  // Illegal flips are refused (any slot the current DH can't play).
  const nowLegal = new Set(dhFlipOptions(save).map((flip) => flip.label));
  const illegal = ["C", "2B", "3B", "SS", "CF", "LF", "RF"].find((label) => !nowLegal.has(label));
  if (illegal) assert.equal(flipDhWith(save, illegal), false, `${illegal} flip is refused`);

  // The flip survives a bench swap: assignments keep every surviving id.
  const assignmentsBefore = { ...save.roster.lineupAssignments };
  setRoster(save, save.roster.cardIds);
  assert.deepEqual(save.roster.lineupAssignments, assignmentsBefore, "roster edits keep the flip");
  const slots = assignLineupSlots(rosterCards(save), save.roster.lineupAssignments).slots;
  assert.equal(slots.find((slot) => slot.label === "DH").player.id, target.player.id);
});

test("the replacement picker ranks the incumbent by points, diamond-marked; picking him keeps him", async () => {
  const { teamScreen, benchCards } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const anchor = rosterCards(save)[0];
  // A pricier and a cheaper spare at the same position, so the incumbent
  // must land BETWEEN them when the list sorts by points.
  const spares = adventurePool().filter((card) =>
    !save.roster.cardIds.includes(card.id) && card.position === anchor.position
  );
  const pricier = spares.find((card) => card.points > anchor.points);
  const cheaper = spares.find((card) => card.points < anchor.points);
  assert.ok(pricier && cheaper, "the pool brackets the incumbent");
  addCardToCollection(save, pricier.id);
  addCardToCollection(save, cheaper.id);

  const app = { save, screen: { name: "team", index: 0, mode: "roster" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  teamScreen.key(app, "a"); // open the picker on the first roster card
  assert.equal(app.screen.mode, "pick");
  const rows = [0, 1, 2].map((at) => teamScreen.hoverCard(app, at));
  const anchorAt = rows.findIndex((card) => card?.id === anchor.id);
  assert.ok(anchorAt > 0, "the incumbent no longer leads the list");
  assert.ok(rows[anchorAt - 1].points >= anchor.points, "everyone above him costs more");
  assert.equal(app.screen.pickIndex, anchorAt, "the cursor still opens on him");
  const html = teamScreen.render(app);
  const nameAt = html.indexOf(anchor.name.split(" ").pop().toUpperCase());
  assert.ok(nameAt >= 0 && html.indexOf("&#9670;", nameAt) > nameAt, "he keeps the diamond wherever he ranks");

  // Picking the incumbent keeps the roster exactly as it was.
  const before = [...save.roster.cardIds];
  teamScreen.key(app, "a");
  assert.deepEqual(save.roster.cardIds, before, "picking the incumbent changes nothing");
  assert.equal(app.screen.mode, "roster");

  // Picking another row still swaps.
  teamScreen.key(app, "a");
  app.screen.pickIndex = anchorAt === 0 ? 1 : 0;
  teamScreen.key(app, "a");
  assert.ok(save.roster.cardIds.includes(pricier.id), "bench picks still swap in");
  assert.ok(!save.roster.cardIds.includes(anchor.id), "and the incumbent departs");
});

test("the team screen shows the previewed card's season stats", async () => {
  const { teamScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const app = { save, screen: { name: "team", index: 0, mode: "roster" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  assert.ok(teamScreen.render(app).includes("THIS SEASON: NO GAMES YET."), "a fresh season says so");

  const { player, npc } = hookTeams();
  const result = simulateGame(buildTeam(player), buildTeam(npc), "team-stats");
  recordGameStats(save, result.boxScore.away);
  const withStats = teamScreen.render(app);
  assert.ok(withStats.includes("THIS SEASON"), "the season line shows");
  assert.match(withStats.replace(/<[^>]+>/g, " "), /OPS.*1G/, "with the hitter's rates and games");
});

test("the roster locks mid-series; rotation, DH, and batting order stay live", async () => {
  const { teamScreen, swapRotation, dhFlipOptions } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  startSeries(save, "gym-garrick", 3);
  const app = { save, screen: { name: "team", index: 0, mode: "roster" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  teamScreen.key(app, "a");
  assert.notEqual(app.screen.mode, "pick", "no bench swaps mid-series");
  assert.ok(teamScreen.render(app).includes("SERIES IN PROGRESS"), "the lock is explained");
  assert.equal(swapRotation(save), true, "the rotation still swaps");
  assert.ok(dhFlipOptions(save).length >= 1, "the DH flip stays on the table");

  clearSeries(save);
  teamScreen.key(app, "a");
  assert.equal(app.screen.mode, "pick", "the lock lifts when the series ends");
});

test("the battle screen tags batter, pitcher, and runners with hoverable card ids", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "hover-tags" });
  battle.state.bases[0] = { id: "runner-card-id", name: "Runner One", speed: 15 };
  const app = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle, mode: "menu", menuIndex: 0, lines: [] } };
  const html = battleScreen.render(app);
  const phase = battlePhase(battle);
  assert.ok(html.includes(`data-card-id="${phase.batter.id}"`), "batter is hoverable");
  assert.ok(html.includes(`data-card-id="${phase.opposingPitcher.id}"`), "pitcher is hoverable");
  assert.ok(html.includes('data-card-id="runner-card-id"'), "occupied base is hoverable");
  // The on-deck batter shows (and hovers) too — always the next spot in order.
  const lineup = battle.state[battle.playerSide].lineup;
  assert.equal(phase.onDeck.id, lineup[(battle.state.lineupIndex[battle.playerSide] + 1) % lineup.length].id);
  assert.ok(html.includes("ON DECK"), "the on-deck line shows");
  assert.ok(html.includes(`data-card-id="${phase.onDeck.id}"`), "and the on-deck man is hoverable");
  // YOU/THEM carry defense summaries: catcher arm, infield, outfield sums.
  const notes = [...html.matchAll(/data-hover-note="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(notes.length, 2, "both HUD sides carry a defense note");
  assert.ok(notes[0].startsWith("YOUR DEFENSE") && notes[1].startsWith("THEIR DEFENSE"));
  for (const note of notes) {
    assert.match(note, /CATCHER [+-]\d+/);
    assert.match(note, /INFIELD [+-]\d+/);
    assert.match(note, /OUTFIELD [+-]\d+/);
  }
  const infield = battle.state[battle.playerSide].lineup
    .filter((p) => ["1B", "2B", "3B", "SS"].includes(p.assignedPosition ?? p.position))
    .reduce((sum, p) => sum + (Number(p.fielding) || 0), 0);
  assert.ok(notes[0].includes(`INFIELD ${infield >= 0 ? "+" : ""}${infield}`), "infield total matches the lineup");
});

test("the menu right-aligns when the opponent is hitting", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  // Home game, top 1: the NPC bats, the player pitches — defense menu.
  const homeGame = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "align-home", playerIsAway: false });
  const app = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle: homeGame, mode: "menu", menuIndex: 0, lines: [] } };
  assert.ok(battleScreen.render(app).includes("gq-menu-right"), "the defense menu reads from the other dugout");
  app.screen.mode = "pen";
  app.screen.penIndex = 0;
  assert.ok(battleScreen.render(app).includes("gq-menu-right"), "the bullpen list too");
  // Road game, top 1: the player bats — the offense menu stays left.
  const roadGame = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "align-road" });
  const roadApp = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle: roadGame, mode: "menu", menuIndex: 0, lines: [] } };
  assert.ok(!battleScreen.render(roadApp).includes("gq-menu-right"), "the batting menu stays left-aligned");
});

test("series games can put the player at home, batting second", () => {
  const { player, npc } = hookTeams();
  const trainer = trainerById("gym-garrick");
  const homeGame = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "home-game", playerIsAway: false });
  assert.equal(homeGame.playerSide, "home");
  assert.equal(homeGame.npcSide, "away");
  assert.equal(homeGame.state.manualPitchingFor, "both", "both mounds run manual in battles");
  const phase = battlePhase(homeGame);
  assert.equal(phase.type, "player-pitching", "top 1 at home: the NPC bats first");
  const roadGame = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "road-game" });
  assert.equal(roadGame.playerSide, "away", "single games keep the player on the road");
});

test("games land on a FINAL screen naming the winner and the last play", async () => {
  const { battleScreen, gameOverScreen } = await import("../src/adventure/ui/battleScreen.js");
  const save = testSave();
  const trainer = trainerById("scout-jojo");
  startSeries(save, trainer.id, 1);
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "final-screen" });
  const app = {
    save,
    screen: { name: "battle", trainerId: trainer.id, battle, mode: "menu", menuIndex: 0, lines: [] },
    go(name, data) { this.screen = { name, ...data }; },
    rerender() {}
  };
  // Ride FAST FORWARD (always the last menu item) until the game ends.
  let guard = 300;
  while (app.screen.name === "battle" && guard-- > 0) {
    battleScreen.key(app, "up"); // wrap to the last item
    battleScreen.key(app, "a");
  }
  assert.equal(app.screen.name, "gameOver", "the game ends on the FINAL screen");
  const html = gameOverScreen.render(app);
  assert.ok(html.includes("YOU WIN!") || html.includes("YOU LOSE"), "the outcome is stated plainly");
  assert.ok(html.includes("THE FINAL PLAY:"), "the last play is shown");
  assert.match(html.replace(/<[^>]+>/g, " "), /YOU \d+ .* THEM \d+/, "the final score reads from your side");
  gameOverScreen.key(app, "a");
  assert.equal(app.screen.name, "gameStats", "Z continues to the box score");
});

test("the NPC mound visit is its own event, never smuggled into the swing", async () => {
  const { npcMoundVisit } = await import("../src/adventure/battle/controller.js");
  const { AI_PROFILES } = await import("../src/adventure/battle/ai.js");
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "mound-visit" });
  battle.profile = AI_PROFILES.conservative;
  const starter = battle.state.home.pitchers[0];
  battle.state.pitching.home.battersFaced = starter.ip * 4 + 4;

  // The visit fires as its own event before the batter decision.
  const visit = npcMoundVisit(battle);
  assert.equal(visit?.type, "pitching-change", "the change is a standalone event");
  assert.equal(battle.events[battle.events.length - 1], visit, "and lands in the game log");
  const onMound = battle.state.pitching.home.pitcherIndex;
  assert.notEqual(onMound, 0, "the tired starter is gone before anyone swings");

  // The swing itself never carries a pitching change, however tired the arm.
  const reliever = battle.state.home.pitchers[onMound];
  battle.state.pitching.home.battersFaced = reliever.ip * 4 + 8;
  const events = actSwing(battle);
  assert.ok(events.every((event) => event?.type !== "pitching-change"), "the swing is pure batter action");
  assert.equal(battle.state.pitching.home.pitcherIndex, onMound, "no mid-swing mound change");

  // No visits while the NPC is batting.
  battle.state.half = "bottom";
  assert.equal(npcMoundVisit(battle), null, "their turn at the plate, no visit");
});

test("the NPC's mound arm shows its fatigue subtraction like the player's", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "npc-tired" });
  const npcArm = battle.state.home.pitchers[0];
  // Push the NPC starter past fatigue onset but short of his planned exit.
  battle.state.pitching.home.battersFaced = npcArm.ip * 4 + 2;
  const phase = battlePhase(battle);
  assert.equal(phase.type, "player-batting");
  assert.ok(phase.opposingMound.fatiguePenalty >= 1, "NPC arms tire under the same rules");
  assert.equal(phase.opposingMound.tiredAt, npcArm.ip * 4, "the displayed tank is the card's IP x 4");
  const app = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle, mode: "menu", menuIndex: 0, lines: [] } };
  const html = battleScreen.render(app);
  assert.ok(html.includes(`&minus;${phase.opposingMound.fatiguePenalty} TIRED`), "the subtraction shows on their arm too");
  // Batters faced is the only fatigue input: deeper outings sink the penalty
  // further, and the printed tank never moves.
  battle.state.pitching.home.battersFaced = npcArm.ip * 4 + 6;
  const deeper = battlePhase(battle).opposingMound;
  assert.ok(deeper.fatiguePenalty > phase.opposingMound.fatiguePenalty, "more batters, more fatigue");
  assert.equal(deeper.tiredAt, npcArm.ip * 4, "IP 1 always reads /4, however deep the outing");
});

test("reported innings match the innings actually played", () => {
  const { player, npc } = hookTeams();
  for (const seed of ["inn-a", "inn-b", "inn-c", "inn-d", "inn-e", "inn-f"]) {
    const result = simulateGame(buildTeam(player), buildTeam(npc), seed);
    const lastInning = Math.max(...result.events.map((event) => event.inning));
    assert.equal(result.innings, lastInning, `${seed}: no phantom extra inning for away-side wins`);
  }
});

test("grand slams get called and celebrated", async () => {
  const { describeEvent } = await import("../src/adventure/ui/helpers.js");
  const { gameFeats } = await import("../src/adventure/feats.js");
  const slam = {
    batter: "Al Smith", pitcher: "Bo Diaz", result: "HR", runs: 4,
    outsAfter: 1, half: "top", inning: 6, scoreAfter: { away: 6, home: 2 }, wpa: 0.3
  };
  const call = describeEvent(slam, "away").join(" ");
  assert.ok(call.includes("GRAND SLAM!"), "the narration calls it");
  assert.ok(!call.includes("CRUSHES IT"), "and replaces the stock homer line");
  // Classic cards' year suffix stays out of the booth.
  const classic = describeEvent({ ...slam, batter: "Chipper Jones '00", runs: 1 }, "away").join(" ");
  assert.ok(classic.includes("C.JONES "), "the booth says C.JONES");
  assert.ok(!classic.includes("'00"), "without the card year");

  // Every fielding check reports its d20, steal-call style.
  const base = { batter: "Al Smith", pitcher: "Bo Diaz", runs: 0, outsAfter: 1, half: "top", inning: 4, scoreAfter: { away: 0, home: 0 } };
  const sent = describeEvent({ ...base, result: "1B", playDetails: { thrownAttempt: { runner: "Lead Man", to: "3B", safe: true, roll: 7 } } }, "away").join(" ");
  assert.ok(sent.includes("(rolled 7)"), "the throw on a hit reports its roll");
  const advance = describeEvent({ ...base, type: "advance", playDetails: { attempts: [
    { runner: "Lead Man", to: "HOME", thrown: true, safe: false, roll: 19 },
    { runner: "Trail Man", to: "3B", thrown: false, safe: true }
  ] } }, "away").join(" ");
  assert.ok(advance.includes("(rolled 19)"), "the send-or-hold throw reports its roll");
  assert.equal((advance.match(/rolled/g) ?? []).length, 1, "unthrown runners stay quiet");
  const twinKilling = describeEvent({ ...base, result: "GB", outsAfter: 2, playDetails: { doublePlayAttempt: { batterOut: true, roll: 12 } } }, "away").join(" ");
  assert.ok(twinKilling.includes("Double play! Two gone. (rolled 12)"), "the pivot reports its roll");
  const bat = { id: "h1", name: "Al Smith", pa: 4, ab: 4, h: 2, d: 0, t: 0, hr: 1, r: 1, bb: 0, so: 0, sb: 0, cs: 0, rbi: 4 };
  const feats = gameFeats({
    boxScore: { away: { hitters: [bat], pitchers: [{ id: "p", name: "Arm", bf: 30, outs: 27, h: 5, bb: 2, so: 6, hr: 0, r: 2 }] }, home: { hitters: [], pitchers: [] } },
    playerSide: "away",
    events: [slam],
    score: { away: 6, home: 2 },
    innings: 9
  });
  const slamFeat = feats.find((feat) => feat.title.includes("GRAND SLAM"));
  assert.ok(slamFeat, "a slam headlines the box score");
  assert.equal(slamFeat.cardId, "h1", "and links the hero's card");
  const theirSlam = gameFeats({
    boxScore: { away: { hitters: [bat], pitchers: [] }, home: { hitters: [], pitchers: [] } },
    playerSide: "away",
    events: [{ ...slam, half: "bottom" }],
    score: { away: 6, home: 2 },
    innings: 9
  });
  assert.equal(theirSlam.some((feat) => feat.title.includes("GRAND SLAM")), false, "their slams are their business");
});

test("the third out narrates the next half-inning only if one is coming", async () => {
  const { describeEvent } = await import("../src/adventure/ui/helpers.js");
  const out = (over = {}) => ({
    batter: "Al Smith", pitcher: "Bo Diaz", result: "GB", runs: 0,
    outsAfter: 3, half: "bottom", inning: 9,
    scoreAfter: { away: 5, home: 3 }, ...over
  });
  const finalOut = describeEvent(out()).join(" ");
  assert.ok(finalOut.includes("That's the ballgame!"), "a decided bottom 9 ends the game");
  assert.ok(!finalOut.includes("coming up"), "no phantom top 10");
  const midGame = describeEvent(out({ inning: 5 })).join(" ");
  assert.ok(midGame.includes("Top 6 coming up."), "mid-game turnovers still announce the next half");
  const tiedNinth = describeEvent(out({ scoreAfter: { away: 3, home: 3 } })).join(" ");
  assert.ok(tiedNinth.includes("Top 10 coming up."), "a tie means free baseball");
  const topNine = describeEvent(out({ half: "top", scoreAfter: { away: 2, home: 4 } })).join(" ");
  assert.ok(topNine.includes("That's the ballgame!"), "home leading after the top of the 9th ends it");
  const topNineTrailing = describeEvent(out({ half: "top", scoreAfter: { away: 4, home: 2 } })).join(" ");
  assert.ok(topNineTrailing.includes("Bottom 9 coming up."), "the home team still gets its licks");

  // Score calls read from the player's side, whichever dugout that is.
  const rbi = out({ outsAfter: 1, runs: 1, result: "1B", scoreAfter: { away: 0, home: 3 } });
  assert.ok(describeEvent(rbi, "home").join(" ").includes("It's 3-0."), "up 3-0 at home reads 3-0");
  assert.ok(describeEvent(rbi, "away").join(" ").includes("It's 0-3."), "and 0-3 from the road dugout");
});

test("the game log lines carry player-perspective WPA", async () => {
  const { gameLogLine } = await import("../src/adventure/ui/statsScreens.js");
  const swing = { inning: 3, half: "top", batter: "Al Smith", pitcher: "Bo Diaz", result: "HR", runs: 2, scoreAfter: { away: 3, home: 1 }, wpa: 0.18 };
  const yours = gameLogLine(swing, "away");
  assert.ok(yours.includes("T3"), "inning tag");
  assert.ok(yours.includes("A.SMITH"), "batter");
  assert.ok(yours.includes("+18%"), "your swing reads positive");
  assert.ok(yours.includes("<b>3-1</b>"), "scoring plays show the score bold");
  const quiet = gameLogLine({ ...swing, runs: 0, result: "GB", scoreAfter: { away: 1, home: 1 } }, "away");
  assert.ok(quiet.includes("1-1"), "every row carries the score");
  const theirs = gameLogLine({ ...swing, half: "bottom" }, "away");
  assert.ok(theirs.includes("-18%"), "their swing reads negative");
  const atHome = gameLogLine(swing, "home");
  assert.ok(atHome.includes("1-3"), "the score flips to read from the home player's side");
  const pen = gameLogLine({ type: "pitching-change", inning: 5, half: "bottom", team: "Them Club", pitcher: "Cy Muller" }, "away");
  assert.ok(pen.includes("PEN"), "pitching changes log without WPA");

  // Rows carry the base-out situation the play happened in: "1o 1-3" reads
  // one out, runners on first and third.
  const situated = gameLogLine({ ...swing, outsBefore: 1, basesBefore: ["A Runner", null, "C Runner"] }, "away");
  assert.ok(situated.includes("1o 1-3"), "outs and bases show before the actor");
  const empty = gameLogLine({ ...swing, outsBefore: 0, basesBefore: [null, null, null] }, "away");
  assert.ok(empty.includes("0o ---"), "empty bases read ---");
  assert.ok(!gameLogLine(swing, "away").includes("o "), "rows without a snapshot stay clean");
});

// ---- Real-card leagues -------------------------------------------------------

test("every league builds a working universe with a legal starter pack", async () => {
  const { UNIVERSES, DECADES, FRANCHISES, universeConfig } = await import("../src/adventure/packs.js");
  const { resolveChart } = await import("../src/rules/cards.js");
  const expectedSizes = { classic: 3544 };
  try {
    assert.ok(DECADES.length >= 12 && DECADES.includes(1910) && DECADES.includes(2020), "decades run 1910s-2020s");
    assert.equal(FRANCHISES.length, 30, "all thirty active franchises");
    assert.equal(universeConfig("mlb-2000s")?.key, "decade-2000", "legacy 2000s saves alias to the decade");
    assert.equal(universeConfig("decade-1870"), null, "pre-bullpen decades are not offered");
    const sampled = [...Object.keys(UNIVERSES), "decade-1930", "decade-1970", "franchise-SEA", "franchise-NYY"];
    for (const key of sampled) {
      setUniverseSeed("league-test", key);
      const pool = adventurePool();
      assert.ok(pool.length >= 200, `${key} pool is deep enough (${pool.length})`);
      if (expectedSizes[key]) assert.equal(pool.length, expectedSizes[key], `${key} pool size`);
      for (const tier of ["common", "uncommon", "rare", "legend"]) {
        assert.ok(pool.some((card) => card.rarity === tier), `${key} has ${tier}s`);
      }
      const roster = starterPack("league-test");
      assert.equal(roster.length, 13, `${key} starter pack fills`);
      assert.equal(validateRoster({ roster }).length, 0, `${key} starter pack is legal`);
      assert.equal(roster.filter((card) => card.rarity === "rare").length, 2, `${key} starter has two rares`);
      // Every real chart must resolve every d20 roll.
      for (const card of pool.slice(0, 250)) {
        for (let roll = 1; roll <= 20; roll += 1) {
          assert.ok(resolveChart(card.chart, roll), `${key} ${card.id} resolves a ${roll}`);
        }
      }
    }
    setUniverseSeed("league-test", "classic");
    const classic = adventurePool();
    assert.ok(classic.every((card) => card.points === card.truePoints), "classic points are authentic — no noise");
    assert.ok(classic.every((card) => card.real && card.setTag), "classic cards carry their set tag");
    assert.ok(classic.every((card) => /'\d\d/.test(card.name)), "the card year rides with the name");
    assert.ok(classic.some((card) => card.foil), "foil printings are flagged");
    const openEnded = classic.find((card) => card.chart.some((row) => !Number.isFinite(row.to)));
    assert.ok(openEnded, "open-ended chart rows survive as printed");
    const { formatRange } = await import("../src/rules/cards.js");
    const openRow = openEnded.chart.find((row) => !Number.isFinite(row.to));
    assert.equal(formatRange(openRow), `${openRow.from}+`, "and format like the card, e.g. 21+");
    setUniverseSeed("league-test", "mlb-history");
    const history = adventurePool();
    assert.ok(history.some((card) => card.points !== card.truePoints), "MLB league keeps the bargain noise");
    assert.ok(history.some((card) => card.name === "Babe Ruth"), "the Babe is in the all-time pool");
    assert.ok(history.length > 9000, "the wide swath: thousands of players, not just stars");
    setUniverseSeed("league-test", "decade-1990");
    const nineties = adventurePool();
    assert.ok(
      nineties.every((card) => {
        const match = /^(\d{4})-(\d{4})$/.exec(card.setTag);
        return match && Number(match[1]) >= 1990 && Number(match[2]) <= 1999;
      }),
      "decade cards pool the whole decade, all teams, clipped to the window"
    );
    setUniverseSeed("league-test", "franchise-SEA");
    const mariners = adventurePool();
    const junior = mariners.find((card) => card.name === "Ken Griffey Jr.");
    assert.equal(junior?.setTag, "1989-2010", "franchise cards span the whole career with the club, decades be damned");
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("MLB pools price on the authentic Showdown scale", async () => {
  const { authenticPoints } = await import("../src/rules/pricing.js");
  const { PRICE_MODEL } = await import("../src/data/priceModel.js");
  const { decodeCardRows } = await import("../src/data/realCards.js");
  const { CLASSIC_CARD_ROWS } = await import("../src/data/classicCards.js");
  try {
    // The model reproduces the real printed points it was fit against. The
    // fit balances by on-base bucket (601 OB-9 commons don't outvote the one
    // Bonds), so the honest yardsticks are a loose unweighted MAE plus a
    // tight one on the star end the balancing exists to protect.
    const classics = decodeCardRows(CLASSIC_CARD_ROWS);
    const err = (card) => Math.abs(authenticPoints(card, PRICE_MODEL) - card.points);
    const mae = classics.reduce((sum, card) => sum + err(card), 0) / classics.length;
    assert.ok(mae < 70, `classic-set MAE stays sane (${mae.toFixed(1)})`);
    const stars = classics.filter((card) => card.points >= 500);
    const starMae = stars.reduce((sum, card) => sum + err(card), 0) / stars.length;
    assert.ok(starMae < 80, `the 500+ point stars price true (${starMae.toFixed(1)} over ${stars.length} cards)`);
    const wakefield = classics.find((card) => card.name === "Tim Wakefield '03");
    assert.ok(Math.abs(authenticPoints(wakefield, PRICE_MODEL) - wakefield.points) < 100,
      "a C5 IP5 starter prices like the real Wakefield printing");

    // Same mechanics cost the same in any pool: no more 70-point Ohtani arms
    // in deep pools. Honest stickers (no noise) to compare scales directly.
    setUniverseSeed("price-scale", "mlb-history", { priceNoise: false });
    const arm = cardById("mlb-all-ohtansh01");
    assert.ok(arm.truePoints >= 200, `a C5 IP5 modern arm prices on the real scale, not the pool-rank floor (${arm.truePoints})`);
    const top = Math.max(...adventurePool().map((card) => card.points));
    assert.ok(top >= 700 && top <= 1000, `all-time legends price like real legend printings (${top})`);
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("simultaneous two-way players bundle: one owned card, both halves", async () => {
  const { dualPartnerId, dualPrimaryId } = await import("../src/adventure/packs.js");
  const { MLB_DUAL_PERSONS } = await import("../src/data/mlbPools.js");
  const { binderRows, catalogRows } = await import("../src/adventure/ui/collectionScreens.js");
  const { personConflict } = await import("../src/rules/cards.js");
  setUniverseSeed("dual-test", "mlb-history");
  try {
    // The strict Ohtani-likes merge; converts and part-timers don't.
    assert.ok(MLB_DUAL_PERSONS.includes("ohtansh01"), "Ohtani merges");
    assert.ok(MLB_DUAL_PERSONS.includes("dihigma99"), "Dihigo merges");
    assert.equal(dualPartnerId("mlb-all-ankieri01"), null, "Ankiel converted sequentially — two separate cards");
    assert.equal(dualPartnerId("mlb-all-ruthba01"), null, "Ruth's overlap was part-time — two separate cards");

    const arm = cardById("mlb-all-ohtansh01");
    const bat = cardById("mlb-all-ohtansh01-bat");
    assert.ok(arm && bat, "both Ohtani halves are in the pool");
    assert.equal(dualPartnerId(arm.id), bat.id, "the halves know each other");
    assert.equal(dualPrimaryId(arm.id), dualPrimaryId(bat.id), "one primary face for the pair");

    // Acquiring either half grants the pair; removal takes the pair.
    const save = { collection: {}, roster: { cardIds: [] } };
    addCardToCollection(save, arm.id);
    assert.equal(ownedCount(save, arm.id), 1, "the arm arrives");
    assert.equal(ownedCount(save, bat.id), 1, "the bat arrives with it");
    assert.ok(removeCardFromCollection(save, arm.id), "the pair sells");
    assert.equal(ownedCount(save, arm.id) + ownedCount(save, bat.id), 0, "both halves gone");

    // Either half's roster copy protects the pair from sale.
    addCardToCollection(save, bat.id);
    save.roster.cardIds = [arm.id];
    assert.equal(removeCardFromCollection(save, bat.id), false, "rostered arm locks the bat too");
    save.roster.cardIds = [];

    // Browse surfaces show one combined entry answering to both slots.
    addCardToCollection(save, arm.id);
    const owned = binderRows(save, "ALL").filter(({ card }) => card.name === "Shohei Ohtani");
    assert.equal(owned.length, 1, "the binder shows one Ohtani");
    assert.ok(binderRows(save, "SP").some(({ card }) => card.name === "Shohei Ohtani"), "he pages under SP");
    assert.ok(binderRows(save, "DH").some(({ card }) => card.name === "Shohei Ohtani"), "and under DH");
    const catalog = catalogRows("ALL").filter((card) => card.name === "Shohei Ohtani");
    assert.equal(catalog.length, 1, "the catalog lists the pair once");

    // Both halves still roster together — that's the two-slot cost — and
    // the pairing is legal under the era rule.
    assert.equal(personConflict([bat], arm), null, "bat and arm share a team");
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("one era of a player per roster: 1990s and 2000s Bonds never share a team", async () => {
  const { canPickPlayer, createDraft, duplicateEraPeople } = await import("../src/rules/draft.js");
  const { personConflict, playerIdentity } = await import("../src/rules/cards.js");
  const { benchCards } = await import("../src/adventure/ui/collectionScreens.js");
  setUniverseSeed("era-rule", "decades-1910,1920,1990,2000");
  try {
    const pool = adventurePool();
    const bonds90 = cardById("mlb-d1990-bondsba01");
    const bonds00 = cardById("mlb-00s-bondsba01");
    assert.ok(bonds90 && bonds00, "both Bonds eras are in the pool");
    assert.equal(playerIdentity(bonds90.id).person, playerIdentity(bonds00.id).person, "same human");

    // The rules layer flags the pair and drafts refuse the second pick.
    const issues = validateRoster({ roster: [bonds90, bonds00], lineupAssignments: {} });
    assert.ok(issues.some((issue) => issue.includes("two eras of Barry Bonds")), "validateRoster names the clash");
    const draft = createDraft(["Era"], pool, 13, "era-rule");
    draft.managers[0].roster.push(bonds90);
    draft.pickedIds.add(bonds90.id);
    const refusal = canPickPlayer(draft, draft.managers[0], bonds00);
    assert.equal(refusal.ok, false, "the draft refuses the second era");
    assert.match(refusal.reason, /already has Barry Bonds/);

    // A two-way player's bat and arm halves share a slice: the legal pairing.
    const bat = pool.find((card) => card.id.endsWith("-bat"));
    const arm = cardById(bat.id.slice(0, -4));
    assert.ok(arm, "the arm half exists");
    assert.equal(duplicateEraPeople([bat, arm]).length, 0, "same-era halves are no clash");
    assert.equal(personConflict([bat], arm), null);

    // Sealed products and NPC squads obey the rule from birth.
    for (const seed of ["a", "b", "c", "d", "e"]) {
      assert.equal(duplicateEraPeople(starterPack(`era-rule-${seed}`)).length, 0, `starter pack ${seed} is era-clean`);
    }
    for (const trainer of TRAINERS.slice(0, 6)) {
      assert.equal(duplicateEraPeople(buildNpcTeam(trainer).roster).length, 0, `${trainer.id} fields one era per player`);
    }

    // The roster editor's bench hides the other era — unless the swap target
    // IS the other era, which is exactly how you change decades.
    const save = createSave({ name: "ERA", saveSeed: "era-rule", universe: "decades-1910,1920,1990,2000" });
    const dealt = starterPack("era-rule-bench").filter((card) => card.id !== bonds90.id && card.id !== bonds00.id);
    const outfielder = dealt.find((card) => card.kind === "hitter" && card.position === "LF/RF");
    const rosterIds = dealt.map((card) => (card.id === outfielder.id ? bonds90.id : card.id));
    for (const id of [...rosterIds, bonds00.id]) addCardToCollection(save, id);
    setRoster(save, rosterIds);
    const otherHitter = rosterCards(save).find((card) => card.kind === "hitter" && card.id !== bonds90.id);
    assert.ok(!benchCards(save, otherHitter, "all").some((card) => card.id === bonds00.id), "the other era never lists for a different slot");
    assert.ok(benchCards(save, bonds90, "position").some((card) => card.id === bonds00.id), "swapping Bonds for Bonds stays on the menu");
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("MLB charts mirror real hit mixes: slap hitters slap, sluggers slug", () => {
  const slots = (card, result) => card.chart
    .filter((row) => row.result === result)
    .reduce((sum, row) => sum + Math.min(row.to, 20) - row.from + 1, 0);
  try {
    setUniverseSeed("mix-test", "franchise-SEA");
    const cruz = adventurePool().find((card) => card.name === "Julio Cruz");
    assert.ok(cruz, "Julio Cruz plays for the all-time Mariners");
    assert.equal(slots(cruz, "HR"), 0, "a 0.5% HR/PA hitter gets no homer slots");
    assert.ok(slots(cruz, "1B") >= 4 && slots(cruz, "2B") <= 1, "what hits he has are singles");
    // Swingmen: relief innings don't inflate a starter's IP.
    const swingman = adventurePool().find((card) => card.name === "Ryan Rowland-Smith");
    assert.ok(swingman.ip <= 6, `swingman IP reflects innings per start (${swingman.ip})`);
    const workhorse = adventurePool().find((card) => card.name === "Randy Johnson");
    assert.ok(workhorse.ip >= 7, "true workhorses keep their deep tanks");
    setUniverseSeed("mix-test", "mlb-history");
    const pool = adventurePool();
    // At OB 16 Ruth owns ~65% of his rolls, so even 2 HR slots reproduce his
    // 6.9% HR/PA — the advantage carries the power, not raw slot count.
    const ruth = pool.find((card) => card.name === "Babe Ruth");
    assert.ok(slots(ruth, "HR") >= 2 && ruth.onBase >= 14, "the Babe still slugs");
    // Defense and speed come from real records now.
    const ozzie = pool.find((card) => card.name === "Ozzie Smith");
    const pudge = pool.find((card) => card.name === "Ivan Rodriguez");
    const rickey = pool.find((card) => card.name === "Rickey Henderson");
    const dunn = pool.find((card) => card.name === "Adam Dunn");
    assert.ok(ozzie.fielding >= 4, "the Wizard tops the shortstop band");
    assert.ok(pudge.fielding >= 8, "Pudge's arm is the real steal deterrent");
    assert.ok(rickey.speed >= 20, "Rickey flies");
    assert.ok(dunn.fielding <= 1, "the metrics remember Adam Dunn's glove");
    // Speed is era-normalized: 1890s scorekeeping (steals credited for extra
    // bases, dead-ball triples) no longer pins the scale, and modern burners
    // rate fast against their own league.
    const slidingBilly = pool.find((card) => card.name === "Billy Hamilton");
    const rebootBilly = pool.find((card) => card.name === "Billy Hamilton '13");
    const ichiro = pool.find((card) => card.name === "Ichiro Suzuki");
    assert.ok(slidingBilly.speed <= 24, `1890s Hamilton is fast for his day, not scale-breaking (${slidingBilly.speed})`);
    assert.ok(rebootBilly.speed >= 26, `the modern Billy Hamilton is the burner (${rebootBilly.speed})`);
    assert.ok(rebootBilly.speed > slidingBilly.speed, "eras rank sanely against each other");
    assert.ok(ichiro.speed >= 16, `Ichiro still rates a burner (${ichiro.speed})`);
    // Under league-backout math a chart only carries a player's surplus over
    // what pitcher charts already concede, so the worst hitters legitimately
    // show empty hit columns — but the pool at large must stay singles-rich.
    const poolHitters = pool.filter((card) => card.kind === "hitter");
    const withSingles = poolHitters.filter((card) => slots(card, "1B") > 0);
    assert.ok(withSingles.length / poolHitters.length > 0.9, "the vast majority of hitters keep singles slots");
    const meanSingles = poolHitters.reduce((sum, card) => sum + slots(card, "1B"), 0) / poolHitters.length;
    assert.ok(meanSingles >= 2.5, `charts stay singles-rich on average (${meanSingles.toFixed(1)})`);
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("simulated matchups reproduce real season rates within tolerance", () => {
  // Analytic expectation of each batter vs the whole decade pitcher pool,
  // checked against the players' real 2000-2009 lines from the databank.
  const share = (chart, result) => chart
    .filter((row) => row.result === result)
    .reduce((sum, row) => sum + Math.min(row.to, 20) - row.from + 1, 0) / 20;
  const onBaseShare = (chart) => ["BB", "1B", "2B", "3B", "HR"].reduce((sum, e) => sum + share(chart, e), 0);
  try {
    setUniverseSeed("replay-test", "decade-2000");
    const pool = adventurePool();
    const arms = pool.filter((card) => card.kind === "pitcher");
    const expectVs = (bat) => {
      let obp = 0, hr = 0;
      for (const arm of arms) {
        const A = Math.min(Math.max((bat.onBase - arm.control) / 20, 0), 1);
        obp += A * onBaseShare(bat.chart) + (1 - A) * onBaseShare(arm.chart);
        hr += A * share(bat.chart, "HR") + (1 - A) * share(arm.chart, "HR");
      }
      return { obp: obp / arms.length, hr: hr / arms.length };
    };
    // Steady careers: peak weighting barely moves flat season-to-season
    // rates, so the card still reproduces the real decade aggregate.
    const steadyLines = [
      ["Jose Vizcaino", 0.315, 0.008],
      ["Mark Grace", 0.372, 0.022]
    ];
    for (const [name, realObp, realHr] of steadyLines) {
      const bat = pool.find((card) => card.name === name);
      assert.ok(bat, `${name} is in the 2000s pool`);
      const sim = expectVs(bat);
      assert.ok(Math.abs(sim.obp - realObp) < 0.025, `${name} OBP ${sim.obp.toFixed(3)} ≈ real ${realObp}`);
      assert.ok(Math.abs(sim.hr - realHr) < 0.01, `${name} HR/PA ${(sim.hr * 100).toFixed(1)}% ≈ real ${(realHr * 100).toFixed(1)}%`);
    }
    // Peaked careers skew toward the prime by design: Hafner's card should
    // beat his decade aggregate (.378 OBP) but stay under his best season
    // (.439 in 2006) — peak-weighted, not best-season-cherry-picked.
    const hafner = pool.find((card) => card.name === "Travis Hafner");
    assert.ok(hafner, "Travis Hafner is in the 2000s pool");
    const sim = expectVs(hafner);
    assert.ok(sim.obp > 0.378 && sim.obp < 0.439, `Hafner OBP ${sim.obp.toFixed(3)} sits between aggregate and peak`);
    // HR rides 5%-wide chart slots, so peak lift can round away — fidelity only.
    assert.ok(Math.abs(sim.hr - 0.049) < 0.01, `Hafner HR/PA ${(sim.hr * 100).toFixed(1)}% ≈ real 4.9%`);
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("the catalog marks owned cards with * and roster cards with a dot", async () => {
  const { catalogScreen, catalogRows } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const rows = catalogRows("ALL");
  const rosterAt = rows.findIndex((card) => save.roster.cardIds.includes(card.id));
  const app = { save, screen: { name: "catalog", index: rosterAt, filter: "ALL" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  const html = catalogScreen.render(app);
  assert.ok(html.includes("*x1"), "owned cards read *xN");
  assert.ok(html.includes("*x1</span> &#9679;"), "roster cards add the dot");
  assert.ok(html.includes("* = owned") && html.includes("&#9679; = on roster"), "the legend explains both");
  // An unowned card in view shows neither marker.
  const unownedAt = rows.findIndex((card, at) => Math.abs(at - rosterAt) < 12 && !save.collection[card.id]);
  assert.ok(unownedAt >= 0, "an unowned card is in the window");
});

test("the shop catalog lists the whole universe, best first", async () => {
  const { catalogRows } = await import("../src/adventure/ui/collectionScreens.js");
  const all = catalogRows("ALL");
  assert.equal(all.length, adventurePool().length, "every card in the league shows");
  for (let i = 1; i < Math.min(all.length, 200); i += 1) {
    assert.ok(all[i - 1].points >= all[i].points, "sorted by printed points, best first");
  }
  const catchers = catalogRows("C");
  assert.ok(catchers.length > 0 && catchers.every((card) => card.position === "C"), "position paging filters");
  const arms = catalogRows("SP");
  assert.ok(arms.every((card) => card.role === "SP"));
});

test("the binder pages by position with the arrow filters", async () => {
  const { binderRows, BINDER_FILTERS } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const all = binderRows(save, "ALL");
  assert.equal(all.length, collectionCardCount(save), "ALL shows the whole binder");
  const catchers = binderRows(save, "C");
  assert.ok(catchers.length >= 1, "the starter catcher shows under C");
  assert.ok(catchers.every(({ card }) => card.position === "C"));
  const starters = binderRows(save, "SP");
  assert.ok(starters.length >= 2, "both starter arms show under SP");
  assert.ok(starters.every(({ card }) => card.role === "SP"));
  assert.ok(BINDER_FILTERS.includes("LF/RF") && BINDER_FILTERS[0] === "ALL");
});

function collectionCardCount(save) {
  return Object.keys(save.collection).length;
}

test("type-to-search narrows binder and catalog by name; X clears before leaving", async () => {
  const { applyQuery, binderScreen, catalogScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const target = cardById(save.roster.cardIds[0]);
  const fragment = target.name.split(" ")[1].slice(0, 3);

  const filtered = applyQuery(adventurePool(), fragment, (card) => card.name);
  assert.ok(filtered.length > 0, "the query matches");
  assert.ok(filtered.every((card) => card.name.toUpperCase().includes(fragment.toUpperCase())));
  assert.equal(applyQuery(adventurePool(), "", (card) => card.name).length, adventurePool().length, "empty query shows all");

  const app = { save, screen: { name: "binder", index: 5, filter: "ALL" }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };
  for (const char of fragment) binderScreen.typed(app, char);
  assert.equal(app.screen.query ?? "", "", "letters are inert until F opens search");
  binderScreen.typed(app, "f");
  assert.equal(app.screen.searching, true, "F opens search");
  for (const char of fragment) binderScreen.typed(app, char);
  assert.equal(app.screen.query, fragment, "typed letters build the query");
  assert.equal(app.screen.index, 0, "the cursor resets to the top match");
  binderScreen.typed(app, "\b");
  assert.equal(app.screen.query, fragment.slice(0, -1), "backspace edits the query");
  binderScreen.key(app, "a");
  assert.equal(app.screen.searching, false, "ENTER closes the search, keeping the filter");
  assert.equal(app.screen.query, fragment.slice(0, -1));
  binderScreen.key(app, "b");
  assert.equal(app.screen.query, "", "X clears the query first");
  assert.equal(app.screen.name, "binder", "without leaving the binder");
  binderScreen.key(app, "b");
  assert.equal(app.screen.name, "map", "a second X leaves");

  const catalogApp = { save, screen: { name: "catalog", index: 0, filter: "ALL" }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };
  catalogScreen.typed(catalogApp, "f");
  for (const char of fragment) catalogScreen.typed(catalogApp, char);
  const html = catalogScreen.render(catalogApp);
  assert.ok(html.includes(`SEARCH: <b>${fragment}</b>`), "the query shows on screen");
});

test("the binder's S key quick-sells a copy, never the roster's last", async () => {
  const { binderScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const spare = adventurePool().find((card) => !save.roster.cardIds.includes(card.id));
  addCardToCollection(save, spare.id, 2);
  const app = { save, screen: { name: "binder", index: 0, filter: "ALL" }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };

  const rows = collectionCards(save);
  app.screen.index = rows.findIndex(({ card }) => card.id === spare.id);
  const before = save.player.coins;
  binderScreen.typed(app, "s");
  assert.equal(app.screen.confirmSell, spare.id, "the first S arms the are-you-sure");
  assert.equal(ownedCount(save, spare.id), 2, "nothing sold yet");
  assert.ok(binderScreen.render(app).includes("S again sells"), "the confirm asks out loud");
  binderScreen.key(app, "down");
  assert.equal(app.screen.confirmSell, null, "any other key keeps him");
  assert.equal(ownedCount(save, spare.id), 2, "still nothing sold");
  binderScreen.key(app, "up");
  binderScreen.typed(app, "s");
  binderScreen.typed(app, "s");
  assert.equal(ownedCount(save, spare.id), 1, "S twice sells one copy");
  assert.equal(save.player.coins, before + RARITIES[spare.rarity].sellValue, "at the pawn rate");
  assert.ok(binderScreen.render(app).includes("SOLD"), "the sale is announced");

  // The roster's last copy refuses, with a notice instead of a sale.
  const rosterRowsNow = collectionCards(save);
  app.screen.index = rosterRowsNow.findIndex(({ card }) => card.id === save.roster.cardIds[0]);
  const coinsBefore = save.player.coins;
  binderScreen.typed(app, "s");
  assert.equal(ownedCount(save, save.roster.cardIds[0]), 1, "the roster copy survives");
  assert.equal(save.player.coins, coinsBefore, "no coins change hands");
  assert.ok(binderScreen.render(app).includes("NOT FOR SALE"), "and the refusal is explained");

  // While searching, S is just a letter.
  binderScreen.typed(app, "f");
  binderScreen.typed(app, "s");
  assert.equal(app.screen.query, "s", "searching swallows the S");
});

test("compare mode pins two cards from the binder and lays them side by side", async () => {
  const { binderScreen, compareScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const rows = collectionCards(save);
  const app = { save, screen: { name: "binder", index: 0, filter: "ALL" }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };
  binderScreen.typed(app, "c");
  assert.equal(app.screen.pinnedId, rows[0].card.id, "C pins the selected card");
  assert.ok(binderScreen.render(app).includes("PINNED"), "the pin is announced");
  binderScreen.typed(app, "c");
  assert.equal(app.screen.pinnedId, null, "C on the same card unpins");
  binderScreen.typed(app, "c");
  binderScreen.key(app, "down");
  binderScreen.typed(app, "c");
  assert.equal(app.screen.name, "compare", "a second pin opens the compare screen");
  assert.equal(app.screen.aId, rows[0].card.id);
  assert.equal(app.screen.bId, rows[1].card.id);
  const html = compareScreen.render(app);
  for (const row of rows.slice(0, 2)) {
    assert.ok(html.includes(row.card.name.toUpperCase()), `${row.card.name} is on the mat`);
  }
  compareScreen.key(app, "b");
  assert.equal(app.screen.name, "binder", "X returns to the binder");
  assert.equal(app.screen.pinnedId, null, "with the pin released");
  assert.equal(app.screen.index, 1, "and the cursor where it was");
});

test("finished games write the almanac and rare feats fill the trophy room", async () => {
  const { recordFinishedGame } = await import("../src/adventure/ui/battleScreen.js");
  const { ensureAlmanac, ensureTrophies } = await import("../src/adventure/state.js");
  const { almanacScreen, trophyScreen } = await import("../src/adventure/ui/statsScreens.js");
  const save = testSave();
  const trainer = trainerById("scout-jojo");
  const { player, npc } = hookTeams();
  const result = simulateGame(buildTeam(player), buildTeam(npc), "almanac-g1");
  recordGameStats(save, result.boxScore.away);
  const won = result.boxScore.away.runs > result.boxScore.home.runs;
  recordFinishedGame(save, {
    trainer,
    boxScore: result.boxScore,
    playerSide: "away",
    events: result.events,
    score: { away: result.boxScore.away.runs ?? result.away.runs, home: result.boxScore.home.runs ?? result.home.runs },
    innings: result.innings,
    won
  });

  const almanac = ensureAlmanac(save);
  assert.equal(almanac.length, 1, "one game, one page of history");
  const entry = almanac[0];
  assert.equal(entry.day, 1, "the season game count is the day");
  assert.equal(entry.opponent, trainer.name);
  assert.equal(entry.won, won);
  assert.ok(entry.boxScore.away.hitters.length >= 9, "the full box score rides along");

  // A hand-built miracle proves feats persist as trophies with day and hero.
  const bat = (id, over = {}) => ({ id, name: `Batter ${id}`, pa: 4, ab: 4, h: 1, d: 0, t: 0, hr: 0, r: 0, bb: 0, so: 0, sb: 0, cs: 0, rbi: 0, wpa: 0, ...over });
  const cycleBox = {
    away: {
      runs: 5,
      hitters: [bat("hero", { h: 4, d: 1, t: 1, hr: 1 }), ...Array.from({ length: 8 }, (_, i) => bat(`h${i}`))],
      pitchers: [{ id: "arm", name: "Arm", bf: 30, outs: 27, h: 5, bb: 1, so: 6, hr: 0, r: 0, wpa: 0 }]
    },
    home: { runs: 0, hitters: [bat("t1"), bat("t2")], pitchers: [{ id: "them", name: "Them", bf: 30, outs: 27, h: 9, bb: 1, so: 3, hr: 1, r: 5, wpa: 0 }] }
  };
  recordGameStats(save, cycleBox.away);
  const feats = recordFinishedGame(save, {
    trainer, boxScore: cycleBox, playerSide: "away", events: [], score: { away: 5, home: 0 }, innings: 9, won: true
  });
  assert.ok(feats.some((feat) => feat.title.includes("CYCLE")), "the cycle fires");
  const trophies = ensureTrophies(save);
  assert.ok(trophies.length >= feats.length, "every feat is framed");
  const cycleTrophy = trophies.find((trophy) => trophy.title.includes("CYCLE"));
  assert.equal(cycleTrophy.day, 2, "the plaque carries the day");
  assert.equal(cycleTrophy.cardId, "hero", "and the hero's card");
  assert.equal(cycleTrophy.opponent, trainer.name);

  // The almanac screen lists newest first and reopens the box score.
  const app = { save, screen: { name: "almanac", index: 0 }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };
  const listHtml = almanacScreen.render(app);
  assert.ok(listHtml.includes("2 GAMES"));
  assert.ok(listHtml.indexOf("DAY 2") < listHtml.indexOf("DAY 1"), "newest game on top");
  almanacScreen.key(app, "a");
  assert.equal(app.screen.name, "gameStats", "Z reopens the game");
  assert.deepEqual(app.screen.next, { name: "almanac", data: { index: 0 } }, "and the box score routes back");
  assert.ok(app.screen.feats.some((feat) => feat.title.includes("CYCLE")), "with its feats");

  const trophyApp = { save, screen: { name: "trophies", index: 0 }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };
  const caseHtml = trophyScreen.render(trophyApp);
  assert.ok(caseHtml.includes("CYCLE"), "the case shows the plaque");
  assert.ok(caseHtml.includes("DAY 2"), "with its date");
});

test("high-leverage plate appearances pause on the d20 before revealing", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { isDramaticMoment } = await import("../src/adventure/battle/controller.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "drama-seed" });
  const state = battle.state;

  assert.equal(isDramaticMoment(state), false, "top 1, nobody on: no drama");
  state.outs = 2;
  state.bases = [{ id: "r1", name: "A", speed: 10 }, { id: "r2", name: "B", speed: 10 }, { id: "r3", name: "C", speed: 10 }];
  assert.equal(isDramaticMoment(state), true, "two outs, bases loaded: drama");
  state.bases = [null, null, null];
  state.outs = 0;
  state.inning = 9;
  state.score = { away: 1, home: 2 };
  assert.equal(isDramaticMoment(state), true, "trailing by one in the 9th: drama");
  state.score = { away: 2, home: 2 };
  assert.equal(isDramaticMoment(state), true, "tied in the 9th: drama");
  state.score = { away: 9, home: 1 };
  assert.equal(isDramaticMoment(state), false, "a 9th-inning blowout stays quick");
  // The batting team piling onto a losing arm is mop-up, not drama...
  state.score = { away: 3, home: 2 };
  assert.equal(isDramaticMoment(state), false, "the pitching team losing in the 9th: no spotlight");
  // ...unless the bases are loaded under him.
  state.bases = [{ id: "r1", name: "A", speed: 10 }, { id: "r2", name: "B", speed: 10 }, { id: "r3", name: "C", speed: 10 }];
  assert.equal(isDramaticMoment(state), true, "bases loaded brings the lights back");
  state.bases = [null, null, null];

  state.score = { away: 1, home: 2 };
  const app = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle, mode: "menu", menuIndex: 0, lines: [] }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };
  const eventsBefore = battle.events.length;
  battleScreen.key(app, "a"); // SWING AWAY
  assert.equal(app.screen.mode, "drama", "the swing lands in drama mode");
  assert.ok(battle.events.length > eventsBefore, "the engine already rolled");
  const stages = app.screen.drama.stages;
  assert.deepEqual(stages.map((stage) => stage.label), ["PITCH", "SWING"], "both halves of the duel stage");
  for (const stage of stages) {
    assert.ok(stage.roll >= 1 && stage.roll <= 20, `${stage.label} is a real d20 roll`);
  }
  assert.match(stages[0].caption, /VS OB \d+ — (PITCHER|BATTER)'S CHART/, "the pitch die carries its verdict");
  const last = battle.events[battle.events.length - 1];
  assert.equal(stages[0].roll, last.controlRoll, "the pitch die lands on the pitcher's real roll");
  assert.equal(stages[1].roll, last.resultRoll, "the swing die lands on the batter's real roll");
  const html = battleScreen.render(app);
  assert.equal((html.match(/gq-die-stage/g) ?? []).length, 2, "two dice on screen");
  assert.ok(html.includes("PITCH") && html.includes("SWING"), "each die is labeled");
  assert.ok(!html.includes("gq-battle-hud"), "the HUD hides so the score can't spoil it");
  battleScreen.key(app, "a"); // skip the suspense
  assert.notEqual(app.screen.mode, "drama", "Z reveals immediately");
  assert.equal(app.screen.drama, null, "the staged roll is consumed");
});

// ---- Easter eggs -------------------------------------------------------------

test("rare feats fire for the games worth framing", async () => {
  const { gameFeats } = await import("../src/adventure/feats.js");
  const bat = (over = {}) => ({ id: "h1", name: "Ace Batter", pa: 4, ab: 4, h: 0, d: 0, t: 0, hr: 0, r: 0, bb: 0, so: 0, sb: 0, cs: 0, rbi: 0, ...over });
  const arm = (over = {}) => ({ id: "p1", name: "Big Arm", bf: 27, outs: 27, h: 5, bb: 2, so: 6, hr: 0, r: 0, ...over });
  const nine = (over = {}) => Array.from({ length: 9 }, (_, i) => bat({ id: `h${i}`, name: `Batter ${i}`, ...over }));
  const game = (over = {}) => gameFeats({
    boxScore: { away: { hitters: nine({ h: 1, ab: 4 }), pitchers: [arm()] }, home: { hitters: nine(), pitchers: [arm()] } },
    playerSide: "away",
    events: [],
    score: { away: 3, home: 1 },
    innings: 9,
    ...over
  });
  const titles = (feats) => feats.map((feat) => feat.title).join(" | ");

  const perfect = game({ boxScore: { away: { hitters: nine({ h: 1 }), pitchers: [arm({ h: 0, bb: 0 })] }, home: { hitters: nine(), pitchers: [arm()] } }, score: { away: 1, home: 0 } });
  assert.ok(titles(perfect).includes("PERFECT GAME!"), "perfecto detected");
  assert.ok(!titles(perfect).includes("NO-HITTER"), "a perfect game outranks its lesser cousins");

  const nono = game({ boxScore: { away: { hitters: nine({ h: 1 }), pitchers: [arm({ h: 0, bb: 3 })] }, home: { hitters: nine(), pitchers: [arm()] } }, score: { away: 2, home: 0 } });
  assert.ok(titles(nono).includes("NO-HITTER!"));
  assert.ok(!titles(nono).includes("SHUTOUT"), "no-hitter suppresses the shutout line");

  const slugger = bat({ h: 4, hr: 4, rbi: 10, ab: 5 });
  const bigDay = game({ boxScore: { away: { hitters: [slugger, ...nine().slice(1)], pitchers: [arm()] }, home: { hitters: nine(), pitchers: [arm()] } } });
  assert.ok(titles(bigDay).includes("WENT DEEP 4 TIMES"), "4-homer game");
  assert.ok(titles(bigDay).includes("DROVE IN 10"), "10 RBI");
  assert.equal(bigDay.find((feat) => feat.title.includes("WENT DEEP")).cardId, "h1", "feat links the hero's card");

  const cycleGuy = bat({ h: 4, d: 1, t: 1, hr: 1 });
  assert.ok(titles(game({ boxScore: { away: { hitters: [cycleGuy, ...nine().slice(1)], pitchers: [arm()] }, home: { hitters: nine(), pitchers: [arm()] } } })).includes("CYCLE"), "the cycle");

  const sombrero = bat({ ab: 5, h: 0, so: 5 });
  assert.ok(titles(game({ boxScore: { away: { hitters: [sombrero, ...nine().slice(1)], pitchers: [arm()] }, home: { hitters: nine(), pitchers: [arm()] } } })).includes("PLATINUM SOMBRERO"), "the sombrero is celebrated, sadly");

  assert.ok(titles(game()).includes("SOCIALIST BASEBALL"), "nine hitters, one hit apiece");
  assert.ok(titles(game({ innings: 14 })).includes("FREE BASEBALL: 14 INNINGS"), "marathon");
  assert.ok(titles(game({ score: { away: 18, home: 2 } })).includes("STATEMENT GAME"), "blowout");

  const comebackEvents = [
    { half: "bottom", inning: 3, runs: 6, scoreAfter: { away: 0, home: 6 } },
    { half: "top", inning: 8, runs: 7, scoreAfter: { away: 7, home: 6 } }
  ];
  assert.ok(titles(game({ events: comebackEvents, score: { away: 7, home: 6 } })).includes("DOWN 6, NOT OUT"), "comeback tracked from the deepest hole");

  const snowmanEvents = Array.from({ length: 4 }, () => ({ half: "top", inning: 5, runs: 2, scoreAfter: { away: 8, home: 0 } }));
  assert.ok(titles(game({ events: snowmanEvents, score: { away: 8, home: 0 } })).includes("8-SPOT"), "snowman inning");

  assert.equal(game({ score: { away: 2, home: 4 } }).some((feat) => feat.title.includes("SHUTOUT")), false, "losses do not celebrate the wrong side");
});

test("pack eggs and day whimsy stay rare", async () => {
  const { packEggs, dayWhimsy } = await import("../src/adventure/feats.js");
  const card = (rarity, position, id) => ({ id, rarity, kind: "hitter", position });
  const doubleLegend = [card("legend", "C", "a"), card("legend", "SS", "b"), card("common", "1B", "c"), card("common", "2B", "d"), card("uncommon", "CF", "e")];
  assert.ok(packEggs(doubleLegend, () => 1).some((egg) => egg.includes("HEAVENS")), "two legends celebrated");
  const mono = ["a", "b", "c", "d", "e"].map((id) => card("uncommon", id, id));
  assert.ok(packEggs(mono, () => 1).some((egg) => egg.includes("MONOCHROME")), "single-rarity pack");
  const samePos = ["a", "b", "c", "d", "e"].map((id) => card("common", "C", id));
  assert.ok(packEggs(samePos, () => 1).some((egg) => egg.includes("SCOUT NEEDS GLASSES")), "five of one slot");
  assert.ok(packEggs(doubleLegend, () => 3).some((egg) => egg.includes("VU")), "all-duplicates pack");
  const ordinary = [card("common", "C", "a"), card("common", "1B", "b"), card("common", "2B", "c"), card("uncommon", "SS", "d"), card("rare", "CF", "e")];
  assert.equal(packEggs(ordinary, (id) => (id === "a" ? 2 : 1)).length, 0, "ordinary packs stay quiet");

  assert.ok(dayWhimsy(42).includes("ANSWER"), "day 42");
  assert.ok(dayWhimsy(162).includes("162"), "day 162");
  assert.equal(dayWhimsy(41), null, "ordinary days stay quiet");
});

test("cards with a real Showdown scan show it in place of the headshot", async () => {
  const { cardPanelHtml } = await import("../src/adventure/ui/helpers.js");
  const { CARD_IMAGE_FILES } = await import("../src/data/cardImages.js");
  const card = adventurePool()[0];
  try {
    CARD_IMAGE_FILES[card.id] = "118-lou-brock-mlb-2004-trading-deadline.jpg";
    const html = cardPanelHtml(card);
    assert.ok(html.includes('class="gq-card-scan"'), "the scan renders");
    assert.ok(html.includes("assets/cards/118-lou-brock-mlb-2004-trading-deadline.jpg"), "from assets/cards");
    assert.ok(!html.includes("gq-card-headshot"), "and replaces the headshot slot");
  } finally {
    delete CARD_IMAGE_FILES[card.id];
  }
  assert.ok(!cardPanelHtml(card).includes("gq-card-scan"), "no scan, no img");
});

test("pixel portraits are deterministic, era-styled, and cards carry their era", async () => {
  const { pixelPortraitSvg } = await import("../src/adventure/photos.js");
  const { eraYear } = await import("../src/adventure/ui/helpers.js");
  const a = pixelPortraitSvg("Bid McPhee", 1882);
  assert.equal(a, pixelPortraitSvg("Bid McPhee", 1882), "same name, same face");
  assert.notEqual(a, pixelPortraitSvg("Sam Thompson", 1885), "different name, different face");
  assert.ok(a.startsWith("<svg"), "portraits are inline SVG");
  assert.ok(a.includes("#0f380f"), "drawn in the DMG palette");
  // A spread of names in each era: vintage faces favor mustaches and beards.
  const names = Array.from({ length: 40 }, (_, i) => `Test Player ${i}`);
  const hairy = (era) => names.filter((name) => {
    const svg = pixelPortraitSvg(name, era);
    return svg.includes('y="10"') && svg.match(/y="10"[^/]*#0f380f/);
  }).length;
  assert.ok(hairy(1890) > hairy(2010), "the old leagues are mustache country");

  assert.equal(eraYear({ setTag: "1989-2010" }), 1989, "MLB tags read their first year");
  assert.equal(eraYear({ setTag: "'04 PR1" }), 2004, "classic tags read the card year");
  assert.equal(eraYear({ setTag: "'93 BK" }), 1993, "two-digit years split the century sanely");
  assert.equal(eraYear({}), 2000, "no tag defaults to modern");
});

// ---- Battle controller -----------------------------------------------------

function playToCompletion(seed) {
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed });
  const trace = [];
  let guard = 1000;
  while (guard > 0) {
    guard -= 1;
    const phase = battlePhase(battle);
    if (phase.type === "over") return { battle, phase, trace };
    if (phase.type === "advance-decision") {
      const send = phase.pending.candidates[0].safeChance >= 0.7 ? 1 : 0;
      trace.push(`adv${send}`);
      actAdvance(battle, send);
    } else if (phase.type === "player-batting") {
      if (phase.stealOptions.length && phase.stealOptions[0].safeChance > 0.85) {
        trace.push("steal");
        actSteal(battle, phase.stealOptions[0].fromIndex);
      } else {
        trace.push("swing");
        actSwing(battle);
      }
    } else if (phase.mound.fatiguePenalty >= 2 && phase.mound.hasReliefAvailable) {
      trace.push("pen");
      actChangePitcher(battle);
    } else {
      trace.push("pitch");
      actPitch(battle);
    }
  }
  throw new Error("battle never finished");
}

test("an interactive battle runs to a decision and is deterministic per seed", () => {
  const one = playToCompletion("battle-seed-1");
  const two = playToCompletion("battle-seed-1");
  const other = playToCompletion("battle-seed-2");
  assert.equal(typeof one.phase.playerWon, "boolean");
  assert.ok(one.battle.state.inning >= 9);
  assert.deepEqual(one.trace, two.trace, "same seed, same game");
  assert.deepEqual(
    one.battle.events.map((event) => event.result ?? event.type),
    two.battle.events.map((event) => event.result ?? event.type)
  );
  assert.equal(one.phase.score.away === other.phase.score.away && one.phase.score.home === other.phase.score.home, false, "different seed diverges");
});

test("fastForward finishes games under repeated calls and never exceeds its guard", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-mabel"), seed: "ff-seed" });
  let guard = 50;
  while (!isGameOver(battle.state) && guard > 0) {
    guard -= 1;
    const events = fastForward(battle);
    assert.ok(events.length > 0 || isGameOver(battle.state));
  }
  assert.ok(isGameOver(battle.state), "fast-forward reaches the end");
});

test("runSimSeries clinches at the majority and alternates home games", () => {
  const { player, npc } = hookTeams();
  const series = runSimSeries({ playerManager: player, npcManager: npc, bestOf: 5, seed: "sim-series" });
  const needed = 3;
  assert.ok(series.playerWins === needed || series.npcWins === needed);
  assert.ok(series.games.length >= needed && series.games.length <= 5);
  assert.equal(series.games[0].playerIsAway, true);
  if (series.games.length > 1) assert.equal(series.games[1].playerIsAway, false);
  const again = runSimSeries({ playerManager: player, npcManager: npc, bestOf: 5, seed: "sim-series" });
  assert.deepEqual(
    series.games.map((game) => `${game.playerRuns}-${game.npcRuns}`),
    again.games.map((game) => `${game.playerRuns}-${game.npcRuns}`)
  );
});

test("attempt numbers derive distinct battle seeds", () => {
  const save = testSave();
  const first = attemptNumber(save, "scout-jojo");
  const second = attemptNumber(save, "scout-jojo");
  assert.notEqual(first, second);
});

// ---- Hall of fame ------------------------------------------------------------

// A finished campaign, faked in miniature: `days` games in the books with
// `losses` defeats, all in the mode asked for.
async function finishedSave(saveSeed, { mode = "budget", days = 30, losses = 5 } = {}) {
  const { recordAlmanacGame } = await import("../src/adventure/state.js");
  const save = testSave();
  save.saveSeed = saveSeed;
  save.mode = mode;
  for (let i = 0; i < days; i += 1) {
    ensureSeasonStats(save).games += 1;
    recordAlmanacGame(save, {
      day: i + 1,
      trainerId: "scout-jojo",
      opponent: "SCOUT JOJO",
      won: i >= losses,
      score: { away: 3, home: 1 },
      playerSide: "away",
      innings: 9,
      feats: [],
      boxScore: null
    });
  }
  return save;
}

test("winning the world series puts the run in the hall of fame, once", async () => {
  const save = await finishedSave("hof-champion-seed", { days: 34, losses: 6 });
  const app = { save };
  const outcome = applyOutcome(app, trainerById("post-worldseries"), true);
  assert.equal(outcome.badge, "trophy");
  const entry = loadHallOfFame().find((item) => item.saveSeed === "hof-champion-seed");
  assert.ok(entry, "the trophy writes the plaque");
  assert.equal(entry.days, 34, "days are games played");
  assert.equal(entry.wins, 28);
  assert.equal(entry.losses, 6);
  assert.equal(entry.mode, "budget");
  assert.ok(entry.roster.length >= 13, "the roster is snapshotted");
  assert.ok(entry.roster.every((card) => card.name && card.points && card.chart), "as full card objects");
  // The plaque is once per campaign: a re-record is refused.
  assert.equal(recordCompletedRun(save), null);
  assert.equal(loadHallOfFame().filter((item) => item.saveSeed === "hof-champion-seed").length, 1);
});

test("the leaderboard splits by mode and ranks by fewest days, losses breaking ties", async () => {
  const storage = fakeStorage();
  recordCompletedRun(await finishedSave("hof-a", { mode: "budget", days: 40, losses: 4 }), storage);
  recordCompletedRun(await finishedSave("hof-b", { mode: "budget", days: 33, losses: 2 }), storage);
  recordCompletedRun(await finishedSave("hof-c", { mode: "uncapped", days: 51, losses: 0 }), storage);
  recordCompletedRun(await finishedSave("hof-d", { mode: "budget", days: 33, losses: 1 }), storage);
  const grouped = hallOfFameByMode(loadHallOfFame(storage));
  assert.deepEqual(grouped.map((group) => group.mode), ["budget", "uncapped"], "budget leads, one group per rule set");
  assert.deepEqual(grouped[0].entries.map((entry) => entry.saveSeed), ["hof-d", "hof-b", "hof-a"]);
  assert.deepEqual(grouped[1].entries.map((entry) => entry.saveSeed), ["hof-c"]);
});

test("local and global hall of fame entries merge to one row per campaign", () => {
  const local = [{ saveSeed: "x", days: 5 }, { saveSeed: "y", days: 9 }];
  const remote = [{ saveSeed: "x", days: 5 }, { saveSeed: "z", days: 7 }];
  assert.deepEqual(mergeEntries(local, remote).map((entry) => entry.saveSeed).sort(), ["x", "y", "z"]);
  assert.deepEqual(mergeEntries(local, null).map((entry) => entry.saveSeed), ["x", "y"], "no server, local still shows");
});

test("the hall of fame screens list champions and open the team page", async () => {
  const save = await finishedSave("hof-screen-seed", { days: 21, losses: 3 });
  save.player.name = "ICHIRO";
  // One recorded game gives the roster's first bat a season line to render.
  const hero = rosterCards(save).find((card) => card.kind !== "pitcher");
  recordGameStats(save, {
    hitters: [{ id: hero.id, name: hero.name, pa: 4, ab: 4, h: 2, d: 1, t: 0, hr: 1, bb: 0, so: 1, r: 1, rbi: 2, sb: 0, cs: 0, gidp: 0, wpa: 0.2 }],
    pitchers: []
  });
  ensureSeasonStats(save).games = 21;
  recordCompletedRun(save);
  const app = {
    save: null,
    screen: { name: "hallOfFame", index: 0 },
    go(name, data = {}) { this.screen = { name, ...data }; },
    rerender() {}
  };
  const listHtml = hallOfFameScreen.render(app);
  assert.ok(listHtml.includes("BUDGET LEAGUE"), "runs group under their rule set");
  assert.ok(listHtml.includes("ICHIRO"), "the champion is listed");
  assert.ok(listHtml.includes("21 DAYS"), "days to the trophy lead the line");
  assert.ok(listHtml.includes("18-3"), "the final record shows");
  const entry = loadHallOfFame().find((item) => item.saveSeed === "hof-screen-seed");
  app.screen = { name: "hofTeam", entry, index: 0 };
  const teamHtml = hofTeamScreen.render(app);
  assert.ok(teamHtml.includes("WORLD SERIES CHAMPION"));
  assert.ok(teamHtml.includes("THE BATS") && teamHtml.includes("THE ARMS"), "the roster renders in sections");
  assert.ok(teamHtml.includes("18-3"), "the record repeats on the team page");
  assert.ok(hofTeamScreen.hoverCard(app, 0), "rows hover to the snapshotted card");
  hofTeamScreen.key(app, "b");
  assert.equal(app.screen.name, "hallOfFame", "X returns to the leaderboard");
});
