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
  hydrateUniverse,
  persistSave,
  loadSave,
  exportSaveCode,
  importSaveCode,
  saveFileName,
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
  actBunt,
  actIntentionalWalk,
  npcMoundVisit,
  serializeBattle,
  restoreBattle,
  fastForward,
  runSimSeries
} from "../src/rules/battle/controller.js";
import { validateRoster, buildTeam } from "../src/rules/draft.js";
import { playsPosition } from "../src/rules/cards.js";
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

test("a save freezes its universe on first load, then installs it verbatim", () => {
  try {
    const save = createSave({ name: "FREEZE", saveSeed: "freeze-seed", universe: "fictional" });
    // A fresh save carries no cards. The first hydrate builds the pool from the
    // seed and freezes whatever it produces, reporting that it changed the save.
    assert.equal("universeCards" in save, false);
    assert.equal(hydrateUniverse(save), true);
    assert.ok(Array.isArray(save.universeCards) && save.universeCards.length > 0);

    // Tamper with a stored card to stand in for a later generator change: the
    // seed would never build this name. If a load re-derived, the edit vanishes.
    save.universeCards[0] = { ...save.universeCards[0], name: "STAYS PUT" };
    const markerId = save.universeCards[0].id;

    // Point the module at another league, then re-hydrate: the stored cards
    // install verbatim, and there is nothing new to persist.
    setUniverseSeed("some-other-seed", "fictional");
    assert.equal(hydrateUniverse(save), false);
    assert.equal(cardById(markerId).name, "STAYS PUT");
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

test("a pack deals each man once — no player twice out of one wrapper", async () => {
  const { cardPerson } = await import("../src/rules/cards.js");
  for (let i = 0; i < 200; i += 1) {
    const cards = openPack("booster", `dupe-${i}`);
    const people = cards.map((card) => cardPerson(card));
    assert.equal(new Set(people).size, cards.length, `pack dupe-${i} dealt the same man twice`);
    // The redraw must not cost the slot its rarity — the hit slot is still a hit.
    assert.ok(["uncommon", "rare", "legend"].includes(cards[4].rarity), "the redraw keeps the slot's tier");
  }
});

test("a legend does not just turn over: the pack glows first, then he lands", async () => {
  const { packOpenScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  // Find a booster whose FIRST pull is a legend, so one Z gets us there.
  let seed = null;
  for (let i = 0; i < 400 && !seed; i += 1) {
    if (openPack("booster", `legend-${i}`)[0].rarity === "legend") seed = `legend-${i}`;
  }
  assert.ok(seed, "some booster leads with a legend");
  const legend = openPack("booster", seed)[0];
  save.pendingPacks = [{ packId: "booster", seed }];
  const app = { save, screen: { name: "packOpen", revealed: 0, viewing: 0 }, go() {}, rerender() {} };

  assert.ok(packOpenScreen.render(app).includes("RIP IT OPEN"), "sealed to start");
  packOpenScreen.key(app, "a");

  // The curtain: he is yours, and he is not on the screen.
  const curtain = packOpenScreen.render(app);
  assert.ok(app.screen.curtain, "the pack is glowing");
  assert.ok(curtain.includes("GLOWING"), "and says so");
  assert.ok(curtain.includes("gq-legend-rays"), "with the rays behind it");
  assert.ok(!curtain.includes(legend.name.toUpperCase()), "but it does not name him yet");
  assert.equal(ownedCount(save, legend.id), 1, "he is already in the collection, though");

  // Nothing you can press hurries it.
  packOpenScreen.key(app, "a");
  packOpenScreen.key(app, "right");
  assert.ok(app.screen.curtain, "the room waits");
  assert.equal(app.screen.revealed, 1, "and the pack does not run on without you");

  // The curtain drops on its own.
  app.screen.curtain = null;
  const landed = packOpenScreen.render(app);
  assert.ok(landed.includes("&#9733; LEGEND &#9733;"), "he is called out");
  assert.ok(landed.includes(legend.name.toUpperCase()), "by name");
  assert.ok(landed.includes("gq-legend-reveal"), "and lands big, on the rays");

  // Leafing back through the pulls afterwards shows the card plainly: the event
  // was the pull, not the card.
  const commonIndex = openPack("booster", seed).findIndex((card) => card.rarity !== "legend");
  if (commonIndex > 0) {
    app.screen.revealed = commonIndex + 1;
    app.screen.viewing = 1;
    const rewound = packOpenScreen.render(app);
    assert.ok(!rewound.includes("gq-legend-reveal"), "no rays on a second look");
    assert.ok(!rewound.includes("&#9733; LEGEND &#9733;"), "and no second curtain call");
  }
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

test("the budget-mode point cap buys at least an average roster out of the pool", async () => {
  const { poolMean, poolCeiling, REFERENCE_CAP, LADDER_REFERENCE } = await import("../src/adventure/packs.js");
  const save = testSave();
  const floor = poolCeiling() * REFERENCE_CAP / LADDER_REFERENCE;
  const expected = Math.round(Math.max(poolMean(), floor) / 50) * 50;
  assert.equal(pointCap(save), expected, "the mean legal roster, or a third of the ceiling, whichever is more");
  save.player.badges = ["ironwood", "galehook", "cascade", "pennant", "trophy"];
  assert.equal(pointCap(save), expected, "badges do not move the cap");
  // An average team, not a great one: the cap sits well under what the pool's
  // best thirteen would cost, and well over its cheapest.
  assert.ok(pointCap(save) < poolCeiling(), "under the pool's best-13 ceiling");
  assert.ok(pointCap(save) > poolCeiling() / 5, "and not a scrapheap");
});

test("the mean floor lifts the thin pools and leaves the deep ones where they were tuned", async () => {
  const { poolMean, poolCeiling, budgetCap, REFERENCE_CAP, LADDER_REFERENCE } = await import("../src/adventure/packs.js");
  const third = () => Math.round((poolCeiling() * REFERENCE_CAP / LADDER_REFERENCE) / 50) * 50;
  try {
    // A franchise pool is thin — a few hundred cards, a short superstar tail —
    // so its middle sits high against its own ceiling and the old third-of-the-
    // ceiling cap bought a bottom-fifth team. The mean is what rescues it.
    setUniverseSeed("cap-shape", "franchise-TBD");
    assert.ok(poolMean() > third(), "the thin pool's mean roster outruns a third of its ceiling");
    assert.equal(budgetCap(), Math.round(poolMean() / 50) * 50, "so a franchise save caps at the mean");
    assert.ok(poolMean() / poolCeiling() > 0.4, "its middle really does sit near its ceiling");

    // The deep leagues have the tail, so the third still wins and their caps do
    // not move: the mean is a floor under the cap, never a ceiling on it.
    for (const universe of ["fictional", "mlb-history"]) {
      setUniverseSeed("cap-shape", universe);
      assert.ok(poolMean() < third(), `${universe}: the deep pool's mean sits below a third of its ceiling`);
      assert.equal(budgetCap(), third(), `${universe}: so the cap stays where it was tuned`);
    }
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("the ladder brackets the cap in every pool, thin or deep", async () => {
  const { poolCeiling, budgetCap } = await import("../src/adventure/packs.js");
  const { npcBudget, TRAINERS } = await import("../src/adventure/region.js");
  const jojo = trainerById("scout-jojo");
  const worldSeries = trainerById("post-worldseries");
  try {
    // The old ceiling-scaled ladder put the Rays' first scout at 950 against a
    // 1350 cap — the whole climb squeezed into the bottom of a thin pool. Hung
    // off the cap instead, the shape holds wherever you play.
    for (const universe of ["fictional", "classic", "franchise-TBD", "decade-1910"]) {
      setUniverseSeed("ladder-shape", universe);
      const save = testSave();
      const cap = budgetCap();
      assert.ok(npcBudget(save, jojo) < cap, `${universe}: the first scout comes in under your cap`);
      assert.ok(npcBudget(save, worldSeries) > cap, `${universe}: the summit outspends you`);
      assert.ok(npcBudget(save, worldSeries) < poolCeiling(), `${universe}: but cannot outspend the pool`);
      const ladder = [...TRAINERS].sort((a, b) => a.pointBudget - b.pointBudget);
      for (let i = 1; i < ladder.length; i += 1) {
        assert.ok(
          npcBudget(save, ladder[i]) >= npcBudget(save, ladder[i - 1]),
          `${universe}: the climb stays monotone`
        );
      }
    }
  } finally {
    setUniverseSeed("test-seed", "fictional");
  }
});

test("uncapped mode drops the player's cap and swells boss budgets", async () => {
  const { npcBudget } = await import("../src/adventure/region.js");
  const save = testSave();
  save.mode = "uncapped";
  assert.equal(pointCap(save), Infinity, "no roster limit in uncapped");

  const jojo = trainerById("scout-jojo");
  const worldSeries = trainerById("post-worldseries");
  // Budget mode hangs the printed ladder off the CAP — the EXACT cap, not the
  // rounded one, or every rung inherits the rounding error magnified: the
  // summit shops 76% of the room between the player's cap and what the pool
  // can actually field.
  const { poolCeiling, exactCap, LADDER_REFERENCE, REFERENCE_CAP } = await import("../src/adventure/packs.js");
  const cap = exactCap();
  const share = (worldSeries.pointBudget - REFERENCE_CAP) / (LADDER_REFERENCE - REFERENCE_CAP);
  assert.equal(
    npcBudget(testSave(), worldSeries),
    Math.round((cap + share * (poolCeiling() - cap)) / 50) * 50,
    "budget mode reads the cap-anchored ladder"
  );
  const scale = poolCeiling() / LADDER_REFERENCE;
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

// Cam doesn't get a new binder between bouts — he grows the one he has. Each
// rematch keeps most of the roster you last saw and trades the rest up.
test("the rival accrues his roster instead of redrafting it", () => {
  const ladder = ["rival-1", "rival-2", "rival-3", "rival-4"].map((id) => trainerById(id));
  let previous = null;
  for (const trainer of ladder) {
    const npc = buildNpcTeam(trainer, null);
    const ids = new Set(npc.roster.map((card) => card.id));
    if (previous) {
      // He opens from last round's binder and trades up. How MUCH he keeps is
      // not fixed — a flush new budget may churn most of it — only that he
      // carries something forward and still upgrades. He never redrafts blind.
      const kept = [...previous].filter((id) => ids.has(id)).length;
      assert.ok(kept >= 1, `${trainer.id} carries part of last round's binder forward (${kept}/${previous.size})`);
      assert.ok(kept < previous.size, `${trainer.id} still upgrades something (${kept}/${previous.size})`);
    }
    previous = ids;
  }

  // Growth is a trade-up, never a fire sale: the money he added is money he
  // spent, so every rematch fields a pricier roster than the last.
  const points = ladder.map((trainer) => buildNpcTeam(trainer, null).points);
  for (let i = 1; i < points.length; i += 1) {
    assert.ok(points[i] > points[i - 1], `rival ${i + 1} outspends his younger self (${points[i]} vs ${points[i - 1]})`);
  }

  // Inheriting a roster must not smuggle in an illegal one, and an heir is
  // still the same team every time you scout him.
  const summit = buildNpcTeam(ladder[3], null);
  assert.equal(validateRoster(summit).length, 0, "the inherited roster stays legal");
  assert.deepEqual(
    summit.roster.map((card) => card.id),
    buildNpcTeam(ladder[3], null).roster.map((card) => card.id),
    "and deterministic"
  );

  // Nobody else inherits: the rest of the ladder still drafts from scratch.
  assert.deepEqual(
    TRAINERS.filter((trainer) => trainer.inherits).map((trainer) => trainer.id),
    ["rival-2", "rival-3", "rival-4"],
    "only the rival carries a binder forward"
  );
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
  assert.ok(exportSaveScreen.render(withSave).includes("showdown-quest-test.sav"), "export names the file it downloads");
  assert.ok(importSaveScreen.render(withSave).includes("CHOOSE A SAVE FILE"), "import takes the downloaded file");
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

test("a save file is named after the manager, whatever they typed", () => {
  assert.equal(saveFileName(createSave({ name: "Casey Jones Jr.", saveSeed: "s" })), "showdown-quest-casey-jones-jr.sav");
  assert.equal(saveFileName(createSave({ name: "???", saveSeed: "s" })), "showdown-quest-manager.sav");
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

// Walk the binder to a card, open its actions, and take ADD TO TEAM. Returns the
// WHO SITS row the cursor came to rest on.
//
// The card has to be the one the QUESTION is about — every row of the binder is
// in the rendered list, so "his name appears" proves nothing; the header does.
function openSwapAndReadCursor(app, binderScreen, card) {
  const asked = `WHO SITS FOR ${card.name.split(" ")[0][0]}.${card.name.split(" ").pop()}?`.toUpperCase();
  for (let index = 0; index < 60; index += 1) {
    app.screen = { name: "binder", index, filter: "ALL" };
    binderScreen.key(app, "a"); // open his actions
    binderScreen.key(app, "a"); // ADD TO TEAM -> PICK WHO SITS
    if (app.screen.mode !== "team-swap") continue;
    const html = binderScreen.render(app);
    if (!html.toUpperCase().includes(asked)) continue;
    const cursor = html.match(/<li class="gq-cursor[^"]*"[^>]*>([\s\S]*?)<\/li>/);
    return cursor ? cursor[1] : null;
  }
  return null;
}

test("WHO SITS opens on the man the new card is here to replace", async () => {
  const { binderScreen, lineupSlotOf } = await import("../src/adventure/ui/collectionScreens.js");
  const { hitterPositions } = await import("../src/rules/cards.js");
  const save = testSave();
  const roster = rosterCards(save);

  // A shortstop is being added to play shortstop. Asking who sits and then
  // pointing at the catcher makes you walk the list every time to answer the
  // question you already answered by choosing the card.
  const seatedSS = roster.find((card) => lineupSlotOf(save, card) === "SS");
  assert.ok(seatedSS, "somebody is playing short");
  const newSS = adventurePool().find((card) =>
    card.kind === "hitter" &&
    !save.roster.cardIds.includes(card.id) &&
    hitterPositions(card)[0]?.pos === "SS");
  assert.ok(newSS, "the pool prints a shortstop");
  addCardToCollection(save, newSS.id);

  const app = { save, screen: { name: "binder", index: 0, filter: "ALL" }, go() {}, rerender() {} };
  const cursorRow = openSwapAndReadCursor(app, binderScreen, newSS);
  assert.ok(cursorRow, "his ADD TO TEAM opens the WHO SITS list");
  assert.match(cursorRow, /<span class="gq-swap-spot">SS<\/span>/, "the cursor stands on the shortstop");
  assert.ok(
    cursorRow.includes(seatedSS.name.split(" ").pop().toUpperCase()),
    "and on the man actually playing there, not on whoever happens to be first"
  );

  // An arm opens on an arm of the same job.
  const newRP = adventurePool().find((card) =>
    card.kind === "pitcher" && card.role === "RP" && !save.roster.cardIds.includes(card.id));
  if (newRP) {
    addCardToCollection(save, newRP.id);
    const armApp = { save, screen: { name: "binder", index: 0, filter: "ALL" }, go() {}, rerender() {} };
    const armRow = openSwapAndReadCursor(armApp, binderScreen, newRP);
    assert.ok(armRow, "the arm opens his list too");
    assert.match(armRow, /<span class="gq-swap-spot">RP<\/span>/, "a reliever opens on a reliever, not the game-one starter");
  }
});

test("WHO SITS names each man by the spot he is standing in", async () => {
  const { binderScreen, lineupSlotOf, rotationSlotOf } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const roster = rosterCards(save);
  const spare = adventurePool().find((card) => card.kind === "hitter" && !save.roster.cardIds.includes(card.id));
  addCardToCollection(save, spare.id);

  const app = {
    save,
    screen: { name: "binder", index: 0, filter: "ALL", mode: "team-swap", pickIndex: 0 },
    go() {},
    rerender() {}
  };
  // Walk the binder until the cursor is on the spare bat, then ask who sits.
  const surnameOf = (card) => card.name.split(" ").pop().toUpperCase();
  let html = null;
  for (let index = 0; index < Object.keys(save.collection).length + 2; index += 1) {
    app.screen.index = index;
    const rendered = binderScreen.render(app);
    if (rendered.includes(`WHO SITS FOR`) && rendered.includes(surnameOf(spare))) {
      html = rendered;
      break;
    }
  }
  assert.ok(html, "the spare bat is in the binder and asks the question");
  // Every man offered is named with the spot he is actually playing — the LF/RF
  // man in left reads LF, the DH reads DH — not with everything his card allows.
  let checked = 0;
  for (const bat of roster.filter((card) => card.kind === "hitter")) {
    const slot = lineupSlotOf(save, bat);
    if (!slot) continue;
    assert.ok(
      html.includes(`<span class="gq-swap-spot">${slot}</span>`),
      `somebody is offered at ${slot}`
    );
    checked += 1;
  }
  assert.ok(checked >= 8, "every man in the order is named by where he is standing");
  assert.ok(html.includes('<span class="gq-swap-spot">DH</span>'), "the DH reads DH, not the glove on his card");
  // The spot leads the row: it is what you are scanning for.
  assert.match(html, /<span class="gq-swap-spot">C<\/span>A\.CHOUDHURY|<span class="gq-swap-spot">[A-Z0-9 \/]+<\/span>[A-Z]/, "the spot reads before the man");
  void rotationSlotOf;
});

test("stars flag keepers in binder and catalog; the sell sweeps can spare them", async () => {
  const { binderScreen, catalogScreen, sellScreen, sellAllCards, sellAllDuplicates } = await import("../src/adventure/ui/collectionScreens.js");
  const { isStarred } = await import("../src/adventure/state.js");
  const save = testSave();
  const keeper = adventurePool().find((card) => !save.roster.cardIds.includes(card.id));
  addCardToCollection(save, keeper.id, 2);
  const app = { save, screen: { name: "binder", index: 0, filter: "ALL" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };

  // The binder stars through the card action menu — the letter keys retired.
  const binderRowsNow = collectionCards(save);
  app.screen.index = binderRowsNow.findIndex(({ card }) => card.id === keeper.id);
  binderScreen.typed(app, "*");
  assert.equal(isStarred(save, keeper.id), false, "the * shortcut is retired");
  binderScreen.key(app, "a");
  assert.equal(app.screen.actionMenu, true, "Z opens the card actions");
  app.screen.actionIndex = 2; // ADD TO TEAM, SELL, STAR, PIN, CANCEL
  binderScreen.key(app, "a");
  assert.equal(isStarred(save, keeper.id), true, "the menu stars the keeper");
  assert.ok(binderScreen.render(app).includes("&#9733;"), "the binder shows the star");

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

  // NOTHING here sells on one keypress. A card sold is gone — the shop pays pawn
  // rates and will not sell it back — and the cursor is often sitting on a row you
  // were only reading.
  const rows = 2;
  app.screen.index = 0; // a single card
  sellScreen.key(app, "a");
  assert.equal(app.screen.confirmSell?.kind, "card", "one Z on a card only ASKS");
  assert.ok(/SELL .+ FOR \$\d+\?/.test(sellScreen.render(app)), "and it names the man and the money");
  sellScreen.key(app, "b");
  assert.equal(app.screen.confirmSell, null, "X takes the question back");
  assert.equal(app.screen.name, "sell", "without leaving the shop");
  const held = ownedCount(save, save.roster.cardIds[0]) + ownedCount(save, spare.id);
  sellScreen.key(app, "a");
  sellScreen.key(app, "a");
  assert.equal(
    ownedCount(save, save.roster.cardIds[0]) + ownedCount(save, spare.id),
    held - 1,
    "and the second Z is the one that sells"
  );

  // The duplicate sweep asks too.
  app.screen.index = rows;
  sellScreen.key(app, "a");
  assert.equal(app.screen.confirmSell?.kind, "duplicates", "so does the duplicate pile");
  sellScreen.key(app, "b");

  // SELL ALL CARDS asks twice, X backs out without selling or leaving.
  app.screen.index = rows + 1; // SELL ALL CARDS
  sellScreen.key(app, "a");
  assert.equal(app.screen.confirmSell?.kind, "binder", "first Z arms the confirm");
  assert.ok(sellScreen.render(app).includes("SELL THE WHOLE BINDER"), "and says what it will take");
  sellScreen.key(app, "b");
  assert.equal(app.screen.confirmSell, null, "X disarms it");
  assert.equal(app.screen.name, "sell", "without leaving the shop");
  assert.ok(ownedCount(save, spare.id) >= 1, "nothing swept");

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
    // The build lifts the weakest slots first but doesn't guarantee every hole
    // clears the bargain bin, and a lucky slot can climb into a genuine star —
    // both are fine. These are sanity floors, not shape rules: not a whole roster
    // of scrubs, and no single card swallowing the entire checkbook.
    const scrubs = npc.roster.filter((card) => card.points < mean * 0.25).length;
    assert.ok(scrubs <= 4, `${trainer.id}: a few bargain-bin fillers at most (${scrubs})`);
    const priciest = Math.max(...npc.roster.map((card) => card.points));
    assert.ok(priciest <= mean * 6, `${trainer.id}: no card hogs the whole checkbook`);
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

test("the first win is the win; a rematch is a wage that never runs dry", () => {
  const save = testSave();
  const boss = { id: "test-boss", rewards: { coins: 200 } };
  assert.equal(rewardCoins(save, boss), 200, "the purse is the purse, once");
  save.progress.trainersBeaten[boss.id] = 1;
  assert.equal(rewardCoins(save, boss), 20, "and a tenth of it every time after");
  save.progress.trainersBeaten[boss.id] = 20;
  assert.equal(rewardCoins(save, boss), 20, "the twentieth lap pays what the second did");
  // A grind that decays to nothing is a grind nobody finishes — and the catalog
  // is bought with these coins.
  assert.equal(rewardCoins(save, { id: "test-scrub", rewards: { coins: 12 } }), 12);
  save.progress.trainersBeaten["test-scrub"] = 3;
  assert.equal(rewardCoins(save, { id: "test-scrub", rewards: { coins: 12 } }), 5, "with a floor under the small fry");
});

test("nobody leaves the map: a beaten trainer will play you again", async () => {
  const { isTrainerAvailable, isRematch } = await import("../src/adventure/region.js");
  const save = testSave();
  const jojo = trainerById("scout-jojo");
  assert.equal(isTrainerAvailable(save, jojo), true);
  save.progress.trainersBeaten[jojo.id] = 1;
  assert.equal(isTrainerAvailable(save, jojo), true, "beating him does not retire him");
  assert.equal(isRematch(save, jojo), true, "and the game knows it is a rematch");
});

test("a loss costs the game and nothing else", () => {
  const save = testSave();
  save.player.coins = 250;
  const app = { save, go() {}, rerender() {} };
  const outcome = applyOutcome(app, trainerById("scout-jojo"), false);
  assert.equal(outcome.coins, 0, "no fee");
  assert.equal(save.player.coins, 250, "and the purse is untouched");
  assert.equal(save.progress.counters.battlesLost, 1, "the loss is still a loss");
});

test("a rematch pays coins only — no second pack, no second card off his roster", () => {
  const save = testSave();
  const trainer = TRAINERS.find((entry) => entry.rewards.pack && !entry.ambush);
  const app = { save, go() {}, rerender() {} };
  const first = applyOutcome(app, trainer, true);
  assert.equal(first.pack, trainer.rewards.pack, "the first win pays the pack");
  assert.equal(first.cardClaim, true, "and a card off his roster");
  const again = applyOutcome(app, trainer, true);
  assert.equal(again.pack, null, "the rematch does not");
  assert.equal(again.cardClaim, false, "nor another claim — that would fill the catalog for you");
  assert.equal(again.rematch, true);
  assert.equal(again.coins, Math.max(5, Math.round(trainer.rewards.coins * 0.1)), "it pays the wage");
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
  const { npcMaybeSteal, AI_PROFILES } = await import("../src/rules/battle/ai.js");

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
  // Pin the two arms this scenario turns on so it tests the AI's hook, not
  // whatever the generated NPC happens to field. A tired, beatable six-inning
  // starter, with a clearly better fresh arm waiting: a conservative skipper
  // pulls that. (A generated NPC can just as well field an elite ace nobody
  // should pull, or an 8-IP workhorse only ever tired in a ninth he should
  // finish — neither is the behaviour under test.)
  npcStarter.control = 3;
  npcStarter.plannedOuts = 21;
  npcStarter.ip = 7;
  state.home.pitchers[1].control = 6;
  state.home.pitchers[1].ip = 1;
  state.pitching.home.outsRecorded = npcStarter.plannedOuts;
  state.pitching.home.battersFaced = npcStarter.ip * 4 + 1;
  // Put the game where an arm that deep actually IS. The bar the pen has to
  // clear slides with the outs left to get, so a starter who has thrown his
  // planned outs has to be standing in the eighth, not the first — and a state
  // that says otherwise is asking the skipper a question about a game nobody is
  // playing.
  state.inning = Math.floor(npcStarter.plannedOuts / 3) + 1;
  assert.equal(pitcherStatus(state, "home").pitcher.id, npcStarter.id, "NPC arm stays until the AI pulls it");
  assert.ok(pitcherStatus(state, "home").fatiguePenalty >= 1, "and shows real fatigue while he waits");
  const { npcMaybePullPitcher, AI_PROFILES } = await import("../src/rules/battle/ai.js");
  const pulled = npcMaybePullPitcher(state, "home", AI_PROFILES.conservative);
  assert.ok(pulled, "a tired NPC arm gets pulled by the profile");
  assert.notEqual(pitcherStatus(state, "home").pitcher.id, npcStarter.id);
});

test("fast forward runs YOUR pen on the same hook as theirs — best arm, not next man along the bench", async () => {
  // The bug this pins: the autopilot managing the player's pen was the rule the
  // hook replaced, kept alive in the one place nobody looked. It pulled at a flat
  // fatigue 2 and took `the next man along the bench` — and the bench is sorted
  // WORST-CONTROL-FIRST (buildPitchingPlan, a leftover from the old scripted
  // staff where the closer was meant to finish). So your worst reliever went in
  // first BY CONSTRUCTION and your best one waited behind him for a game that
  // usually ended first: an IP 1 arm throwing four innings while the ace of your
  // pen got a one-inning cameo.
  const { fastForward } = await import("../src/rules/battle/controller.js");
  const { isGameOver } = await import("../src/rules/game.js");
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "ff-pen" });

  const staff = battle.state[battle.playerSide].pitchers;
  const bench = staff.slice(1);
  assert.ok(bench.length >= 2, "the fixture has a pen to choose from");
  const nextManAlong = bench[0];
  const bestArm = [...bench].sort((a, b) => b.control - a.control)[0];
  assert.notEqual(nextManAlong.id, bestArm.id, "and the stack really does bury the best arm — else this proves nothing");

  let guard = 40;
  while (!isGameOver(battle.state) && guard > 0) {
    guard -= 1;
    fastForward(battle);
  }

  const used = battle.events
    .filter((event) => event?.type === "pitching-change" && event.side === battle.playerSide)
    .map((event) => event.pitcher);
  assert.ok(used.length >= 1, "the autopilot went to the pen at all");
  // The hook rates every arm and brings in the BEST one, jumping the men in front
  // of him — the same call the other dugout has been making all along.
  assert.equal(used[0], bestArm.name, `the first arm in is the best one (${bestArm.name}), not the next seat on the bench (${nextManAlong.name})`);
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

  // Speed 14, not 20: a burner cannot be thrown out going home from second and is
  // no longer ASKED about at all (see the auto-safe test below). This man can be,
  // so the call is still the player's, and sending him is still a gamble.
  state.bases = [null, { id: "r5", name: "Runner Five", speed: 14 }, null];
  applySingle(state, state.away.lineup[1], "away", "home", createRng("adv-roll-2"), pitcher);
  assert.ok(state.pendingAdvance, "a man who CAN be thrown out is still a question");
  const outsBefore = state.outs;
  const scoreBefore = state.score.away;
  const event = resolveAdvanceDecision(state, 1, createRng("send-roll"));
  assert.equal(event.type, "advance");
  const scoredOrOut = state.score.away === scoreBefore + 1 || state.outs === outsBefore + 1;
  assert.ok(scoredOrOut, "the send either scores or costs an out");
});

test("an extra base is split between the man who hit it and the man who took it; a steal is all his", async () => {
  const { attemptSteal } = await import("../src/rules/game.js");
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "credit-seed" });
  const state = battle.state;
  const batter = state.away.lineup[0];
  const pitcher = pitcherStatus(state, "home").pitcher;

  // A single with a man on second: the runner is sent, and the play is two
  // men's doing — the hitter put the ball out there, the runner went and got it.
  // Speed 14: he can be thrown out, so going is a RISK he takes, and the credit
  // is shared. (A man who cannot be thrown out is never asked and never sent —
  // the base was the hit's doing, not his.)
  state.bases[1] = { id: "r2", name: "Runner Two", speed: 14 };
  applySingle(state, batter, "away", "home", createRng("split-roll"), pitcher);
  const event = resolveAdvanceDecision(state, 1, createRng("send"));
  assert.equal(event.type, "advance");

  const hitterLine = state.stats.hitters.get(`away:${batter.id}`);
  const runnerLine = state.stats.hitters.get("away:r2");
  const half = event.wpa / 2;
  assert.ok(Math.abs(hitterLine.wpa - half) < 1e-9, "the hitter takes half the swing");
  assert.ok(Math.abs(runnerLine.wpa - half) < 1e-9, "and the runner takes the other half");
  assert.ok(
    Math.abs((hitterLine.wpa + runnerLine.wpa) - event.wpa) < 1e-9,
    "and between them they take all of it — the play is not paid for twice"
  );
  // The pending play never carried the batter at all, so the RBI credit on a
  // deferred send was dead code: a run driven in by sending a man home went in
  // nobody's column.
  assert.equal(hitterLine.rbi, event.runs, "and the runs he drove in are his");

  // A steal is nobody's bat. The runner takes the whole swing, and the man at
  // the plate takes none of it.
  const fresh = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "steal-credit" });
  const stealState = fresh.state;
  const atThePlate = stealState.away.lineup[stealState.lineupIndex.away];
  stealState.bases[0] = { id: "r1", name: "Runner One", speed: 20 };
  const steal = attemptSteal(stealState, 0, createRng("steal-roll"));
  assert.ok(steal, "he goes");
  assert.equal(steal.runnerId, "r1", "and the row can hover his card, not the batter's");
  const thief = stealState.stats.hitters.get("away:r1");
  assert.ok(Math.abs(thief.wpa - steal.wpa) < 1e-9, "the base is all his");
  assert.equal(
    stealState.stats.hitters.get(`away:${atThePlate.id}`)?.wpa ?? 0,
    0,
    "the man holding the bat did nothing and is credited with nothing"
  );
});

test("auto play never defers: simulated games leave no pending decisions", () => {
  const { player, npc } = hookTeams();
  const result = simulateGame(buildTeam(player), buildTeam(npc), "no-defer-seed");
  assert.ok(result.events.length > 0);
});

test("the box score counts extra bases taken, outs on the bases, and a catcher's throw-outs", () => {
  const { player, npc } = hookTeams();
  const home = buildTeam(player);
  const away = buildTeam(npc);
  // A season's worth of games so the rare plays actually turn up.
  let sawAdv = false, sawAdvOut = false;
  for (let game = 0; game < 60; game += 1) {
    const result = simulateGame({ ...away }, { ...home }, `baserunning-${game}`);
    for (const side of ["away", "home"]) {
      const them = side === "away" ? "home" : "away";
      const hitters = result.boxScore[side].hitters;
      const theirHitters = result.boxScore[them].hitters;
      // Every new field exists on every line.
      for (const line of hitters) {
        assert.equal(typeof line.adv, "number", "adv is on the line");
        assert.equal(typeof line.advOut, "number", "advOut is on the line");
        assert.equal(typeof line.csCaught, "number", "csCaught is on the line");
        if (line.adv > 0) sawAdv = true;
        if (line.advOut > 0) sawAdvOut = true;
      }
      // The invariant that makes the catcher record trustworthy: every caught
      // stealing charged to a runner is credited to exactly one man behind the
      // plate. So THIS side's catchers' throw-outs equal the OTHER side's runners'
      // caught-stealings, game for game — including when both are zero.
      const sum = (lines, field) => lines.reduce((total, line) => total + (line[field] || 0), 0);
      assert.equal(sum(hitters, "csCaught"), sum(theirHitters, "cs"),
        "a catcher is credited for every runner his side cut down, and no other");
    }
  }
  assert.ok(sawAdv, "somebody took an extra base across a season of games");
  assert.ok(sawAdvOut, "somebody was thrown out trying");
});

test("a caught stealing credits the man behind the plate, on the other side", () => {
  const { player, npc } = hookTeams();
  // A slow runner will be gunned down on some rolls; walk seeds until one is.
  let caught = null;
  for (let i = 0; i < 300 && !caught; i += 1) {
    const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: `cs-${i}` });
    const state = battle.state;
    state.outs = 0;
    state.bases = [{ id: "r1", name: "Runner One", speed: 4 }, null, null];
    const event = attemptSteal(state, 0, createRng(`cs-roll-${i}`));
    if (event?.result === "CS") caught = state;
  }
  assert.ok(caught, "found a caught stealing to inspect");
  const lines = [...caught.stats.hitters.values()];
  const sum = (field) => lines.reduce((total, line) => total + (line[field] || 0), 0);
  assert.equal(sum("cs"), 1, "the runner is charged the caught stealing");
  assert.equal(sum("csCaught"), 1, "and exactly one catcher is credited the throw-out");
  const runner = lines.find((line) => line.cs > 0);
  const catcher = lines.find((line) => line.csCaught > 0);
  assert.notEqual(runner.side, catcher.side, "the throw-out is the defense's, not the runner's own dugout");
});

test("the game counts every natural 20 rolled, and the record reads the luckiest one", async () => {
  const { RECORDS } = await import("../src/adventure/records.js");
  const { player, npc } = hookTeams();
  const away = buildTeam(npc);
  const home = buildTeam(player);
  let sawTwenty = false;
  for (let game = 0; game < 40; game += 1) {
    const result = simulateGame({ ...away }, { ...home }, `twenties-${game}`);
    assert.ok(Number.isInteger(result.twenties) && result.twenties >= 0, "a whole, non-negative count");
    // Every plate appearance carries its two d20s; the game's count is at least
    // those, plus any steal / advance / groundout throws that also came up 20.
    const paTwenties = result.events.reduce(
      (total, event) => total + (event.controlRoll === 20 ? 1 : 0) + (event.resultRoll === 20 ? 1 : 0), 0);
    assert.ok(result.twenties >= paTwenties, "the count includes the plate-appearance 20s, and any others");
    if (result.twenties > 0) sawTwenty = true;
  }
  assert.ok(sawTwenty, "somebody rolled a 20 across a season of games");

  const record = RECORDS.find((row) => row.key === "twenties-game");
  const save = { almanac: [{ day: 1, opponent: "A", twenties: 3 }, { day: 2, opponent: "B", twenties: 5 }] };
  assert.deepEqual(record.read(save), { value: 5, day: 2, opponent: "B" }, "the luckiest afternoon holds it");
  assert.equal(record.read({ almanac: [{ day: 1, opponent: "A" }] }), null,
    "a game from before the count existed never rolled a tracked die, and does not compete");
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

test("the club has a page of its own", async () => {
  const { seasonStatsScreen } = await import("../src/adventure/ui/statsScreens.js");
  const { seasonTeam } = await import("../src/adventure/state.js");
  const { recordFinishedGame } = await import("../src/adventure/ui/battleScreen.js");
  const save = testSave();
  const trainer = trainerById("scout-jojo");
  const { player, npc } = hookTeams();

  // Every man had a line and the team they add up to had none, which is odd, since
  // the team is the manager's whole job.
  const empty = seasonTeam(save);
  assert.equal(empty.games, 0);
  assert.equal(empty.wins + empty.losses, 0, "no games, no record");

  let wins = 0;
  let runsFor = 0;
  let runsAgainst = 0;
  for (const seed of ["club-1", "club-2", "club-3"]) {
    const result = simulateGame(buildTeam(player), buildTeam(npc), seed);
    const score = { away: result.away.runs, home: result.home.runs };
    const won = score.away > score.home;
    recordGameStats(save, result.boxScore.away);
    recordFinishedGame(save, {
      trainer,
      boxScore: result.boxScore,
      playerSide: "away",
      events: result.events,
      score,
      innings: result.innings,
      won,
      lineScore: result.lineScore
    });
    if (won) wins += 1;
    runsFor += score.away;
    runsAgainst += score.home;
  }

  const team = seasonTeam(save);
  // The record and the runs come from the GAMES — a box score knows who won and a
  // stat line does not.
  assert.equal(team.games, 3);
  assert.equal(team.wins, wins, "the club's record is the games it actually won");
  assert.equal(team.losses, 3 - wins);
  assert.equal(team.runsFor, runsFor, "runs scored");
  assert.equal(team.runsAgainst, runsAgainst, "and runs given up");
  assert.equal(team.runDiff, runsFor - runsAgainst);
  assert.ok(team.ops > 0 && team.ops === team.obp + team.slg, "the club has a slash line");
  assert.ok(team.runsPerNine > 0, "and the staff has a rate");

  // Z walks bats -> arms -> the club, and the club's page is rows, not a table:
  // there is one club and nothing to sort it against.
  const app = { save, screen: { name: "seasonStats", view: "hitters", index: 0 }, go() {}, rerender() {} };
  seasonStatsScreen.key(app, "a");
  assert.equal(app.screen.view, "pitchers");
  seasonStatsScreen.key(app, "a");
  assert.equal(app.screen.view, "team", "and then the team they add up to");
  const html = seasonStatsScreen.render(app);
  assert.match(html, /SEASON STATS &middot; THE CLUB/);
  assert.match(html, new RegExp(`RECORD <b>${team.wins}-${team.losses}</b>`));
  assert.match(html, /RUNS <b>\d+-\d+<\/b>/, "the runs, both ways");
  assert.equal(seasonStatsScreen.hoverCard(app, 0), null, "no card hovers off a club row");
  seasonStatsScreen.key(app, "a");
  assert.equal(app.screen.view, "hitters", "and round again to the bats");
});

test("the season page rates a man per 162, not by how long he has been here", async () => {
  const { seasonStatsScreen, seasonLines, statLineHtml } = await import("../src/adventure/ui/statsScreens.js");
  const { seasonHitters } = await import("../src/adventure/state.js");
  const save = testSave();
  const { player, npc } = hookTeams();
  // Two games in the book, so games played can differ from man to man.
  for (const seed of ["per162-a", "per162-b"]) {
    const result = simulateGame(buildTeam(player), buildTeam(npc), seed);
    recordGameStats(save, result.boxScore.away);
  }

  const bats = seasonHitters(save);
  assert.ok(bats.length, "somebody batted");
  for (const line of bats) {
    assert.equal(
      Number(line.wpa162.toFixed(6)),
      Number(((line.wpa * 162) / line.games).toFixed(6)),
      `${line.name} is rated per 162`
    );
  }

  // A man who played one game and swung it is worth MORE than a man who played
  // two and did nothing — summed WPA says the opposite, which is a counting stat
  // being read as a rating.
  const oneGame = { name: "Cup Of Coffee", wpa: 0.4, games: 1, wpa162: (0.4 * 162) / 1 };
  const twoGames = { name: "Been Here", wpa: 0.5, games: 2, wpa162: (0.5 * 162) / 2 };
  assert.ok(oneGame.wpa < twoGames.wpa, "the total says the veteran");
  assert.ok(oneGame.wpa162 > twoGames.wpa162, "the rate says the new man");

  // The season page shows the rate; a box score still shows what a man DID.
  const app = { save, screen: { name: "seasonStats", view: "hitters", index: 0 }, rerender() {} };
  const html = seasonStatsScreen.render(app);
  assert.match(html, /WPA\/162/, "the column says so");
  assert.match(html, /W\/162 IS WINS ADDED PER 162 GAMES/, "and the footer says what the unit is");
  // A season of WPA is WINS, not a percentage: 3.6 wins per 162, never "+361%".
  assert.ok(!/\+\d{3}%/.test(html), "no play-sized percentages on a season page");
  assert.match(html, /[+\u2212]\d+\.\d <span class="gq-dim">W\/162<\/span>/, "it reads as wins");
  assert.equal(seasonLines(app).sorts[0].key, "wpa162", "and the sort follows the number on the screen");

  const line = { ...bats[0] };
  assert.notEqual(
    statLineHtml(line, "hitters", { per162: true }),
    statLineHtml(line, "hitters"),
    "the box score's summed WPA is left alone"
  );
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

test("the team menu swaps the rotation, and a hitter switches position legally and durably", async () => {
  const { rotationCards, swapRotation, positionSwitchOptions, switchPositionTo, lineupSlotOf } =
    await import("../src/adventure/ui/collectionScreens.js");
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

  // The DH is the open case: he fields nothing, so every slot he can play is
  // on offer, and 1B always is.
  const dh = rosterCards(save).find((card) => lineupSlotOf(save, card) === "DH");
  assert.ok(dh, "the lineup seats a DH");
  const switches = positionSwitchOptions(save, dh);
  assert.ok(switches.length >= 1, "the 1B switch at minimum is always on the table");
  assert.ok(switches.every((option) => canPlayerFillLineupSlot(option.card, option.label)), "only legal switches are offered");
  assert.ok(switches.every((option) => !option.player || canPlayerFillLineupSlot(option.player, option.from)), "and the swap works both ways");
  assert.ok(switches.some((option) => option.label === "1B"), "anyone can take first");

  // Applying one moves both men.
  const target = switches[0];
  assert.equal(switchPositionTo(save, dh, target.label), true);
  const after = buildTeam(managerFor(save)).lineup;
  assert.equal(after.find((player) => player.assignedPosition === target.label).id, dh.id, "the old DH takes the field");
  assert.equal(after.find((player) => player.assignedPosition === "DH").id, target.player.id, "the fielder now DHs");
  assert.equal(lineupSlotOf(save, dh), target.label, "and the slot lookup agrees");

  // Illegal switches are refused (any slot he can't play).
  const nowLegal = new Set(positionSwitchOptions(save, dh).map((option) => option.label));
  const illegal = ["C", "2B", "3B", "SS", "CF", "LF", "RF"].find((label) => !nowLegal.has(label));
  if (illegal) assert.equal(switchPositionTo(save, dh, illegal), false, `${illegal} is refused`);

  // The switch survives a bench swap: assignments keep every surviving id.
  const assignmentsBefore = { ...save.roster.lineupAssignments };
  setRoster(save, save.roster.cardIds);
  assert.deepEqual(save.roster.lineupAssignments, assignmentsBefore, "roster edits keep the switch");
  const slots = assignLineupSlots(rosterCards(save), save.roster.lineupAssignments).slots;
  assert.equal(slots.find((slot) => slot.label === "DH").player.id, target.player.id);
});

test("the team roster names the spot each man is playing, not every spot he could", async () => {
  const { teamScreen, lineupSlotOf } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const app = { save, screen: { name: "team", index: 0, mode: "roster" }, rerender() {} };
  const text = teamScreen.render(app).replace(/<[^>]+>/g, " ");
  for (const card of rosterCards(save)) {
    const slot = lineupSlotOf(save, card);
    if (!slot) continue; // an arm, or a bat the lineup couldn't seat
    const surname = card.name.split(" ").pop().toUpperCase();
    assert.match(text, new RegExp(`${surname}\\s+${slot.replace("/", "\\/")}\\s+OB`), `${surname} is listed at ${slot}`);
  }
  // A man eligible at more than one spot is listed at the one he's filling —
  // his card's whole eligibility list never reaches the row.
  const multi = rosterCards(save).find((card) => (card.positions ?? []).length > 1 && lineupSlotOf(save, card));
  if (multi) {
    const label = (multi.positions ?? []).join("/");
    assert.ok(!text.includes(` ${label} OB`), "the eligibility list stays on the card, off the lineup row");
  }
});

test("the team roster lists the DH as DH, and his swap opens on every spare bat", async () => {
  const { teamScreen, benchCards, lineupSlotOf } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const roster = rosterCards(save);
  const dhIndex = roster.findIndex((card) => lineupSlotOf(save, card) === "DH");
  assert.ok(dhIndex >= 0, "the lineup seats a DH");
  const dh = roster[dhIndex];

  const app = { save, screen: { name: "team", index: dhIndex, mode: "roster" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  const text = teamScreen.render(app).replace(/<[^>]+>/g, " ");
  const shown = new RegExp(`${dh.name.split(" ").pop().toUpperCase()}\\s+DH\\s+OB`);
  assert.match(text, shown, "he reads as DH, not as the glove printed on his card");

  // His replacement pool is every spare bat — the DH fields nothing, so the
  // glove printed on his card doesn't narrow it.
  const onPosition = benchCards(save, dh, "position");
  const everyone = benchCards(save, dh, "all");
  assert.deepEqual(
    onPosition.map((card) => card.id).sort(),
    everyone.map((card) => card.id).sort(),
    "the DH's position filter is every spare bat"
  );

  teamScreen.key(app, "a"); // open his action menu
  teamScreen.key(app, "a"); // SWAP THIS CARD leads it
  assert.equal(app.screen.mode, "pick");
  assert.match(teamScreen.render(app), /ANY BAT CAN DH/, "and the header says so");
});

test("a hitter's swap pool follows the slot he fills, not everything printed on his card", async () => {
  const { benchCards, positionSwitchOptions, switchPositionTo, lineupSlotOf } =
    await import("../src/adventure/ui/collectionScreens.js");
  const { canPlayerFillLineupSlot } = await import("../src/rules/draft.js");
  const save = testSave();

  // A corner outfielder: playing LF he should be replaced by men who can play
  // LF, and not by a pure infielder. Seed the collection with one of each.
  const corner = rosterCards(save).find((card) => lineupSlotOf(save, card) === "LF");
  assert.ok(corner, "the lineup seats a left fielder");
  const spare = (predicate) => adventurePool().find((card) =>
    card.kind === "hitter" && !save.roster.cardIds.includes(card.id) && predicate(card)
  );
  const spareCorner = spare((card) => canPlayerFillLineupSlot(card, "LF"));
  const spareInfielder = spare((card) => !canPlayerFillLineupSlot(card, "LF") && card.position === "2B");
  assert.ok(spareCorner && spareInfielder, "the pool has both a corner bat and a second baseman");
  addCardToCollection(save, spareCorner.id);
  addCardToCollection(save, spareInfielder.id);

  const pool = benchCards(save, corner, "position");
  assert.ok(
    pool.every((card) => canPlayerFillLineupSlot(card, "LF")),
    "every man offered can actually play left"
  );
  assert.ok(pool.some((card) => card.id === spareCorner.id), "the spare corner bat is offered");
  assert.ok(!pool.some((card) => card.id === spareInfielder.id), "the second baseman is not");
  assert.ok(
    benchCards(save, corner, "all").some((card) => card.id === spareInfielder.id),
    "though widening to every bat still reaches him"
  );

  // Move him to first, and the pool follows him: now anyone can cover it.
  const toFirst = positionSwitchOptions(save, corner).find((option) => option.label === "1B");
  if (toFirst) {
    assert.equal(switchPositionTo(save, corner, "1B"), true);
    assert.equal(lineupSlotOf(save, corner), "1B");
    const atFirst = benchCards(save, corner, "position").map((card) => card.id).sort();
    const everyBat = benchCards(save, corner, "all").map((card) => card.id).sort();
    assert.deepEqual(atFirst, everyBat, "any glove covers first, so the pool opens up");
  }
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
  // A keeper marked in the binder is still a keeper here — the swap menu that
  // decides who leaves the roster has to show which of the candidates you starred.
  const { toggleStar } = await import("../src/adventure/state.js");
  toggleStar(save, pricier.id);

  const app = { save, screen: { name: "team", index: 0, mode: "roster" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  teamScreen.key(app, "a"); // open the card's action menu
  teamScreen.key(app, "a"); // SWAP THIS CARD leads it
  assert.equal(app.screen.mode, "pick");
  const starredRow = teamScreen.render(app);
  const pricierAt = starredRow.indexOf(pricier.name.split(" ").pop().toUpperCase());
  assert.ok(pricierAt >= 0 && starredRow.indexOf("&#9733;", pricierAt) > pricierAt, "the starred candidate keeps his star in the swap menu");
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
  assert.ok(!teamScreen.render(app).includes("THIS SEASON"), "a fresh season shows no season line");

  const { player, npc } = hookTeams();
  const result = simulateGame(buildTeam(player), buildTeam(npc), "team-stats");
  recordGameStats(save, result.boxScore.away);
  const withStats = teamScreen.render(app);
  assert.ok(withStats.includes("THIS SEASON"), "the season line shows");
  assert.match(withStats.replace(/<[^>]+>/g, " "), /OPS.*1G/, "with the hitter's rates and games");
});

test("the roster locks mid-series; rotation, position switches, and batting order stay live", async () => {
  const { teamScreen, swapRotation, positionSwitchOptions, lineupSlotOf } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  startSeries(save, "gym-garrick", 3);
  const app = { save, screen: { name: "team", index: 0, mode: "roster" }, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  teamScreen.key(app, "a");
  assert.notEqual(app.screen.mode, "pick", "no bench swaps mid-series");
  assert.ok(teamScreen.render(app).includes("SERIES IN PROGRESS"), "the lock is explained");
  assert.equal(swapRotation(save), true, "the rotation still swaps");
  const dh = rosterCards(save).find((card) => lineupSlotOf(save, card) === "DH");
  assert.ok(positionSwitchOptions(save, dh).length >= 1, "position switches stay on the table");

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

  // Both clubs' orders run down the outside edges: surname and on-base, nine
  // deep, every man hoverable. ON DECK is gone — the whole order is right there.
  assert.ok(!html.includes("ON DECK"), "the on-deck line is retired");
  // The away club's strip carries a modifier class (its summary reads to the
  // right edge), so the two are not spelled identically.
  const strips = [...html.matchAll(/<ul class="gq-hud-strip[^"]*">([\s\S]*?)<\/ul>/g)].map((m) => m[1]);
  assert.equal(strips.length, 2, "one strip per club");
  for (const [index, side] of [battle.playerSide, battle.npcSide].entries()) {
    const lineup = battle.state[side].lineup;
    for (const player of lineup) {
      const last = player.name.split(" ").pop().toUpperCase();
      assert.ok(strips[index].includes(last), `${last} stands in his club's order`);
      assert.ok(strips[index].includes(`data-card-id="${player.id}"`), `${last} is hoverable`);
    }
    assert.ok(strips[index].includes(`>${lineup[0].onBase}<`), "on-base values ride along");
    // A tenth row, set apart: the arm behind them, marked P, reading his control.
    const { pitcher } = pitcherStatus(battle.state, side);
    const armLast = pitcher.name.split(" ").pop().toUpperCase();
    assert.match(strips[index], /class="gq-strip-arm[^"]*"/, "the club's arm gets his own row");
    assert.ok(strips[index].includes(`>${armLast}<`), "and it names him");
    assert.ok(strips[index].includes(`>${pitcher.control}<`), "reading his control");
    assert.ok(strips[index].includes(`data-card-id="${pitcher.id}"`), "hoverable like the rest");
  }
  // Only the club at bat lights a man up, and it's the man at the plate. The
  // club in the field marks its leadoff man for next inning, more quietly.
  const lit = [...html.matchAll(/<li class="[^"]*gq-strip-now[^"]*" data-card-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(lit, [phase.batter.id], "exactly one hitter is highlighted: the batter");
  const next = [...html.matchAll(/<li class="[^"]*gq-strip-next[^"]*" data-card-id="([^"]+)"/g)].map((m) => m[1]);
  const fielding = battle.state[battle.npcSide].lineup;
  assert.deepEqual(
    next,
    [fielding[battle.state.lineupIndex[battle.npcSide] % fielding.length].id],
    "and the fielding club marks whoever leads off when they bat"
  );
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

test("the hand-operated board hangs runs by inning, and blank is not nought", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "line-score" });
  const state = battle.state;
  const app = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle, mode: "menu", menuIndex: 0, lines: [] } };

  // Top of the 1st, nobody has batted. The away club's frame is lit but empty —
  // a nought is a finished frame's verdict, and this one is still being played.
  // The home club's frame is neither lit nor filled: they have not come up.
  const cells = (html, row) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((c) => c[1]))
    .filter((r) => r.length)[row];
  const lit = (html, row) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td class="([^"]*)"[^>]*>/g)].map((c) => c[1]))
    .filter((r) => r.length)[row];
  let html = battleScreen.render(app);
  assert.equal(cells(html, 0)[0], "", "the frame being played hangs nothing until a run comes in");
  assert.ok(lit(html, 0)[0].includes("gq-line-live"), "but the slot is lit");
  assert.equal(cells(html, 1)[0], "", "the home club has not come up: its frame stays blank");
  assert.ok(!lit(html, 1)[0].includes("gq-line-live"), "and is not lit");

  // A run lands in the frame being played, and now the slot reads it.
  state.lineScore.away = [1];
  state.score.away = 1;
  assert.equal(cells(battleScreen.render(app), 0)[0], "1", "the run hangs as soon as it scores");

  // Runs land in the frame they were scored in, and a finished scoreless frame
  // does read nought.
  state.lineScore.away = [2, 0, 1];
  state.lineScore.home = [0, 3];
  state.score.away = 3;
  state.score.home = 3;
  state.inning = 3;
  state.half = "top";
  html = battleScreen.render(app);
  const away = cells(html, 0);
  const home = cells(html, 1);
  assert.deepEqual(away.slice(0, 3), ["2", "0", "1"], "the away club's frames read across");
  assert.deepEqual(home.slice(0, 3), ["0", "3", ""], "and the home club has not batted in the 3rd yet");
  assert.equal(away[away.length - 1], "3", "the total hangs on the end");
  assert.equal(home[home.length - 1], "3");
  assert.ok(away.length >= 10, "nine frames and a total, at least");
});

test("the board hangs extra frames until the wall runs out, then slides", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "extras" });
  const state = battle.state;
  const app = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle, mode: "menu", menuIndex: 0, lines: [] } };
  const frames = () => [...battleScreen.render(app).matchAll(/<tr class="gq-line-head">([\s\S]*?)<\/tr>/g)]
    .flatMap((m) => [...m[1].matchAll(/<th>(\d+)<\/th>/g)].map((n) => Number(n[1])));

  // Nine innings: the board reads 1 through 9.
  assert.deepEqual(frames(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // The 10th hangs off the end — there is still wall for it.
  state.inning = 10;
  assert.deepEqual(frames(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "extras hang a new frame");

  // Past that the board slides: the oldest frame comes down, the newest goes up,
  // and the count of frames on the wall never grows.
  state.inning = 13;
  assert.deepEqual(frames(), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13], "the 1st through 3rd come down");
  assert.equal(frames().length, 10, "the wall still holds ten");

  // The run total still counts the frames that came down.
  state.lineScore.away = [3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  state.score.away = 3;
  const html = battleScreen.render(app);
  assert.ok(!html.includes(">1</th>"), "the 1st is off the board");
  assert.match(html, /gq-line-total">3</, "but its runs are still in the total");
});

test("every run reaches the board, in the inning it was scored", async () => {
  const { fastForward } = await import("../src/rules/battle/controller.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "line-score-live" });
  // fastForward stops at every leverage moment; keep waving it on to the end.
  for (let guard = 0; guard < 300 && battlePhase(battle).type !== "over"; guard += 1) fastForward(battle);
  const state = battle.state;
  const total = (side) => state.lineScore[side].reduce((sum, runs) => sum + runs, 0);
  assert.ok(state.score.away + state.score.home > 0, "the game actually scored");
  assert.equal(total("away"), state.score.away, "the away board adds up to the away score");
  assert.equal(total("home"), state.score.home, "and the home board to the home score");
  // Nothing hung in a frame that was never played.
  assert.ok(state.lineScore.away.length <= state.inning, "no runs land past the last inning");
  assert.ok(state.lineScore.home.length <= state.inning);
});

test("the walk-on survives the render that lands on top of it", async () => {
  const { mapScreen, trainerIntroScreen } = await import("../src/adventure/ui/mapScreen.js");
  const save = testSave();
  const app = {
    save,
    screen: { name: "map" },
    go(name, data = {}) { this.screen = { name, ...data }; this.rerender(); },
    rerender() {
      const screen = this.screen.name === "map" ? mapScreen : trainerIntroScreen;
      this.html = screen.render(this);
      screen.mounted?.(this);
    }
  };
  app.rerender();

  // Walking onto a trainer is TWO renders in one task: go() renders and mounts,
  // then mapScreen.key rerenders on its way out. The animation has to survive
  // the second one — marking the intro spent in mounted() killed it before the
  // browser ever painted a frame.
  mapScreen.key(app, "a");
  assert.equal(app.screen.name, "trainerIntro", "we are at the stare-down");
  assert.match(app.html, /gq-versus-enter/, "and the two of them are still walking on");
  assert.match(app.html, /gq-intro-late/, "with the name plate and his line still held back");
  assert.ok(app.screen.introRunning, "the walk-on is running");

  // Nothing you press hurries it, and nothing you press restarts it.
  trainerIntroScreen.key(app, "a");
  assert.match(app.html, /gq-versus-enter/, "a button during the walk-on does nothing");
  assert.equal(app.screen.page, 0, "his first line is still his first line");

  // Once it has actually played, the screen draws the two of you standing there.
  app.screen.introRunning = false;
  app.screen.introPlayed = true;
  app.rerender();
  assert.ok(!app.html.includes("gq-versus-enter"), "no second walk-on");
  assert.ok(!app.html.includes("gq-intro-late"), "and nobody waits to speak again");
});

test("the scoreboard puts up the man, not his suffix", async () => {
  const { surname } = await import("../src/ui/cardFace.js");
  assert.equal(surname("Ken Griffey Jr."), "GRIFFEY", "the lineup strip had a JR. batting third");
  assert.equal(surname("Ken Griffey Jr. '97"), "GRIFFEY", "card year and suffix both come off");
  assert.equal(surname("Cal Ripken Jr."), "RIPKEN");
  assert.equal(surname("Bob Smith III"), "SMITH");
  assert.equal(surname("A.J. Pierzynski '03"), "PIERZYNSKI", "an initialed first name is still not the surname");
  assert.equal(surname("Ichiro Suzuki"), "SUZUKI");
  assert.equal(surname("Ichiro"), "ICHIRO", "a one-word man is his own surname");
});

test("the diamond acts out the play: a lap for a homer, a shake for a man cut down", async () => {
  const { playMotion } = await import("../src/adventure/ui/battleScreen.js");

  // A home run touches all four, in order — that's the lap.
  assert.deepEqual(playMotion([{ result: "HR", runs: 1 }]), { path: [1, 2, 3, 4], outs: [] });
  assert.deepEqual(playMotion([{ result: "2B", runs: 0 }]).path, [1, 2], "a double runs through first");
  assert.deepEqual(playMotion([{ result: "BB", runs: 0 }]).path, [1], "a walk is a trot to first");

  // A single that brings a man home lights first and the plate, and nothing between.
  assert.deepEqual(playMotion([{ result: "1B", runs: 1 }]).path, [1, 4]);

  // A runner cut down stealing shakes the bag he was going for, and does not
  // pulse it — he never got there.
  const caught = playMotion([
    { result: "CS", runs: 0, playDetails: { kind: "steal", stealAttempt: { to: "2B", safe: false } } }
  ]);
  assert.deepEqual(caught, { path: [], outs: [2] });

  // A steal that works pulses the base instead.
  const stolen = playMotion([
    { result: "SB", runs: 0, playDetails: { kind: "steal", stealAttempt: { to: "2B", safe: true } } }
  ]);
  assert.deepEqual(stolen, { path: [2], outs: [] });

  // A hit with runners going: the safe ones light up, the thrown-out one shakes.
  const mixed = playMotion([
    {
      result: "1B",
      runs: 1,
      playDetails: {
        kind: "hit",
        attempts: [{ to: "home", safe: true }, { to: "3B", safe: false }]
      }
    }
  ]);
  assert.deepEqual(mixed.path, [1, 4], "the batter to first, the runner home");
  assert.deepEqual(mixed.outs, [3], "and the man thrown out at third");

  // Nothing happened on the bases: nothing moves.
  assert.deepEqual(playMotion([{ result: "SO", runs: 0 }]), { path: [], outs: [] });
  assert.deepEqual(playMotion([]), { path: [], outs: [] });
});

test("the menu right-aligns when the opponent is hitting", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  // Home game, top 1: the NPC bats, the player pitches — defense menu.
  const homeGame = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "align-home", playerIsAway: false });
  const app = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle: homeGame, mode: "menu", menuIndex: 0, lines: [] } };
  assert.ok(battleScreen.render(app).includes("gq-menu-right"), "the defense menu reads from the other dugout");
  // Road game, top 1: the player bats — the offense menu stays left.
  const roadGame = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "align-road" });
  const roadApp = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle: roadGame, mode: "menu", menuIndex: 0, lines: [] } };
  assert.ok(!battleScreen.render(roadApp).includes("gq-menu-right"), "the batting menu stays left-aligned");
});

test("a game in progress rebuilds itself from its seed and the decisions taken", () => {
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "resume-me", playerIsAway: false });
  // Manage a game with every kind of decision in it, exactly the way the battle
  // screen does — including the NPC skipper's look at his mound after each one.
  const rng = createRng("resume-choices");
  for (let i = 0; i < 60; i += 1) {
    const phase = battlePhase(battle);
    if (phase.type === "over") break;
    if (phase.type === "advance-decision") actAdvance(battle, rng.next() < 0.5 ? 0 : 1);
    else if (phase.type === "player-batting") {
      if (phase.stealOptions.length && rng.next() < 0.5) actSteal(battle, phase.stealOptions[0].fromIndex);
      else if (phase.canBunt && rng.next() < 0.3) actBunt(battle);
      else actSwing(battle);
    } else if (rng.next() < 0.1 && phase.bullpen.length) actChangePitcher(battle, phase.bullpen[0].index);
    else if (rng.next() < 0.1) actIntentionalWalk(battle);
    else actPitch(battle);
    npcMoundVisit(battle);
  }
  assert.ok(battle.eventCount > 10, "there is a game here to lose");
  const kinds = new Set(battle.actions.map((action) => action.type));
  assert.ok(kinds.size >= 3, "and it was managed, not just swung at");

  // What the save would hold: a seed, a few hundred bytes of decisions. No state.
  const stashed = JSON.parse(JSON.stringify(serializeBattle(battle)));
  const resumed = restoreBattle({ playerManager: player, npcManager: npc, trainer, ...stashed });
  assert.ok(resumed, "the recording replays");
  assert.deepEqual(resumed.state.score, battle.state.score, "same score");
  assert.equal(resumed.state.inning, battle.state.inning, "same inning");
  assert.equal(resumed.state.half, battle.state.half, "same half");
  assert.equal(resumed.state.outs, battle.state.outs, "same outs");
  assert.deepEqual(
    resumed.state.bases.map((runner) => runner?.id ?? null),
    battle.state.bases.map((runner) => runner?.id ?? null),
    "same men on"
  );
  assert.deepEqual(resumed.state.lineScore, battle.state.lineScore, "same frames hung on the board");
  assert.equal(resumed.events.length, battle.events.length, "every play back in the book");
  assert.deepEqual(
    resumed.events.map((event) => `${event.result ?? event.type}:${event.resultRoll ?? ""}`),
    battle.events.map((event) => `${event.result ?? event.type}:${event.resultRoll ?? ""}`),
    "the same dice, in the same order"
  );
  assert.deepEqual(battlePhase(resumed), battlePhase(battle), "and it asks the manager the same question");

  // A recording this engine cannot read is refused, not half-applied.
  assert.equal(
    restoreBattle({ playerManager: player, npcManager: npc, trainer, ...stashed, actions: [{ type: "levitate" }] }),
    null,
    "an unknown decision means no resume"
  );
  assert.equal(
    restoreBattle({ playerManager: player, npcManager: npc, trainer, ...stashed, eventCount: stashed.eventCount + 1 }),
    null,
    "and so does a game that replays to a different number of plays"
  );
});

test("the play description is the whole book of the game, ruled at the innings", async () => {
  const { battleScreen, startTrainerBattle, rebuildPlayLog } = await import("../src/adventure/ui/battleScreen.js");
  const save = testSave();
  const trainer = trainerById("scout-jojo");
  const app = { save, screen: {}, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  startTrainerBattle(app, trainer);

  // The book opens with the words the game opens with.
  assert.ok(app.screen.playLog.length, "there is a book");
  const opening = app.screen.playLog[0].lines.join(" ");
  assert.match(opening, /Winner takes the coins|best-of/, "and it opens where the game does");

  // Play a couple of innings.
  for (let i = 0; i < 24 && app.screen.name === "battle"; i += 1) {
    if (battlePhase(app.screen.battle).type === "over") break;
    battleScreen.key(app, "a");
  }
  // The loop can land on a suspense pause, and the dice screen holds the floor
  // instead of the book. Let the play finish before reading the screen.
  for (let i = 0; i < 12 && app.screen.mode === "drama"; i += 1) {
    battleScreen.key(app, "a");
  }
  const entries = app.screen.playLog;
  assert.ok(entries.length > 6, "every play went in the book, not just the last one");

  const html = battleScreen.render(app);
  // The oldest play is still on the screen — that is the whole point. It scrolls.
  assert.ok(html.includes(entries[0].lines[0]), "the first thing said is still there");
  assert.ok(html.includes(entries.at(-1).lines.at(-1)), "and so is the newest");

  // Each play stands apart, and there is floor under the last one — without it the
  // newest play cannot be scrolled to the TOP of the box, and would sit at the
  // bottom with the old plays above it, which is the one thing this log must not
  // do: what just happened has to be the first thing your eye lands on.
  assert.equal(
    (html.match(/class="gq-play"/g) ?? []).length,
    entries.length,
    "every play is its own block"
  );
  assert.match(html, /gq-play-floor/, "and there is room under the last of them");

  // A rule wherever the sides changed, naming the half that closed and the score
  // as it stood, read from your dugout.
  const halves = new Set(entries.map((entry) => `${entry.half}${entry.inning}`));
  const rules = [...html.matchAll(/gq-play-break[^>]*><span>([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.equal(rules.length, halves.size - 1, "one rule per half-inning that ended");
  assert.match(rules[0], /END TOP 1 &middot; \d+-\d+/, "which names it and says where the game stood");

  // A game you come back to comes back to the whole book, not a blank box.
  const rebuilt = rebuildPlayLog(app.screen.battle);
  assert.ok(rebuilt.length > 5, "the book rebuilds from the plays themselves");
  // Every play the rebuild reads off the persisted events also happened in the
  // live book — the reopened game is the same game. (The live book can carry a
  // display-only beat the events don't, e.g. "The runners hold." after a fly
  // ball; the rebuild folds that back into the play it belongs to, so compare on
  // presence, not on the exact final line, which depends on how the game ended.)
  const livePlays = new Set(entries.map((entry) => entry.lines.join("")));
  assert.ok(
    livePlays.has(rebuilt.at(-1).lines.join("")),
    "the last play it rebuilds is one that actually happened"
  );
});

test("closing the tab mid-inning does not cost you the game", async () => {
  const { startTrainerBattle, resumeBattle, battleScreen, gameOverScreen } = await import("../src/adventure/ui/battleScreen.js");
  const save = testSave();
  const trainer = trainerById("scout-jojo");
  const app = { save, screen: {}, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  startTrainerBattle(app, trainer);
  assert.equal(app.screen.name, "battle");
  assert.ok(save.activeBattle, "the game is on the books the moment it starts");

  // Manage a few plate appearances.
  for (let i = 0; i < 8; i += 1) {
    if (battlePhase(app.screen.battle).type === "over") break;
    battleScreen.key(app, "a");
  }
  const battle = app.screen.battle;
  assert.ok(save.activeBattle.actions.length > 0, "and every decision after that");
  assert.ok(!save.activeBattle.state, "the state is replayed, never stored");

  // Close the tab: all that survives is what went to localStorage.
  const reloaded = JSON.parse(JSON.stringify(save));
  const booted = { save: reloaded, screen: { name: "title" } };
  const screen = resumeBattle(booted);
  assert.ok(screen, "and the save knows there is a game to come back to");
  assert.equal(screen.name, "battle", "which opens at the plate, not the title");
  assert.equal(screen.trainerId, trainer.id);
  assert.deepEqual(screen.battle.state.score, battle.state.score, "same score");
  assert.equal(screen.battle.state.inning, battle.state.inning, "same inning");
  assert.equal(screen.battle.state.outs, battle.state.outs, "same outs");
  assert.equal(screen.battle.events.length, battle.events.length, "the same plays in the book");
  assert.deepEqual(screen.lines, app.screen.lines, "and the same call still on the screen");

  // Finish it. Once the coins are paid there is nothing to come back to.
  booted.go = function (name, data = {}) { this.screen = { name, ...data }; };
  booted.rerender = () => {};
  booted.screen = screen;
  for (let i = 0; i < 400 && booted.screen.name === "battle"; i += 1) battleScreen.key(booted, "a");
  assert.equal(booted.screen.name, "gameOver", "the game ends on the FINAL screen");
  assert.ok(reloaded.activeBattle, "which has not paid out yet, so the game is still on the books");
  assert.equal(resumeBattle({ save: JSON.parse(JSON.stringify(reloaded)) })?.name, "gameOver", "a reload there comes back to FINAL");
  gameOverScreen.key(booted, "a");
  assert.equal(reloaded.activeBattle, null, "and once it pays out, the book is closed");
});

test("walking out to the main menu mid-inning does not cost you the game either", async () => {
  const { startTrainerBattle, battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { titleScreen } = await import("../src/adventure/ui/titleScreens.js");
  const save = testSave();
  const trainer = trainerById("scout-jojo");
  const app = { save, screen: {}, go(name, data = {}) { this.screen = { name, ...data }; }, rerender() {} };
  startTrainerBattle(app, trainer);
  for (let i = 0; i < 8; i += 1) {
    if (battlePhase(app.screen.battle).type === "over") break;
    battleScreen.key(app, "a");
  }
  const left = app.screen.battle;

  // The MAIN MENU button: straight to the front door, nothing written on the way.
  app.go("title", { menuIndex: 0 });
  assert.match(titleScreen.render(app), /CONTINUE/, "which offers to give the game back");

  // CONTINUE (the first row) hands back the game, not the map.
  titleScreen.key(app, "a");
  assert.equal(app.screen.name, "battle", "and CONTINUE puts you back at the plate");
  assert.equal(app.screen.trainerId, trainer.id, "against the same manager");
  assert.deepEqual(app.screen.battle.state.score, left.state.score, "same score");
  assert.equal(app.screen.battle.state.inning, left.state.inning, "same inning");
  assert.equal(app.screen.battle.state.outs, left.state.outs, "same outs");
  assert.equal(app.screen.battle.events.length, left.events.length, "the same plays in the book");

  // With no game on the books, CONTINUE means the map, the way it always did.
  save.activeBattle = null;
  app.go("title", { menuIndex: 0 });
  titleScreen.key(app, "a");
  assert.equal(app.screen.name, "map", "and with nothing to come back to, the map");
});

test("a tiring arm rings the bullpen phone — once per step down, and never for the new man", async () => {
  const { fatigueAlarm } = await import("../src/adventure/ui/battleScreen.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  // The player is at home, so the arm the manager can actually pull is the home
  // one — actChangePitcher goes to HIS pen.
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "fatigue-seed", playerIsAway: false });
  const state = battle.state;
  const fresh = pitcherStatus(state, "home");

  // Nobody is tired yet, so nothing is said.
  let heard = {};
  let alarm = fatigueAlarm(battle, heard);
  assert.equal(alarm.sound, null, "a fresh arm is not news");
  heard = alarm.now;

  // He goes past his tank: the first step down is the arm starting to labour.
  state.pitching.home.battersFaced = fresh.tiredAt + 1;
  alarm = fatigueAlarm(battle, heard);
  assert.equal(alarm.sound, "tiring", "the first step down says so");
  heard = alarm.now;

  // Same batter count, same penalty: it does not say it twice.
  alarm = fatigueAlarm(battle, heard);
  assert.equal(alarm.sound, null, "a penalty that has not moved is not news again");
  heard = alarm.now;

  // Deeper into the hole: a different sound, because it is a different problem.
  state.pitching.home.battersFaced = fresh.tiredAt + 12;
  alarm = fatigueAlarm(battle, heard);
  assert.equal(alarm.sound, "spent", "getting worse gets its own noise");
  heard = alarm.now;

  // The manager goes to the pen. The new man is fresh, and his zero must not be
  // heard as the old man's tiredness coming down — nor may he inherit it, and
  // then say nothing when HE starts to labour.
  const relief = actChangePitcher(battle);
  assert.ok(relief.length, "an arm comes in");
  alarm = fatigueAlarm(battle, heard);
  assert.equal(alarm.sound, null, "a fresh arm out of the pen is quiet");
  heard = alarm.now;

  const newMan = pitcherStatus(state, "home");
  state.pitching.home.battersFaced = newMan.tiredAt + 1;
  alarm = fatigueAlarm(battle, heard);
  assert.equal(alarm.sound, "tiring", "and when he tires, the phone rings for him too");
});

test("the winner's pick says which of his men you already own", async () => {
  const { claimCardScreen } = await import("../src/adventure/ui/battleScreen.js");
  const save = testSave();
  const trainer = trainerById("scout-jojo");
  const theirs = buildNpcTeam(trainer, save).roster;

  const app = { save, screen: { name: "claimCard", trainerId: trainer.id, index: 0 }, go() {}, rerender() {} };
  const before = claimCardScreen.render(app);
  assert.ok(!before.includes("*x"), "a man you do not own is not marked");

  // Claiming a man you already hold is a real choice — a spare to sell, a hedge —
  // but it has to be a choice you MAKE, not one you discover afterwards.
  addCardToCollection(save, theirs[0].id);
  addCardToCollection(save, theirs[0].id);
  const html = claimCardScreen.render(app);
  assert.match(html, /\*x2/, "the row says how many you hold");
  assert.match(html, /x2</, "and so does the card, the way it does everywhere else");
});

test("the bullpen opens as a compare screen: the warming arm beside the one on the mound", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { battlePhase } = await import("../src/rules/battle/controller.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  // Home game, top 1: the player is pitching, so the pen is live.
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "pen-compare", playerIsAway: false });
  const app = { save: testSave(), screen: { name: "battle", trainerId: trainer.id, battle, mode: "pen", penIndex: 0, lines: [] } };
  const reliever = battlePhase(battle).bullpen[0].pitcher;
  const starter = battle.state.home.pitchers[0];
  const html = battleScreen.render(app);
  assert.ok(html.includes("BULLPEN"), "the pen gets the whole screen, not a corner of the textbox");
  assert.ok(html.includes("gq-card-side"), "and the roster book's card column");
  assert.ok(html.includes(reliever.name.toUpperCase()), "the warming arm's card is up");
  assert.ok(html.includes("ON THE MOUND"), "so is the man he would replace");
  assert.ok(html.includes(starter.name.toUpperCase()), "the starter's card is there to read against him");
  assert.equal(battleScreen.hoverCard(app, 0)?.id, reliever.id, "hovering a pen row floats his card");
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

  // The room calls the result out loud — once. This screen rerenders, and a
  // fanfare on every one of them would turn the best moment in the game into a
  // stuck record.
  assert.ok(!app.screen.calledIt, "nothing has been called yet");
  gameOverScreen.mounted(app);
  assert.ok(app.screen.calledIt, "the call is made");
  gameOverScreen.mounted(app);
  gameOverScreen.mounted(app);
  assert.ok(app.screen.calledIt, "and not made again");

  gameOverScreen.key(app, "a");
  assert.equal(app.screen.name, "gameStats", "Z continues to the box score");
});

test("the NPC mound visit is its own event, never smuggled into the swing", async () => {
  const { npcMoundVisit } = await import("../src/rules/battle/controller.js");
  const { AI_PROFILES } = await import("../src/rules/battle/ai.js");
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "mound-visit" });
  battle.profile = AI_PROFILES.conservative;
  // Late enough that the bullpen can finish what's left: a conservative skipper
  // won't burn the pen in the first inning, however tired the starter, if it
  // can't cover nine. By the eighth the math is unambiguous — pull the arm.
  battle.state.inning = 8;
  const starter = battle.state.home.pitchers[0];
  // Pin the arms so the hook is unambiguous, not left to what the generated NPC
  // fields: a tired, beatable six-inning starter past his planned depth by the
  // eighth, with a clearly better fresh arm behind him. (Generation can hand the
  // NPC an elite ace, or an 8-IP workhorse still inside his plan here — a
  // conservative skipper rides either out, which is not the event under test.)
  starter.control = 3;
  starter.plannedOuts = 18;
  starter.ip = 6;
  battle.state.home.pitchers[1].control = 6;
  battle.state.home.pitchers[1].ip = 1;
  battle.state.pitching.home.battersFaced = starter.ip * 4 + 4;
  // Deep into the game — his four-inning floor is long spent, so the only thing
  // deciding the hook is the fatigue math the test is about.
  battle.state.pitching.home.outsRecorded = 21;

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
  assert.ok(twinKilling.includes("Double play! Two gone. (rolled 12)"), "the throw reports its roll");
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
  // A grounder that turned two is logged as a GIDP, not the bare GB it started as.
  const twinKilling = gameLogLine({ ...swing, runs: 0, result: "GB", playDetails: { doublePlayAttempt: { batterOut: true, roll: 17 } } }, "away");
  assert.ok(twinKilling.includes("<b>GIDP</b>"), "a double play is called a GIDP in the log");
  assert.ok(!twinKilling.includes("<b>GB</b>"), "and not the grounder it began as");
  const theirs = gameLogLine({ ...swing, half: "bottom" }, "away");
  assert.ok(theirs.includes("-18%"), "their swing reads negative");
  const atHome = gameLogLine(swing, "home");
  assert.ok(atHome.includes("1-3"), "the score flips to read from the home player's side");
  const pen = gameLogLine({ type: "pitching-change", inning: 5, half: "bottom", team: "Them Club", pitcher: "Cy Muller" }, "away");
  assert.ok(pen.includes("PEN"), "pitching changes log without WPA");

  // Both men in the plate appearance are named, and both float their card.
  const withIds = gameLogLine({ ...swing, batterId: "h-1", pitcherId: "p-9" }, "away");
  assert.ok(withIds.includes("B.DIAZ"), "the arm is named too, not just the bat");
  assert.match(withIds, /data-card-id="h-1"/, "the batter hovers");
  assert.match(withIds, /data-card-id="p-9"/, "and so does the pitcher");

  // Rows carry the base-out situation the play happened in — as the diamond
  // itself, occupied bags filled, rather than "1-3" to be decoded.
  const situated = gameLogLine({ ...swing, outsBefore: 1, basesBefore: ["A Runner", null, "C Runner"] }, "away");
  // The outs are the banner's three lamps, not the digit: one lit, two dark.
  const lamps = [...situated.matchAll(/<i class="(gq-out-on)?"><\/i>/g)];
  assert.equal(lamps.length, 3, "three lamps, before the actor");
  assert.equal(lamps.filter((m) => m[1]).length, 1, "one of them lit for the one out");
  assert.match(situated, /gq-diamond-mini/, "and the bases show as the diamond");
  const filled = [...situated.matchAll(/class="gq-base ([^"]*)"/g)].map((m) => m[1]);
  assert.ok(filled.some((c) => c.includes("gq-base-1") && c.includes("gq-base-on")), "first is occupied");
  assert.ok(filled.some((c) => c.includes("gq-base-3") && c.includes("gq-base-on")), "third is occupied");
  assert.ok(!filled.some((c) => c.includes("gq-base-2") && c.includes("gq-base-on")), "second is not");
  const empty = gameLogLine({ ...swing, outsBefore: 0, basesBefore: [null, null, null] }, "away");
  assert.ok(!empty.includes("gq-base-on"), "empty bases fill nothing");
  assert.ok(!gameLogLine(swing, "away").includes("gq-diamond-mini"), "rows without a snapshot stay clean");
});

test("the play-by-play opens with the two dice that decided the at-bat", async () => {
  const { describeEvent } = await import("../src/adventure/ui/helpers.js");
  const swing = {
    inning: 3,
    half: "top",
    batter: "Al Smith",
    pitcher: "Bo Diaz",
    result: "HR",
    runs: 1,
    outsAfter: 1,
    scoreAfter: { away: 1, home: 0 },
    controlRoll: 4,
    resultRoll: 19
  };
  const lines = describeEvent(swing, "away");
  assert.equal(lines[0], "PITCH 4 vs SWING 19.", "the dice are called before the play is");
  assert.ok(lines[1].includes("SMITH"), "and the call still follows");
  // A play with no duel — a man taking an extra base — has no dice to call.
  const advance = describeEvent({
    ...swing,
    type: "advance",
    playDetails: { attempts: [{ runner: "Lead Man", to: "3B", thrown: false }] }
  }, "away");
  assert.ok(!advance.some((line) => line.startsWith("PITCH")), "no pitch line where there was no pitch");
});

test("the finished game's log carries the win-probability line, dotted at the swings", async () => {
  const { gameStatsScreen, winProbChartHtml } = await import("../src/adventure/ui/statsScreens.js");
  const play = (over) => ({
    inning: 1 + Math.floor(over / 2),
    half: over % 2 === 0 ? "top" : "bottom",
    batter: `Bat ${over}`,
    pitcher: `Arm ${over}`,
    result: "GB",
    runs: 0,
    outsBefore: 0,
    basesBefore: [null, null, null],
    scoreAfter: { away: 0, home: 0 },
    wpa: 0.02,
    wpAfter: 0.5
  });
  const events = [play(0), play(1), play(2), play(3)];
  // Two plays that actually swung it, and one arm change, which has no odds of
  // its own and no row on the line.
  events[1] = { ...events[1], wpa: 0.22, wpAfter: 0.72, result: "HR" };
  events[3] = { ...events[3], wpa: -0.31, wpAfter: 0.41, result: "SO" };
  events.splice(2, 0, { type: "pitching-change", inning: 2, half: "top", team: "Them", pitcher: "Reliever" });

  const chart = winProbChartHtml(events, "home", 0);
  assert.match(chart, /gq-wp-chart/, "the line is drawn");
  const swings = [...chart.matchAll(/gq-wp-swing/g)];
  assert.equal(swings.length, 2, "a dot on each 10%+ swing, and only those");
  assert.match(chart, /22% swing/, "the dot says how far it moved");

  // Clicks carry the row in the LIST, not the position on the line: the arm
  // change has no point of its own, so the two indexes are not the same number.
  const rows = [...chart.matchAll(/data-log-index="(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(rows, [0, 1, 3, 4], "every point points at the play it came from");

  // And the screen the player actually lands on after a game shows it.
  const app = {
    save: testSave(),
    screen: {
      name: "gameStats",
      view: "log",
      events,
      playerSide: "home",
      score: { home: 3, away: 1 },
      trainerId: "scout-jojo",
      index: 0,
      next: { name: "map", data: {} }
    }
  };
  const html = gameStatsScreen.render(app);
  assert.match(html, /gq-wp-chart/, "the finished log has the line above it");
  assert.match(html, /gq-wp-swing/, "with the swings dotted");
  // A game with nothing to plot draws nothing rather than a degenerate line.
  assert.equal(winProbChartHtml([events[0]], "home", 0), "", "one play is not a chart");
  assert.equal(winProbChartHtml([], "home", 0), "");
});

test("the game log shows the dice and the running win probability", async () => {
  const { gameLogLine } = await import("../src/adventure/ui/statsScreens.js");
  const pa = {
    inning: 3,
    half: "top",
    batter: "Al Smith",
    pitcher: "Bo Diaz",
    result: "HR",
    runs: 2,
    scoreAfter: { away: 3, home: 1 },
    wpa: 0.18,
    controlRoll: 4,
    effectiveControl: 5,
    controlTotal: 9,
    onBase: 11,
    chartOwner: "hitter",
    resultRoll: 17,
    fatiguePenalty: 0,
    wpAfter: 0.28
  };
  // One row, arm first: each man carries the die he threw, right beside his
  // name. No second line, and no arithmetic — that is what the cards are for.
  const line = gameLogLine({ ...pa, pitcherId: "p-9", batterId: "h-1" }, "away");
  const text = line.replace(/<[^>]+>/g, "");
  assert.match(text, /B\.DIAZ \(4\) v A\.SMITH \(17\)/, "arm and his die, then the bat and his");
  assert.ok(!line.includes("PITCH:"), "the dice do not queue on a line of their own");
  assert.ok(!line.includes("VS OB"), "the control sum is not spelled out");
  assert.ok(!line.includes("gq-log-detail"), "and there is no second line to put it on");
  assert.match(line, /data-card-id="p-9"/, "the arm still hovers");
  assert.match(line, /data-card-id="h-1"/, "and so does the bat");
  // The odds lead with the level and carry the step in parentheses behind it.
  assert.ok(line.includes("WP: 72%"), "the away player's running odds are the home team's inverted");
  assert.ok(gameLogLine(pa, "home").includes("WP: 28%"), "the home player reads them straight");
  assert.match(line.replace(/<[^>]+>/g, ""), /WP: 72% \(\+\d+%\)/, "the swing rides behind the level, in parentheses");

  // A steal throws one die, and it belongs to the runner. The arm on the mound
  // did not beat him, so he is not in the row at all.
  const steal = {
    type: "steal",
    inning: 5,
    half: "bottom",
    batter: "Al Smith",
    result: "SB",
    runs: 0,
    scoreAfter: { away: 1, home: 1 },
    wpa: 0.03,
    wpAfter: 0.6,
    playDetails: { kind: "steal", stealAttempt: { runner: "Dee Gordon", roll: 13, fielding: 5, total: 18, target: 19, safe: true } }
  };
  const stealLine = gameLogLine(steal, "home");
  const stealText = stealLine.replace(/<[^>]+>/g, "");
  assert.match(stealText, /D\.GORDON \(13\)/, "the runner carries the throw he beat");
  assert.ok(stealLine.includes("WP: 60%"), "and the odds it left you at");
  assert.ok(!stealText.includes(" v "), "no pitcher is set against him");

  const pen = gameLogLine({ type: "pitching-change", inning: 5, half: "bottom", team: "Them Club", pitcher: "Cy Muller" }, "away");
  assert.ok(!pen.includes("WIN"), "a substitution rolls nothing and moves no odds");
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
    // The strict Ohtani-likes merge; converts and thin overlaps don't.
    assert.ok(MLB_DUAL_PERSONS.includes("ohtansh01"), "Ohtani merges");
    assert.ok(MLB_DUAL_PERSONS.includes("dihigma99"), "Dihigo merges");
    assert.ok(!MLB_DUAL_PERSONS.includes("dunleja01"), "Dunleavy's window misses the pool's entry bar — two separate cards");
    assert.equal(dualPartnerId("mlb-all-ankieri01"), null, "Ankiel converted sequentially — two separate cards");
    assert.equal(dualPartnerId("mlb-all-ruthba01"), null, "Ruth's CAREER printings stay two separate cards");

    // A real simultaneous stretch inside a longer career mints a third
    // printing: the tw-slice pair, rated on just the two-way window.
    const twArm = cardById("mlb-tw-ruthba01");
    const twBat = cardById("mlb-tw-ruthba01-bat");
    assert.ok(twArm && twBat, "1915-19 Ruth is in the pool, both halves");
    assert.equal(dualPartnerId(twArm.id), twBat.id, "the tw pair merges by its slice");
    assert.ok(twBat.points < cardById("mlb-all-ruthba01-bat").points, "the window bat rates below the career bat");
    // The tw printing is its own era: it can't share a team with career Ruth.
    assert.ok(personConflict([cardById("mlb-all-ruthba01")], twArm), "one Ruth per roster");

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
  const { duplicateEraPeople } = await import("../src/rules/draft.js");
  const { personConflict, playerIdentity } = await import("../src/rules/cards.js");
  const { dealDraftDeck } = await import("../src/data/universes.js");
  const { benchCards } = await import("../src/adventure/ui/collectionScreens.js");
  setUniverseSeed("era-rule", "decades-1910,1920,1990,2000");
  try {
    const pool = adventurePool();
    const bonds90 = cardById("mlb-d1990-bondsba01");
    const bonds00 = cardById("mlb-00s-bondsba01");
    assert.ok(bonds90 && bonds00, "both Bonds eras are in the pool");
    assert.equal(playerIdentity(bonds90.id).person, playerIdentity(bonds00.id).person, "same human");

    // The rules layer flags the pair: a COLLECTION can turn up both Bondses,
    // and a roster built out of them is illegal.
    const issues = validateRoster({ roster: [bonds90, bonds00], lineupAssignments: {} });
    assert.ok(issues.some((issue) => issue.includes("two eras of Barry Bonds")), "validateRoster names the clash");

    // A DRAFT settles it at the deal instead of at the pick: the board prints
    // each man once, so the second era is never on it and no pick has to be
    // refused for a reason nobody can see coming.
    const deck = dealDraftDeck("era-rule");
    assert.deepEqual(duplicateEraPeople(deck), [], "the dealt board holds one era of every man");
    const bondsCards = deck.filter((card) => playerIdentity(card.id)?.person === "bondsba01");
    assert.ok(bondsCards.length <= 1, "one Barry Bonds on the board, at most");

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
  assert.ok(catchers.length > 0 && catchers.every((card) => playsPosition(card, "C")), "position paging filters");
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
  assert.ok(catchers.every(({ card }) => playsPosition(card, "C")));
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

test("the binder's card menu sells a copy, never the roster's last", async () => {
  const { binderScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const spare = adventurePool().find((card) => !save.roster.cardIds.includes(card.id));
  addCardToCollection(save, spare.id, 2);
  const app = { save, screen: { name: "binder", index: 0, filter: "ALL" }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };

  const rows = collectionCards(save);
  app.screen.index = rows.findIndex(({ card }) => card.id === spare.id);
  const before = save.player.coins;
  binderScreen.key(app, "a");
  assert.equal(app.screen.actionMenu, true, "Z opens the card actions");
  assert.ok(binderScreen.render(app).includes("SELL A COPY"), "selling is on the menu");
  assert.equal(ownedCount(save, spare.id), 2, "nothing sold by just looking");
  binderScreen.key(app, "b");
  assert.equal(app.screen.actionMenu, false, "X closes without selling");
  binderScreen.key(app, "a");
  app.screen.actionIndex = 1; // ADD TO TEAM, SELL, STAR, PIN, CANCEL
  binderScreen.key(app, "a");
  assert.equal(ownedCount(save, spare.id), 2, "picking SELL asks first, sells nothing");
  assert.ok(binderScreen.render(app).includes("SELL " + spare.name.toUpperCase() + "?"), "the are-you-sure comes up");
  app.screen.actionIndex = 1; // NO — KEEP HIM
  binderScreen.key(app, "a");
  assert.equal(ownedCount(save, spare.id), 2, "NO keeps him");
  binderScreen.key(app, "a");
  app.screen.actionIndex = 1;
  binderScreen.key(app, "a");
  binderScreen.key(app, "a"); // YES — SELL leads the confirm
  assert.equal(ownedCount(save, spare.id), 1, "YES sells one copy");
  assert.equal(save.player.coins, before + RARITIES[spare.rarity].sellValue, "at the pawn rate");
  assert.equal(app.screen.actionMenu, false, "acting closes the menu");

  // The roster's last copy shows why it won't sell, and the entry is dead.
  const rosterRowsNow = collectionCards(save);
  app.screen.index = rosterRowsNow.findIndex(({ card }) => card.id === save.roster.cardIds[0]);
  const coinsBefore = save.player.coins;
  binderScreen.key(app, "a");
  assert.ok(binderScreen.render(app).includes("NOT FOR SALE"), "the refusal is explained on the entry");
  app.screen.actionIndex = 1;
  binderScreen.key(app, "a");
  assert.equal(ownedCount(save, save.roster.cardIds[0]), 1, "the roster copy survives");
  assert.equal(save.player.coins, coinsBefore, "no coins change hands");
  assert.equal(app.screen.actionMenu, true, "a dead entry doesn't even close the menu");
  binderScreen.key(app, "b");

  // While searching, letters are just letters.
  binderScreen.typed(app, "f");
  binderScreen.typed(app, "s");
  assert.equal(app.screen.query, "s", "searching swallows the S");
});

test("compare mode pins two cards from the binder and lays them side by side", async () => {
  const { binderScreen, compareScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const rows = collectionCards(save);
  const app = { save, screen: { name: "binder", index: 0, filter: "ALL" }, go(name, data) { this.screen = { name, ...data }; }, rerender() {} };
  const pinViaMenu = () => {
    binderScreen.key(app, "a");
    app.screen.actionIndex = 3; // ADD TO TEAM, SELL, STAR, PIN, CANCEL
    binderScreen.key(app, "a");
  };
  pinViaMenu();
  assert.equal(app.screen.pinnedId, rows[0].card.id, "the menu pins the selected card");
  assert.ok(binderScreen.render(app).includes("PINNED"), "the pin is announced");
  pinViaMenu();
  assert.equal(app.screen.pinnedId, null, "the same menu entry unpins");
  pinViaMenu();
  binderScreen.key(app, "down");
  pinViaMenu();
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

test("a glove's die is announced before it is thrown, and the bat's answer is read first", async () => {
  const { dramaStages } = await import("../src/adventure/ui/battleScreen.js");

  // Two dice thrown at the same moment are one roll with two numbers on it. These
  // are a sequence: the ball is put in play, and THEN a glove has to do something
  // about it. Watching a die decide a double play before anybody has told you
  // there is a ground ball is watching a die for no reason.
  const grounder = {
    controlRoll: 4,
    controlTotal: 8,
    onBase: 10,
    chartOwner: "hitter",
    resultRoll: 11,
    result: "GB",
    // He needs a 13: the runner's speed sets a target of 15, the infield adds 3,
    // so the out lands anywhere past 12.
    playDetails: { doublePlayAttempt: { batterOut: true, roll: 17, fielding: 3, target: 15 } }
  };
  const [pitch, swing, pivot] = dramaStages([grounder]);

  assert.match(swing.caption, /GB — GROUND BALL/, "the swing says what the bat did");
  assert.match(pivot.lead, /THEY GO FOR TWO/, "and the glove says what it is about to do — before it does it");
  // And what the die has to BEAT. A die you are watching without knowing what it
  // needs is a die you are only waiting on.
  assert.match(pivot.lead, /DEFENSE NEEDS A 13/, "with the number the defense has to throw");
  // The number lands on its own line, under the setup — not trailing it after an
  // ellipsis. It is the thing about to be sweated, and it earns the line.
  assert.match(pivot.lead, /THEY GO FOR TWO<br>DEFENSE NEEDS A 13/, "the needed number gets its own line");
  assert.ok(!pivot.lead.includes("&hellip;"), "and no ellipsis leading into it");
  assert.match(pivot.caption, /TWO DOWN/, "and what it did, after");
  assert.ok(pivot.late, "the throw is late, so the screen holds a beat for it");
  assert.ok(!swing.late && !pitch.late, "the duel's own dice are not");

  // A throw names the man being run at, and it does so BEFORE the die tumbles.
  const thrown = { runner: "Lead Man '99", to: "home", safe: false, roll: 6, fielding: 2, target: 14 };
  const single = {
    controlRoll: 9,
    controlTotal: 12,
    onBase: 14,
    chartOwner: "hitter",
    resultRoll: 15,
    result: "1B",
    playDetails: { thrownAttempt: thrown, attempts: [thrown] }
  };
  const stages = dramaStages([single]);
  assert.match(stages[1].caption, /1B — BASE HIT/, "the base hit is called");
  assert.match(stages[2].lead, /L\.MAN IS SENT TO HOME/, "and the runner is sent, before the throw is rolled");
  assert.match(stages[2].lead, /DEFENSE NEEDS A 13/, "and the throw's number is on the screen with him");

  // The check can fall off the die at either end, and neither reads as a number.
  const { fieldingCheckNeeds } = await import("../src/rules/game.js");
  assert.deepEqual(fieldingCheckNeeds({ target: 15, fielding: 3 }), { needed: 13, certain: false, impossible: false });
  assert.equal(fieldingCheckNeeds({ target: 4, fielding: 8 }).certain, true, "a plodder in front of good gloves is out on anything");
  assert.equal(fieldingCheckNeeds({ target: 25, fielding: 1 }).impossible, true, "and a rocket cannot be caught at all");
  assert.equal(fieldingCheckNeeds(null), null);

  // A swing with no glove to answer it says nothing extra — the play is about to
  // read out in the textbox anyway, and calling it twice steps on it.
  const strikeout = { controlRoll: 3, controlTotal: 7, onBase: 9, chartOwner: "pitcher", resultRoll: 2, result: "SO" };
  const quiet = dramaStages([strikeout]);
  assert.equal(quiet.length, 2, "pitch and swing, and nothing else");
  assert.equal(quiet[1].caption, null, "and the swing keeps quiet");
});

test("a throw that cannot be made is not staged as a die, and the booth says so", async () => {
  const { dramaStages } = await import("../src/adventure/ui/battleScreen.js");
  const { describeEvent } = await import("../src/ui/playByPlay.js");

  // The engine never threw at him — the gloves would have needed a 21 — so the
  // attempt comes through with no roll. Watching a d20 tumble toward a number it
  // cannot reach is a magic trick with no card in it.
  const free = { runner: "Fleet Foot '01", from: "2B", to: "3B", safe: true, thrown: false, roll: null, fielding: 1, target: 22 };
  const single = {
    controlRoll: 9,
    controlTotal: 12,
    onBase: 14,
    chartOwner: "hitter",
    resultRoll: 15,
    result: "1B",
    playDetails: { thrownAttempt: free, extraBaseAttempts: [free] }
  };
  const stages = dramaStages([single]);
  assert.deepEqual(stages.map((stage) => stage.label), ["PITCH", "SWING"], "the throw that never happened is not staged");
  assert.equal(stages[1].caption, null, "and with no glove to answer it, the swing keeps quiet");

  const called = describeEvent({ ...single, inning: 3, half: "top", batter: "Hitter", runs: 0, outsAfter: 1 }, "away").join(" ");
  assert.match(called, /F\.FOOT takes 3B on no throw\./, "the booth says he took it on no throw");
  assert.doesNotMatch(called, /rolled/, "and reports no roll, because there was none");

  // A deferred send with nobody to throw at is the same fact: no die, so no
  // suspense screen at all — the play simply reads out.
  const conceded = {
    type: "advance",
    resultRoll: null,
    controlRoll: null,
    playDetails: { thrownAttempt: free, attempts: [free] }
  };
  assert.equal(dramaStages([conceded]), null, "a send nobody can defend rolls nothing to watch");
  const read = describeEvent({ ...conceded, inning: 3, half: "top", batter: "Hitter", runs: 0, outsAfter: 1 }, "away").join(" ");
  assert.match(read, /F\.FOOT takes 3B\./);
  assert.match(read, /The defense holds the ball\. No throw\./);

  // The other end of the same coin: a man so plainly beaten that even his kindest
  // roll is out. The throw IS made and beats him — but the die was never in doubt,
  // so it is not staged, and the booth cuts him down without a roll and without
  // pretending nobody threw.
  const doomed = { runner: "Slow Poke '77", from: "1B", to: "2B", safe: false, thrown: false, roll: null, fielding: 8, target: 4 };
  const gunned = {
    type: "advance",
    resultRoll: null,
    controlRoll: null,
    playDetails: { thrownAttempt: doomed, attempts: [doomed] }
  };
  assert.equal(dramaStages([gunned]), null, "a foregone out rolls nothing to watch");
  const out = describeEvent({ ...gunned, inning: 3, half: "top", batter: "Hitter", runs: 0, outsAfter: 1 }, "away").join(" ");
  assert.match(out, /S\.POKE is cut down at 2B!/);
  assert.doesNotMatch(out, /rolled/, "no die, no roll");
  assert.doesNotMatch(out, /No throw/, "and no lie that nobody threw");
});

test("the suspense screen stages every die the play threw, gloves included", async () => {
  const { dramaStages } = await import("../src/adventure/ui/battleScreen.js");

  // A ball in play that turns two. The suspense used to stop at the swing — it
  // cut to black exactly where the play got interesting, and the die that turned
  // it, the one you were actually sweating, was never shown.
  const grounder = {
    controlRoll: 4,
    controlTotal: 8,
    onBase: 10,
    chartOwner: "hitter",
    resultRoll: 11,
    result: "GB",
    playDetails: { doublePlayAttempt: { batterOut: true, roll: 17 } }
  };
  const turned = dramaStages([grounder]);
  assert.deepEqual(turned.map((stage) => stage.label), ["PITCH", "SWING", "THE THROW"]);
  assert.deepEqual(turned.map((stage) => stage.roll), [4, 11, 17]);
  assert.match(turned[2].caption, /TWO DOWN/, "and it says what the glove did with it");

  // A single with a man cut down at the plate: pitch, swing, throw.
  const thrown = { runner: "Lead Man '99", to: "home", safe: false, roll: 6 };
  const single = {
    controlRoll: 9,
    controlTotal: 12,
    onBase: 14,
    chartOwner: "hitter",
    resultRoll: 15,
    result: "1B",
    // The throw is filed twice — the attempts list holds the very same object —
    // and must still be staged once, or the play looks like it threw two dice.
    playDetails: { thrownAttempt: thrown, attempts: [thrown, { runner: "Trailer", to: "2B", thrown: false }] }
  };
  const cutDown = dramaStages([single]);
  assert.deepEqual(cutDown.map((stage) => stage.label), ["PITCH", "SWING", "THROW TO HOME"]);
  assert.equal(cutDown[2].roll, 6);
  assert.match(cutDown[2].caption, /^L\.MAN IS OUT!$/, "the man, short, and without his card year");

  // A deferred send throws no pitch and takes no swing. The whole play is the
  // throw — the most suspenseful die in the game — so it stages on its own.
  const send = {
    type: "advance",
    playDetails: { kind: "advance", attempts: [{ runner: "Speedy", to: "3B", safe: true, roll: 3 }] }
  };
  const sent = dramaStages([send]);
  assert.deepEqual(sent.map((stage) => stage.label), ["THROW TO 3B"]);
  assert.match(sent[0].caption, /IS SAFE!/);

  // A steal is one die and always was.
  const steal = { playDetails: { stealAttempt: { runner: "Thief", to: "2B", safe: false, roll: 19 } } };
  const stolen = dramaStages([steal]);
  assert.deepEqual(stolen.map((stage) => stage.label), ["THE THROW"]);
  assert.match(stolen[0].caption, /GUNNED DOWN/);

  // A play with no dice at all stages nothing.
  assert.equal(dramaStages([{ type: "pitching-change" }]), null);
});

test("high-leverage plate appearances pause on the d20 before revealing", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { isDramaticMoment } = await import("../src/rules/battle/controller.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "drama-seed" });
  const state = battle.state;

  // Which moments earn the slow dice is not a rule anybody wrote down any more:
  // it is Greg Stoll's leverage index, off the same Retrosheet history the win
  // expectancy comes from. 1.0 is an average plate appearance; the dice come out
  // at two and a half.
  const runners = () => [
    { id: "r1", name: "A", speed: 10 },
    { id: "r2", name: "B", speed: 10 },
    { id: "r3", name: "C", speed: 10 }
  ];

  assert.equal(isDramaticMoment(state), false, "top 1, nobody on (0.86): no drama");
  state.outs = 2;
  state.bases = runners();
  assert.equal(isDramaticMoment(state), true, "two outs, bases loaded in a tie (3.06): drama");

  // The old rules called every ninth-inning plate appearance dramatic. Nobody on
  // and nobody out in a tied ninth is a real spot — but it is a 2.04, and the
  // game should save its breath for what comes after somebody reaches.
  state.bases = [null, null, null];
  state.outs = 0;
  state.inning = 9;
  state.score = { away: 2, home: 2 };
  assert.equal(isDramaticMoment(state), false, "tied 9th, nobody on (2.04): not yet");
  state.bases = [runners()[0], null, null];
  assert.equal(isDramaticMoment(state), true, "tied 9th, a man aboard (2.8+): now");

  state.bases = [null, null, null];
  state.score = { away: 9, home: 1 };
  assert.equal(isDramaticMoment(state), false, "a 9th-inning blowout (0.00) stays quick");

  // The old rules said a batting team already ahead was mop-up UNLESS the bases
  // were loaded, and then the lights came back on. The table says they were right
  // about the first part and wrong about the second: the visitors padding a lead
  // in the top of the ninth is a 0.46, and loading the bases under that arm only
  // takes it to 1.44 — because runs that pad a lead barely move the win
  // probability. The pressure in that ballgame is in the BOTTOM half, and that is
  // where the game now spends its dice.
  state.score = { away: 3, home: 2 };
  assert.equal(isDramaticMoment(state), false, "visitors up one, nobody on (0.46): mop-up");
  state.bases = runners();
  state.outs = 2;
  assert.equal(isDramaticMoment(state), false, "and up one with the bases loaded (1.44) is still padding");

  // The rules used to miss this one entirely: it is not the ninth, and the bases
  // are not loaded, so nothing about it was dramatic. It is a 3.53.
  state.inning = 4;
  state.bases = [null, runners()[1], runners()[2]];
  state.outs = 2;
  state.score = { away: 1, home: 2 };
  assert.equal(isDramaticMoment(state), true, "down one, second and third, two out in the 4th: drama");

  state.inning = 9;
  state.outs = 0;
  state.bases = [runners()[0], null, null];
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
  const { pixelPortraitSvg } = await import("../src/ui/photos.js");
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

test("the champion keeps collecting, and the plaque keeps up", async () => {
  const { syncRunProgress } = await import("../src/adventure/hallOfFame.js");
  const { catalogProgress, addCardToCollection } = await import("../src/adventure/state.js");
  const { adventurePool } = await import("../src/adventure/packs.js");
  const storage = fakeStorage();
  const save = await finishedSave("hof-collector-seed", { days: 20, losses: 2 });
  const app = { save };
  applyOutcome(app, trainerById("post-worldseries"), true);

  const before = catalogProgress(save);
  assert.ok(before.total > before.owned, "a fresh champion has not seen most of the league");
  assert.equal(before.complete, false);

  // The plaque as written the day the trophy landed.
  const written = loadHallOfFame().find((item) => item.saveSeed === "hof-collector-seed");
  assert.equal(written.cardsOwned, before.owned, "it carries what he had collected");
  assert.equal(written.catalogComplete, false);

  // He keeps playing the beaten bosses for wages and buys the league out.
  for (const card of adventurePool()) addCardToCollection(save, card.id);
  const after = catalogProgress(save);
  assert.equal(after.complete, true, "the catalog is complete");
  assert.equal(after.owned, after.total);
  assert.ok(save.progress.catalogCompletedOn != null, "the day it happened is written down");
  assert.ok(
    save.log.some((line) => line.includes("THE CATALOG IS COMPLETE")),
    "and it is recognized at the time, in the log"
  );

  // Opening the hall amends the plaque, which was written long before this.
  const amended = syncRunProgress(save);
  assert.equal(amended.catalogComplete, true, "the plaque catches up");
  assert.equal(amended.cardsOwned, after.total);
  assert.equal(amended.days, 20, "and nothing else about the run moves");
  assert.equal(
    loadHallOfFame().find((item) => item.saveSeed === "hof-collector-seed").catalogComplete,
    true,
    "the amendment is written to the board, not just handed back"
  );
  void storage;
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

// A Showdown-set card says who the man is on its FACE, not in its id. The era
// rule used to ask the id and get "nobody" back for every card in the classic
// league, so it never fired there: Rival Cam fielded two Brant Browns, a pair of
// Pedro Martinezes, and would have run two Sammy Sosas out at the summit.
test("one man per roster holds in the classic league, where the id doesn't name him", async () => {
  const { personConflict, cardPerson } = await import("../src/rules/cards.js");
  setUniverseSeed("one-man-test", "classic");
  const pool = adventurePool();

  const sosas = pool.filter((card) => cardPerson(card) === "name:sammy sosa");
  assert.ok(sosas.length > 2, "the classic pool prints the same man many times over");
  const [first, second] = sosas;
  assert.ok(personConflict([first], second), "two printings of one man conflict, whatever the season on the face");
  const someoneElse = pool.find((card) => cardPerson(card) !== cardPerson(first));
  assert.equal(personConflict([first], someoneElse), null, "two different men do not");
  assert.equal(personConflict([first], second, first.id), null, "and a card may still replace itself in a swap");

  // The rule is only worth having if the teams it governs obey it.
  const save = { mode: "budget", saveSeed: "one-man-test", universe: "classic" };
  for (const trainer of TRAINERS) {
    const roster = buildNpcTeam(trainer, save).roster;
    const men = roster.map((card) => cardPerson(card));
    assert.equal(new Set(men).size, men.length, `${trainer.id} fields ${men.length} distinct men`);
  }
});

// The pack screen used to be a single instruction — Z, next card — and anything
// you wanted to DO with the man you had just pulled meant walking to another
// screen to do it. The menu brings the two things you were going to do anyway to
// where he already is.
test("the pulled card carries a menu: next, sell, add to team — cursor on next", async () => {
  const { packOpenScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const seed = "menu-pack";
  const cards = openPack("booster", seed);
  save.pendingPacks = [{ packId: "booster", seed }];
  save.player.coins = 0;
  const app = { save, screen: { name: "packOpen", revealed: 0, viewing: 0 }, go() {}, rerender() {} };

  // Sealed: no menu, just the one instruction.
  assert.ok(packOpenScreen.render(app).includes("RIP IT OPEN"), "a sealed pack has nothing to decide");

  packOpenScreen.key(app, "a");
  if (app.screen.curtain) app.screen.curtain = null;   // legends glow first; not what this is about
  const pulled = cards[0];
  const shown = packOpenScreen.render(app);
  assert.ok(shown.includes("NEXT CARD"), "the menu is up");
  assert.ok(shown.includes("SELL"), "and he can be sold");
  assert.ok(shown.includes("ADD TO TEAM"), "and he can be signed");
  assert.equal(app.screen.menuIndex ?? 0, 0, "the cursor sits on NEXT CARD, which is what you came here to press");

  // Selling never happens on one keypress: the pack asks, like the shop asks.
  app.screen.menuIndex = 1;
  packOpenScreen.key(app, "a");
  assert.equal(app.screen.confirmSell, pulled.id, "it asks first");
  assert.ok(packOpenScreen.render(app).includes("YES"), "and shows the question");
  const owned = ownedCount(save, pulled.id);
  packOpenScreen.key(app, "a");                         // YES
  assert.equal(ownedCount(save, pulled.id), owned - 1, "the copy is gone");
  assert.ok(save.player.coins > 0, "and it was paid for");
  assert.equal(app.screen.menuIndex, 0, "the cursor goes home to NEXT CARD");
});

test("adding from the pack asks who sits, and the man he replaces comes off", async () => {
  const { packOpenScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  // A pack whose first pull is a HITTER, so there is somebody for him to replace.
  let seed = null;
  for (let i = 0; i < 200 && !seed; i += 1) {
    if (openPack("booster", `hitter-${i}`)[0].kind === "hitter") seed = `hitter-${i}`;
  }
  assert.ok(seed, "some booster leads with a bat");
  const pulled = openPack("booster", seed)[0];
  save.pendingPacks = [{ packId: "booster", seed }];
  const app = { save, screen: { name: "packOpen", revealed: 0, viewing: 0 }, go() {}, rerender() {} };

  packOpenScreen.key(app, "a");
  if (app.screen.curtain) app.screen.curtain = null;
  app.screen.menuIndex = 2;                             // ADD TO TEAM
  packOpenScreen.key(app, "a");
  assert.equal(app.screen.mode, "team-swap", "it asks who sits");
  const benched = rosterCards(save)[app.screen.pickIndex ?? 0];
  assert.ok(packOpenScreen.render(app).includes("WHO SITS"), "and says so");

  packOpenScreen.key(app, "a");                         // bench him
  const roster = rosterCards(save).map((card) => card.id);
  assert.ok(roster.includes(pulled.id), "the new man is on the team");
  assert.ok(!roster.includes(benched.id), "and the man he replaced is off it");
  assert.equal(app.screen.mode, null, "the question is closed");
  assert.equal(app.screen.menuIndex, 0, "and the cursor is back on NEXT CARD");
});

// Thirteen men in one column put the arms below the fold: changing who starts
// game 1 meant scrolling past nine bats to reach him. They are two jobs asked in
// two vocabularies, so they are two pages, and left/right turns between them.
test("the team screen files the bats and the arms on separate pages", async () => {
  const { teamScreen } = await import("../src/adventure/ui/collectionScreens.js");
  const save = testSave();
  const app = { save, screen: { name: "team", index: 0, mode: "roster" }, go() {}, rerender() {} };

  const bats = rosterCards(save).filter((card) => card.kind === "hitter");
  const arms = rosterCards(save).filter((card) => card.kind === "pitcher");
  assert.ok(bats.length && arms.length, "the club has both");

  // Bats lead, because a roster is a lineup card first. A bat's row reads OB and
  // SPD; an arm's reads CTRL and IP. Neither vocabulary shows up on the other's
  // page — not in the list, and not in the card standing beside it.
  const batsPage = teamScreen.render(app);
  assert.ok(batsPage.includes(`${bats.length} BATS`), "the banner counts the bats");
  assert.ok(!batsPage.includes("CTRL"), "no arm is filed among the bats");
  assert.equal(teamScreen.hoverCard(app, 0).kind, "hitter", "and the cursor is on one");

  // Right turns to the arms.
  teamScreen.key(app, "right");
  const armsPage = teamScreen.render(app);
  assert.ok(armsPage.includes(`${arms.length} ARMS`), "the banner counts the arms");
  assert.ok(!armsPage.includes("SPD"), "no bat is filed among the arms");
  assert.equal(app.screen.index, 0, "the cursor starts at the top of the page you land on");
  assert.equal(teamScreen.hoverCard(app, 0).kind, "pitcher", "and the card panel follows it");

  // And left turns back.
  teamScreen.key(app, "left");
  assert.ok(teamScreen.render(app).includes(`${bats.length} BATS`), "left goes home to the bats");
});

// ---- The record book ---------------------------------------------------------

test("consecutive hits counts a RUN of hits, and a walk breaks it", async () => {
  const { longestHitStreak } = await import("../src/adventure/records.js");
  const pa = (battingTeam, result) => ({ battingTeam, result });
  const events = [
    pa("US", "1B"), pa("US", "2B"), pa("US", "BB"),        // two, then the walk ends it
    pa("THEM", "HR"), pa("THEM", "HR"), pa("THEM", "HR"),  // the other lot don't count at all
    pa("US", "1B"), pa("US", "HR"), pa("US", "1B+"),       // three in a row
    { battingTeam: "US", type: "steal" },                  // not a plate appearance: neither makes nor breaks
    pa("US", "SO")
  ];
  assert.equal(longestHitStreak(events, "US"), 3, "the best run of hits, back to back");
  assert.equal(longestHitStreak(events, "THEM"), 3, "read from the other dugout, it is theirs");
  assert.equal(longestHitStreak([], "US"), 0, "a game with no hits has no run of them");
});

test("the record book ranks each record the right way round, and folds you in", async () => {
  const { RECORDS, leaderboard } = await import("../src/adventure/records.js");
  // The board also folds in your all-time book (see updatePersonalRecords); this
  // test is about the save in your hands, so start it from an empty book.
  localStorage.removeItem("showdown-quest-records-local");
  const runsGame = RECORDS.find((record) => record.key === "runs-game");
  const fewestHits = RECORDS.find((record) => record.key === "hits-allowed-win");
  assert.equal(runsGame.better, "max");
  assert.equal(fewestHits.better, "min", "fewest hits is a record you win by going LOW");

  const save = testSave();
  save.saveSeed = "sq-me";
  save.player.name = "ME";
  // One game on the almanac: eight runs, and a two-hit win.
  save.almanac = [{
    day: 3, opponent: "JOJO", won: true, innings: 9, playerSide: "away",
    score: { away: 8, home: 1 },
    boxScore: { away: { team: "ME", hitters: [{ hr: 1 }], pitchers: [{ h: 2, so: 9 }] }, home: { team: "JOJO", hitters: [], pitchers: [] } }
  }];

  const globals = {
    "runs-game": [
      { value: 24, name: "ANA", saveSeed: "sq-a", day: 20, opponent: "OKABE" },
      { value: 3, name: "BO", saveSeed: "sq-b", day: 2, opponent: "MABEL" }
    ],
    "hits-allowed-win": [{ value: 5, name: "ANA", saveSeed: "sq-a", day: 4, opponent: "PETRA" }]
  };

  const runs = leaderboard(runsGame, globals, save);
  assert.deepEqual(runs.top.map((row) => row.value), [24, 8, 3], "highest first");
  assert.equal(runs.top[1].you, true, "and you are in it where you belong");
  assert.equal(runs.yourRank, 2);

  const hits = leaderboard(fewestHits, globals, save);
  assert.deepEqual(hits.top.map((row) => row.value), [2, 5], "LOWEST first for this one");
  assert.equal(hits.yourRank, 1, "two hits beats five");

  // A record nobody has set stays empty rather than inventing a zero.
  const untouched = leaderboard(RECORDS.find((r) => r.key === "hit-streak"), {}, save);
  assert.equal(untouched.top.length, 0);
  assert.equal(untouched.you, null, "never having done it is not the same as having done it badly");
});

test("a record from any run stands, and survives starting the next one", async () => {
  const { RECORDS, leaderboard, updatePersonalRecords, loadPersonalRecords } = await import("../src/adventure/records.js");
  localStorage.removeItem("showdown-quest-records-local");
  const runsGame = RECORDS.find((record) => record.key === "runs-game");

  // One away win by however many runs — the raw material of a runs-in-a-game record.
  const gameWith = (runs) => ({
    day: 1, opponent: "JOJO", won: true, innings: 9, playerSide: "away",
    score: { away: runs, home: 0 },
    boxScore: { away: { team: "?", hitters: [], pitchers: [] }, home: { team: "JOJO", hitters: [], pitchers: [] } }
  });

  // Run A puts up eight in a game, then the player walks away from it — no title —
  // and starts run B, which only manages five.
  const runA = testSave();
  runA.saveSeed = "sq-a"; runA.player.name = "ANA"; runA.almanac = [gameWith(8)];
  updatePersonalRecords(runA);

  const runB = testSave();
  runB.saveSeed = "sq-b"; runB.player.name = "BO"; runB.almanac = [gameWith(5)];
  updatePersonalRecords(runB);

  // The book still remembers ANA's eight — a better mark, from a run that never won
  // a thing and is long gone — credited to the run that set it.
  const book = loadPersonalRecords();
  assert.equal(book["runs-game"].value, 8, "the best of every run I have played, not just the one I hold");
  assert.equal(book["runs-game"].saveSeed, "sq-a", "credited to the run that set it");

  // And the board, read while playing run B, folds ANA's eight in above BO's five.
  const board = leaderboard(runsGame, {}, runB);
  assert.deepEqual(
    board.top.map((row) => [row.value, row.name]), [[8, "ANA"], [5, "BO"]],
    "a game from a past run makes the record book, not just a run that wins the title"
  );

  // Beat it in run B and the book moves to B; the old mark is replaced, not stacked.
  runB.almanac = [gameWith(12)];
  updatePersonalRecords(runB);
  assert.equal(loadPersonalRecords()["runs-game"].value, 12, "a new best overwrites the old");
  assert.equal(loadPersonalRecords()["runs-game"].saveSeed, "sq-b");

  localStorage.removeItem("showdown-quest-records-local");
});

test("a game that sets an openable record is the one worth uploading", async () => {
  const { updatePersonalRecords, setsOpenableGameRecord } = await import("../src/adventure/records.js");
  localStorage.removeItem("showdown-quest-records-local");

  const save = testSave();
  save.saveSeed = "sq-up"; save.player.name = "UP";
  // An away win by eight on day 1: sets runs-game, whose board line opens the game.
  save.almanac = [{
    day: 1, opponent: "J", won: true, innings: 9, playerSide: "away",
    score: { away: 8, home: 0 },
    boxScore: { away: { team: "UP", hitters: [], pitchers: [] }, home: { team: "J", hitters: [], pitchers: [] } }
  }];
  const moved = updatePersonalRecords(save);
  assert.ok(moved.includes("runs-game"), "the eight-run game moved an openable record");
  assert.equal(setsOpenableGameRecord(moved, 1), true, "so its afternoon is worth uploading");
  assert.equal(setsOpenableGameRecord(moved, 2), false, "but only the day it actually happened");
  assert.equal(setsOpenableGameRecord(updatePersonalRecords(save), 1), false, "and nothing to send when nothing moved");

  localStorage.removeItem("showdown-quest-records-local");
});

test("the fastest championship is two boards, and a run only competes in the league it was won in", async () => {
  const { RECORDS } = await import("../src/adventure/records.js");
  const HOF_KEY = "showdown-quest-hall-of-fame";
  localStorage.setItem(HOF_KEY, JSON.stringify([
    { saveSeed: "sq-a", name: "ANA", mode: "budget", days: 61 },
    { saveSeed: "sq-b", name: "BO", mode: "uncapped", days: 44 },
    { saveSeed: "sq-c", name: "CY", mode: "budget", days: 55 },
    { saveSeed: "sq-d", name: "DEE", days: 70 } // predates the field, so: budget
  ]));

  const budget = RECORDS.find((row) => row.key === "fastest-title-budget");
  const uncapped = RECORDS.find((row) => row.key === "fastest-title-uncapped");

  assert.equal(budget.read().value, 55, "the quickest of the budget runs, and not BO's 44");
  assert.equal(budget.read().opponent, "CY");
  assert.equal(uncapped.read().value, 44, "and the uncapped board keeps its own");
  assert.equal(uncapped.read().opponent, "BO");

  // A league nobody has taken a pennant in has no record, which is not a nought.
  localStorage.setItem(HOF_KEY, JSON.stringify([{ saveSeed: "sq-b", name: "BO", mode: "uncapped", days: 44 }]));
  assert.equal(budget.read(), null);

  localStorage.removeItem(HOF_KEY);
});

// A campaign in the hands of two bats and two arms: MAYA slugs, JOJO runs, OKABE
// gives up a run a game and PIP gives up none at all. `games` of them, so the
// qualifiers (40 PA, 15 IP) are actually cleared.
function sluggerSave(games = 8) {
  const save = testSave();
  save.saveSeed = "sq-me";
  save.player.name = "ME";
  delete save.seasonStats;
  for (let game = 0; game < games; game += 1) {
    recordGameStats(save, {
      hitters: [
        { id: "h1", name: "MAYA", pa: 5, ab: 4, h: 2, d: 0, t: 0, hr: 2, bb: 1, so: 1, r: 2, rbi: 4, sb: 0, cs: 0, gidp: 0, wpa: 0.4 },
        { id: "h2", name: "JOJO", pa: 5, ab: 5, h: 1, d: 1, t: 0, hr: 0, bb: 0, so: 2, r: 0, rbi: 1, sb: 2, cs: 0, gidp: 0, wpa: 0.1 }
      ],
      pitchers: [
        { id: "p1", name: "OKABE", bf: 20, outs: 18, h: 4, bb: 1, so: 11, hr: 0, r: 1, wpa: 0.5 },
        { id: "p2", name: "PIP", bf: 10, outs: 9, h: 1, bb: 0, so: 3, hr: 0, r: 0, wpa: 0.2 }
      ]
    });
  }
  return save;
}

test("a player record belongs to the MAN, and reads out of the campaign, not the afternoon", async () => {
  const { RECORDS, recordsOnPage, leaderboard, personalBests } = await import("../src/adventure/records.js");
  localStorage.removeItem("showdown-quest-records-local");
  const record = (key) => RECORDS.find((row) => row.key === key);
  const save = sluggerSave();

  assert.ok(recordsOnPage("player").length, "the book has a player half");
  assert.ok(
    recordsOnPage("player").every((row) => row.page === "player") &&
    recordsOnPage("manager").every((row) => row.page === "manager"),
    "and the two halves do not leak into each other"
  );

  // The best man on the club for the measure — which is not the same man twice.
  assert.deepEqual(record("player-homers").read(save), { value: 16, player: "MAYA" }, "eight games, two a game");
  assert.equal(record("player-steals").read(save).player, "JOJO", "the thief owns the steals, not the slugger");
  assert.equal(record("player-strikeouts").read(save).player, "OKABE");

  // A rate needs a season behind it. One perfect afternoon is not a season.
  assert.equal(record("player-ops").read(save).player, "MAYA", "forty plate appearances clears the bar");
  assert.equal(record("player-ops").read(sluggerSave(2)), null, "ten of them does not");

  // The trap: a man who has allowed NO runs has an RA9 of nought, and nought is a
  // number he earned — not a measure he never took.
  const ra9 = record("player-ra9").read(save);
  assert.equal(record("player-ra9").better, "min", "you win this one by going low");
  assert.deepEqual(ra9, { value: 0, player: "PIP" }, "the shutout arm owns it, and a zero is not a missing number");

  // What goes up to the league carries his name with it.
  assert.equal(personalBests(save)["player-homers"].player, "MAYA");

  // And the board reads back with both names on the line: the man, then his club.
  const board = leaderboard(record("player-homers"), {
    "player-homers": [{ value: 40, name: "ANA", player: "PETRA", saveSeed: "sq-a" }]
  }, save);
  assert.deepEqual(
    board.top.map((row) => [row.value, row.player, row.name]),
    [[40, "PETRA", "ANA"], [16, "MAYA", "ME"]],
    "the record holder, then you"
  );
  assert.equal(board.top[1].you, true);
});

test("the record book has two pages, and left/right turns it", async () => {
  const { recordsScreen } = await import("../src/adventure/ui/recordsScreen.js");
  const save = sluggerSave();
  // `synced` short-circuits the network call the screen makes on arrival.
  const app = { save, screen: { name: "records", index: 0, synced: true }, go() {}, rerender() {} };

  const managers = recordsScreen.render(app);
  assert.ok(managers.includes("MANAGER RECORDS"), "it opens on the afternoons");
  assert.ok(managers.includes("MOST RUNS IN A GAME"));
  assert.ok(!managers.includes("MOST HOMERS, CAREER"), "the men are on the other page");

  recordsScreen.key(app, "right");
  const players = recordsScreen.render(app);
  assert.ok(players.includes("PLAYER RECORDS"));
  assert.ok(players.includes("MOST HOMERS, CAREER"));
  assert.ok(!players.includes("MOST RUNS IN A GAME"), "and the afternoons are on the other one");
  assert.ok(players.includes("MAYA") && players.includes("ME"), "the man who did it, and the club he did it for");

  // Down to a CAREER record — the first three are single games, which do open.
  // There is no one afternoon behind a career, so there is nothing to step into.
  recordsScreen.key(app, "down");
  recordsScreen.key(app, "down");
  recordsScreen.key(app, "down");
  recordsScreen.key(app, "a");
  assert.notEqual(app.screen.mode, "board", "Z does not step into a career");

  recordsScreen.key(app, "left");
  assert.ok(recordsScreen.render(app).includes("MANAGER RECORDS"), "and left turns back");
});

// Two afternoons, written down the way the almanac writes them. The first is a
// comeback: JOJO is up 4-0 before ME scores at all, and ME wins it 5-4 with a
// four-run eighth. PIP throws a nine-inning no-hitter in the second, which is won
// 3-0 in the eleventh — so the two games run into one long stretch of zeroes.
function almanacSave() {
  const save = testSave();
  save.saveSeed = "sq-me";
  save.player.name = "ME";
  save.almanac = [
    {
      day: 1, opponent: "JOJO", won: true, innings: 9, playerSide: "away",
      score: { away: 5, home: 4 },
      lineScore: { away: [0, 0, 0, 0, 0, 1, 0, 4, 0], home: [3, 0, 1, 0, 0, 0, 0, 0, 0] },
      boxScore: {
        away: {
          team: "ME",
          hitters: [{ id: "h1", name: "MAYA", h: 3, hr: 2, rbi: 5 }],
          pitchers: [{ id: "p2", name: "OKABE", so: 6, h: 7, outs: 27 }]
        },
        home: { team: "JOJO", hitters: [], pitchers: [] }
      }
    },
    {
      day: 2, opponent: "MABEL", won: true, innings: 11, playerSide: "home",
      score: { home: 3, away: 0 },
      lineScore: { home: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3], away: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      boxScore: {
        home: {
          team: "ME",
          hitters: [{ id: "h1", name: "MAYA", h: 1, hr: 0, rbi: 1 }],
          pitchers: [{ id: "p1", name: "PIP", so: 12, h: 0, outs: 33 }]
        },
        away: { team: "MABEL", hitters: [], pitchers: [] }
      }
    }
  ];
  return save;
}

test("the afternoons the line score remembers: the comeback, the big inning, the zeroes", async () => {
  const { RECORDS } = await import("../src/adventure/records.js");
  const record = (key) => RECORDS.find((row) => row.key === key);
  const save = almanacSave();

  // Four down before we scored at all. The box score cannot know this; only the
  // shape of the afternoon can.
  assert.equal(record("comeback").read(save).value, 4, "the deepest hole climbed out of");
  assert.equal(record("comeback").read(save).day, 1);
  assert.equal(record("inning-runs").read(save).value, 4, "the four-run eighth");
  assert.equal(record("longest-game").read(save).value, 11, "and only a game that went past nine counts");
  assert.equal(record("shutouts").read(save).value, 1, "one of the two was a shutout");

  // The zeroes run from JOJO's fourth through the end of MABEL: six, then eleven.
  // The streak crosses the gap between two games, and is filed on the day it got
  // there.
  const zeroes = record("scoreless-streak").read(save);
  assert.equal(zeroes.value, 17, "a streak does not stop just because the game did");
  assert.equal(zeroes.day, 2);

  // A win is a win: a comeback record does not count a hole you lost in.
  const lost = almanacSave();
  lost.almanac[0].won = false;
  assert.equal(record("comeback").read(lost), null, "you did not come back — you lost");

  // Twenty games or the win rate is not a rate, it is an anecdote.
  assert.equal(record("win-pct").read(save), null, "two-for-two is not the best record in the league");
});

test("a game with no line score breaks a scoreless streak rather than bridging it", async () => {
  const { RECORDS } = await import("../src/adventure/records.js");
  const streak = RECORDS.find((row) => row.key === "scoreless-streak");
  const shutout = (day) => ({
    day, opponent: `OPP${day}`, won: true, innings: 9, playerSide: "away",
    score: { away: 1, home: 0 },
    lineScore: { away: [1, 0, 0, 0, 0, 0, 0, 0, 0], home: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    boxScore: { away: { team: "ME", hitters: [], pitchers: [] }, home: { team: "OPP", hitters: [], pitchers: [] } }
  });
  const save = testSave();

  save.almanac = [shutout(1), shutout(2)];
  assert.equal(streak.read(save).value, 18, "back-to-back shutouts run straight on into each other");

  // The same two shutouts with an unrecorded afternoon between them. That game was
  // played before the board existed and nobody can say what happened in it, so the
  // streak starts again on the far side: an honest nine beats a fabricated
  // eighteen.
  const older = { ...shutout(9), lineScore: null };
  save.almanac = [shutout(1), older, shutout(2)];
  assert.equal(streak.read(save).value, 9, "a gap nobody can vouch for is not a run of zeroes");
});

test("a man's best afternoon opens the box score, and a no-hitter is worth nought hits", async () => {
  const { RECORDS, leaderboard } = await import("../src/adventure/records.js");
  const record = (key) => RECORDS.find((row) => row.key === key);
  const save = almanacSave();
  localStorage.removeItem("showdown-quest-records-local");

  // The single game, the man who had it, and the afternoon it can be opened at.
  const homers = record("player-hr-game").read(save);
  assert.deepEqual(homers, { value: 2, player: "MAYA", day: 1, opponent: "JOJO" });
  assert.equal(record("player-hr-game").opens, true, "so the board can go and show you him doing it");
  assert.equal(record("player-rbi-game").read(save).value, 5);
  assert.equal(record("player-k-game").read(save).player, "PIP", "twelve, and OKABE's six is not the record");

  // The trap, again, and it is the whole point of the board: a man who gave up NO
  // hits reads nought, and nought is the best mark on it — not a missing one.
  const noHitter = record("player-no-hitter").read(save);
  assert.deepEqual(noHitter, { value: 0, player: "PIP", day: 2, opponent: "MABEL" });
  assert.equal(record("player-no-hitter").better, "min");
  // It reaches the league board through the co-holder path (submitCoHolders), and a
  // hitless complete game is a real nought there — the holder, not a missing mark.
  const board = leaderboard(record("player-no-hitter"), {}, save);
  assert.equal(board.top[0].value, 0, "and it goes up to the league as nought");
  assert.equal(board.top[0].player, "PIP");

  // OKABE went the distance too, and gave up seven. A reliever who never did could
  // not hold this record however clean his evening was.
  const short = almanacSave();
  short.almanac[1].boxScore.home.pitchers = [{ id: "p3", name: "REL", so: 3, h: 0, outs: 9 }];
  assert.equal(record("player-no-hitter").read(short).value, 7, "three hitless innings is a fine evening, not a complete game");
});

test("a single-game record tied by two of your men names them both", async () => {
  const { RECORDS, leaderboard } = await import("../src/adventure/records.js");
  localStorage.removeItem("showdown-quest-records-local");
  const record = RECORDS.find((row) => row.key === "player-hr-game");

  const game = (day, hitters) => ({
    day, opponent: "RIVALS", won: true, innings: 9, playerSide: "away",
    score: { away: 5, home: 3 },
    boxScore: { away: { team: "US", hitters, pitchers: [] }, home: { team: "RIVALS", hitters: [], pitchers: [] } }
  });
  const save = testSave();
  save.saveSeed = "sq-tie"; save.player.name = "SKYLAR";
  // Yandy hits three one day, Carlos three another — a tie at the top of the board.
  save.almanac = [
    game(1, [{ name: "YANDY", hr: 3 }, { name: "ORTIZ", hr: 1 }]),
    game(2, [{ name: "CARLOS", hr: 3 }])
  ];

  const board = leaderboard(record, {}, save);
  assert.deepEqual(
    board.top.filter((row) => row.value === 3).map((row) => row.player).sort(),
    ["CARLOS", "YANDY"],
    "both men who hit three are on the board, not just the first"
  );
  assert.ok(!board.top.some((row) => row.player === "ORTIZ"), "the one-homer man is no co-holder and does not crowd it");

  localStorage.removeItem("showdown-quest-records-local");
});

test("a replay of a beaten trainer is a day of history, not a stat or a record", async () => {
  const { recordGameStats, ensureSeasonStats, seasonHitters, almanacGames } = await import("../src/adventure/state.js");
  const { RECORDS } = await import("../src/adventure/records.js");

  const save = testSave();
  delete save.seasonStats;
  const box = { hitters: [{ id: "h1", name: "BOPPER", pa: 4, ab: 4, h: 4, d: 0, t: 0, hr: 4, bb: 0, so: 0, r: 4, rbi: 4, sb: 0, cs: 0, gidp: 0, wpa: 1 }], pitchers: [] };

  recordGameStats(save, box);                    // a real game: it counts
  recordGameStats(save, box, { replay: true });  // a rematch of a beaten gym: it does not
  assert.equal(ensureSeasonStats(save).games, 2, "both are days played, so the almanac keeps unique days");
  assert.equal(seasonHitters(save).find((line) => line.id === "h1").hr, 4, "but only the real game's four homers are on his career line");

  // The record book reads through almanacGames, which drops the replay.
  const played = (day, runs, replay) => ({
    day, opponent: "GYM", playerSide: "away", won: true, replay,
    score: { away: runs, home: 0 },
    boxScore: { away: { team: "US", hitters: [], pitchers: [] }, home: { team: "GYM", hitters: [], pitchers: [] } }
  });
  save.almanac = [played(1, 9, false), played(2, 20, true)];
  assert.equal(almanacGames(save).length, 1, "the replay is not among the games that count");
  assert.equal(RECORDS.find((row) => row.key === "runs-game").read(save).value, 9,
    "the 20-run grind sets no record; the 9-run real game holds it");
});

// The drama screen always KNEW how to stage a steal (see the THE THROW test
// above). The man breaking for second was simply never asked: the swing asked,
// the pitch asked, the runner sent on a hit asked, and the steal went straight
// to the box score. A die thrown at a base with the game on it is the most
// suspenseful thing in the sport.
test("a steal in a big spot throws the slow die too", async () => {
  const { battleScreen } = await import("../src/adventure/ui/battleScreen.js");
  const { createBattle, battlePhase, isDramaticMoment, DRAMA_LEVERAGE } = await import("../src/rules/battle/controller.js");
  const { managerFor } = await import("../src/adventure/state.js");
  const { buildNpcTeam } = await import("../src/adventure/npcTeams.js");
  const { stateLeverage } = await import("../src/rules/game.js");

  const save = testSave();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({
    playerManager: managerFor(save),
    npcManager: buildNpcTeam(trainer, save),
    trainer,
    seed: "steal-drama",
    playerIsAway: true
  });

  // Ninth, two out, down one, the tying run on first and running. About as big
  // as a steal gets.
  const state = battle.state;
  state.inning = 9;
  state.half = "top";
  state.outs = 2;
  state.score = { away: 2, home: 3 };
  state.bases = [{ ...state.away.lineup[0], speed: 20 }, null, null];

  assert.ok(stateLeverage(state) >= DRAMA_LEVERAGE, `this is a big spot (leverage ${stateLeverage(state).toFixed(2)})`);
  assert.ok(isDramaticMoment(state), "so the die should come out slow");

  const phase = battlePhase(battle);
  assert.equal(phase.type, "player-batting");
  assert.ok(phase.stealOptions.length, "and the runner can go");

  const app = { save, screen: { name: "battle", battle, trainerId: trainer.id, menuIndex: 0 }, go() {}, rerender() {} };
  // Find the STEAL row the way a player finds it: by looking at the screen.
  const html = battleScreen.render(app);
  const rows = [...html.matchAll(/data-menu-index="(\d+)"([\s\S]*?)<\/li>/g)];
  const stealRow = rows.find(([, , body]) => /STEAL/.test(body));
  assert.ok(stealRow, "the steal is on the menu");

  app.screen.menuIndex = Number(stealRow[1]);
  battleScreen.key(app, "a");

  assert.equal(app.screen.mode, "drama", "sending him pauses on the tumbling die");
  assert.equal(app.screen.drama.stages[0].label, "THE THROW", "and the die is the throw to the bag");
});

// A question with one answer is not a question. If nobody can throw the man out,
// he takes the base — the game does not stop and ask permission to give you
// something free.
test("a runner who cannot be thrown out takes the base without being asked", async () => {
  const { applySingle, applyFlyout, pendingAdvanceDecision, certainSafe, freeAdvanceCount } = await import("../src/rules/game.js");
  const { player, npc } = hookTeams();

  const setUp = (speed) => {
    const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "free-base" });
    const state = battle.state;
    state.bases = [null, { id: "r", name: "Runner", speed }, null];
    return { state, batter: state.away.lineup[0], pitcher: pitcherStatus(state, "home").pitcher };
  };

  // The plodder can be gunned down at the plate, so the call is yours.
  const slow = setUp(10);
  applySingle(slow.state, slow.batter, "away", "home", createRng("slow"), slow.pitcher);
  const asked = pendingAdvanceDecision(slow.state);
  assert.ok(asked, "a man who can be thrown out is a decision");
  assert.ok(!certainSafe(asked.candidates[0]), "because he can be thrown out");
  assert.equal(freeAdvanceCount(asked.candidates), 0, "nothing here is free");

  // The burner cannot be. No question, and he is already home.
  const fast = setUp(20);
  const scoreBefore = fast.state.score.away;
  applySingle(fast.state, fast.batter, "away", "home", createRng("fast"), fast.pitcher);
  assert.equal(pendingAdvanceDecision(fast.state), null, "nobody is asked about a base nobody can defend");
  assert.equal(fast.state.score.away, scoreBefore + 1, "and he scored, rather than standing on second waiting to be asked");

  // The same on a fly ball: a tag-up nobody can throw out is not a question, and
  // — the bug this nearly shipped with — he must actually GO, not be swallowed.
  const flyBattle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "free-tag" });
  const flyState = flyBattle.state;
  flyState.outs = 0;
  flyState.bases = [null, null, { id: "t", name: "Tagger", speed: 20 }];
  applyFlyout(flyState, flyState.away.lineup[0], "away", "home", createRng("tag"));
  assert.equal(pendingAdvanceDecision(flyState), null, "no question");
  assert.equal(flyState.score.away, 1, "he tagged and scored");
  assert.equal(flyState.bases[2], null, "third is empty behind him");
});

// The bullpen phone is a WARNING — go and get him, he has nothing left. A warning
// about a game that is already over is not a warning: it is the last out honking
// at you a beat before the victory music, about an arm nobody has to decide
// anything about ever again.
test("the tired-arm alarm keeps quiet on the play that ends the game", async () => {
  const { fatigueAlarm } = await import("../src/adventure/ui/battleScreen.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer, seed: "last-out", playerIsAway: false });
  const state = battle.state;
  const mound = pitcherStatus(state, "home");

  // He is one batter past his tank: mid-game, that is news.
  state.pitching.home.battersFaced = mound.tiredAt + 1;
  const midGame = fatigueAlarm(battle, {});
  assert.equal(midGame.sound, "tiring", "with a game still to play, the phone rings");

  // The same tired arm, on the last out of the ballgame. Nothing to say.
  state.inning = 9;
  state.half = "bottom";
  state.outs = 3;
  state.score = { away: 2, home: 5 };
  state.gameOver = true;
  const final = fatigueAlarm(battle, {});
  assert.equal(final.sound, null, "the game is over; his tiredness is his own business");
  // The book is still kept, so nothing is double-counted if anybody asks later.
  assert.deepEqual(final.now, midGame.now, "what was heard is still tracked, it is simply not sounded");
});

// The game used to be thrown away at the final out: the almanac kept the box
// score and the board, and the play-by-play — the actual game — went in the bin.
// Reopening a game gave you an empty GAME LOG and a win-probability chart with
// nothing to draw.
test("a finished game files its play-by-play, and the book hands it back", async () => {
  const { recordFinishedGame } = await import("../src/adventure/ui/battleScreen.js");
  const { expandGame, compactGame } = await import("../src/adventure/gameLog.js");
  const { simulateGame } = await import("../src/rules/game.js");
  const { ensureAlmanac, ensureSeasonStats } = await import("../src/adventure/state.js");
  const { player, npc } = hookTeams();
  const trainer = trainerById("scout-jojo");
  const save = testSave();

  const teamOf = (manager) => ({
    name: manager.name ?? "TEAM",
    lineup: manager.lineup ?? manager.roster.filter((c) => c.kind === "hitter").slice(0, 9),
    pitchers: manager.pitchers ?? manager.roster.filter((c) => c.kind === "pitcher")
  });
  const game = simulateGame(teamOf(player), teamOf(npc), "log-seed");
  ensureSeasonStats(save).games = 1;

  recordFinishedGame(save, {
    trainer,
    boxScore: game.boxScore,
    playerSide: "away",
    events: game.events,
    score: { away: game.away.runs, home: game.home.runs },
    innings: game.innings,
    won: game.away.runs > game.home.runs,
    lineScore: game.lineScore
  });

  const filed = ensureAlmanac(save)[0];
  assert.ok(filed.events, "the game is kept");
  assert.ok(filed.events.cast?.length, "as a cast and a script — the men once, the plays pointing at them");

  const back = expandGame(filed.events);
  assert.equal(back.length, game.events.length, "every play comes back");
  // The fields the log and the chart actually render must survive the filing —
  // a compression that drops the one field the log needed is a log with a hole.
  const first = back.find((event) => event.result);
  const live = game.events.find((event) => event.result);
  for (const field of ["inning", "half", "batter", "batterId", "pitcher", "pitcherId", "result", "resultRoll", "controlRoll", "outsBefore", "basesBefore", "scoreAfter"]) {
    assert.deepEqual(first[field] ?? null, live[field] ?? null, `${field} survives`);
  }
  assert.ok(Math.abs(first.wpAfter - live.wpAfter) < 0.001, "and the win odds, to the percent the chart draws");

  // It is smaller than what it came from, which is the whole point of the cast.
  const filedSize = JSON.stringify(compactGame(game.events)).length;
  assert.ok(filedSize < JSON.stringify(game.events).length * 0.7, "and it is filed at well under the raw size");
});

// A rate cannot be added to a rate. Three games at .300 is not a .900 hitter, and
// an ERA is not a running total — so folding an opponent's games has to fold the
// COUNTS and work the rates out again at the bottom.
test("an opponent's book folds counts and reckons the rates fresh", async () => {
  const { opposingLines, opponentsOf } = await import("../src/adventure/gameArchive.js");
  const bat = (h, ab, hr) => ({ id: "o1", name: "Their Slugger", pa: ab, ab, h, hr, d: 0, t: 0, bb: 0, wpa: 0.1, avg: h / ab, ops: 1.2 });
  const arm = (r, outs, so) => ({ id: "o2", name: "Their Arm", outs, r, so, h: 5, bb: 1, wpa: -0.2, runsPerNine: 9 });
  const game = (day, won, mine, theirs, hitter, pitcher) => ({
    day, trainerId: "gym-garrick", opponent: "BENCH BOSS GARRICK", won, playerSide: "away",
    score: { away: mine, home: theirs },
    boxScore: { away: { team: "ME", hitters: [], pitchers: [] }, home: { team: "THEM", hitters: [hitter], pitchers: [pitcher] } }
  });
  const games = [
    game(3, true, 5, 2, bat(1, 4, 0), arm(5, 27, 4)),
    game(6, false, 1, 4, bat(3, 4, 2), arm(1, 27, 8))
  ];

  const { hitters, pitchers } = opposingLines(games);
  assert.equal(hitters[0].h, 4, "the hits add up");
  assert.equal(hitters[0].ab, 8);
  assert.ok(Math.abs(hitters[0].avg - 0.5) < 1e-9, "and the average is 4-for-8, not the two averages added together");
  assert.ok(hitters[0].ops < 2, "the OPS is reckoned, not summed into nonsense");

  assert.equal(pitchers[0].outs, 54, "the outs add up");
  assert.ok(Math.abs(pitchers[0].runsPerNine - 3) < 1e-9, "six runs in eighteen innings is a 3.00, not an 18.00");
  assert.ok(Math.abs(pitchers[0].strikeoutsPerNine - 6) < 1e-9);

  // And the road itself: who he played, and how it went.
  const [foe] = opponentsOf(games);
  assert.equal(foe.opponent, "BENCH BOSS GARRICK");
  assert.equal(foe.wins, 1);
  assert.equal(foe.losses, 1);
  assert.equal(foe.runsFor, 6);
  assert.equal(foe.runsAgainst, 6);
});
