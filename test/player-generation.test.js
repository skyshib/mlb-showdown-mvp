import test from "node:test";
import assert from "node:assert/strict";
import { buildFictionalDraftPool, buildFictionalUniverse, generatePlayerPool } from "../src/data/playerGeneration.js";
import { maxRealPoolManagers } from "../src/data/realPlayers.js";
import { autopick, createDraft, validateRoster } from "../src/rules/draft.js";

const FIELDING_RANGES = {
  C: [1, 10],
  "1B": [0, 1],
  "2B": [0, 6],
  "3B": [0, 3],
  SS: [0, 6],
  "LF/RF": [0, 2],
  CF: [1, 3]
};

test("generated players use distribution-built charts instead of archetypes", () => {
  const pool = generatePlayerPool("distribution-check", 6, 13);
  const hitterCharts = new Set();
  const pitcherCharts = new Set();

  for (const player of pool) {
    assert.equal(Object.hasOwn(player, "archetype"), false);
    assertChartCoversD20(player.chart);

    if (player.kind === "hitter") {
      const [min, max] = FIELDING_RANGES[player.position];
      assert.ok(player.onBase >= 6 && player.onBase <= 15);
      assert.ok(player.speed >= 1);
      assert.ok(player.fielding >= min && player.fielding <= max);
      hitterCharts.add(JSON.stringify(player.chart));
    } else {
      assert.ok(player.control >= 0 && player.control <= 6);
      assert.ok(player.role === "RP" ? player.ip === 1 : player.ip >= 5);
      pitcherCharts.add(JSON.stringify(player.chart));
    }
  }

  assert.ok(hitterCharts.size > 4);
  assert.ok(pitcherCharts.size > 4);
});

test("generated hitter speed has no artificial upper cap", () => {
  const pool = generatePlayerPool("uncapped-speed-check", 20, 13);
  const speeds = pool.filter((player) => player.kind === "hitter").map((player) => player.speed);
  assert.ok(Math.max(...speeds) > 20);
});

test("generated player pools do not repeat full names", () => {
  const pool = generatePlayerPool("name-variety-check", 12, 13);
  const names = pool.map((player) => player.name);
  assert.equal(new Set(names).size, names.length);
});

test("generated player pools include two players per team per lineup slot at every hitter position", () => {
  const teamCount = 2;
  const pool = generatePlayerPool("position-depth-check", teamCount, 13);
  const hitters = pool.filter((player) => player.kind === "hitter");
  const positionCounts = Object.fromEntries(Object.keys(FIELDING_RANGES).map((position) => [position, 0]));

  for (const hitter of hitters) {
    positionCounts[hitter.position] += 1;
  }

  // LF/RF covers two lineup slots, so its bucket is twice as deep.
  assert.deepEqual(positionCounts, {
    C: 4,
    "1B": 4,
    "2B": 4,
    "3B": 4,
    SS: 4,
    "LF/RF": 8,
    CF: 4
  });
});

test("the fictional universe is one persistent league", () => {
  const universe = buildFictionalUniverse();
  assert.deepEqual(universe, buildFictionalUniverse(), "universe is stable across builds");
  assert.ok(universe.length >= 150, "universe is deep enough to deal from");
  const names = universe.map((player) => player.name);
  assert.equal(new Set(names).size, names.length, "every fictional player is one person");
});

test("each fictional draft deals a seeded slice of the universe", () => {
  const dealA = buildFictionalDraftPool("night-a");
  const dealB = buildFictionalDraftPool("night-b");

  // Same seed, same deck — required for online rooms to rebuild identically.
  assert.deepEqual(dealA, buildFictionalDraftPool("night-a"));

  const idsA = new Set(dealA.map((player) => player.id));
  const idsB = new Set(dealB.map((player) => player.id));
  assert.notDeepEqual([...idsA].sort(), [...idsB].sort(), "two seeds deal different decks");

  // Recurring characters: the decks overlap without being identical.
  const shared = [...idsA].filter((id) => idsB.has(id));
  assert.ok(shared.length > 0, "some fictional players recur across decks");

  const universe = buildFictionalUniverse();
  for (const deal of [dealA, dealB]) {
    assert.ok(deal.length < universe.length, "a deal is a strict slice of the universe");
    assert.ok(maxRealPoolManagers(deal) >= 8, "every deal supports eight-manager rooms");
    for (const player of deal) {
      assert.ok(universe.some((card) => card.id === player.id), `${player.name} comes from the universe`);
    }
  }
});

test("dealt fictional pools draft to completion at the eight-manager maximum", () => {
  const pool = buildFictionalDraftPool("fictional-max");
  const managers = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const draft = createDraft(managers, pool, 13);
  while (!draft.complete) autopick(draft);
  for (const manager of draft.managers) {
    assert.deepEqual(validateRoster(manager), [], `${manager.name} roster is legal`);
  }
});

function assertChartCoversD20(chart) {
  assert.equal(chart[0].from, 1);
  assert.equal(chart.at(-1).to, 20);
  for (let index = 1; index < chart.length; index += 1) {
    assert.equal(chart[index].from, chart[index - 1].to + 1);
  }
}
