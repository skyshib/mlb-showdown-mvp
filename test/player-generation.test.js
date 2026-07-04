import test from "node:test";
import assert from "node:assert/strict";
import { generatePlayerPool } from "../src/data/playerGeneration.js";

const FIELDING_RANGES = {
  C: [1, 10],
  "1B": [0, 1],
  "2B": [0, 6],
  "3B": [0, 3],
  SS: [0, 6],
  LF: [0, 2],
  CF: [1, 3],
  RF: [0, 2]
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
      assert.ok(player.speed >= 1 && player.speed <= 20);
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

test("generated player pools do not repeat full names", () => {
  const pool = generatePlayerPool("name-variety-check", 12, 13);
  const names = pool.map((player) => player.name);
  assert.equal(new Set(names).size, names.length);
});

test("generated player pools include two players per team at every hitter position", () => {
  const teamCount = 2;
  const pool = generatePlayerPool("position-depth-check", teamCount, 13);
  const hitters = pool.filter((player) => player.kind === "hitter");
  const positionCounts = Object.fromEntries(Object.keys(FIELDING_RANGES).map((position) => [position, 0]));

  for (const hitter of hitters) {
    positionCounts[hitter.position] += 1;
  }

  assert.deepEqual(positionCounts, {
    C: 4,
    "1B": 4,
    "2B": 4,
    "3B": 4,
    SS: 4,
    LF: 4,
    CF: 4,
    RF: 4
  });
});

function assertChartCoversD20(chart) {
  assert.equal(chart[0].from, 1);
  assert.equal(chart.at(-1).to, 20);
  for (let index = 1; index < chart.length; index += 1) {
    assert.equal(chart[index].from, chart[index - 1].to + 1);
  }
}
