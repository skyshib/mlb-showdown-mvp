import test from "node:test";
import assert from "node:assert/strict";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import {
  DEFAULT_BATCH_RUNS,
  batchProgressSnapshot,
  createBatchState,
  normalizeBatchRuns,
  runBatchChunk,
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

test("simulateBatch accounts for every season, title, and finals slot", () => {
  const teams = draftTeams("batch-accounting");
  const summary = simulateBatch(teams, { seed: "batch-accounting", runs: 25 });

  assert.equal(summary.runs, 25);
  assert.equal(summary.teams.length, 4);

  const titleShare = summary.teams.reduce((sum, row) => sum + row.titleShare, 0);
  const finalsShare = summary.teams.reduce((sum, row) => sum + row.finalsShare, 0);
  assert.ok(Math.abs(titleShare - 1) < 1e-9, "one champion per season");
  assert.ok(Math.abs(finalsShare - 2) < 1e-9, "two finalists per season");

  // 4 teams play 6 round-robin games per season, so wins and losses each sum to 6.
  const meanWins = summary.teams.reduce((sum, row) => sum + row.wins.mean, 0);
  const meanLosses = summary.teams.reduce((sum, row) => sum + row.losses.mean, 0);
  assert.ok(Math.abs(meanWins - 6) < 1e-9);
  assert.ok(Math.abs(meanLosses - 6) < 1e-9);
  assert.equal(summary.teams.reduce((sum, row) => sum + row.wins.sum, 0), 25 * 6);
  assert.equal(summary.teams.reduce((sum, row) => sum + row.losses.sum, 0), 25 * 6);

  for (const row of summary.teams) {
    assert.equal(row.wins.count, 25);
    assert.ok(row.games >= row.wins.sum + row.losses.sum);
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
    assert.ok(Number.isFinite(line.ops));
    assert.ok(line.teamGames > 0);
    assert.ok(Number.isFinite(line.paPer162));
    assert.ok(Number.isFinite(line.hrPer162));
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

test("batchProgressSnapshot reports running title tallies mid-batch", () => {
  const teams = draftTeams("batch-snapshot");
  const state = createBatchState(teams);
  runBatchChunk(state, teams, "batch-snapshot", 0, 8);
  const snapshot = batchProgressSnapshot(state);

  assert.equal(snapshot.runs, 8);
  assert.equal(snapshot.rows.length, 4);
  assert.equal(snapshot.rows.reduce((sum, row) => sum + row.titles, 0), 8);
  const shareSum = snapshot.rows.reduce((sum, row) => sum + row.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-9);
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
