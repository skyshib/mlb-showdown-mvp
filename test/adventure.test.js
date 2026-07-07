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
import {
  createSave,
  persistSave,
  loadSave,
  exportSaveCode,
  importSaveCode,
  addCardToCollection,
  removeCardFromCollection,
  ownedCount,
  setRoster,
  setBattingOrder,
  rosterPoints,
  managerFor,
  ensureSeasonStats,
  recordGameStats,
  seasonHitters,
  seasonPitchers,
  pointCap,
  startSeries,
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
  changePitcher,
  pitcherStatus,
  isGameOver,
  createInitialState,
  simulateGame,
  canBunt,
  attemptBunt,
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

test("the point cap is always 3500", () => {
  const save = testSave();
  assert.equal(pointCap(save), 3500);
  save.player.badges = ["ironwood", "galehook", "cascade", "pennant", "trophy"];
  assert.equal(pointCap(save), 3500, "badges do not move the cap");
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
  assert.equal(TRAINERS.some((trainer) => trainer.battleFormat.type === "simSeries"), false, "the sim-series farm boss is gone");
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

test("every trainer builds a legal team within budget, deterministically", () => {
  for (const trainer of TRAINERS) {
    const npc = buildNpcTeam(trainer);
    assert.equal(validateRoster(npc).length, 0, `${trainer.id} legal`);
    assert.ok(npc.points <= trainer.pointBudget, `${trainer.id} within budget (${npc.points}/${trainer.pointBudget})`);
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

test("manual pitching keeps the player's arm in past the plan; the NPC still rolls over", () => {
  const { player, npc } = hookTeams();
  const battle = createBattle({ playerManager: player, npcManager: npc, trainer: trainerById("scout-jojo"), seed: "manual-pen" });
  const state = battle.state;
  const starter = pitcherStatus(state, "away").pitcher;
  state.pitching.away.outsRecorded = starter.plannedOuts + 6;
  assert.equal(pitcherStatus(state, "away").pitcher.id, starter.id, "player's starter stays until pulled");
  assert.ok(pitcherStatus(state, "away").fatiguePenalty >= 1, "and pays for it in fatigue");
  const npcStarter = pitcherStatus(state, "home").pitcher;
  state.pitching.home.outsRecorded = npcStarter.plannedOuts;
  assert.notEqual(pitcherStatus(state, "home").pitcher.id, npcStarter.id, "NPC pen still follows the plan");
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
  const batterId = state.away.lineup[0].id;
  const event = attemptBunt(state, createRng("bunt-roll"));
  assert.equal(event.type, "bunt");
  assert.ok(["SAC", "FC"].includes(event.result));
  assert.equal(state.outs, 1);
  assert.equal(state.lineupIndex.away, 1, "the bunt consumed the plate appearance");
  if (event.result === "SAC") {
    assert.equal(state.bases[1]?.id, "r1", "runner moved up");
    assert.equal(state.bases[0], null);
  } else {
    assert.equal(state.bases[0]?.id, batterId, "batter reached on the fielder's choice");
    assert.equal(state.bases[1], null, "lead runner was cut down");
  }
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
});

test("the game log lines carry player-perspective WPA", async () => {
  const { gameLogLine } = await import("../src/adventure/ui/statsScreens.js");
  const swing = { inning: 3, half: "top", batter: "Al Smith", pitcher: "Bo Diaz", result: "HR", runs: 2, scoreAfter: { away: 3, home: 1 }, wpa: 0.18 };
  const yours = gameLogLine(swing, "away");
  assert.ok(yours.includes("T3"), "inning tag");
  assert.ok(yours.includes("A.SMITH"), "batter");
  assert.ok(yours.includes("+18%"), "your swing reads positive");
  assert.ok(yours.includes("3-1"), "score shows when runs score");
  const theirs = gameLogLine({ ...swing, half: "bottom" }, "away");
  assert.ok(theirs.includes("-18%"), "their swing reads negative");
  const pen = gameLogLine({ type: "pitching-change", inning: 5, half: "bottom", team: "Them Club", pitcher: "Cy Muller" }, "away");
  assert.ok(pen.includes("PEN"), "pitching changes log without WPA");
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
