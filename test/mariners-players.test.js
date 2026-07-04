import test from "node:test";
import assert from "node:assert/strict";
import { buildMarinersPool } from "../src/data/marinersPlayers.js";
import { maxRealPoolManagers } from "../src/data/realPlayers.js";
import { RESULTS } from "../src/rules/cards.js";
import { autopick, buildTeam, createDraft, validateRoster } from "../src/rules/draft.js";
import { simulateRoundRobin } from "../src/rules/tournament.js";

function findCard(pool, name, season) {
  const player = pool.find((item) => item.name.startsWith(name) && item.season === season);
  assert.ok(player, `expected ${name} '${season} in the Mariners pool`);
  return player;
}

function chartSlots(player, result) {
  return player.chart.reduce((sum, entry) => sum + (entry.result === result ? entry.to - entry.from + 1 : 0), 0);
}

test("mariners pool is deterministic and structurally valid", () => {
  const pool = buildMarinersPool();
  assert.deepEqual(pool, buildMarinersPool());

  const ids = new Set(pool.map((player) => player.id));
  assert.equal(ids.size, pool.length, "player ids are unique");

  for (const player of pool) {
    assert.match(player.team, /^SEA '\d{2}$/, `${player.name} carries an era team label`);
    assert.ok(Number.isInteger(player.season), `${player.name} carries a season`);
    const sorted = [...player.chart].sort((a, b) => a.from - b.from);
    let cursor = 1;
    for (const entry of sorted) {
      assert.equal(entry.from, cursor, `${player.name} chart is contiguous`);
      assert.ok(entry.to >= entry.from, `${player.name} chart ranges are ordered`);
      cursor = entry.to + 1;
    }
    assert.equal(cursor, 21, `${player.name} chart covers exactly 1-20`);
    assert.ok(player.points > 0, `${player.name} has positive points`);
  }
});

test("mariners pool covers every era of the franchise", () => {
  const decades = new Set(buildMarinersPool().map((player) => Math.floor(player.season / 10) * 10));
  for (const decade of [1970, 1980, 1990, 2000, 2010, 2020]) {
    assert.ok(decades.has(decade), `pool carries cards from the ${decade}s`);
  }
});

test("mariners pool supports at least six managers with legal position supply", () => {
  assert.ok(maxRealPoolManagers(buildMarinersPool()) >= 6, "pool should support six-manager rooms");
});

test("franchise legends grade out like legends across eras", () => {
  const pool = buildMarinersPool();
  const edgar = findCard(pool, "Edgar Martinez", 1995);
  const randy = findCard(pool, "Randy Johnson", 1995);
  const griffey93 = findCard(pool, "Ken Griffey Jr.", 1993);
  const griffey97 = findCard(pool, "Ken Griffey Jr.", 1997);
  const ichiro = findCard(pool, "Ichiro Suzuki", 2004);
  const langston = findCard(pool, "Mark Langston", 1987);

  // '95 Edgar is the best pure on-base card in franchise history.
  const bestOnBase = Math.max(...pool.filter((player) => player.kind === "hitter").map((player) => player.onBase));
  assert.equal(edgar.onBase, bestOnBase, "Edgar '95 owns the pool's top on-base");
  assert.ok(edgar.onBase >= 13, "Edgar '95 is elite at getting on");

  // The Big Unit rates as an ace even against the 2020s baseline: the era
  // shift is what buys the .259 OBP allowed of 1995 its extra control point.
  assert.ok(randy.control >= 5, "Randy '95 is an ace");
  assert.ok(chartSlots(randy, RESULTS.SO) >= 8, "Randy '95 misses bats in bulk");
  assert.ok(randy.ip >= 7, "Randy '95 works deep into games");
  assert.ok(langston.ip >= 7, "Langston '87 is a workhorse");

  // Icons show up once per era with distinct, tellable-apart cards.
  assert.notEqual(griffey93.id, griffey97.id);
  assert.equal(griffey93.name, "Ken Griffey Jr. '93");
  assert.equal(griffey97.name, "Ken Griffey Jr. '97");
  assert.equal(griffey93.team, "SEA '93");
  assert.equal(griffey97.team, "SEA '97");
  assert.ok(chartSlots(griffey97, RESULTS.HR) >= 3, "56-homer Griffey carries serious home run range");
  assert.ok(ichiro.speed >= 15, "Ichiro is a burner");
});

test("mariners pool drafts to completion and simulates a tournament", () => {
  const pool = buildMarinersPool();
  const managers = ["Kasey", "Milo", "Nico", "Rafa"];
  const draft = createDraft(managers, pool, 13);
  while (!draft.complete) autopick(draft);

  for (const manager of draft.managers) {
    assert.deepEqual(validateRoster(manager), [], `${manager.name} roster is legal`);
  }

  const teams = draft.managers.map((manager) => buildTeam(manager));
  const tournament = simulateRoundRobin(teams, "mariners-pool-smoke");
  assert.equal(tournament.standings.length, 4);
  assert.ok(tournament.games.length > 0);
});

test("mariners pool drafts to completion at the six-manager maximum", () => {
  const pool = buildMarinersPool();
  const managers = ["A", "B", "C", "D", "E", "F"];
  const draft = createDraft(managers, pool, 13);
  while (!draft.complete) autopick(draft);
  for (const manager of draft.managers) {
    assert.deepEqual(validateRoster(manager), [], `${manager.name} roster is legal`);
  }
});
