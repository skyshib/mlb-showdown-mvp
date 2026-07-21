import test from "node:test";
import assert from "node:assert/strict";
import { buildFictionalDraftPool, buildFictionalUniverse, generatePlayerPool } from "../src/data/playerGeneration.js";
import { maxRealPoolManagers } from "../src/data/realPlayers.js";
import { hitterPositions } from "../src/rules/cards.js";
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

test("generated hitters loosely follow all-time MLB multi-position patterns", () => {
  const pool = generatePlayerPool("multi-position-pattern-check", 125, 13);
  const hitters = pool.filter((player) => player.kind === "hitter");
  const multi = hitters.filter((player) => hitterPositions(player).length > 1);
  const threePosition = multi.filter((player) => hitterPositions(player).length === 3);
  const pairCount = (a, b) => multi.filter((player) => {
    const positions = hitterPositions(player).map((entry) => entry.pos);
    return positions.includes(a) && positions.includes(b);
  }).length;

  // The all-time reference is 28.1%; leave enough room for seeded variance
  // and for the fictional pool's deliberately even primary-position supply.
  assert.ok(multi.length / hitters.length >= 0.25);
  assert.ok(multi.length / hitters.length <= 0.34);
  assert.ok(multi.length < hitters.length, "most generated hitters remain single-position");
  assert.ok(threePosition.length > 0, "rare utility players can cover three positions");
  assert.ok(threePosition.length / multi.length < 0.08, "three-position players stay rare");

  assert.ok(pairCount("SS", "2B") > pairCount("SS", "C"), "SS/2B is more common than SS/C");
  assert.ok(pairCount("CF", "LF/RF") > pairCount("CF", "2B"), "CF/corner OF is more common than CF/2B");
});

test("generated multi-position cards retain primary ratings and valid secondary fielding", () => {
  const hitters = generatePlayerPool("multi-position-ratings-check", 40, 13)
    .filter((player) => player.kind === "hitter");
  const multi = hitters.filter((player) => hitterPositions(player).length > 1);

  assert.ok(multi.length > 0);
  for (const player of multi) {
    const positions = hitterPositions(player);
    assert.deepEqual(positions[0], { pos: player.position, fielding: player.fielding });
    assert.equal(new Set(positions.map((entry) => entry.pos)).size, positions.length);
    for (const entry of positions) {
      const [min, max] = FIELDING_RANGES[entry.pos];
      assert.ok(entry.fielding >= min && entry.fielding <= max, `${player.name} ${entry.pos}+${entry.fielding}`);
    }
  }
});

test("each room seed invents its own fictional league", () => {
  const universe = buildFictionalUniverse();
  assert.deepEqual(universe, buildFictionalUniverse(), "the no-seed league is stable across builds");
  assert.ok(universe.length >= 150, "a league is deep enough to deal from");
  const names = universe.map((player) => player.name);
  assert.equal(new Set(names).size, names.length, "every fictional player is one person");

  const nightA = buildFictionalUniverse("night-a");
  assert.deepEqual(nightA, buildFictionalUniverse("night-a"), "same seed, same league");
  const nightB = buildFictionalUniverse("night-b");
  assert.notDeepEqual(
    nightA.map((player) => player.name),
    nightB.map((player) => player.name),
    "two seeds invent different players"
  );
  assert.equal(nightA.filter((player) => player.egg === "golden").length, 1, "every league hides one golden ticket");
});

test("each fictional draft deals a seeded slice of its own league", () => {
  const deal = buildFictionalDraftPool("night-a");

  // Same seed, same deck — required for online rooms to rebuild identically.
  assert.deepEqual(deal, buildFictionalDraftPool("night-a"));

  const universe = buildFictionalUniverse("night-a");
  assert.ok(deal.length < universe.length, "a deal is a strict slice of its league");
  assert.ok(maxRealPoolManagers(deal) >= 8, "every deal supports eight-manager rooms");
  for (const player of deal) {
    assert.ok(universe.some((card) => card.id === player.id), `${player.name} comes from his league`);
  }

  const otherDeal = buildFictionalDraftPool("night-b");
  assert.notDeepEqual(
    deal.map((player) => player.name),
    otherDeal.map((player) => player.name),
    "two seeds deal decks of different players"
  );
});

test("one roll in a thousand prints past the bell: OB 16 bats and Control 7 arms", () => {
  let hitters = 0;
  let pitchers = 0;
  let ob16 = 0;
  let ctrl7 = 0;
  let overCeiling = 0;
  for (let i = 0; i < 60; i += 1) {
    for (const card of buildFictionalUniverse(`aces-${i}`)) {
      if (card.kind === "hitter") {
        hitters += 1;
        if (card.onBase === 16) ob16 += 1;
        if (card.onBase > 16) overCeiling += 1;
      } else {
        pitchers += 1;
        if (card.control === 7) ctrl7 += 1;
        if (card.control > 7) overCeiling += 1;
      }
    }
  }
  // ~6,240 hitters and ~5,280 pitchers at 0.1% — a handful each, never a flood.
  assert.ok(ob16 >= 1 && ob16 <= 20, `${ob16} OB 16 hitters in ${hitters}`);
  assert.ok(ctrl7 >= 1 && ctrl7 <= 20, `${ctrl7} Control 7 pitchers in ${pitchers}`);
  assert.equal(overCeiling, 0, "nothing prints past the ace ceiling");
});

test("every fictional deck carries exactly one golden ticket", () => {
  for (const seed of ["night-a", "night-b", "night-c", "golden-hunt", "high-dinger"]) {
    const goldens = buildFictionalDraftPool(seed).filter((card) => card.egg === "golden");
    assert.equal(goldens.length, 1, `seed "${seed}" deals ${goldens.length} golden tickets`);
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
