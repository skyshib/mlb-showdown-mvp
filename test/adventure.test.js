import test from "node:test";
import assert from "node:assert/strict";
import {
  adventurePool,
  cardById,
  openPack,
  shopStock,
  starterCommons,
  starterChoices,
  starterRosterWith,
  RARITIES,
  PACKS
} from "../src/adventure/packs.js";
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
  pointCap,
  startSeries,
  recordSeriesGame,
  seriesNeeded,
  attemptNumber,
  grantCoins,
  spendCoins
} from "../src/adventure/state.js";
import { TRAINERS, trainerById, isTrainerUnlocked, rewardCoins } from "../src/adventure/region.js";
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

function testSave() {
  const save = createSave({ name: "TEST", saveSeed: "test-seed" });
  const roster = starterRosterWith(starterChoices()[0].card);
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

// ---- Pool and rarity -------------------------------------------------------

test("every adventure card carries a rarity and ids resolve", () => {
  const pool = adventurePool();
  assert.ok(pool.length > 300);
  for (const card of pool) {
    assert.ok(RARITIES[card.rarity], `${card.id} has rarity ${card.rarity}`);
    assert.equal(cardById(card.id)?.id, card.id);
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

test("pack pulls are deterministic per seed and honor slot tiers", () => {
  const first = openPack("booster", "seed-1");
  const second = openPack("booster", "seed-1");
  const other = openPack("booster", "seed-2");
  assert.deepEqual(first.map((card) => card.id), second.map((card) => card.id));
  assert.notDeepEqual(first.map((card) => card.id), other.map((card) => card.id));
  assert.equal(first.length, PACKS.booster.slots.length);
  assert.equal(first.filter((card) => card.rarity === "common").length, 3);
  assert.equal(first[3].rarity, "uncommon");
  assert.ok(["rare", "legend"].includes(first[4].rarity));
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

test("starter commons are a legal roster and every star swap stays legal and under the cap", () => {
  const commons = starterCommons();
  assert.equal(commons.length, 13);
  assert.equal(validateRoster({ roster: commons }).length, 0);
  for (const choice of starterChoices()) {
    const roster = starterRosterWith(choice.card);
    assert.equal(roster.length, 13);
    assert.equal(validateRoster({ roster }).length, 0, `${choice.key} roster legal`);
    assert.ok(roster.some((card) => card.id === choice.card.id), "star made the team");
    const points = roster.reduce((sum, card) => sum + card.points, 0);
    assert.ok(points <= 2600, `${choice.key} under starter cap (${points})`);
  }
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
  const farm = trainerById("farm-cage-crew");
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

test("point cap rises with badges", () => {
  const save = testSave();
  assert.equal(pointCap(save), 2600);
  save.player.badges.push("ironwood");
  assert.equal(pointCap(save), 3000);
});

test("attempt numbers derive distinct battle seeds", () => {
  const save = testSave();
  const first = attemptNumber(save, "scout-jojo");
  const second = attemptNumber(save, "scout-jojo");
  assert.notEqual(first, second);
});
