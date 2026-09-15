import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftPool } from "../src/data/universes.js";
import { autopick, buildTeam, createDraft, standingReplacements } from "../src/rules/draft.js";
import { simulateBatch } from "../src/rules/batch.js";
import { simulateGame } from "../src/rules/game.js";
import { FIELDING_SWEEP } from "../src/rules/attribution.js";

function roomTeams(seed) {
  const pool = buildDraftPool("classic", seed, { managerCount: 4 });
  const draft = createDraft(["A", "B", "C", "D"], pool, 13, seed);
  while (!draft.complete) autopick(draft);
  const replacements = standingReplacements(draft);
  return draft.managers.map((manager) => ({ ...buildTeam(manager, { optimize: true }), replacements }));
}

const TEAMS = roomTeams("attribution-room");

test("measuring wins above replacement does not change a single game", () => {
  for (let index = 0; index < 40; index += 1) {
    const [away, home] = [TEAMS[index % 4], TEAMS[(index + 1) % 4]];
    const plain = simulateGame(away, home, `same-dice-${index}`);
    const measured = simulateGame(away, home, `same-dice-${index}`, {
      attribution: { replacements: { away: away.replacements, home: home.replacements } }
    });
    assert.ok(measured.attribution.lines.length > 0);
    const { attribution, ...rest } = measured;
    assert.deepEqual(rest, plain);
  }
});

test("a player measured against himself is worth exactly nothing", () => {
  // The replay is the real plate appearance, the same dice through the same
  // rules, so swapping a card for itself must reproduce every win to the bit.
  const self = (side, kind, player) => {
    if (kind === "runner") return Number(player.speed) || 0;
    if (kind === "fielder") return Number(player.fielding) || 0;
    return player;
  };
  for (let index = 0; index < 60; index += 1) {
    const [away, home] = [TEAMS[index % 4], TEAMS[(index + 2) % 4]];
    const game = simulateGame(away, home, `self-${index}`, { attribution: { resolveReplacement: self } });
    for (const line of game.attribution.lines) {
      for (const bucket of ["hitting", "baserunning", "defense", "pitching", "pitchingFresh"]) {
        assert.equal(line[bucket], 0, `${line.name} ${bucket} in game ${index}`);
      }
    }
  }
});

test("the fielding curve is zero at the club's own defense and never rewards a worse glove", () => {
  const summary = simulateBatch(TEAMS, { runs: 300, seed: "curve" });
  assert.equal(summary.attribution, true);
  for (const team of summary.teams) {
    for (const [unit, curve] of Object.entries(team.fieldingCurvePer162)) {
      assert.equal(curve.length, FIELDING_SWEEP * 2 + 1);
      assert.equal(curve[FIELDING_SWEEP], 0, `${team.team} ${unit}`);
      for (let index = 1; index < curve.length; index += 1) {
        assert.ok(curve[index] >= curve[index - 1] - 1e-9, `${team.team} ${unit} dips at ${index - FIELDING_SWEEP}`);
      }
    }
  }
});

test("each bucket lands only on the players it measures", () => {
  const summary = simulateBatch(TEAMS, { runs: 200, seed: "buckets" });
  for (const hitter of summary.hitters) assert.equal(hitter.warPer162.pitching, 0);
  for (const pitcher of summary.pitchers) {
    assert.equal(pitcher.warPer162.hitting, 0);
    assert.equal(pitcher.warPer162.baserunning, 0);
    assert.equal(pitcher.warPer162.defense, 0);
  }
  assert.ok(summary.hitters.some((hitter) => hitter.warPer162.hitting !== 0));
  assert.ok(summary.hitters.some((hitter) => hitter.warPer162.baserunning !== 0));
  assert.ok(summary.hitters.some((hitter) => hitter.warPer162.defense !== 0));
  assert.ok(summary.pitchers.some((pitcher) => pitcher.warPer162.pitching !== 0));
  // Not tired pitching WPAR is its own split: measured, and short of all work
  // for an arm who pitched tired.
  assert.ok(summary.pitchers.some((pitcher) => pitcher.fresh.warPer162.pitching !== 0));
  assert.ok(summary.pitchers.some((pitcher) => pitcher.fresh.bf < pitcher.bf
    && pitcher.fresh.warPer162.pitching !== pitcher.warPer162.pitching));
  for (const pitcher of summary.pitchers.filter((line) => line.fresh.bf === line.bf)) {
    assert.ok(Math.abs(pitcher.fresh.warPer162.pitching - pitcher.warPer162.pitching) < 1e-9, pitcher.name);
  }
});

test("a room without standing replacements simulates without measuring", () => {
  const teams = TEAMS.map(({ replacements, ...team }) => team);
  const summary = simulateBatch(teams, { runs: 20, seed: "no-replacements" });
  assert.equal(summary.attribution, false);
});
