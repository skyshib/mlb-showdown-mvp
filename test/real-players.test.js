import test from "node:test";
import assert from "node:assert/strict";
import { actionShotUrl, headshotUrl } from "../src/data/headshots.js";
import { buildMarinersPool } from "../src/data/marinersPlayers.js";
import { buildRealPlayerPool, buildRealDraftPool, maxRealPoolManagers } from "../src/data/realPlayers.js";
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

test("starter workload outprices relievers", () => {
  const pool = buildRealPlayerPool();
  const starters = pool.filter((player) => player.role === "SP");
  const relievers = pool.filter((player) => player.role === "RP");
  const avg = (players) => players.reduce((sum, player) => sum + player.points, 0) / players.length;

  // Relievers pitch one inning to a starter's six-plus, so the same control
  // and chart quality should cost far less on a bullpen card.
  assert.ok(avg(relievers) < avg(starters) * 0.65, "average reliever prices well below average starter");

  const bestReliever = Math.max(...relievers.map((player) => player.points));
  const bestStarter = Math.max(...starters.map((player) => player.points));
  assert.ok(bestReliever < bestStarter * 0.6, "even elite closers stay below ace pricing");
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

test("real pool drafts to completion with six managers", () => {
  const pool = buildRealPlayerPool();
  const managers = ["A", "B", "C", "D", "E", "F"];
  const draft = createDraft(managers, pool, 13);
  while (!draft.complete) autopick(draft);
  for (const manager of draft.managers) {
    assert.deepEqual(validateRoster(manager), [], `${manager.name} roster is legal`);
  }
});

test("real pool drafts to completion at the max manager count", () => {
  const pool = buildRealPlayerPool();
  const limit = maxRealPoolManagers(pool);
  assert.ok(limit >= 8, "era expansion should support big rooms");
  const managers = Array.from({ length: limit }, (_, index) => `M${index + 1}`);
  const draft = createDraft(managers, pool, 13);
  while (!draft.complete) autopick(draft);
  for (const manager of draft.managers) {
    assert.deepEqual(validateRoster(manager), [], `${manager.name} roster is legal`);
  }
});

test("real players resolve to real photos, not cartoons", () => {
  const stars = buildRealPlayerPool();
  const starsMissing = stars.filter((player) => !headshotUrl(player.name)).map((player) => player.name);
  assert.deepEqual(starsMissing, [], "every stars-pool player has a photo");

  // A few deep-cut Mariners have no photo on MLB or Wikimedia; they show the
  // initials placeholder. Keep overall coverage above 90%.
  const combined = [...stars, ...buildMarinersPool()];
  const missing = combined.filter((player) => !headshotUrl(player.name));
  assert.ok(
    missing.length / combined.length < 0.1,
    `photo coverage dropped below 90%, missing: ${missing.map((player) => player.name).join(", ")}`
  );

  assert.match(headshotUrl("Aaron Judge"), /img\.mlbstatic\.com/);
  assert.match(headshotUrl("Babe Ruth '27"), /121578/, "era suffixes resolve to the right person");
  assert.match(headshotUrl("Mario Mendoza '79"), /wikimedia/, "MLB-photo-less players fall back to Wikimedia");
  // Cards lead with full-bleed action shots where MLB has one, and the
  // headshot stays available as the in-browser fallback.
  assert.match(actionShotUrl("Aaron Judge"), /action\/hero/);
  assert.match(actionShotUrl("Babe Ruth '27"), /121578/, "even Ruth has an action shot on file");
  assert.equal(actionShotUrl("Mario Mendoza '79"), null, "Wikimedia-sourced players keep their single photo");
});

test("era cards read like the seasons die-hards remember", () => {
  const pool = buildRealPlayerPool();
  const ruth = findPlayer(pool, "Babe Ruth '27");
  const bonds = findPlayer(pool, "Barry Bonds '04");
  const gwynn = findPlayer(pool, "Tony Gwynn '94");
  const deer = findPlayer(pool, "Rob Deer '91");
  const rickey = findPlayer(pool, "Rickey Henderson '82");
  const mendoza = findPlayer(pool, "Mario Mendoza '79");
  const bigTrain = findPlayer(pool, "Walter Johnson '13");
  const gaedel = findPlayer(pool, "Eddie Gaedel '51");

  // 60 homers shows up as serious HR range; the .609 OBP season is a wall of walks.
  assert.ok(chartSlots(ruth, RESULTS.HR) >= 3, "Ruth's chart carries his 60");
  assert.ok(bonds.onBase >= 15, "2004 Bonds tops the on-base scale");
  assert.ok(chartSlots(bonds, RESULTS.BB) >= 10, "2004 Bonds walks and walks");
  // Contact vs three true outcomes.
  assert.ok(chartSlots(gwynn, RESULTS.SO) <= 1, "Gwynn does not strike out");
  assert.ok(chartSlots(deer, RESULTS.SO) >= 3 && chartSlots(deer, RESULTS.HR) >= 2, "Deer whiffs or homers");
  // Skill extremes carry through: speed, futility, workload, and one famous walk.
  assert.equal(rickey.speed, 20, "Rickey is the fastest card in the set");
  const sortedPoints = pool.map((player) => player.points).sort((a, b) => a - b);
  assert.ok(mendoza.points < sortedPoints[Math.floor(pool.length / 2)], "the Mendoza Line sits below the median");
  assert.equal(bigTrain.ip, 8, "deadball workhorses go deep");
  assert.equal(chartSlots(gaedel, RESULTS.BB), 19, "Gaedel's strike zone remains theoretical");
});

test("each stars draft deals a seeded slice with six-manager position depth", () => {
  const dealA = buildRealDraftPool("stars-night-a");
  const dealB = buildRealDraftPool("stars-night-b");

  // Same seed, same deck — required for online rooms to rebuild identically.
  assert.deepEqual(dealA, buildRealDraftPool("stars-night-a"));

  const idsA = new Set(dealA.map((player) => player.id));
  const idsB = new Set(dealB.map((player) => player.id));
  assert.notDeepEqual([...idsA].sort(), [...idsB].sort(), "two seeds deal different decks");

  const full = buildRealPlayerPool();
  for (const deal of [dealA, dealB]) {
    assert.equal(deal.length, 89, "a deal is 89 cards");
    assert.ok(deal.length < full.length, "a deal is a strict slice of the set");
    assert.ok(maxRealPoolManagers(deal) >= 6, "every deal supports six-manager rooms");
    for (const player of deal) {
      assert.ok(full.some((card) => card.id === player.id), `${player.name} comes from the full set`);
    }
  }
});

test("dealt stars pools draft to completion at the six-manager maximum", () => {
  for (const seed of ["stars-max-1", "stars-max-2"]) {
    const pool = buildRealDraftPool(seed);
    const managers = ["A", "B", "C", "D", "E", "F"];
    const draft = createDraft(managers, pool, 13);
    while (!draft.complete) autopick(draft);
    for (const manager of draft.managers) {
      assert.deepEqual(validateRoster(manager), [], `${manager.name} roster is legal with seed ${seed}`);
    }
  }
});
