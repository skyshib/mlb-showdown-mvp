import test from "node:test";
import assert from "node:assert/strict";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { autopick, buildTeam, createDraft } from "../src/rules/draft.js";
import { replayBatchGames, simulateBatch } from "../src/rules/batch.js";

function draftTeams(seed, teamCount = 3) {
  const managers = Array.from({ length: teamCount }, (_, index) => `Team ${index + 1}`);
  const pool = generatePlayerPool(`${seed}-pool`, teamCount * 2, 13);
  const draft = createDraft(managers, pool, 13, seed);
  while (!draft.complete) autopick(draft);
  return draft.managers.map((manager) => buildTeam(manager));
}

test("replayed games reproduce the batch run exactly", () => {
  const teams = draftTeams("replay-exact");
  const runs = 30;
  const summary = simulateBatch(teams, { seed: "replay-exact-seed", runs });

  const replayed = replayBatchGames(teams, "replay-exact-seed", 0, runs);
  assert.equal(replayed.length, runs);

  const wins = new Map(teams.map((team) => [team.name, 0]));
  for (const { game } of replayed) {
    wins.set(game.winner, (wins.get(game.winner) ?? 0) + 1);
  }
  for (const row of summary.teams) {
    assert.equal(wins.get(row.team), row.wins.sum, `${row.team} win total matches the replay`);
  }
});

test("replaying a slice matches the same games from a full replay", () => {
  const teams = draftTeams("replay-slice");
  const full = replayBatchGames(teams, "slice-seed", 0, 25);
  const slice = replayBatchGames(teams, "slice-seed", 17, 4);

  assert.equal(slice.length, 4);
  for (let offset = 0; offset < slice.length; offset += 1) {
    const expected = full[17 + offset].game;
    const actual = slice[offset].game;
    assert.equal(slice[offset].index, 17 + offset);
    assert.equal(actual.seed, expected.seed, "same deterministic seed");
    assert.equal(actual.away.runs, expected.away.runs);
    assert.equal(actual.home.runs, expected.home.runs);
    assert.equal(actual.events.length, expected.events.length);
  }
});

test("replayed events carry win probability for the review log", () => {
  const teams = draftTeams("replay-wp");
  const [{ game }] = replayBatchGames(teams, "wp-seed", 0, 1);
  for (const event of game.events) {
    assert.ok(event.wpBefore >= 0 && event.wpBefore <= 1);
    assert.ok(event.wpAfter >= 0 && event.wpAfter <= 1);
    assert.ok(Math.abs(event.wpa) <= 1);
  }
  const last = game.events[game.events.length - 1];
  assert.equal(last.wpAfter, game.winner === game.home.name ? 1 : 0);
});
