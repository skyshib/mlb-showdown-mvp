import test from "node:test";
import assert from "node:assert/strict";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { autopick, buildTeam, createDraft } from "../src/rules/draft.js";
import {
  replayBatchGames,
  simulateBatch
} from "../src/rules/batch.js";
import {
  WPA_CALIBRATION_VERSION,
  baseOutRunExpectancy,
  calibratedWinProbability,
  createWinExpectancyCalibration,
  finalizeWinExpectancyCalibration,
  observeCalibrationGame
} from "../src/rules/wpaCalibration.js";

function draftTeams(seed, teamCount = 3) {
  const managers = Array.from({ length: teamCount }, (_, index) => `Team ${index + 1}`);
  const pool = generatePlayerPool(`${seed}-pool`, teamCount * 2, 13);
  const draft = createDraft(managers, pool, 13, seed);
  while (!draft.complete) autopick(draft);
  return draft.managers.map((manager) => buildTeam(manager));
}

function calibrationGame({ homeWon, finalRuns }) {
  const away = { name: "Away", runs: 0 };
  const home = { name: "Home", runs: finalRuns };
  return {
    away,
    home,
    winner: homeWon ? home.name : away.name,
    events: [{
      inning: 4,
      half: "bottom",
      outsBefore: 1,
      basesBefore: [null, "Runner", null],
      scoreBefore: { away: 2, home: 1 },
      scoreAfter: { away: 2, home: finalRuns },
      wpBefore: 0.4
    }]
  };
}

test("calibration shrinks empirical state values toward the historical prior", () => {
  const calibration = createWinExpectancyCalibration();
  observeCalibrationGame(calibration, calibrationGame({ homeWon: true, finalRuns: 3 }));
  observeCalibrationGame(calibration, calibrationGame({ homeWon: false, finalRuns: 1 }));
  const model = finalizeWinExpectancyCalibration(calibration, { priorStrength: 2 });

  assert.equal(model.version, WPA_CALIBRATION_VERSION);
  assert.equal(model.games, 2);
  assert.equal(model.events, 2);
  assert.equal(model.observedStates, 1);
  assert.equal(model.states["4|bottom|1|2|-1"], 0.45);
  assert.equal(baseOutRunExpectancy(model, 1, [null, "Runner", null]), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model, "saved batches can serialize the model");
});

test("calibrated lookup falls back for unseen states", () => {
  const model = {
    version: WPA_CALIBRATION_VERSION,
    states: { "1|top|0|0|0": 0.48 }
  };
  assert.equal(calibratedWinProbability(model, {
    inning: 1,
    half: "top",
    outs: 0,
    bases: [null, null, null],
    diff: 0
  }, 0.54), 0.48);
  assert.equal(calibratedWinProbability(model, {
    inning: 9,
    half: "bottom",
    outs: 2,
    bases: [null, null, null],
    diff: -1
  }, 0.05), 0.05);
});

test("batch simulations replay with their frozen draft-specific WPA model", () => {
  const teams = draftTeams("calibrated-batch");
  const seed = "calibrated-batch-games";
  const runs = 30;
  const summary = simulateBatch(teams, { seed, runs });
  const model = summary.winExpectancyModel;
  const replayed = replayBatchGames(teams, seed, 0, runs, model);

  assert.equal(model.version, WPA_CALIBRATION_VERSION);
  assert.equal(model.games, runs);
  assert.ok(model.events > 0);
  assert.ok(model.observedStates > 0);
  assert.ok(Number.isFinite(model.runsPerGame));
  assert.ok(Number.isFinite(baseOutRunExpectancy(model, 1, [null, "Runner", null])));

  const replayHitterWpa = new Map();
  const replayPitcherWpa = new Map();
  for (const { game } of replayed) {
    for (let index = 1; index < game.events.length; index += 1) {
      assert.ok(
        Math.abs(game.events[index].wpBefore - game.events[index - 1].wpAfter) < 1e-9,
        "calibrated win probability telescopes through the replay"
      );
    }
    for (const box of [game.boxScore.away, game.boxScore.home]) {
      for (const line of box.hitters) {
        replayHitterWpa.set(line.id, (replayHitterWpa.get(line.id) ?? 0) + line.wpa);
      }
      for (const line of box.pitchers) {
        replayPitcherWpa.set(line.id, (replayPitcherWpa.get(line.id) ?? 0) + line.wpa);
      }
    }
  }

  for (const line of summary.hitters) {
    assert.ok(Math.abs(line.wpa - (replayHitterWpa.get(line.id) ?? 0)) < 1e-9);
  }
  for (const line of summary.pitchers) {
    assert.ok(Math.abs(line.wpa - (replayPitcherWpa.get(line.id) ?? 0)) < 1e-9);
  }
  const netWpa = [...summary.hitters, ...summary.pitchers]
    .reduce((sum, line) => sum + line.wpa, 0);
  assert.ok(Math.abs(netWpa) < 1e-9, `batch WPA remains zero-sum, got ${netWpa}`);
});

test("batch schedule gives every pairing both home and away games", () => {
  const teams = draftTeams("balanced-home-away", 2);
  const games = replayBatchGames(teams, "balanced-home-away-games", 0, 4);
  assert.deepEqual(
    games.map(({ game }) => [game.away.name, game.home.name]),
    [
      [teams[0].name, teams[1].name],
      [teams[1].name, teams[0].name],
      [teams[0].name, teams[1].name],
      [teams[1].name, teams[0].name]
    ]
  );
});

test("legacy batch schedules still replay saved games in their original order", () => {
  const teams = draftTeams("legacy-schedule", 3);
  const [fifth] = replayBatchGames(
    teams,
    "legacy-schedule-games",
    4,
    1,
    null,
    { scheduleVersion: 1 }
  );
  assert.equal(fifth.game.away.name, teams[0].name);
  assert.equal(fifth.game.home.name, teams[2].name);
});
