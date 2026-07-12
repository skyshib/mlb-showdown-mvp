import test from "node:test";
import assert from "node:assert/strict";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import {
  DEFAULT_BATCH_RUNS,
  batchProgressSnapshot,
  createBatchState,
  normalizeBatchRuns,
  runBatchChunk,
  simulateBatchGame,
  simulateBatch
} from "../src/rules/batch.js";
import { RESULTS } from "../src/rules/cards.js";
import { autopick, buildTeam, createDraft } from "../src/rules/draft.js";
import { simulateGame } from "../src/rules/game.js";

function draftTeams(seed, teamCount = 4) {
  const managers = Array.from({ length: teamCount }, (_, index) => `Team ${index + 1}`);
  const pool = generatePlayerPool(`${seed}-pool`, teamCount * 2, 13);
  const draft = createDraft(managers, pool, 13);
  while (!draft.complete) autopick(draft);
  return draft.managers.map((manager) => buildTeam(manager));
}

test("simulateBatch is deterministic for the same seed", () => {
  const teams = draftTeams("batch-deterministic");
  const first = simulateBatch(teams, { seed: "batch-test", runs: 10 });
  const second = simulateBatch(teams, { seed: "batch-test", runs: 10 });
  assert.deepEqual(first, second);
});

test("simulateBatch accounts for every simulated game", () => {
  const teams = draftTeams("batch-accounting");
  const summary = simulateBatch(teams, { seed: "batch-accounting", runs: 25 });

  assert.equal(summary.runs, 25);
  assert.equal(summary.teams.length, 4);

  // Each simulated game creates one win, one loss, and two team-games.
  const meanWins = summary.teams.reduce((sum, row) => sum + row.wins.mean, 0);
  const meanLosses = summary.teams.reduce((sum, row) => sum + row.losses.mean, 0);
  assert.ok(meanWins > 0);
  assert.ok(meanLosses > 0);
  assert.equal(summary.teams.reduce((sum, row) => sum + row.wins.sum, 0), 25);
  assert.equal(summary.teams.reduce((sum, row) => sum + row.losses.sum, 0), 25);
  assert.equal(summary.teams.reduce((sum, row) => sum + row.games, 0), 50);

  for (const row of summary.teams) {
    assert.ok(Number.isFinite(row.winPct));
    assert.equal(row.games, row.wins.sum + row.losses.sum);
    assert.ok(Number.isFinite(row.steals));
    assert.ok(Number.isFinite(row.caughtStealing));
    assert.ok(Number.isFinite(row.advances));
    assert.ok(Number.isFinite(row.advanceAttempts));
    assert.ok(Number.isFinite(row.outsOnBases));
    assert.ok(Number.isFinite(row.cutDowns));
    assert.ok(Number.isFinite(row.caughtStealingByDefense));
    assert.ok(Number.isFinite(row.doublePlays));
    assert.ok(Number.isFinite(row.doublePlayChances));
  }
});

test("simulateBatch aggregates every drafted lineup and staff member", () => {
  const teams = draftTeams("batch-players");
  const summary = simulateBatch(teams, { seed: "batch-players", runs: 5 });

  assert.equal(summary.hitters.length, 36);
  assert.equal(summary.pitchers.length, 16);
  for (const line of summary.hitters) {
    assert.ok(line.pa > 0);
    assert.ok(line.team);
    assert.ok(Number.isFinite(line.r));
    assert.ok(Number.isFinite(line.sb));
    assert.ok(Number.isFinite(line.cs));
    assert.ok(Number.isFinite(line.ops));
    assert.ok(line.teamGames > 0);
    assert.ok(Number.isFinite(line.paPer162));
    assert.ok(Number.isFinite(line.hrPer162));
    assert.ok(Number.isFinite(line.csPer162));
  }
  for (const line of summary.pitchers) {
    assert.ok(line.outs > 0);
    assert.ok(Number.isFinite(line.runsPerNine));
    assert.ok(line.teamGames > 0);
    assert.ok(Number.isFinite(line.ipPer162));
  }
  for (let index = 1; index < summary.hitters.length; index += 1) {
    assert.ok(summary.hitters[index - 1].ops >= summary.hitters[index].ops, "hitters sorted by OPS");
  }
});

test("single-game batch hitter totals match the source box score", () => {
  const teams = draftTeams("batch-box-source", 2);
  const seed = "batch-box-source";
  const summary = simulateBatch(teams, { seed, runs: 1 });
  const game = simulateGame(teams[0], teams[1], `${seed}-game-1-${teams[0].name}-${teams[1].name}`);
  const boxHitters = [...game.boxScore.away.hitters, ...game.boxScore.home.hitters];

  for (const key of ["r", "sb", "cs", "rbi", "hr"]) {
    assert.equal(
      summary.hitters.reduce((sum, line) => sum + line[key], 0),
      boxHitters.reduce((sum, line) => sum + line[key], 0),
      `batch ${key} should match one source game`
    );
  }
});

test("simulateBatchGame recreates a numbered batch game", () => {
  const teams = draftTeams("batch-game-log", 3);
  const seed = "batch-game-log";
  const game = simulateBatchGame(teams, seed, 5);
  const sameGame = simulateBatchGame(teams, seed, 5);
  const previousGame = simulateBatchGame(teams, seed, 4);
  const summary = simulateBatch(teams, { seed, runs: 5 });

  assert.ok(game.events.length > 0);
  assert.deepEqual(game, sameGame);
  assert.notDeepEqual(game.events, previousGame.events);
  assert.equal(game.away.name, teams[0].name);
  assert.equal(game.home.name, teams[2].name);
  assert.equal(summary.runs, 5);
  assert.equal(
    summary.teams.reduce((sum, row) => sum + row.wins.sum, 0),
    5
  );
});

test("batchProgressSnapshot reports running win rates mid-batch", () => {
  const teams = draftTeams("batch-snapshot");
  const state = createBatchState(teams);
  runBatchChunk(state, teams, "batch-snapshot", 0, 8);
  const snapshot = batchProgressSnapshot(state);

  assert.equal(snapshot.runs, 8);
  assert.equal(snapshot.rows.length, 4);
  assert.equal(snapshot.rows.reduce((sum, row) => sum + row.wins, 0), 8);
  assert.equal(snapshot.rows.reduce((sum, row) => sum + row.losses, 0), 8);
  for (const row of snapshot.rows) {
    assert.ok(row.share >= 0 && row.share <= 1);
  }
});

test("normalizeBatchRuns clamps bad input to sane run counts", () => {
  assert.equal(normalizeBatchRuns(1000), 1000);
  assert.equal(normalizeBatchRuns("250"), 250);
  assert.equal(normalizeBatchRuns(0), DEFAULT_BATCH_RUNS);
  assert.equal(normalizeBatchRuns("garbage"), DEFAULT_BATCH_RUNS);
  assert.equal(normalizeBatchRuns(999999), 20000);
});

test("hitter box lines track doubles and triples that match the event log", () => {
  const teams = draftTeams("batch-xbh", 2);
  const result = simulateGame(teams[0], teams[1], "xbh-seed");
  const lines = [...result.boxScore.away.hitters, ...result.boxScore.home.hitters];
  const doubles = result.events.filter((event) => event.result === RESULTS.DOUBLE).length;
  const triples = result.events.filter((event) => event.result === RESULTS.TRIPLE).length;
  assert.equal(lines.reduce((sum, line) => sum + line.d, 0), doubles);
  assert.equal(lines.reduce((sum, line) => sum + line.t, 0), triples);
});
