import test from "node:test";
import assert from "node:assert/strict";
import { buildRealPlayerPool, maxRealPoolManagers } from "../src/data/realPlayers.js";
import { RESULTS } from "../src/rules/cards.js";
import { autopick, buildTeam, createDraft, validateRoster } from "../src/rules/draft.js";
import { simulateRoundRobin } from "../src/rules/tournament.js";

function findPlayer(pool, name) {
  const player = pool.find((item) => item.name === name);
  assert.ok(player, `expected ${name} in the real player pool`);
  return player;
}

function chartSlots(player, result) {
  return player.chart.reduce((sum, entry) => sum + (entry.result === result ? entry.to - entry.from + 1 : 0), 0);
}

test("real player pool is deterministic and structurally valid", () => {
  const pool = buildRealPlayerPool();
  assert.deepEqual(pool, buildRealPlayerPool());

  const ids = new Set(pool.map((player) => player.id));
  assert.equal(ids.size, pool.length, "player ids are unique");

  for (const player of pool) {
    const sorted = [...player.chart].sort((a, b) => a.from - b.from);
    let cursor = 1;
    for (const entry of sorted) {
      assert.equal(entry.from, cursor, `${player.name} chart is contiguous`);
      assert.ok(entry.to >= entry.from, `${player.name} chart ranges are ordered`);
      cursor = entry.to + 1;
    }
    assert.equal(cursor, 21, `${player.name} chart covers exactly 1-20`);
    assert.ok(player.points > 0, `${player.name} has positive points`);
    assert.ok(player.team, `${player.name} has a team`);
  }
});

test("real pool supports at least six managers with legal position supply", () => {
  const pool = buildRealPlayerPool();
  assert.ok(maxRealPoolManagers(pool) >= 6, "pool should support six-manager rooms");
});

test("real cards reflect real skills", () => {
  const pool = buildRealPlayerPool();
  const judge = findPlayer(pool, "Aaron Judge");
  const kwan = findPlayer(pool, "Steven Kwan");
  const greene = findPlayer(pool, "Riley Greene");
  const harris = findPlayer(pool, "Michael Harris II");
  const skubal = findPlayer(pool, "Tarik Skubal");
  const witt = findPlayer(pool, "Bobby Witt Jr.");

  // Elite on-base skill shows up as a higher on-base number.
  assert.ok(judge.onBase > harris.onBase, "Judge gets on base more than a low-OBP hitter");
  // Power shows up as more home run slots.
  assert.ok(chartSlots(judge, RESULTS.HR) >= 3, "Judge's chart carries serious home run range");
  assert.ok(chartSlots(judge, RESULTS.HR) > chartSlots(kwan, RESULTS.HR), "Judge out-slugs Kwan");
  // Contact skill shows up as fewer strikeout slots.
  assert.ok(chartSlots(kwan, RESULTS.SO) < chartSlots(greene, RESULTS.SO), "Kwan whiffs less than Greene");
  // An ace grades out with elite control and a strikeout-heavy chart.
  assert.ok(skubal.control >= 5, "Skubal is an ace");
  assert.ok(chartSlots(skubal, RESULTS.SO) >= 6, "Skubal misses bats");
  // Speed and fielding ratings carry through.
  assert.ok(witt.speed >= 15 && witt.fielding >= 5, "Witt is a burner with a glove");
});

test("real pool drafts to completion and simulates a tournament", () => {
  const pool = buildRealPlayerPool();
  const managers = ["One", "Two", "Three", "Four"];
  const draft = createDraft(managers, pool, 13);
  while (!draft.complete) autopick(draft);

  for (const manager of draft.managers) {
    assert.deepEqual(validateRoster(manager), [], `${manager.name} roster is legal`);
  }

  const teams = draft.managers.map((manager) => buildTeam(manager));
  const tournament = simulateRoundRobin(teams, "real-pool-smoke");
  assert.equal(tournament.standings.length, 4);
  assert.ok(tournament.games.length > 0);
});

test("real pool drafts to completion at the six-manager maximum", () => {
  const pool = buildRealPlayerPool();
  const managers = ["A", "B", "C", "D", "E", "F"];
  const draft = createDraft(managers, pool, 13);
  while (!draft.complete) autopick(draft);
  for (const manager of draft.managers) {
    assert.deepEqual(validateRoster(manager), [], `${manager.name} roster is legal`);
  }
});
