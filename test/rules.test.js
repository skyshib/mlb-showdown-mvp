import test from "node:test";
import assert from "node:assert/strict";
import { compactChart, RESULTS, resolveChart } from "../src/rules/cards.js";
import { applyDraftAction, assignLineupSlots, autopick, availablePlayers, buildTeam, canPickPlayer, createDraft, currentManager, currentManagerMustReplace, draftHistory, getRosterNeeds, managerValuation, maxSeriesStarts, normalizeCardPosition, pauseSnake, pickPlayer, pickRandomStarter, repairDraftRosters, resumeSnake, snakeClockBankMs, snakeClockEnabled, snakeClockFlagged, snakeTimeRemainingMs, staffSlotLabels, startSnakeClock, sweepRosters, undoLastPick, validateRoster } from "../src/rules/draft.js";
import { createValuationModel, VALUATION_BASE_WEIGHTS, VALUATION_PERTURBATION } from "../src/rules/valuation.js";
import {
  applyDouble,
  applyFlyout,
  applyGroundout,
  applyHomer,
  applySingle,
  applyWalk,
  attemptSteal,
  autoRelieve,
  createInitialState,
  isGameOver,
  pitcherStatus,
  playGameEvent,
  playPlateAppearance,
  playStealAttempt,
  resolveAdvanceDecision,
  stealCandidates,
  simulateGame,
  STARTER_MIN_OUTS,
  SUB_MIN_INNING,
  availableBench,
  substitutionEligibility,
  pinchHit,
  pinchRun,
  defensiveSub,
  autoSubstituteFor
} from "../src/rules/game.js";
import { batterRunsPerPa, benchSlotFielding, pinchHitDecision, pinchRunDecision, defensiveSubDecision } from "../src/rules/substitutions.js";
import { createRng } from "../src/rules/rng.js";
import { simulateRoundRobin } from "../src/rules/tournament.js";

const hitter = {
  id: "h-test",
  kind: "hitter",
  name: "Test Hitter",
  position: "1B",
  onBase: 10,
  speed: 12,
  fielding: 2,
  chart: [
    { from: 1, to: 10, result: RESULTS.SINGLE },
    { from: 11, to: 20, result: RESULTS.HR }
  ]
};

const pitcher = {
  id: "p-test",
  kind: "pitcher",
  name: "Test Pitcher",
  role: "SP",
  control: 4,
  ip: 6,
  chart: [
    { from: 1, to: 12, result: RESULTS.SO },
    { from: 13, to: 20, result: RESULTS.BB }
  ]
};

const positions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

function makeHitter(overrides = {}) {
  return { ...hitter, ...overrides };
}

function makePitcher(overrides = {}) {
  return { ...pitcher, ...overrides };
}

function makeDraftPool(prefix = "pool", hitterCount = 24, pitcherCount = 8) {
  const hitters = Array.from({ length: hitterCount }, (_, index) => makeHitter({
    id: `${prefix}-h-${index}`,
    name: `${prefix} Hitter ${index}`,
    position: positions[index % positions.length],
    points: 250 - index
  }));
  const pitchers = Array.from({ length: pitcherCount }, (_, index) => makePitcher({
    id: `${prefix}-p-${index}`,
    name: `${prefix} Pitcher ${index}`,
    role: index % 2 === 0 ? "SP" : "RP",
    ip: index % 2 === 0 ? 6 : 1,
    points: 180 - index
  }));
  return [...hitters, ...pitchers];
}

function repeatingRng(...rolls) {
  let index = 0;
  return {
    d20() {
      const roll = rolls[index % rolls.length];
      index += 1;
      return roll;
    }
  };
}

// The lineups whole games are simulated with. They need one thing the bare
// `hitter` fixture does not have: a way to make an out. A nine-man order that
// cannot be retired is not a slow ball game, it is an unending one — the pitcher
// tires without bound, the batter's advantage becomes permanent, and the half
// inning has no exit. Games here used to escape it by accident, on runners
// thrown out taking bases they had no business taking.
// The out sits on 20 so every other roll lands where the bare fixture's chart
// put it, and the tests that spell out a die keep meaning what they meant.
const simHitter = {
  ...hitter,
  chart: [
    { from: 1, to: 10, result: RESULTS.SINGLE },
    { from: 11, to: 19, result: RESULTS.HR },
    { from: 20, to: 20, result: RESULTS.GB }
  ]
};

const teamA = {
  name: "A",
  lineup: Array.from({ length: 9 }, (_, index) => ({ ...simHitter, id: `a-h-${index}`, name: `A Hitter ${index}` })),
  pitchers: [{ ...pitcher, id: "a-p", name: "A Pitcher" }]
};

const teamB = {
  name: "B",
  lineup: Array.from({ length: 9 }, (_, index) => ({ ...simHitter, id: `b-h-${index}`, name: `B Hitter ${index}` })),
  pitchers: [{ ...pitcher, id: "b-p", name: "B Pitcher" }]
};

const strongDefense = {
  name: "Strong Defense",
  lineup: [
    makeHitter({ id: "sd-1b", name: "Strong 1B", position: "1B", fielding: 5 }),
    makeHitter({ id: "sd-2b", name: "Strong 2B", position: "2B", fielding: 5 }),
    makeHitter({ id: "sd-3b", name: "Strong 3B", position: "3B", fielding: 5 }),
    makeHitter({ id: "sd-ss", name: "Strong SS", position: "SS", fielding: 5 }),
    makeHitter({ id: "sd-c", name: "Strong C", position: "C", fielding: 0 }),
    makeHitter({ id: "sd-lf", name: "Strong LF", position: "LF", fielding: 0 }),
    makeHitter({ id: "sd-cf", name: "Strong CF", position: "CF", fielding: 0 }),
    makeHitter({ id: "sd-rf", name: "Strong RF", position: "RF", fielding: 0 }),
    makeHitter({ id: "sd-dh", name: "Strong DH", position: "1B", fielding: 0 })
  ],
  pitchers: [{ ...pitcher, id: "sd-p", name: "Strong Pitcher" }]
};

const weakDefense = {
  name: "Weak Defense",
  lineup: strongDefense.lineup.map((player) => ({ ...player, id: player.id.replace("sd", "wd"), name: player.name.replace("Strong", "Weak"), fielding: 0 })),
  pitchers: [{ ...pitcher, id: "wd-p", name: "Weak Pitcher" }]
};

const strongCatcherDefense = {
  name: "Strong Catcher Defense",
  lineup: weakDefense.lineup.map((player) => (
    player.position === "C"
      ? { ...player, id: "sc-c", name: "Strong Catcher", fielding: 5 }
      : { ...player, id: player.id.replace("wd", "sc") }
  )),
  pitchers: [{ ...pitcher, id: "sc-p", name: "Strong Catcher Pitcher" }]
};

test("resolveChart finds the matching d20 range", () => {
  assert.equal(resolveChart(hitter.chart, 1), RESULTS.SINGLE);
  assert.equal(resolveChart(hitter.chart, 20), RESULTS.HR);
});

test("resolveChart resolves open-ended top ranges after a JSON round-trip", () => {
  // Open-ended ranges hold `to: Infinity`; JSON.stringify turns that into null
  // when a save round-trips through localStorage. Both must still resolve.
  const chart = [
    { from: 1, to: 18, result: RESULTS.SINGLE },
    { from: 19, to: Infinity, result: RESULTS.HR }
  ];
  assert.equal(resolveChart(chart, 19), RESULTS.HR);
  const rehydrated = JSON.parse(JSON.stringify(chart));
  assert.equal(rehydrated[1].to, null);
  assert.equal(resolveChart(rehydrated, 19), RESULTS.HR);
  assert.equal(resolveChart(rehydrated, 20), RESULTS.HR);
});

test("compactChart uses single numbers for one-roll ranges", () => {
  assert.equal(
    compactChart([
      { from: 17, to: 17, result: RESULTS.BB },
      { from: 18, to: 20, result: RESULTS.HR }
    ]),
    "17: BB, 18-20: HR"
  );
});

test("walk advances only forced runners", () => {
  const state = createInitialState(teamA, teamB);
  state.bases = [{ name: "Runner 1" }, null, { name: "Runner 3" }];
  const runs = applyWalk(state, hitter, "away");
  assert.equal(runs, 0);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    ["Test Hitter", "Runner 1", "Runner 3"]
  );
});

test("single advances runners one base", () => {
  const state = createInitialState(teamA, teamB);
  state.bases = [{ name: "Runner 1" }, { name: "Runner 2" }, { name: "Runner 3" }];
  const runs = applySingle(state, hitter, "away");
  assert.equal(runs, 1);
  assert.equal(state.score.away, 1);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    ["Test Hitter", "Runner 1", "Runner 2"]
  );
});

test("1B+ auto-advances the batter to second when it's open", () => {
  const state = createInitialState(teamA, teamB);
  state.bases = [null, null, { name: "Runner 3" }];
  const runs = applySingle(state, hitter, "away", null, null, null, true);
  assert.equal(runs, 1);
  assert.equal(state.score.away, 1);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    [null, "Test Hitter", null]
  );
});

test("1B+ plays as a plain single when second base ends up occupied", () => {
  const state = createInitialState(teamA, teamB);
  state.bases = [{ name: "Runner 1" }, null, null];
  const runs = applySingle(state, hitter, "away", null, null, null, true);
  assert.equal(runs, 0);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    ["Test Hitter", "Runner 1", null]
  );
});

test("double scores runners from second and third", () => {
  const state = createInitialState(teamA, teamB);
  state.bases = [{ name: "Runner 1" }, { name: "Runner 2" }, { name: "Runner 3" }];
  const runs = applyDouble(state, hitter, "away");
  assert.equal(runs, 2);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    [null, "Test Hitter", "Runner 1"]
  );
});

test("single can send runner from first to third on an extra-base attempt", () => {
  const state = createInitialState(teamA, weakDefense);
  state.bases = [{ name: "Runner 1", speed: 20 }, null, null];

  const runs = applySingle(state, hitter, "away", "home", { d20: () => 20 });

  assert.equal(runs, 0);
  assert.equal(state.outs, 0);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    ["Test Hitter", null, "Runner 1"]
  );
  assert.equal(state.lastPlayDetails.thrownAttempt.to, "3B");
  assert.equal(state.lastPlayDetails.thrownAttempt.safe, true);
});

test("single uses two-out bonus for runner trying to score from second", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 2;
  state.bases = [null, { name: "Runner 2", speed: 4 }, null];

  const runs = applySingle(state, hitter, "away", "home", { d20: () => 14 });

  assert.equal(runs, 1);
  assert.equal(state.score.away, 1);
  assert.equal(state.outs, 2);
  assert.equal(state.lastPlayDetails.thrownAttempt.to, "home");
  assert.equal(state.lastPlayDetails.thrownAttempt.target, 14);
  assert.equal(state.lastPlayDetails.thrownAttempt.safe, true);
});

test("double can send runner from first home on an extra-base attempt", () => {
  const state = createInitialState(teamA, weakDefense);
  // 90%, and it takes that much: nobody out with a man behind him, an out at
  // the plate costs a rally the win column values at 88 cents on the dollar.
  state.bases = [{ name: "Runner 1", speed: 13 }, null, null];

  const runs = applyDouble(state, hitter, "away", "home", { d20: () => 17 });

  assert.equal(runs, 1);
  assert.equal(state.score.away, 1);
  assert.equal(state.outs, 0);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    [null, "Test Hitter", null]
  );
  assert.equal(state.lastPlayDetails.thrownAttempt.to, "home");
});

test("failed extra-base attempt after a hit records an out for the pitcher", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 2;
  state.bases = [{ name: "Runner 1", speed: 13 }, null, null];

  const event = playPlateAppearance(state, repeatingRng(1, 1, 20));

  assert.equal(event.result, RESULTS.SINGLE);
  assert.equal(event.outsAfter, 3);
  assert.equal(event.playDetails.thrownAttempt.safe, false);
  assert.equal(state.stats.pitchers.get("home:wd-p").outs, 1);
});

test("1B+ from the chart resolves through the engine as an auto-advance single", () => {
  const state = createInitialState(teamA, weakDefense);
  const batter = makeHitter({ id: "plus-h", name: "Plus Hitter", chart: [{ from: 1, to: 20, result: RESULTS.SINGLE_PLUS }] });
  state.away.lineup[0] = batter;

  const event = playPlateAppearance(state, repeatingRng(1, 5));

  assert.equal(event.result, RESULTS.SINGLE_PLUS);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    [null, "Plus Hitter", null]
  );
  assert.equal(state.stats.hitters.get("away:plus-h").h, 1);
});

test("runner can steal second before the plate appearance", () => {
  const state = createInitialState(teamA, weakDefense);
  state.bases = [{ id: "a-h-0", name: "A Hitter 0", speed: 20 }, null, null];

  const event = playStealAttempt(state, { d20: () => 20 });

  assert.equal(event.type, "steal");
  assert.equal(event.result, "SB");
  assert.equal(event.outsAfter, 0);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    [null, "A Hitter 0", null]
  );
  assert.equal(state.lineupIndex.away, 0);
  assert.equal(event.playDetails.stealAttempt.to, "2B");
  assert.equal(event.playDetails.stealAttempt.runnerSpeed, 20);
  assert.equal(event.playDetails.stealAttempt.targetBonus, 0);
  assert.equal(event.playDetails.stealAttempt.destination, "second");
  // First inning, nobody out, tied: the win column asks for 72% here, which is
  // what a century of baseball asks of a stolen base.
  assert.ok(
    Math.abs(event.playDetails.stealAttempt.decisionMinimum - 0.72) < 0.005,
    `bar was ${event.playDetails.stealAttempt.decisionMinimum}`
  );
  assert.equal(state.stats.hitters.get("away:a-h-0").sb, 1);
});

test("a runner who cannot be thrown out steals without a die being rolled", () => {
  const state = createInitialState(teamA, weakDefense);
  // Top speed against a 0-fielding catcher: even a 20 beats the throw, so it is
  // settled before the throw.
  state.bases = [{ id: "a-h-0", name: "A Hitter 0", speed: 20 }, null, null];

  let rolled = false;
  const event = playStealAttempt(state, { d20: () => { rolled = true; return 20; } });

  assert.equal(rolled, false, "the die is never rolled");
  assert.equal(event.result, "SB");
  assert.equal(event.playDetails.stealAttempt.roll, null, "and no roll is recorded");
  assert.equal(event.playDetails.stealAttempt.total, null);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    [null, "A Hitter 0", null]
  );
});

test("stealing third fights the shorter throw: +5 to the catcher, not the runner", () => {
  const state = createInitialState(teamA, strongCatcherDefense);
  state.outs = 1;
  state.bases = [null, { name: "Runner 2", speed: 15 }, null];

  // The penalized odds fall below what the base is worth, so the auto-runner
  // now declines this jump...
  assert.equal(playStealAttempt(state, { d20: () => 16 }), null);

  // ...but a forced attempt shows the penalized target and pays for it.
  const event = attemptSteal(state, 1, { d20: () => 16 });

  assert.equal(event.result, "CS");
  assert.equal(event.outsAfter, 2);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(event.playDetails.stealAttempt.fielding, 5);
  assert.equal(event.playDetails.stealAttempt.runnerSpeed, 15);
  assert.equal(event.playDetails.stealAttempt.targetBonus, -5);
  assert.equal(event.playDetails.stealAttempt.target, 10);
  assert.equal(event.playDetails.stealAttempt.destination, "third");
  // Third with one out is the one window where the jump pays: 67%, the lowest
  // bar any steal gets, and these odds are nowhere near it.
  assert.ok(
    Math.abs(event.playDetails.stealAttempt.decisionMinimum - 0.67) < 0.005,
    `bar was ${event.playDetails.stealAttempt.decisionMinimum}`
  );
  assert.equal(event.playDetails.stealAttempt.safeChance, 0.25);
  assert.equal(event.playDetails.stealAttempt.total, 21);
  assert.equal(state.stats.pitchers.get("home:sc-p").outs, 1);
});

test("low-probability steal attempts are skipped by the decision matrix", () => {
  const state = createInitialState(teamA, weakDefense);
  state.bases = [{ name: "Runner 1", speed: 8 }, null, null];

  const event = playStealAttempt(state, { d20: () => 1 });

  assert.equal(event, null);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    ["Runner 1", null, null]
  );
});

test("caught stealing for the third out advances the half inning without a plate appearance", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 2;
  // 75%, which clears the 71% second base is worth here — the bar the runner
  // has to beat, not a fixed rate.
  state.bases = [{ name: "Runner 1", speed: 15 }, null, null];

  const event = playGameEvent(state, { d20: () => 20 });

  assert.equal(event.type, "steal");
  assert.equal(event.result, "CS");
  assert.equal(event.outsAfter, 3);
  assert.equal(state.half, "bottom");
  assert.equal(state.outs, 0);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(state.lineupIndex.away, 0);
  assert.equal(state.away.plateAppearances, 0);
  assert.equal(state.stats.pitchers.get("home:wd-p").outs, 1);
});

test("home run clears the bases and scores batter", () => {
  const state = createInitialState(teamA, teamB);
  state.bases = [{ name: "Runner 1" }, { name: "Runner 2" }, null];
  const runs = applyHomer(state, hitter, "away");
  assert.equal(runs, 3);
  assert.equal(state.score.away, 3);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(state.stats.hitters.get("away:h-test").r, 1);
});

test("groundout with runner on first can become a double play", () => {
  const state = createInitialState(teamA, strongDefense);
  state.bases = [{ name: "Runner 1" }, null, { name: "Runner 3" }];

  const runs = applyGroundout(state, hitter, "away", "home", { d20: () => 1 });

  assert.equal(runs, 1);
  assert.equal(state.score.away, 1);
  assert.equal(state.outs, 2);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(state.lastPlayDetails.doublePlayAttempt.batterOut, true);
});

test("a batter dead to rights is out without a throw being rolled", () => {
  const state = createInitialState(teamA, strongDefense);
  state.bases = [{ name: "Runner 1" }, null, { name: "Runner 3" }];

  // strongDefense turns 20 of infield fielding on a target of 12, so even a roll
  // of 1 is an out. There is nothing for the throw to decide.
  let rolled = false;
  const rng = { d20: () => { rolled = true; return 1; } };
  applyGroundout(state, hitter, "away", "home", rng);

  assert.equal(rolled, false, "the die is never rolled");
  assert.equal(state.lastPlayDetails.doublePlayAttempt.roll, null, "and no roll is recorded");
  assert.equal(state.lastPlayDetails.doublePlayAttempt.batterOut, true);
  assert.equal(state.outs, 2);
});

test("failed double play attempt leaves batter at first and advances other runners", () => {
  const state = createInitialState(teamA, weakDefense);
  state.bases = [{ name: "Runner 1" }, { name: "Runner 2" }, { name: "Runner 3" }];

  const runs = applyGroundout(state, hitter, "away", "home", { d20: () => 1 });

  assert.equal(runs, 1);
  assert.equal(state.outs, 1);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    ["Test Hitter", null, "Runner 2"]
  );
  assert.equal(state.lastPlayDetails.doublePlayAttempt.batterOut, false);
});

test("runner from third does not score when groundout double play creates third out", () => {
  const state = createInitialState(teamA, strongDefense);
  state.outs = 1;
  state.bases = [{ name: "Runner 1" }, null, { name: "Runner 3" }];

  const runs = applyGroundout(state, hitter, "away", "home", { d20: () => 1 });

  assert.equal(runs, 0);
  assert.equal(state.score.away, 0);
  assert.equal(state.outs, 3);
  assert.deepEqual(state.bases, [null, null, null]);
});

test("flyout can score a runner from third on a successful tag-up", () => {
  const state = createInitialState(teamA, weakDefense);
  state.bases = [null, null, { name: "Runner 3", speed: 12 }];

  const runs = applyFlyout(state, makeHitter({ id: "fly-b", name: "Fly Batter" }), "away", "home", { d20: () => 17 });

  assert.equal(runs, 1);
  assert.equal(state.score.away, 1);
  assert.equal(state.outs, 1);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(state.lastPlayDetails.thrownAttempt.safe, true);
  assert.equal(state.lastPlayDetails.thrownAttempt.to, "home");
});

test("flyout tag-up uses the outs after the catch for the decision matrix", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 1;
  state.bases = [null, null, { name: "Runner 3", speed: 6 }];

  const runs = applyFlyout(state, makeHitter({ id: "fly-b", name: "Fly Batter" }), "away", "home", { d20: () => 11 });

  assert.equal(runs, 1);
  assert.equal(state.outs, 2);
  assert.equal(state.lastPlayDetails.thrownAttempt.outsForDecision, 2);
  assert.equal(state.lastPlayDetails.thrownAttempt.safeChance, 0.55);
});

test("flyout does not allow tag-up when the catch is the third out", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 2;
  state.bases = [null, null, { name: "Runner 3", speed: 20 }];

  const runs = applyFlyout(state, makeHitter({ id: "fly-b", name: "Fly Batter" }), "away", "home", { d20: () => 1 });

  assert.equal(runs, 0);
  assert.equal(state.outs, 3);
  assert.deepEqual(
    state.bases.map((runner) => runner?.name ?? null),
    [null, null, "Runner 3"]
  );
  assert.deepEqual(state.lastPlayDetails.tagUpAttempts, []);
});

test("failed flyout tag-up records the extra out and clears the runner", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 1;
  state.bases = [null, null, { name: "Runner 3", speed: 12 }];

  const runs = applyFlyout(state, makeHitter({ id: "fly-b", name: "Fly Batter" }), "away", "home", { d20: () => 20 });

  assert.equal(runs, 0);
  assert.equal(state.outs, 3);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(state.lastPlayDetails.thrownAttempt.safe, false);
  assert.equal(state.lastPlayDetails.thrownAttempt.total, 20);
});

test("runner tagging home scores when defense throws out another tag-up for the third out", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 1;
  // SPD 19 clears what third is worth behind a runner who has already scored
  // (90% with two down — the run is in, and the third out is the whole rest of
  // the inning) yet stays the shakiest runner, so the forced-20 throw cuts him
  // down while home scores.
  state.bases = [null, { name: "Runner 2", speed: 19 }, { name: "Runner 3", speed: 20 }];

  const runs = applyFlyout(state, makeHitter({ id: "fly-b", name: "Fly Batter" }), "away", "home", { d20: () => 20 });

  assert.equal(runs, 1);
  assert.equal(state.score.away, 1);
  assert.equal(state.outs, 3);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(state.lastPlayDetails.thrownAttempt.runner, "Runner 2");
  assert.equal(state.lastPlayDetails.thrownAttempt.safe, false);
});

test("a base nobody can defend draws no throw, and no die", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 1;
  // SPD 20 tagging home in front of a butcher's outfield: target 25, gloves 0,
  // and the throw would need a 21. The ball stays in the glove.
  state.bases = [null, null, { name: "Runner 3", speed: 20 }];
  const rng = { d20: () => assert.fail("the defense threw a die it had no throw to make") };

  const runs = applyFlyout(state, makeHitter({ id: "fly-b", name: "Fly Batter" }), "away", "home", rng);

  assert.equal(runs, 1);
  assert.equal(state.outs, 2);
  const attempt = state.lastPlayDetails.thrownAttempt;
  assert.equal(attempt.safe, true);
  assert.equal(attempt.thrown, false, "nobody threw");
  assert.equal(attempt.roll, null, "so there is no roll to report");
  assert.equal(attempt.total, null);
});

test("a runner dead to rights is thrown out on no die either", async () => {
  const { resolveAdvanceDecision, certainOut } = await import("../src/rules/game.js");
  const { describeEvent } = await import("../src/ui/playByPlay.js");
  const state = createInitialState(teamA, weakDefense);

  // The player sends a plodder into gloves that beat even his best roll: 2nd to
  // 3rd, target 3, fielding 5. He is out on every face, so the throw is a
  // formality — a die tumbling toward a foregone answer.
  const runner = { id: "plodder", name: "Plodder", speed: 3 };
  state.bases = [null, runner, null];
  const candidate = { runner, fromIndex: 1, toIndex: 2, outsForDecision: 0, fielding: 5, target: 3, safeChance: 0, destination: "third" };
  assert.equal(certainOut(candidate), true);
  state.pendingAdvance = { kind: "hit", battingSide: "away", pitchingSide: "home", outsBefore: 0, candidates: [candidate], batter: null, autoSend: 0 };
  const rng = { d20: () => assert.fail("a settled throw rolled a die") };

  const event = resolveAdvanceDecision(state, 1, rng);

  assert.equal(event.result, "ADV-OUT");
  assert.equal(state.outs, 1, "he is out all the same");
  const attempt = event.playDetails.thrownAttempt;
  assert.equal(attempt.safe, false);
  assert.equal(attempt.thrown, false, "but no throw was staged");
  assert.equal(attempt.roll, null, "and there is no roll to report");

  const called = describeEvent(event, "away").join(" ");
  assert.match(called, /PLODDER is cut down at 3B!/);
  assert.doesNotMatch(called, /rolled/, "no die, no roll in the booth");
  assert.doesNotMatch(called, /No throw/, "a throw WAS made — it just needed no die");
});

test("starter covers innings not covered by bullpen and gets tired past his IP", () => {
  const tiredStaff = {
    name: "Tired Staff",
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "starter", name: "Starter", control: 9, ip: 5, chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
      makePitcher({ id: "low-rp", name: "Low RP", control: 2, ip: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
      makePitcher({ id: "mid-rp", name: "Mid RP", control: 5, ip: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
      makePitcher({ id: "high-rp", name: "High RP", control: 8, ip: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] })
    ]
  };
  const state = createInitialState(teamA, tiredStaff);
  state.pitching.home.outsRecorded = 15;
  // IP 5 covers 20 batters at full strength; the 21st sees the penalty.
  state.pitching.home.battersFaced = 20;

  const event = playPlateAppearance(state, repeatingRng(20, 1));

  assert.equal(event.pitcher, "Starter");
  assert.equal(event.fatiguePenalty, 1);
  assert.equal(event.effectiveControl, 8);
  assert.equal(event.controlTotal, 28);
});

test("the pen sends its BEST arm, not the next man along the bench", () => {
  const orderedStaff = {
    name: "Ordered Staff",
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "starter", name: "Starter", control: 9, ip: 5 }),
      makePitcher({ id: "high-rp", name: "High RP", control: 8, ip: 1 }),
      makePitcher({ id: "low-rp", name: "Low RP", control: 2, ip: 1 }),
      makePitcher({ id: "mid-rp", name: "Mid RP", control: 5, ip: 1 })
    ]
  };
  const state = createInitialState(teamA, orderedStaff);
  // The IP 5 starter's tank is 20 batters; at 32 faced he is four points into
  // fatigue, so a control 9 is really a control 5 — well behind the control 8
  // sitting in the pen. A man that deep is deep in the GAME too, the eighth, and
  // the innings left are what tell the skipper he can afford the arm.
  state.pitching.home.battersFaced = 32;
  state.pitching.home.outsRecorded = 21;
  state.inning = 8;

  const event = playPlateAppearance(state, repeatingRng(20, 1));

  // The old skipper took the next man in a list sorted worst-first, and handed a
  // tight game to a control-2 mop-up arm. The hook picks the MAN now, not the
  // next seat on the bench.
  assert.equal(event.pitcher, "High RP");
  assert.equal(event.fatiguePenalty, 0);
});

test("the hook gets quicker as the outs run out — the same gap rides in the first and pulls in the eighth", () => {
  // The bug this pins: a starting pitcher pulled after 0.1 innings. The gap the
  // hook measures does not depend on the inning — fatigue is its only moving
  // part, and fatigue only pushes it up — so against a flat bar a pull that is
  // ever going to happen happens on the FIRST BATTER, for a gap that has nothing
  // to do with anything the man has done. A bad starter with a good pen behind
  // him could not throw a pitch.
  //
  // A control 3 starter with a control 6 arm in the pen: a real upgrade, and one
  // that is just as true before the first pitch as it is in the eighth. What has
  // to change between those two moments is not the gap. It is what his remaining
  // outs are WORTH — everything early, when a two-inning pen cannot cover a game
  // without him, and nothing at all once there is no game left to cover.
  const staff = {
    name: "Bad Starter, Good Pen",
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "sp", name: "Weak Starter", control: 3, ip: 5 }),
      makePitcher({ id: "rp1", name: "Ace Reliever", control: 6, ip: 1 }),
      makePitcher({ id: "rp2", name: "Other Reliever", control: 5, ip: 1 })
    ]
  };
  const moundIn = (inning) => {
    const state = createInitialState(teamA, staff);
    state.inning = inning;
    // Outs in the book that match the inning, so the four-inning floor is spent
    // by the time the sliding hook is the thing being asked about.
    state.pitching.home.outsRecorded = (inning - 1) * 3;
    return pitcherStatus(state, "home").pitcher.name;
  };

  // Fresh, first batter of the game, nothing has happened yet.
  assert.equal(moundIn(1), "Weak Starter", "he is not pulled before he has thrown a pitch");
  assert.equal(moundIn(2), "Weak Starter", "nor in the second");
  // Same staff, same gap, same fatigue — but now his floor is up and his outs are
  // worth nothing.
  assert.equal(moundIn(8), "Ace Reliever", "and in the eighth the pen is worth going to get");
});

test("a starter is pulled on his own IP, not on a fixed seven innings", () => {
  // The bug this replaced: the starter was scripted to cover whatever outs the
  // bullpen's printed IP did not, so with two one-inning arms behind him EVERY
  // starter threw exactly 7.0 innings — an IP 6 card pushed a full inning past
  // his tank every game, an IP 8 card taken out with gas still in it.
  const staffOf = (ip) => ({
    name: `IP ${ip}`,
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "sp", name: "Starter", control: 5, ip }),
      makePitcher({ id: "rp1", name: "RP One", control: 5, ip: 1 }),
      makePitcher({ id: "rp2", name: "RP Two", control: 5, ip: 1 })
    ]
  });
  // Ask the mound directly at each point, on a fresh state — playing the PAs
  // out would flip the half-inning and hand back the other team's pitcher.
  const facedWhenPulled = (ip) => {
    for (let faced = 0; faced <= 60; faced += 1) {
      const state = createInitialState(teamA, staffOf(ip));
      state.pitching.home.battersFaced = faced;
      // Outs track batters faced closely enough here; the point is that by the
      // time fatigue makes the pen better (deep past his tank), his four-inning
      // floor is long gone and cannot be what pulls him.
      state.pitching.home.outsRecorded = faced;
      if (pitcherStatus(state, "home").pitcher.name !== "Starter") return faced;
    }
    return null;
  };

  const short = facedWhenPulled(5);
  const long = facedWhenPulled(8);
  assert.ok(short !== null && long !== null, "both starters come out eventually");
  assert.ok(long > short, `the IP 8 arm goes deeper (${long} BF) than the IP 5 arm (${short} BF)`);
  // The hook is a comparison now, not a fixed number of batters past the tank —
  // so what is pinned here is the thing the card actually promises: a man is not
  // pulled while he is still FRESH, and the bigger tank buys more of the game.
  // (These arms and the pen are the same control 5, so the only thing that can
  // make the pen better than him is his own fatigue.)
  assert.ok(short >= 5 * 4, `the IP 5 arm empties his tank first (pulled at ${short} BF, tank is ${5 * 4})`);
  assert.ok(long >= 8 * 4, `the IP 8 arm empties his tank first (pulled at ${long} BF, tank is ${8 * 4})`);
});

test("last bullpen pitcher keeps pitching in extras and becomes tired", () => {
  const orderedStaff = {
    name: "Ordered Staff",
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "starter", name: "Starter", control: 9, ip: 6 }),
      makePitcher({ id: "low-rp", name: "Low RP", control: 2, ip: 1 }),
      makePitcher({ id: "high-rp", name: "High RP", control: 8, ip: 1 })
    ]
  };
  const state = createInitialState(teamA, orderedStaff);
  state.pitching.home.pitcherIndex = 2;
  state.pitching.home.outsRecorded = 3;
  // IP 1 covers four batters; the fifth finds him gassed.
  state.pitching.home.battersFaced = 4;

  const event = playPlateAppearance(state, repeatingRng(20, 1));

  assert.equal(event.pitcher, "High RP");
  assert.equal(event.fatiguePenalty, 1);
  assert.equal(event.effectiveControl, 7);
});

test("runs are charged to the pitcher responsible for inherited runners", () => {
  const staff = {
    name: "Inherited Runner Staff",
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "starter", name: "Starter", control: 7, ip: 5 }),
      makePitcher({ id: "reliever", name: "Reliever", control: 5, ip: 1 })
    ]
  };
  const state = createInitialState(teamA, staff);
  state.pitching.home.pitcherIndex = 1;
  state.bases = [null, {
    name: "Inherited Runner",
    speed: 12,
    responsiblePitcherId: "starter",
    responsiblePitcherFresh: true
  }, null];

  const runs = applyDouble(state, hitter, "away", "home", null, state.home.pitchers[1]);

  assert.equal(runs, 1);
  assert.equal(state.stats.pitchers.get("home:starter").r, 1);
  assert.equal(state.stats.pitchers.get("home:starter").fresh.r, 1);
  assert.equal(state.stats.pitchers.get("home:reliever")?.r ?? 0, 0);
  assert.equal(state.stats.pitchers.get("home:reliever")?.fresh.r ?? 0, 0);
});

test("fatigue runs on batters faced alone and never forces the bullpen door", () => {
  const staff = {
    name: "Workload Staff",
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "starter", name: "Starter", control: 9, ip: 5, chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
      makePitcher({ id: "low-rp", name: "Low RP", control: 2, ip: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
      makePitcher({ id: "mid-rp", name: "Mid RP", control: 5, ip: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
      makePitcher({ id: "high-rp", name: "High RP", control: 8, ip: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] })
    ]
  };
  const state = createInitialState(teamA, staff);
  state.pitching.home.outsRecorded = 12;
  // 16 batters into an IP 5 tank (20 BF): still fresh, whatever the score.
  state.pitching.home.battersFaced = 16;

  const fresh = playPlateAppearance(state, repeatingRng(20, 1));
  assert.equal(fresh.pitcher, "Starter");
  assert.equal(fresh.fatiguePenalty, 0);
  assert.equal(fresh.effectiveControl, 9);

  // The 21st batter starts the slide — one point per four batters after.
  state.pitching.home.battersFaced = 20;
  const tired = playPlateAppearance(state, repeatingRng(20, 1));
  assert.equal(tired.fatiguePenalty, 1);
  assert.equal(tired.effectiveControl, 8);
  assert.equal(state.pitching.home.pitcherIndex, 0, "fatigue never forces the bullpen door");
  const line = state.stats.pitchers.get("home:starter");
  assert.equal(line.bf, 2);
  assert.equal(line.fresh.bf, 1);
  assert.equal(line.fresh.outs, 1);
});

test("simulation is deterministic for a seed", () => {
  const first = simulateGame(teamA, teamB, "same-seed");
  const second = simulateGame(teamA, teamB, "same-seed");
  assert.deepEqual(first.events, second.events);
  assert.equal(first.away.runs, second.away.runs);
  assert.equal(first.home.runs, second.home.runs);
});

test("simulation returns box score lines", () => {
  const result = simulateGame(teamA, teamB, "box-score-seed");
  assert.equal(result.boxScore.away.hitters.length, 9);
  assert.equal(result.boxScore.home.pitchers.length, 1);
  assert.ok(result.boxScore.away.hitters.some((line) => line.pa > 0));
});

test("a card on both teams keeps separate home and away box score lines", () => {
  const mirrorHome = {
    name: "Mirror",
    lineup: teamA.lineup.map((player) => ({ ...player })),
    pitchers: [{ ...pitcher, id: "mirror-p", name: "Mirror Pitcher" }]
  };
  const result = simulateGame(teamA, mirrorHome, "mirror-seed");

  assert.equal(result.boxScore.away.hitters.length, 9);
  assert.equal(result.boxScore.home.hitters.length, 9);
  for (const awayLine of result.boxScore.away.hitters) {
    const homeLine = result.boxScore.home.hitters.find((line) => line.id === awayLine.id);
    assert.ok(homeLine, `${awayLine.id} has a home line too`);
    assert.notEqual(awayLine, homeLine, "the sides do not share a stat line");
    assert.equal(awayLine.side, "away");
    assert.equal(homeLine.side, "home");
  }
  const awayPa = result.boxScore.away.hitters.reduce((sum, line) => sum + line.pa, 0);
  const homePa = result.boxScore.home.hitters.reduce((sum, line) => sum + line.pa, 0);
  assert.ok(awayPa >= 27 && homePa >= 24, "each side records only its own plate appearances");
});

test("draft blocks picks that would make pitcher minimum impossible", () => {
  const hitters = Array.from({ length: 10 }, (_, index) => makeHitter({
    id: `draft-h-${index}`,
    name: `Draft Hitter ${index}`,
    position: positions[index % positions.length]
  }));
  const pitchers = [
    makePitcher({ id: "draft-sp-1", name: "Draft Starter 1", role: "SP" }),
    makePitcher({ id: "draft-sp-2", name: "Draft Starter 2", role: "SP" }),
    makePitcher({ id: "draft-rp-1", name: "Draft Bullpen 1", role: "RP", ip: 1 }),
    makePitcher({ id: "draft-rp-2", name: "Draft Bullpen 2", role: "RP", ip: 1 })
  ];
  const draft = createDraft(["Solo"], [...hitters, ...pitchers], 13);

  for (let i = 0; i < 9; i += 1) {
    pickPlayer(draft, hitters[i].id);
  }

  const manager = currentManager(draft);
  const legality = canPickPlayer(draft, manager, hitters[9]);
  assert.equal(legality.ok, false);
  assert.match(legality.reason, /lineup/);
});

test("draft allows one duplicate hitter as DH and blocks another duplicate", () => {
  const firstBase = makeHitter({ id: "dh-1b-a", name: "First Base A", position: "1B" });
  const dhFirstBase = makeHitter({ id: "dh-1b-b", name: "First Base B", position: "1B" });
  const extraFirstBase = makeHitter({ id: "dh-1b-c", name: "First Base C", position: "1B" });
  const catcher = makeHitter({ id: "dh-c-a", name: "Catcher A", position: "C" });
  const dhCatcher = makeHitter({ id: "dh-c-b", name: "Catcher B", position: "C" });
  const pitchers = [
    makePitcher({ id: "dh-sp-1", name: "DH Starter 1", role: "SP" }),
    makePitcher({ id: "dh-sp-2", name: "DH Starter 2", role: "SP" }),
    makePitcher({ id: "dh-rp-1", name: "DH Bullpen 1", role: "RP", ip: 1 }),
    makePitcher({ id: "dh-rp-2", name: "DH Bullpen 2", role: "RP", ip: 1 })
  ];
  const draft = createDraft(["Solo"], [firstBase, dhFirstBase, extraFirstBase, catcher, dhCatcher, ...pitchers], 13);

  pickPlayer(draft, firstBase.id);
  pickPlayer(draft, dhFirstBase.id);
  pickPlayer(draft, catcher.id);

  assert.equal(canPickPlayer(draft, currentManager(draft), extraFirstBase).ok, false);
  const secondDuplicate = canPickPlayer(draft, currentManager(draft), dhCatcher);
  assert.equal(secondDuplicate.ok, false);
  assert.match(secondDuplicate.reason, /lineup/);
});

test("undoLastPick reverses the most recent snake-draft pick", () => {
  const draft = createDraft(["One", "Two"], makeDraftPool("undo"), 13);
  pickPlayer(draft, "undo-h-0");
  pickPlayer(draft, "undo-h-1");
  pickPlayer(draft, "undo-h-2");

  const undone = undoLastPick(draft);

  assert.equal(undone.player.id, "undo-h-2");
  assert.equal(undone.manager.name, "Two");
  assert.equal(draft.pickNumber, 2);
  assert.equal(draft.pickedIds.has("undo-h-2"), false);
  assert.deepEqual(draft.managers[1].roster.map((player) => player.id), ["undo-h-1"]);
  assert.equal(currentManager(draft).name, "Two");
});

test("undoLastPick reopens a completed draft and clears undone lineup assignments", () => {
  const draft = createDraft(["One", "Two"], makeDraftPool("complete-undo"), 13);
  while (!draft.complete) autopick(draft);
  const manager = draft.managers[1];
  const lastPlayer = manager.roster[manager.roster.length - 1];
  manager.lineupAssignments = { DH: lastPlayer.id };

  const undone = undoLastPick(draft);

  assert.equal(draft.complete, false);
  assert.equal(draft.pickNumber, 25);
  assert.equal(undone.player.id, lastPlayer.id);
  assert.equal(draft.pickedIds.has(lastPlayer.id), false);
  assert.deepEqual(manager.lineupAssignments, {});
});

test("a completed draft hands every CPU manager an optimized lineup, staff, and order", () => {
  const draft = createDraft(
    [{ name: "Robo", cpu: true }, { name: "Human", cpu: false }],
    makeDraftPool("cpu-sync"),
    13
  );
  while (!draft.complete) autopick(draft);

  const robo = draft.managers[0];
  const human = draft.managers[1];

  // The CPU's materialized choices reproduce exactly the team the optimizer
  // would build from a blank slate — nothing better is left on his bench.
  const played = buildTeam(robo);
  const optimal = buildTeam(
    { ...robo, lineupAssignments: {}, staffAssignments: {}, battingOrder: [] },
    { optimize: true }
  );
  assert.deepEqual(played.lineup.map((player) => player.id), optimal.lineup.map((player) => player.id));
  assert.deepEqual(played.starters.map((player) => player.id), optimal.starters.map((player) => player.id));
  assert.deepEqual(played.bullpen.map((player) => player.id), optimal.bullpen.map((player) => player.id));

  // The human's seat is his own business: completion writes him nothing.
  assert.ok(!human.lineupAssignments || Object.keys(human.lineupAssignments).length === 0);
  assert.ok(!human.staffAssignments || Object.keys(human.staffAssignments).length === 0);
  assert.ok(!human.battingOrder || human.battingOrder.length === 0);
});

test("corner outfielders can fill left or right field", () => {
  const manager = {
    name: "Corner Flex",
    roster: [
      makeHitter({ id: "flex-c", position: "C" }),
      makeHitter({ id: "flex-1b", position: "1B" }),
      makeHitter({ id: "flex-2b", position: "2B" }),
      makeHitter({ id: "flex-3b", position: "3B" }),
      makeHitter({ id: "flex-ss", position: "SS" }),
      makeHitter({ id: "flex-cf", position: "CF" }),
      makeHitter({ id: "flex-lf-a", name: "Left One", position: "LF" }),
      makeHitter({ id: "flex-lf-b", name: "Left Two", position: "LF" }),
      makeHitter({ id: "flex-dh", position: "C" }),
      makePitcher({ id: "flex-sp-1", role: "SP" }),
      makePitcher({ id: "flex-sp-2", role: "SP" }),
      makePitcher({ id: "flex-rp-1", role: "RP", ip: 1 }),
      makePitcher({ id: "flex-rp-2", role: "RP", ip: 1 })
    ]
  };

  assert.deepEqual(validateRoster(manager), []);

  const slots = assignLineupSlots(manager.roster).slots;
  assert.equal(slots.find((slot) => slot.label === "RF").player.name, "Left Two");
});

test("a 3B/1B card covers third before first, leaving second base to the 2B card", () => {
  // The bug: matching first base alongside the required slots let the 3B/1B
  // card take first, which pushed the 3B/2B card to third and reported the
  // roster "missing 2B" even though it fields a legal nine.
  const manager = {
    name: "Corner Infield",
    roster: [
      makeHitter({ id: "ci-c", position: "C" }),
      makeHitter({
        id: "ci-3b-2b",
        name: "Utility Infielder",
        position: "3B",
        positions: [{ pos: "3B", fielding: 1 }, { pos: "2B", fielding: 0 }]
      }),
      makeHitter({
        id: "ci-3b-1b",
        name: "Corner Infielder",
        position: "3B",
        positions: [{ pos: "3B", fielding: 2 }, { pos: "1B", fielding: 0 }]
      }),
      makeHitter({ id: "ci-ss", position: "SS" }),
      makeHitter({ id: "ci-cf", position: "CF" }),
      makeHitter({ id: "ci-lf", position: "LF" }),
      makeHitter({ id: "ci-rf", position: "RF" }),
      makeHitter({ id: "ci-of-a", name: "Fourth Outfielder", position: "LF" }),
      makeHitter({ id: "ci-of-b", name: "Fifth Outfielder", position: "RF" }),
      makePitcher({ id: "ci-sp-1", role: "SP" }),
      makePitcher({ id: "ci-sp-2", role: "SP" }),
      makePitcher({ id: "ci-rp-1", role: "RP", ip: 1 }),
      makePitcher({ id: "ci-rp-2", role: "RP", ip: 1 })
    ]
  };

  assert.deepEqual(validateRoster(manager), []);

  const seated = assignLineupSlots(manager.roster).slots;
  const at = (label) => seated.find((slot) => slot.label === label).player?.name;
  assert.equal(at("2B"), "Utility Infielder");
  assert.equal(at("3B"), "Corner Infielder");
  // First base still fills — with a spare outfielder, out of position.
  assert.ok(at("1B"));
});

test("a card that only plays first base still gets first base", () => {
  const roster = [
    makeHitter({ id: "fb-c", position: "C" }),
    makeHitter({ id: "fb-1b", name: "True First Baseman", position: "1B" }),
    makeHitter({ id: "fb-2b", position: "2B" }),
    makeHitter({ id: "fb-3b", position: "3B" }),
    makeHitter({ id: "fb-ss", position: "SS" }),
    makeHitter({ id: "fb-cf", position: "CF" }),
    makeHitter({ id: "fb-lf", position: "LF" }),
    makeHitter({ id: "fb-rf", position: "RF" }),
    makeHitter({ id: "fb-dh", position: "C" })
  ];

  const seated = assignLineupSlots(roster).slots;
  const firstBase = seated.find((slot) => slot.label === "1B");
  assert.equal(firstBase.player.name, "True First Baseman");
  assert.equal(firstBase.outOfPosition, false);
});

test("createDraft lumps bare LF and RF card labels into the LF/RF pool", () => {
  const draft = createDraft(["Solo"], [
    makeHitter({ id: "lump-lf", position: "LF" }),
    makeHitter({ id: "lump-rf", position: "RF" }),
    makeHitter({ id: "lump-combined", position: "LF/RF" }),
    makeHitter({ id: "lump-cf", position: "CF" }),
    makePitcher({ id: "lump-sp", role: "SP" })
  ], 13);

  const positions = Object.fromEntries(draft.pool.map((player) => [player.id, player.position ?? player.role]));
  assert.equal(positions["lump-lf"], "LF/RF");
  assert.equal(positions["lump-rf"], "LF/RF");
  assert.equal(positions["lump-combined"], "LF/RF");
  assert.equal(positions["lump-cf"], "CF");
  assert.equal(positions["lump-sp"], "SP");

  const centerFielder = makeHitter({ id: "keep-cf", position: "CF" });
  assert.equal(normalizeCardPosition(centerFielder), centerFielder);
});

test("combined LF/RF cards cover both corners at the same fielding score", () => {
  const manager = {
    name: "Combined Corners",
    roster: [
      makeHitter({ id: "combo-c", position: "C" }),
      makeHitter({ id: "combo-1b", position: "1B" }),
      makeHitter({ id: "combo-2b", position: "2B" }),
      makeHitter({ id: "combo-3b", position: "3B" }),
      makeHitter({ id: "combo-ss", position: "SS" }),
      makeHitter({ id: "combo-cf", position: "CF" }),
      makeHitter({ id: "combo-corner-a", name: "Corner One", position: "LF/RF", fielding: 2 }),
      makeHitter({ id: "combo-corner-b", name: "Corner Two", position: "LF/RF", fielding: 1 }),
      makeHitter({ id: "combo-dh", position: "C" }),
      makePitcher({ id: "combo-sp-1", role: "SP" }),
      makePitcher({ id: "combo-sp-2", role: "SP" }),
      makePitcher({ id: "combo-rp-1", role: "RP", ip: 1 }),
      makePitcher({ id: "combo-rp-2", role: "RP", ip: 1 })
    ]
  };

  assert.deepEqual(validateRoster(manager), []);

  const team = buildTeam(manager);
  const leftField = team.lineup.find((player) => player.defensivePosition === "LF");
  const rightField = team.lineup.find((player) => player.defensivePosition === "RF");
  assert.equal(leftField.id, "combo-corner-a");
  assert.equal(leftField.fielding, 2);
  assert.equal(rightField.id, "combo-corner-b");
  assert.equal(rightField.fielding, 1);

  const swapped = buildTeam({
    ...manager,
    lineupAssignments: { LF: "combo-corner-b", RF: "combo-corner-a" }
  });
  assert.equal(swapped.lineup.find((player) => player.defensivePosition === "LF").fielding, 1);
  assert.equal(swapped.lineup.find((player) => player.defensivePosition === "RF").fielding, 2);
});

test("any hitter can cover first base with literal minus-one fielding", () => {
  const manager = {
    name: "First Base Fallback",
    roster: [
      makeHitter({ id: "fallback-c", position: "C", fielding: 5 }),
      makeHitter({ id: "fallback-2b", position: "2B", fielding: 5 }),
      makeHitter({ id: "fallback-3b", position: "3B", fielding: 5 }),
      makeHitter({ id: "fallback-ss", name: "Shortstop At First", position: "SS", fielding: 5 }),
      makeHitter({ id: "fallback-ss-2", position: "SS", fielding: 5 }),
      makeHitter({ id: "fallback-lf", position: "LF", fielding: 5 }),
      makeHitter({ id: "fallback-cf", position: "CF", fielding: 5 }),
      makeHitter({ id: "fallback-rf", position: "RF", fielding: 5 }),
      makeHitter({ id: "fallback-dh", position: "C", fielding: 5 }),
      makePitcher({ id: "fallback-sp-1", role: "SP" }),
      makePitcher({ id: "fallback-sp-2", role: "SP" }),
      makePitcher({ id: "fallback-rp-1", role: "RP", ip: 1 }),
      makePitcher({ id: "fallback-rp-2", role: "RP", ip: 1 })
    ]
  };

  assert.deepEqual(validateRoster(manager), []);

  const team = buildTeam(manager);
  const firstBase = team.lineup.find((player) => player.defensivePosition === "1B");
  assert.notEqual(firstBase.cardPosition, "1B");
  assert.equal(firstBase.fielding, -1);
});

test("off-position first baseman uses minus-one in infield fielding", () => {
  const manager = {
    name: "Fallback Defense",
    roster: [
      makeHitter({ id: "def-c", position: "C", fielding: 0 }),
      makeHitter({ id: "def-2b", position: "2B", fielding: 5 }),
      makeHitter({ id: "def-3b", position: "3B", fielding: 5 }),
      makeHitter({ id: "def-ss", name: "Fallback 1B", position: "SS", fielding: 5 }),
      makeHitter({ id: "def-ss-2", position: "SS", fielding: 5 }),
      makeHitter({ id: "def-lf", position: "LF", fielding: 0 }),
      makeHitter({ id: "def-cf", position: "CF", fielding: 0 }),
      makeHitter({ id: "def-rf", position: "RF", fielding: 0 }),
      makeHitter({ id: "def-dh", position: "C", fielding: 0 }),
      makePitcher({ id: "def-sp-1", role: "SP" }),
      makePitcher({ id: "def-sp-2", role: "SP" }),
      makePitcher({ id: "def-rp-1", role: "RP", ip: 1 }),
      makePitcher({ id: "def-rp-2", role: "RP", ip: 1 })
    ]
  };
  const fieldingTeam = buildTeam(manager);
  const state = createInitialState(teamA, fieldingTeam);
  state.bases[0] = { id: "runner-first", name: "Runner First", speed: 10 };

  applyGroundout(state, hitter, "away", "home", repeatingRng(1));

  assert.equal(state.lastPlayDetails.doublePlayAttempt.fielding, 14);
});

test("manual lineup assignments are used when building a team", () => {
  const manager = {
    name: "Manual Slots",
    lineupAssignments: {
      "1B": "manual-ss",
      LF: "manual-rf",
      RF: "manual-lf"
    },
    roster: [
      makeHitter({ id: "manual-c", position: "C", fielding: 2 }),
      makeHitter({ id: "manual-1b", position: "1B", fielding: 2 }),
      makeHitter({ id: "manual-2b", position: "2B", fielding: 2 }),
      makeHitter({ id: "manual-3b", position: "3B", fielding: 2 }),
      makeHitter({ id: "manual-ss", name: "Manual Shortstop", position: "SS", fielding: 5 }),
      makeHitter({ id: "manual-ss-2", position: "SS", fielding: 2 }),
      makeHitter({ id: "manual-lf", name: "Manual LF", position: "LF", fielding: 2 }),
      makeHitter({ id: "manual-cf", position: "CF", fielding: 2 }),
      makeHitter({ id: "manual-rf", name: "Manual RF", position: "RF", fielding: 2 }),
      makePitcher({ id: "manual-sp-1", role: "SP" }),
      makePitcher({ id: "manual-sp-2", role: "SP" }),
      makePitcher({ id: "manual-rp-1", role: "RP", ip: 1 }),
      makePitcher({ id: "manual-rp-2", role: "RP", ip: 1 })
    ]
  };

  const team = buildTeam(manager);

  assert.equal(team.lineup.find((player) => player.defensivePosition === "1B").id, "manual-ss");
  assert.equal(team.lineup.find((player) => player.defensivePosition === "1B").fielding, -1);
  assert.equal(team.lineup.find((player) => player.defensivePosition === "LF").id, "manual-rf");
  assert.equal(team.lineup.find((player) => player.defensivePosition === "RF").id, "manual-lf");
});

test("repairDraftRosters swaps excess hitters for required staff roles", () => {
  const hitters = Array.from({ length: 13 }, (_, index) => makeHitter({
    id: `repair-h-${index}`,
    name: `Repair Hitter ${index}`,
    position: positions[index % positions.length],
    points: 200 - index
  }));
  const pitchers = [
    makePitcher({ id: "repair-sp-1", name: "Repair Starter 1", role: "SP", points: 150 }),
    makePitcher({ id: "repair-sp-2", name: "Repair Starter 2", role: "SP", points: 149 }),
    makePitcher({ id: "repair-rp-1", name: "Repair Bullpen 1", role: "RP", ip: 1, points: 148 }),
    makePitcher({ id: "repair-rp-2", name: "Repair Bullpen 2", role: "RP", ip: 1, points: 147 })
  ];
  const draft = createDraft(["Solo"], [...hitters, ...pitchers], 13);
  draft.managers[0].roster = [...hitters];
  draft.pickedIds = new Set(hitters.map((player) => player.id));
  draft.pickNumber = 13;
  draft.complete = true;

  repairDraftRosters(draft);

  assert.deepEqual(validateRoster(draft.managers[0]), []);
  assert.equal(draft.managers[0].roster.filter((player) => player.kind === "pitcher" && player.role === "SP").length, 2);
  assert.equal(draft.managers[0].roster.filter((player) => player.kind === "pitcher" && player.role === "RP").length, 2);
});

test("repairDraftRosters prints a replacement hitter when a required position is exhausted", () => {
  const roster = [
    makeHitter({ id: "gap-c", position: "C" }),
    makeHitter({ id: "gap-1b", position: "1B" }),
    makeHitter({ id: "gap-2b", position: "2B" }),
    makeHitter({ id: "gap-ss", position: "SS" }),
    makeHitter({ id: "gap-lf", position: "LF" }),
    makeHitter({ id: "gap-cf", position: "CF" }),
    makeHitter({ id: "gap-rf", position: "RF" }),
    makeHitter({ id: "gap-dh", position: "1B" }),
    makePitcher({ id: "gap-sp-1", role: "SP" }),
    makePitcher({ id: "gap-sp-2", role: "SP" }),
    makePitcher({ id: "gap-rp-1", role: "RP", ip: 1 }),
    makePitcher({ id: "gap-rp-2", role: "RP", ip: 1 })
  ];
  const draft = createDraft(["Solo"], [
    ...roster,
    makeHitter({ id: "gap-extra-1b", position: "1B", points: 300 })
  ], 13);
  draft.managers[0].roster = [...roster];
  draft.pickedIds = new Set(roster.map((player) => player.id));
  draft.pickNumber = 12;

  repairDraftRosters(draft);

  assert.deepEqual(validateRoster(draft.managers[0]), []);
  assert.equal(draft.complete, true);
  // No third baseman exists anywhere in this pool, so there is nothing to copy
  // and the replacement is printed from whole cloth — the last resort.
  const filler = draft.managers[0].roster.find((player) => player.replacement);
  assert.ok(filler, "the repair prints a replacement");
  assert.equal(filler.name, "Replacement 3B");
  assert.equal(filler.position, "3B");
  assert.deepEqual(filler.positions, [{ pos: "3B", fielding: 0 }]);
});

// The sweep is an auction-room closing act: it runs when the nomination queue
// dries up, and it writes what it hands out to the auction's log.
const AUCTION_ROOM = { draftType: "auction", nomination: "random", budget: 500, timer: false };

// A legal roster but for the outfield spots named in `holes`: eight bats, four
// arms, and nothing that can cover what's missing.
function rosterMissingOutfield(prefix, holes) {
  const spots = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "1B"].filter((spot) => !holes.includes(spot));
  const hitters = spots.map((spot, index) => makeHitter({
    id: `${prefix}-h-${index}`,
    name: `${prefix} hitter ${index}`,
    position: spot,
    positions: [{ pos: spot, fielding: 1 }]
  }));
  const arms = [
    makePitcher({ id: `${prefix}-sp-1`, role: "SP" }),
    makePitcher({ id: `${prefix}-sp-2`, role: "SP" }),
    makePitcher({ id: `${prefix}-rp-1`, role: "RP", ip: 1 }),
    makePitcher({ id: `${prefix}-rp-2`, role: "RP", ip: 1 })
  ];
  return [...hitters, ...arms];
}

test("the sweep hands managers short at a position a copy of the worst card who plays it", () => {
  // Two center fielders on the board, one manager bought both, and two are
  // left without. Each gets a copy of the CHEAPER of the two — the same card,
  // so the same hole costs them the same.
  const cheap = makeHitter({
    id: "cf-cheap",
    name: "Cheap Glove",
    position: "CF",
    points: 20,
    onBase: 7,
    positions: [{ pos: "CF", fielding: 1 }, { pos: "LF", fielding: 2 }]
  });
  const dear = makeHitter({
    id: "cf-dear",
    name: "Dear Bat",
    position: "CF",
    points: 400,
    onBase: 12,
    positions: [{ pos: "CF", fielding: 3 }]
  });
  const one = rosterMissingOutfield("one", ["CF"]);
  const two = rosterMissingOutfield("two", ["CF"]);
  const hoarder = rosterMissingOutfield("hog", ["CF"]);
  const pool = [cheap, dear, ...one, ...two, ...hoarder];
  const draft = createDraft(["One", "Two", "Hoarder"], pool, 13, "replacement-copy", AUCTION_ROOM);
  draft.managers[0].roster = [...one];
  draft.managers[1].roster = [...two];
  draft.managers[2].roster = [...hoarder, cheap, dear];
  draft.pickedIds = new Set(pool.map((player) => player.id));

  sweepRosters(draft);

  const copies = [draft.managers[0], draft.managers[1]].map((manager) =>
    manager.roster.find((player) => player.replacement));
  for (const card of copies) {
    assert.ok(card, "the sweep prints a center fielder rather than leaving the hole");
    assert.equal(card.name, "Replacement CF");
    assert.equal(card.points, 20, "the worst center fielder on the board, not the best");
    assert.equal(card.onBase, 7, "his numbers come across");
    assert.equal(card.sourceId, "cf-cheap");
    assert.deepEqual(card.positions, [{ pos: "CF", fielding: 1 }], "stripped to the one slot he was called up for");
  }
  assert.notEqual(copies[0].id, copies[1].id, "two copies, two cards");
  assert.deepEqual(validateRoster(draft.managers[0]), []);
  assert.deepEqual(validateRoster(draft.managers[1]), []);
});

test("two holes at the same slot print numbered replacements", () => {
  const corner = makeHitter({
    id: "corner-only",
    name: "Only Corner",
    position: "LF",
    points: 30,
    positions: [{ pos: "LF", fielding: 2 }]
  });
  const short = rosterMissingOutfield("short", ["LF", "RF"]);
  const hoarder = rosterMissingOutfield("hog", ["LF"]);
  const pool = [corner, ...short, ...hoarder];
  const draft = createDraft(["Short", "Hoarder"], pool, 13, "replacement-twins", AUCTION_ROOM);
  draft.managers[0].roster = [...short];
  draft.managers[1].roster = [...hoarder, corner];
  draft.pickedIds = new Set(pool.map((player) => player.id));

  sweepRosters(draft);

  const printed = draft.managers[0].roster.filter((player) => player.replacement);
  assert.deepEqual(printed.map((player) => player.name), ["Replacement LF/RF", "Replacement LF/RF #2"]);
  assert.equal(printed[0].sourceId, "corner-only");
  assert.equal(printed[1].sourceId, "corner-only");
  assert.deepEqual(validateRoster(draft.managers[0]), []);

  // Undo the sweep and the printed cards stop existing. Left in the pool they
  // would come back as unowned cards on the auction board, up for bid.
  undoLastPick(draft);
  assert.deepEqual(draft.pool.filter((player) => player.replacement), []);
  assert.deepEqual(draft.managers[0].roster.filter((player) => player.replacement), []);
});

test("draft blocks picks that would consume another manager's only required position supply", () => {
  const teamOneRoster = [
    makeHitter({ id: "scarce-a-c", position: "C" }),
    makeHitter({ id: "scarce-a-1b", position: "1B" }),
    makeHitter({ id: "scarce-a-2b", position: "2B" }),
    makeHitter({ id: "scarce-a-3b", position: "3B" }),
    makeHitter({ id: "scarce-a-ss", position: "SS" }),
    makeHitter({ id: "scarce-a-lf", position: "LF" }),
    makeHitter({ id: "scarce-a-cf", position: "CF" }),
    makeHitter({ id: "scarce-a-rf", position: "RF" }),
    makePitcher({ id: "scarce-a-sp-1", role: "SP" }),
    makePitcher({ id: "scarce-a-sp-2", role: "SP" }),
    makePitcher({ id: "scarce-a-rp-1", role: "RP", ip: 1 }),
    makePitcher({ id: "scarce-a-rp-2", role: "RP", ip: 1 })
  ];
  const teamTwoRoster = [
    makeHitter({ id: "scarce-b-c", position: "C" }),
    makeHitter({ id: "scarce-b-1b", position: "1B" }),
    makeHitter({ id: "scarce-b-2b", position: "2B" }),
    makeHitter({ id: "scarce-b-ss", position: "SS" }),
    makeHitter({ id: "scarce-b-lf", position: "LF" }),
    makeHitter({ id: "scarce-b-cf", position: "CF" }),
    makeHitter({ id: "scarce-b-rf", position: "RF" }),
    makeHitter({ id: "scarce-b-dh", position: "1B" }),
    makePitcher({ id: "scarce-b-sp-1", role: "SP" }),
    makePitcher({ id: "scarce-b-sp-2", role: "SP" }),
    makePitcher({ id: "scarce-b-rp-1", role: "RP", ip: 1 }),
    makePitcher({ id: "scarce-b-rp-2", role: "RP", ip: 1 })
  ];
  const lastThirdBase = makeHitter({ id: "scarce-last-3b", position: "3B", points: 300 });
  const dhOption = makeHitter({ id: "scarce-dh-option", position: "1B", points: 250 });
  const draft = createDraft(["One", "Two"], [...teamOneRoster, ...teamTwoRoster, lastThirdBase, dhOption], 13);
  draft.managers[0].roster = [...teamOneRoster];
  draft.managers[1].roster = [...teamTwoRoster];
  draft.pickedIds = new Set([...teamOneRoster, ...teamTwoRoster].map((player) => player.id));
  draft.pickNumber = 24;

  const greedyPick = canPickPlayer(draft, draft.managers[0], lastThirdBase);
  const safePick = canPickPlayer(draft, draft.managers[0], dhOption);

  assert.equal(greedyPick.ok, false);
  assert.match(greedyPick.reason, /3B/);
  assert.equal(safePick.ok, true);
});

test("snake hands a stalled manager a replacement copy of the last card drafted at the slot", () => {
  const makeBat = (id, position, extra = {}) =>
    makeHitter({ id, position, positions: [{ pos: position, fielding: 2 }], ...extra });
  const teamOne = [
    makeBat("stall-one-1b", "1B"),
    makeBat("stall-one-2b", "2B"),
    makeBat("stall-one-3b", "3B"),
    makeBat("stall-one-ss", "SS"),
    makeBat("stall-one-lf", "LF"),
    makeBat("stall-one-cf", "CF"),
    makeBat("stall-one-rf", "RF"),
    makeBat("stall-one-dh", "1B"),
    makePitcher({ id: "stall-one-sp-1", role: "SP" }),
    makePitcher({ id: "stall-one-sp-2", role: "SP" }),
    makePitcher({ id: "stall-one-rp-1", role: "RP", ip: 1 }),
    makePitcher({ id: "stall-one-rp-2", role: "RP", ip: 1 })
  ];
  const catcher = makeHitter({
    id: "stall-two-c",
    name: "Last Catcher",
    position: "C",
    onBase: 11,
    points: 175,
    positions: [{ pos: "C", fielding: 4 }]
  });
  const teamTwo = [
    catcher,
    makeBat("stall-two-1b", "1B"),
    makeBat("stall-two-2b", "2B"),
    makeBat("stall-two-3b", "3B"),
    makeBat("stall-two-ss", "SS"),
    makeBat("stall-two-lf", "LF"),
    makeBat("stall-two-cf", "CF"),
    makeBat("stall-two-rf", "RF"),
    makePitcher({ id: "stall-two-sp-1", role: "SP" }),
    makePitcher({ id: "stall-two-sp-2", role: "SP" }),
    makePitcher({ id: "stall-two-rp-1", role: "RP", ip: 1 }),
    makePitcher({ id: "stall-two-rp-2", role: "RP", ip: 1 })
  ];
  // A spare bat and a spare arm sit unowned on the board: legal-looking cards,
  // but neither can fill Team One's one open slot, which is a catcher.
  const spareBat = makeBat("stall-spare-bat", "SS");
  const spareArm = makePitcher({ id: "stall-spare-arm", role: "RP", ip: 1 });
  const pool = [...teamOne, ...teamTwo, spareBat, spareArm];
  const draft = createDraft(["One", "Two"], pool, 13, "snake-stall");
  draft.managers[0].roster = [...teamOne];
  draft.managers[1].roster = [...teamTwo];
  draft.pickedIds = new Set([...teamOne, ...teamTwo].map((player) => player.id));
  draft.pickNumber = 24; // round 12, snake turns back to Team One

  assert.equal(currentManager(draft).id, draft.managers[0].id);
  assert.equal(currentManagerMustReplace(draft), true, "no legal pick fills Team One's open catcher slot");

  autopick(draft);

  const printed = draft.managers[0].roster.find((player) => player.replacement);
  assert.ok(printed, "the stall is filled rather than throwing");
  assert.equal(printed.name, "Replacement C");
  assert.equal(printed.sourceId, "stall-two-c", "copies the last real catcher drafted");
  assert.equal(printed.onBase, 11, "his numbers come across");
  assert.equal(printed.points, 175);
  assert.deepEqual(printed.positions, [{ pos: "C", fielding: 4 }]);
  assert.deepEqual(validateRoster(draft.managers[0]).filter((issue) => issue.includes("C")), []);

  // Undo the forced pick and the printed card leaves the pool too, or it would
  // return as a pickable card on the board.
  undoLastPick(draft);
  assert.deepEqual(draft.pool.filter((player) => player.replacement), []);
  assert.equal(draft.managers[0].roster.some((player) => player.replacement), false);
});

test("a catcher-short snake league finishes on a replacement instead of stalling", () => {
  const bats = [];
  for (const position of ["1B", "2B", "3B", "SS", "LF", "CF", "RF"]) {
    for (let n = 0; n < 3; n += 1) {
      bats.push(makeHitter({
        id: `short-${position}-${n}`,
        position,
        positions: [{ pos: position, fielding: 1 }],
        points: 200 - n
      }));
    }
  }
  const pitchers = [];
  for (let n = 0; n < 5; n += 1) {
    pitchers.push(makePitcher({ id: `short-sp-${n}`, role: "SP", points: 150 - n }));
    pitchers.push(makePitcher({ id: `short-rp-${n}`, role: "RP", ip: 1, points: 140 - n }));
  }
  // One catcher, two teams that each need one. The league-finish guard blocks
  // the pick that would strand the other team, so the lone catcher cannot be
  // taken until a replacement has relieved one seat.
  const onlyCatcher = makeHitter({ id: "short-only-c", position: "C", positions: [{ pos: "C", fielding: 3 }], points: 300 });
  const pool = [onlyCatcher, ...bats, ...pitchers];
  const draft = createDraft(["One", "Two"], pool, 13, "catcher-short");

  let guard = 0;
  while (!draft.complete && guard < 100) {
    autopick(draft);
    guard += 1;
  }

  assert.ok(draft.complete, "the draft finishes rather than throwing on the last catcher");
  for (const manager of draft.managers) {
    assert.deepEqual(validateRoster(manager), [], `${manager.name} fields a legal roster`);
  }
  // Exactly one C slot in the room must be a replacement — there is only one
  // real catcher for two seats — and the real one is taken once a replacement
  // frees the block.
  const printed = draft.managers.flatMap((manager) => manager.roster).filter((player) => player.replacement);
  assert.equal(printed.length, 1, "one hole, one replacement");
  assert.equal(printed[0].slot, "C");
  assert.equal(draft.pickedIds.has("short-only-c"), true, "the real catcher is drafted once the block lifts");
});

test("autopick keeps rosters legal", () => {
  const hitters = Array.from({ length: 24 }, (_, index) => makeHitter({
    id: `auto-h-${index}`,
    name: `Auto Hitter ${index}`,
    position: positions[index % positions.length],
    points: 250 - index
  }));
  const pitchers = Array.from({ length: 8 }, (_, index) =>
    makePitcher({
      id: `auto-p-${index}`,
      name: `Auto Pitcher ${index}`,
      role: index % 2 === 0 ? "SP" : "RP",
      ip: index % 2 === 0 ? 6 : 1,
      points: 180 - index
    })
  );
  const draft = createDraft(["One", "Two"], [...hitters, ...pitchers], 13);

  while (!draft.complete) autopick(draft);

  assert.deepEqual(validateRoster(draft.managers[0]), []);
  assert.deepEqual(validateRoster(draft.managers[1]), []);
});

test("draft requires two starters and two bullpen pitchers", () => {
  const draft = createDraft(["Solo"], [], 13);
  const manager = draft.managers[0];
  manager.roster = [
    makePitcher({ id: "role-sp-1", role: "SP" }),
    makePitcher({ id: "role-sp-2", role: "SP" }),
    makePitcher({ id: "role-rp-1", role: "RP", ip: 1 })
  ];

  assert.deepEqual(validateRoster(manager).filter((issue) => issue.includes("starter")), []);
  assert.ok(validateRoster(manager).some((issue) => issue.includes("bullpen pitcher")));
  assert.equal(canPickPlayer(draft, manager, makePitcher({ id: "role-sp-3", role: "SP" })).ok, false);
});

test("a configured four-man rotation changes CPU roster needs and the active game staff", () => {
  const draft = createDraft(["One", "Two"], makeDraftPool("rotation-four", 24, 24), 15, "rotation-four", {
    startingPitchers: 4
  });

  assert.equal(draft.rosterSize, 15);
  assert.equal(getRosterNeeds([], draft).starter, 4);

  while (!draft.complete) autopick(draft);

  for (const manager of draft.managers) {
    const starters = manager.roster.filter((player) => player.kind === "pitcher" && player.role === "SP");
    assert.equal(starters.length, 4);
    assert.deepEqual(validateRoster(manager), []);
    assert.equal(buildTeam(manager).starters.length, 4, "every drafted starter remains in the game rotation");
    assert.equal(
      canPickPlayer(draft, manager, makePitcher({ id: `${manager.id}-extra-sp`, role: "SP" })).ok,
      false,
      "a fifth starter does not fit a four-man staff"
    );
  }
});

test("single-game team uses first starter and two bullpen pitchers", () => {
  const manager = {
    name: "Staff Split",
    roster: [
      ...Array.from({ length: 9 }, (_, index) => makeHitter({
        id: `staff-h-${index}`,
        name: `Staff Hitter ${index}`,
        position: positions[index % positions.length]
      })),
      makePitcher({ id: "staff-sp-1", name: "Starter One", role: "SP" }),
      makePitcher({ id: "staff-sp-2", name: "Starter Two", role: "SP" }),
      makePitcher({ id: "staff-rp-1", name: "Bullpen One", role: "RP", ip: 1 }),
      makePitcher({ id: "staff-rp-2", name: "Bullpen Two", role: "RP", ip: 1 })
    ]
  };

  const team = buildTeam(manager);
  const rotatedTeam = buildTeam(manager, { starterIndex: 1 });

  assert.deepEqual(team.pitchers.map((item) => item.name), ["Starter One", "Bullpen One", "Bullpen Two"]);
  assert.deepEqual(rotatedTeam.pitchers.map((item) => item.name), ["Starter Two", "Bullpen One", "Bullpen Two"]);
});

test("round robin cycles through each starter per team", () => {
  const managers = ["One", "Two", "Three"].map((name, managerIndex) => ({
    name,
    roster: [
      ...Array.from({ length: 9 }, (_, index) => makeHitter({
        id: `${name}-h-${index}`,
        name: `${name} Hitter ${index}`,
        position: positions[index % positions.length]
      })),
      makePitcher({ id: `${name}-sp-1`, name: `${name} Starter One`, role: "SP", chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
      makePitcher({ id: `${name}-sp-2`, name: `${name} Starter Two`, role: "SP", chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
      makePitcher({ id: `${name}-rp-1`, name: `${name} Bullpen One`, role: "RP", ip: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
      makePitcher({ id: `${name}-rp-2`, name: `${name} Bullpen Two`, role: "RP", ip: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] })
    ]
  }));
  const teams = managers.map((manager) => buildTeam(manager));

  const tournament = simulateRoundRobin(teams, "rotation-test");
  const startersByTeam = new Map();

  for (const game of tournament.games) {
    const awayStarters = startersByTeam.get(game.away.name) ?? [];
    awayStarters.push(game.away.pitchers[0].name);
    startersByTeam.set(game.away.name, awayStarters);

    const homeStarters = startersByTeam.get(game.home.name) ?? [];
    homeStarters.push(game.home.pitchers[0].name);
    startersByTeam.set(game.home.name, homeStarters);
  }

  assert.deepEqual(startersByTeam.get("One"), ["One Starter One", "One Starter Two"]);
  assert.deepEqual(startersByTeam.get("Two"), ["Two Starter One", "Two Starter Two"]);
  assert.deepEqual(startersByTeam.get("Three"), ["Three Starter One", "Three Starter Two"]);
});

test("valuation models are deterministic and differ between managers", () => {
  const player = makeHitter({ id: "val-h", position: "SS", onBase: 11, speed: 14, fielding: 3 });
  const modelA = createValuationModel("room-seed:valuation:team-1");
  const modelARepeat = createValuationModel("room-seed:valuation:team-1");
  const modelB = createValuationModel("room-seed:valuation:team-2");

  assert.equal(modelA.value(player), modelARepeat.value(player));
  assert.notDeepEqual(modelA.weights, modelB.weights);
});

test("valuation model prices starter workload above an identical reliever", () => {
  const starter = makePitcher({ id: "val-sp", role: "SP", ip: 6 });
  const reliever = makePitcher({ id: "val-rp", role: "RP", ip: 1 });

  for (const seed of ["room-a:valuation:team-1", "room-b:valuation:team-2", "room-c:valuation:team-3"]) {
    const model = createValuationModel(seed);
    assert.ok(
      model.value(starter) > model.value(reliever) * 1.5,
      `same-quality starter should be worth well over a reliever (seed ${seed})`
    );
  }
});

test("valuation weights stay within the advertised spread of the revealed baseline", () => {
  for (const seed of ["room-a:valuation:team-1", "room-b:valuation:team-2", "room-c:valuation:team-3"]) {
    const model = createValuationModel(seed);
    for (const kind of ["hitter", "pitcher"]) {
      for (const [key, base] of Object.entries(VALUATION_BASE_WEIGHTS[kind])) {
        const ratio = model.weights[kind][key] / base;
        assert.ok(
          ratio >= 1 - VALUATION_PERTURBATION && ratio <= 1 + VALUATION_PERTURBATION,
          `${kind}.${key} lean ${ratio} should stay within ±${VALUATION_PERTURBATION} (seed ${seed})`
        );
      }
    }
  }
});

test("managerValuation derives distinct stable models from the draft seed", () => {
  const draft = createDraft(["One", "Two"], [], 13, "my-room");
  const modelOne = managerValuation(draft, draft.managers[0]);
  const modelTwo = managerValuation(draft, draft.managers[1]);
  const revived = createDraft(["One", "Two"], [], 13, "my-room");

  assert.notDeepEqual(modelOne.weights, modelTwo.weights);
  assert.deepEqual(managerValuation(revived, revived.managers[0]).weights, modelOne.weights);
});

test("autopick weighs positional dropoff instead of only top overall value", () => {
  const eliteStats = {
    onBase: 12,
    speed: 12,
    fielding: 3,
    chart: [
      { from: 1, to: 10, result: RESULTS.SINGLE },
      { from: 11, to: 20, result: RESULTS.HR }
    ]
  };
  const weakChart = [
    { from: 1, to: 12, result: RESULTS.SO },
    { from: 13, to: 20, result: RESULTS.SINGLE }
  ];
  const pool = [
    makeHitter({ id: "scarce-ss-1", name: "Deep SS One", position: "SS", ...eliteStats }),
    makeHitter({ id: "scarce-ss-2", name: "Deep SS Two", position: "SS", ...eliteStats }),
    makeHitter({ id: "scarce-c-1", name: "Last Good C", position: "C", ...eliteStats }),
    makeHitter({ id: "scarce-c-2", name: "Weak C", position: "C", onBase: 7, speed: 8, fielding: 0, chart: weakChart }),
    makePitcher({ id: "scarce-sp-1", role: "SP" }),
    makePitcher({ id: "scarce-sp-2", role: "SP" }),
    makePitcher({ id: "scarce-rp-1", role: "RP", ip: 1 }),
    makePitcher({ id: "scarce-rp-2", role: "RP", ip: 1 })
  ];
  const draft = createDraft(["Solo"], pool, 13, "scarcity-room");

  autopick(draft);

  assert.equal(draft.managers[0].roster[0].id, "scarce-c-1");
});

test("draftHistory lists picks in snake order with the picking manager", () => {
  const draft = createDraft(["One", "Two"], makeDraftPool("hist"), 13, "history-room");

  pickPlayer(draft, "hist-h-0");
  pickPlayer(draft, "hist-h-1");
  pickPlayer(draft, "hist-h-2");
  pickPlayer(draft, "hist-h-3");

  const history = draftHistory(draft);
  assert.deepEqual(
    history.map((pick) => [pick.pickNumber, pick.round, pick.manager.name, pick.player.id]),
    [
      [1, 1, "One", "hist-h-0"],
      [2, 1, "Two", "hist-h-1"],
      [3, 2, "Two", "hist-h-2"],
      [4, 2, "One", "hist-h-3"]
    ]
  );

  undoLastPick(draft);
  assert.equal(draftHistory(draft).length, 3);
});

// ---- Multi-position cards ------------------------------------------------------

// A 13-man roster around one flexible infielder, with `flexPositions` as his
// eligibility list (primary first) and a pure 2B alongside him.
function multiPositionRoster(flexPositions) {
  return {
    name: "Utility Crew",
    roster: [
      makeHitter({ id: "mp-c", position: "C" }),
      makeHitter({ id: "mp-1b", position: "1B" }),
      makeHitter({ id: "mp-2b", name: "Pure Second", position: "2B", fielding: 4 }),
      makeHitter({ id: "mp-3b", position: "3B" }),
      makeHitter({
        id: "mp-flex",
        name: "Utility Man",
        position: flexPositions[0].pos,
        fielding: flexPositions[0].fielding,
        positions: flexPositions
      }),
      makeHitter({ id: "mp-cf", position: "CF" }),
      makeHitter({ id: "mp-lf", position: "LF/RF" }),
      makeHitter({ id: "mp-rf", position: "LF/RF" }),
      makeHitter({ id: "mp-dh", position: "C" }),
      makePitcher({ id: "mp-sp-1", role: "SP" }),
      makePitcher({ id: "mp-sp-2", role: "SP" }),
      makePitcher({ id: "mp-rp-1", role: "RP", ip: 1 }),
      makePitcher({ id: "mp-rp-2", role: "RP", ip: 1 })
    ]
  };
}

test("a multi-position card covers its secondary slot at the listed fielding", () => {
  const manager = multiPositionRoster([
    { pos: "2B", fielding: 3 },
    { pos: "SS", fielding: 2 }
  ]);

  assert.deepEqual(validateRoster(manager), []);

  const team = buildTeam(manager);
  const shortstop = team.lineup.find((player) => player.defensivePosition === "SS");
  const second = team.lineup.find((player) => player.defensivePosition === "2B");
  // The pure 2B holds his spot; the 2B/SS card slides to short at his
  // SS rating, not his primary 2B rating.
  assert.equal(second.id, "mp-2b");
  assert.equal(shortstop.id, "mp-flex");
  assert.equal(shortstop.fielding, 2);
});

test("lineup matching reseats a multi-position card instead of stranding a slot", () => {
  // The flex card seats at 2B first (his primary, listed before SS), and the
  // matching must push him to SS when the pure 2B shows up later.
  const manager = multiPositionRoster([
    { pos: "2B", fielding: 3 },
    { pos: "SS", fielding: 2 }
  ]);
  manager.roster = [
    manager.roster.find((player) => player.id === "mp-flex"),
    ...manager.roster.filter((player) => player.id !== "mp-flex")
  ];

  assert.deepEqual(validateRoster(manager), []);
  const slots = assignLineupSlots(manager.roster).slots;
  assert.equal(slots.find((slot) => slot.label === "SS").player.id, "mp-flex");
  assert.equal(slots.find((slot) => slot.label === "2B").player.id, "mp-2b");
});

test("a 1B side-listing plays first base at its printed rating, not minus one", () => {
  const manager = {
    name: "Corner Crew",
    roster: [
      makeHitter({ id: "corner-c", position: "C" }),
      makeHitter({
        id: "corner-3b1b",
        name: "Corner Man",
        position: "3B",
        fielding: 2,
        positions: [{ pos: "3B", fielding: 2 }, { pos: "1B", fielding: 0 }]
      }),
      makeHitter({ id: "corner-2b", position: "2B" }),
      makeHitter({ id: "corner-3b", position: "3B" }),
      makeHitter({ id: "corner-ss", position: "SS" }),
      makeHitter({ id: "corner-cf", position: "CF" }),
      makeHitter({ id: "corner-lf", position: "LF/RF" }),
      makeHitter({ id: "corner-rf", position: "LF/RF" }),
      makeHitter({ id: "corner-dh", position: "C" }),
      makePitcher({ id: "corner-sp-1", role: "SP" }),
      makePitcher({ id: "corner-sp-2", role: "SP" }),
      makePitcher({ id: "corner-rp-1", role: "RP", ip: 1 }),
      makePitcher({ id: "corner-rp-2", role: "RP", ip: 1 })
    ]
  };

  const team = buildTeam(manager);
  const firstBase = team.lineup.find((player) => player.defensivePosition === "1B");
  assert.equal(firstBase.id, "corner-3b1b");
  assert.equal(firstBase.fielding, 0);
  assert.equal(firstBase.outOfPosition, false);
  const thirdBase = team.lineup.find((player) => player.defensivePosition === "3B");
  assert.equal(thirdBase.id, "corner-3b");
});

// ---- the snake's chess clock -------------------------------------------------

function clockDraft(managers = ["Ana", "Bo"], timer = { bankSeconds: 60, incrementSeconds: 10 }) {
  return createDraft(managers, makeDraftPool("clock", 40, 20), 13, "clock-seed", { snakeTimer: timer });
}

test("a snake draft has no clock unless it asks for one", () => {
  const plain = createDraft(["Ana", "Bo"], makeDraftPool("plain"), 13);
  assert.equal(snakeClockEnabled(plain), false, "an untimed draft stays untimed");
  assert.equal(plain.clock, undefined, "and carries no clock at all");
  assert.equal(snakeClockEnabled(clockDraft()), true, "one that asks for a chess clock gets one");
});

test("the chess clock spends the man on the clock, and only him", () => {
  const draft = clockDraft();
  const [ana, bo] = draft.managers;
  const t0 = 1_000_000;
  startSnakeClock(draft, t0);
  assert.equal(snakeTimeRemainingMs(draft, ana, t0), 60_000, "both start with a full bank");
  assert.equal(snakeTimeRemainingMs(draft, bo, t0), 60_000);

  // Ana sits on the pick for 20 seconds. Bo's clock does not move.
  assert.equal(snakeTimeRemainingMs(draft, ana, t0 + 20_000), 40_000, "her bank drains while she thinks");
  assert.equal(snakeTimeRemainingMs(draft, bo, t0 + 20_000), 60_000, "his does not — it is not his turn");

  // She picks at 20s: charged 20, paid the 10s increment.
  pickPlayer(draft, availablePlayers(draft)[0].id, t0 + 20_000);
  assert.equal(snakeClockBankMs(draft, ana), 50_000, "charged for the time, credited the increment");
  assert.equal(currentManager(draft).id, bo.id, "and the clock passes to the next man");
  assert.equal(snakeTimeRemainingMs(draft, bo, t0 + 25_000), 55_000, "whose bank is now the one running");
  assert.equal(snakeTimeRemainingMs(draft, ana, t0 + 25_000), 50_000, "hers is parked where she left it");
});

test("a timeout autopick awards the increment and gives the manager another chance", () => {
  const draft = clockDraft();
  const [ana] = draft.managers;
  const t0 = 2_000_000;
  startSnakeClock(draft, t0);
  // Ana walks away from the table for two minutes, on a one-minute bank.
  const late = t0 + 120_000;
  assert.equal(snakeTimeRemainingMs(draft, ana, late), 0, "the flag is down");
  assert.equal(snakeClockFlagged(draft, ana, late), true);

  const before = ana.roster.length;
  autopick(draft, late);
  assert.equal(ana.roster.length, before + 1, "the pick is made for her");
  assert.equal(snakeClockBankMs(draft, ana), 10_000, "the automatic pick still earns her increment");

  // Bo picks and the snake comes back through him once more. Ana's increment
  // is parked until it is her turn again.
  autopick(draft, late + 1000);
  autopick(draft, late + 2000);
  assert.equal(currentManager(draft).id, ana.id);
  assert.equal(snakeClockBankMs(draft, ana), 10_000);
  assert.equal(snakeClockFlagged(draft, ana, late + 2_000), false, "she can act during the bonus window");
  assert.equal(snakeClockFlagged(draft, ana, late + 12_000), true, "only the new increment runs out");
});

test("pausing a chess-clocked snake costs the man on the clock nothing", () => {
  const draft = clockDraft();
  const [ana] = draft.managers;
  const t0 = 3_000_000;
  startSnakeClock(draft, t0);
  pauseSnake(draft, null, t0 + 15_000);
  assert.equal(snakeClockBankMs(draft, ana), 45_000, "the pause settles what she had used");
  // An hour goes by with the room stopped.
  assert.equal(snakeTimeRemainingMs(draft, ana, t0 + 3_600_000), 45_000, "and a stopped clock does not tick");
  resumeSnake(draft, t0 + 3_600_000);
  assert.equal(snakeTimeRemainingMs(draft, ana, t0 + 3_600_000), 45_000, "she comes back to the clock she left");
  assert.equal(snakeTimeRemainingMs(draft, ana, t0 + 3_605_000), 40_000, "and it runs again from there");
});

test("a room replays its clock: same actions, same timestamps, same banks", () => {
  const live = clockDraft(["Ana", "Bo", "Cy"]);
  const t0 = 4_000_000;
  const log = [{ type: "start-clock", at: t0 }];
  applyDraftAction(live, log[0]);
  let at = t0;
  for (let i = 0; i < 6; i += 1) {
    at += (i + 1) * 7_000; // each manager dawdles a different amount
    const action = { type: "pick", playerId: availablePlayers(live)[i].id, at };
    applyDraftAction(live, log[log.length] = action);
  }
  applyDraftAction(live, log[log.length] = { type: "pause", at: at + 5_000 });
  applyDraftAction(live, log[log.length] = { type: "resume", at: at + 500_000 });

  const replayed = clockDraft(["Ana", "Bo", "Cy"]);
  for (const action of log) applyDraftAction(replayed, action);
  assert.deepEqual(replayed.clock.banks, live.clock.banks, "the banks land where they landed");
  assert.equal(replayed.pickNumber, live.pickNumber, "off the same picks");
});

// The 1B+ auto-advance is settled at the END of the play, not the start of it.
// With a man on first, he is standing on second the instant the ball lands, so
// asking "is second open?" before the throw is resolved always said no — and the
// batter was pinned to first even when that runner carried on to third and left
// second empty behind him.
test("1B+ takes second after the lead runner vacates it, not before", () => {
  const state = createInitialState(teamA, weakDefense);
  const batter = makeHitter({ id: "plus-h", name: "Plus Hitter", chart: [{ from: 1, to: 20, result: RESULTS.SINGLE_PLUS }] });
  state.away.lineup[0] = batter;
  // A fast man on first, against a defense that cannot throw him out at third.
  state.bases = [makeHitter({ id: "lead-r", name: "Lead Runner", speed: 20 }), null, null];

  const event = playPlateAppearance(state, repeatingRng(1, 1, 1));

  assert.equal(event.result, RESULTS.SINGLE_PLUS);
  assert.equal(state.bases[2]?.name, "Lead Runner", "the man on first took third on the hit");
  assert.equal(
    state.bases[1]?.name,
    "Plus Hitter",
    "and the 1B+ batter takes the second base that the play itself opened up"
  );
  assert.equal(state.bases[0], null, "so nobody is left standing on first");
});

// One advance per hit. The 1B+ trot is a base taken on the play — uncontested,
// unthrown-at — and a man who has just walked into second does not then get to
// break for third before a pitch is thrown.
test("the 1B+ trot spends the batter's steal", () => {
  const quiet = [{ from: 1, to: 20, result: RESULTS.SO }];
  const plus = makeHitter({ id: "plus-h", name: "Plus Hitter", speed: 20, chart: [{ from: 1, to: 20, result: RESULTS.SINGLE_PLUS }] });
  const nextUp = makeHitter({ id: "quiet-h", name: "Quiet Hitter", chart: quiet });
  const away = { name: "A", lineup: [plus, nextUp, ...teamA.lineup.slice(2)], pitchers: teamA.pitchers };
  // A defense that cannot throw anybody out, so nothing but the rule stops him.
  const defense = { ...weakDefense, pitchers: [makePitcher({ id: "wd-p", name: "Weak Pitcher", chart: quiet })] };
  const state = createInitialState(away, defense);

  playPlateAppearance(state, repeatingRng(1, 1));
  assert.equal(state.bases[1]?.name, "Plus Hitter", "he trotted into second on the hit");
  assert.deepEqual(stealCandidates(state), [], "and third is not his for the taking on the same trip");
  assert.equal(playStealAttempt(state, repeatingRng(1)), null, "the auto-runner does not go either");

  // The next at-bat hands the green light back: a strikeout, nobody moves.
  playPlateAppearance(state, repeatingRng(1, 1));
  assert.equal(state.bases[1]?.name, "Plus Hitter", "still standing on second");
  assert.deepEqual(
    stealCandidates(state).map((candidate) => candidate.runner.name), ["Plus Hitter"],
    "a pitch has been thrown since, and now he can run"
  );
});

// Same rule, one step further out: when the send is the PLAYER's call, the play
// is not over when the hit lands — it is over when he answers. Asking about
// second before that pins the batter to first on a base the manager is about to
// empty, so the trot waits for the call and then reads the bases it left.
test("a 1B+ batter waits on the send call before taking second", () => {
  const setUp = () => {
    const state = createInitialState(teamA, weakDefense);
    state.away.lineup[0] = makeHitter({ id: "plus-h", name: "Plus Hitter", chart: [{ from: 1, to: 20, result: RESULTS.SINGLE_PLUS }] });
    // A runner who CAN be thrown out at third, so the send is a decision, and a
    // manager on the hook for making it.
    state.deferAdvancesFor = "away";
    state.bases = [makeHitter({ id: "lead-r", name: "Lead Runner" }), null, null];
    playPlateAppearance(state, repeatingRng(1, 1));
    return state;
  };

  const asked = setUp();
  assert.ok(asked.pendingAdvance, "the manager is on the clock");
  assert.equal(asked.bases[0]?.name, "Plus Hitter", "and the batter holds at first while he thinks");

  const sent = setUp();
  resolveAdvanceDecision(sent, 1, repeatingRng(1));
  assert.equal(sent.bases[2]?.name, "Lead Runner", "sent, and safe at third");
  assert.equal(sent.bases[1]?.name, "Plus Hitter", "so the batter takes the second base the send opened");
  assert.equal(sent.bases[0], null, "and first is empty behind him");

  const gunnedDown = setUp();
  resolveAdvanceDecision(gunnedDown, 1, repeatingRng(20));
  assert.equal(gunnedDown.outs, 1, "sent, and thrown out at third");
  assert.equal(gunnedDown.bases[1]?.name, "Plus Hitter", "second is empty either way, and the trot is uncontested either way");
  // And the base he trotted into costs him the same thing here as anywhere: third
  // is now standing empty, and it is still not his until a pitch is thrown.
  assert.deepEqual(stealCandidates(gunnedDown), [], "the late trot spends his steal too");

  const held = setUp();
  resolveAdvanceDecision(held, 0, repeatingRng(1));
  assert.equal(held.bases[1]?.name, "Lead Runner", "held at second");
  assert.equal(held.bases[0]?.name, "Plus Hitter", "which leaves the batter nowhere to go — a plain single");
});

// Every plate appearance throws two dice, and each of them belongs to somebody:
// the PITCH is the arm's and the SWING is the bat's. The box score keeps them so
// it can say whether an afternoon was the man or the dice.
test("a plate appearance files each man's own die on his line", () => {
  const quiet = [{ from: 1, to: 20, result: RESULTS.SO }];
  const batter = makeHitter({ id: "dice-h", name: "Dice Hitter", chart: quiet });
  const arm = makePitcher({ id: "dice-p", name: "Dice Arm", chart: quiet });
  const state = createInitialState({ ...teamA, lineup: [batter, ...teamA.lineup.slice(1)] }, { ...teamB, pitchers: [arm] });

  // A strikeout either way, so the only dice thrown are the two that matter.
  playPlateAppearance(state, repeatingRng(4, 18));

  const hitter = state.stats.hitters.get("away:dice-h");
  const pitcher = state.stats.pitchers.get("home:dice-p");
  assert.deepEqual([hitter.rolls, hitter.rollTotal], [1, 18], "the swing is the batter's, whosever chart it lands on");
  assert.deepEqual([pitcher.rolls, pitcher.rollTotal], [1, 4], "and the pitch is the arm's");

  // A second turn through, and the totals are totals.
  state.lineupIndex.away = 0;
  playPlateAppearance(state, repeatingRng(6, 12));
  assert.deepEqual([hitter.rolls, hitter.rollTotal], [2, 30], "two swings, added up");
  assert.deepEqual([pitcher.rolls, pitcher.rollTotal], [2, 10], "two pitches, the same way");
});

// ---- The hook -----------------------------------------------------------------
// The two ways a skipper embarrasses himself, one test each.

test("a tired ace keeps the ball when the pen is worse than he is", () => {
  const aceAndRubbish = {
    name: "Ace And Rubbish",
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "ace", name: "Ace", control: 9, ip: 5 }),
      makePitcher({ id: "mop-1", name: "Mop Up", control: 1, ip: 2 }),
      makePitcher({ id: "mop-2", name: "Mop Up Two", control: 1, ip: 2 })
    ]
  };
  const state = createInitialState(teamA, aceAndRubbish);
  // Two points past his tank: a control 9 who is really a 7 tonight. Still the
  // best arm in the building, and the old rule pulled him for a control 1.
  state.pitching.home.battersFaced = 24;
  state.inning = 7;

  const event = playPlateAppearance(state, repeatingRng(20, 1));

  assert.equal(event.pitcher, "Ace", "he is tired, not finished — nobody out there is better");
  assert.equal(event.fatiguePenalty, 2, "and he wears the fatigue while he does it");
});

test("a starter getting hit around comes out the moment his four-inning floor is up, tired or not", () => {
  const batteringPractice = {
    name: "Batting Practice",
    lineup: teamB.lineup,
    pitchers: [
      // Utterly hittable, but the four-inning floor is a hard rule: he wears the
      // first four whatever the pen holds — see STARTER_MIN_OUTS.
      makePitcher({ id: "bp", name: "Batting Practice Guy", control: 0, ip: 7 }),
      makePitcher({ id: "good-1", name: "Good Arm", control: 9, ip: 3 }),
      makePitcher({ id: "good-2", name: "Good Arm Two", control: 8, ip: 3 })
    ]
  };
  // One out shy of the floor: the pen sits, however hittable he is.
  const early = createInitialState(teamA, batteringPractice);
  early.pitching.home.battersFaced = 11;
  early.pitching.home.outsRecorded = 11;
  assert.equal(playPlateAppearance(early, repeatingRng(20, 1)).pitcher, "Batting Practice Guy",
    "the floor holds the ball even in the hands of a batting-practice arm");

  // Twelve outs in the book (his floor is up) and still nobody is tired: the
  // instant the floor lifts, the good arm comes in.
  const atFloor = createInitialState(teamA, batteringPractice);
  atFloor.pitching.home.battersFaced = 12;
  atFloor.pitching.home.outsRecorded = 12;
  const event = playPlateAppearance(atFloor, repeatingRng(20, 1));
  assert.equal(event.pitcher, "Good Arm", "quality innings in the pen do not sit idle behind a bad start past its floor");
  assert.equal(event.fatiguePenalty, 0);
});

test("a starter gets his four innings before any hook, however good the pen behind him", () => {
  // The bug: an elite short reliever (a lights-out closer) read as such a big
  // upgrade over a perfectly fine starter that the skipper pulled the starter on
  // the first batter — the closer then threw eight innings he was never built
  // for. The four-inning floor answers it from outside the relief math.
  const stackedPen = {
    name: "Great Closer, Short Pen",
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "sp", name: "Solid Starter", role: "SP", control: 2, ip: 6 }),
      makePitcher({ id: "closer", name: "Lights Out", role: "RP", control: 8, ip: 1 }),
      makePitcher({ id: "setup", name: "Setup Man", role: "RP", control: 7, ip: 1 })
    ]
  };
  assert.equal(STARTER_MIN_OUTS, 12, "the floor is four full innings");

  // One out short of the floor: the skipper's hands are tied, elite pen or not.
  const early = createInitialState(teamA, stackedPen);
  early.inning = 4;
  early.pitching.home.outsRecorded = STARTER_MIN_OUTS - 1;
  assert.equal(autoRelieve(early, "home"), null, "eleven outs is not four innings; the starter stays");
  assert.equal(early.pitching.home.pitcherIndex, 0, "and he is still the man on the mound");

  // Twelve outs in the book: the floor lifts and the hook is live again.
  const atFloor = createInitialState(teamA, stackedPen);
  atFloor.inning = 5;
  atFloor.pitching.home.outsRecorded = STARTER_MIN_OUTS;
  const pulled = autoRelieve(atFloor, "home");
  assert.ok(pulled, "four innings in, the skipper is free to go get him");
  assert.equal(pulled.name, "Lights Out", "and he sends the best arm he has");

  // A reliever who inherited the game carries no floor of his own. The pen is
  // ordered worst-arm-first, so index 1 is the setup man; in for barely an inning
  // (two outs, well under the floor) but gassed past his one-inning tank, he
  // gives way to the fresher closer waiting behind him.
  const reliever = createInitialState(teamA, stackedPen);
  reliever.inning = 6;
  reliever.pitching.home.pitcherIndex = 1;
  reliever.pitching.home.outsRecorded = 2;
  reliever.pitching.home.battersFaced = 24;
  const swapped = autoRelieve(reliever, "home");
  assert.ok(swapped, "a reliever under the floor's out count is still not held by it");
  assert.equal(swapped.name, "Lights Out", "the tiring setup man gives way to the fresher arm");
});

test("the hook holds when the pen has no innings left to give", () => {
  const shortPen = {
    name: "Short Pen",
    lineup: teamB.lineup,
    pitchers: [
      makePitcher({ id: "meh", name: "Journeyman", control: 3, ip: 7 }),
      // Clearly better than him — three points of control — but with one out in
      // the tank. Good enough to want, nowhere near enough to finish: pulling in
      // the first would mean somebody throws the other eight innings on fumes.
      // Only a DREADFUL start (the desperation gap) is worth that, and a
      // journeyman is not dreadful.
      makePitcher({ id: "sliver", name: "One Out Guy", control: 6, ip: 0.3 })
    ]
  };
  const state = createInitialState(teamA, shortPen);
  state.pitching.home.battersFaced = 0;

  const event = playPlateAppearance(state, repeatingRng(20, 1));

  assert.equal(event.pitcher, "Journeyman", "a slightly better arm is not worth burning the last one in the first");
});

// A base nobody could have thrown him out taking is not asked about — but it is
// still HIS base. He read it, he ran it, he scored. The credit is split with the
// hitter exactly as it is when the player sends him for a contested one; the only
// thing the free base changes is that nobody had to be asked.
test("a free base is still half the runner's", () => {
  const state = createInitialState(teamA, weakDefense);
  const batter = makeHitter({ id: "sng", name: "Singler", chart: [{ from: 1, to: 20, result: RESULTS.SINGLE }] });
  state.away.lineup[0] = batter;
  // The player's side: normally he would be asked to send or hold.
  state.deferAdvancesFor = "away";
  state.bases = [null, makeHitter({ id: "burner", name: "Burner", speed: 20 }), null];

  const event = playPlateAppearance(state, repeatingRng(1, 5));

  assert.equal(event.result, RESULTS.SINGLE);
  assert.equal(state.pendingAdvance, null, "he cannot be thrown out, so nobody was asked");
  assert.equal(state.score.away, 1, "and he came all the way home");

  const hitter = state.stats.hitters.get("away:sng");
  const runner = state.stats.hitters.get("away:burner");
  assert.ok(runner.wpa > 0, "the man who went and got it is paid for going and getting it");
  assert.ok(hitter.wpa > 0, "and the man who hit it still has the bigger half of his own single");
  assert.ok(
    Math.abs((hitter.wpa + runner.wpa) - event.wpa) < 1e-9,
    "the two of them are the whole play and no more — nothing invented, nothing lost"
  );
  const arm = state.stats.pitchers.get("home:wd-p");
  assert.ok(Math.abs(arm.wpa + event.wpa) < 1e-9, "and the pitcher wears all of it");
});

// CERTAIN means a hundred percent, and nothing else means it.
test("only a 100% runner takes the base unasked; 95% is still a gamble, and it is yours", async () => {
  const { certainSafe, freeAdvanceCount, fieldingCheckNeeds } = await import("../src/rules/game.js");

  assert.equal(certainSafe({ safeChance: 1 }), true, "he cannot be thrown out");
  assert.equal(certainSafe({ safeChance: 0.95 }), false, "one face of the die still gets him — so it is a decision");
  assert.equal(certainSafe({ safeChance: 0.999 }), false, "and near-certain is not certain");
  assert.equal(certainSafe({}), false, "an unrated candidate is not a free base");

  // The trap this guards. "The defense needs a 21" is a PROXY for a hundred
  // percent, and it stops being the same thing the moment a number in it isn't
  // whole: here the proxy says he cannot be caught, while a 20 on the die still
  // catches him. Believe the odds, not the proxy.
  const halfPoint = { target: 19.5, fielding: 0, safeChance: 19.5 / 20 };
  assert.equal(fieldingCheckNeeds(halfPoint).impossible, true, "the old proxy calls this uncatchable");
  assert.equal(certainSafe(halfPoint), false, "but a 20 guns him down, so the player is still asked");

  // Only the leading run of genuinely free men is taken without asking.
  assert.equal(freeAdvanceCount([{ safeChance: 1 }, { safeChance: 1 }, { safeChance: 0.9 }]), 2);
  assert.equal(freeAdvanceCount([{ safeChance: 0.95 }, { safeChance: 1 }]), 0, "the lead man is the one who has to be free");
});

// ---- Full-roster format: slots, validation, rotation draw --------------------

function fullFormatRoster() {
  const spots = ["C", "1B", "2B", "3B", "SS", "LF", "RF", "CF", "1B"];
  const hitters = spots.map((pos, index) => makeHitter({
    id: `fr-h-${index}`, name: `FR Hitter ${index}`, position: pos, points: 300 - index * 10
  }));
  const benchBats = ["C", "SS", "LF", "CF"].map((pos, index) => makeHitter({
    id: `fr-b-${index}`, name: `FR Bench ${index}`, position: pos, points: 100 + index
  }));
  const starters = Array.from({ length: 4 }, (_, index) => makePitcher({
    id: `fr-sp-${index}`, name: `FR Starter ${index}`, role: "SP", points: 200 - index
  }));
  const relievers = Array.from({ length: 3 }, (_, index) => makePitcher({
    id: `fr-rp-${index}`, name: `FR Reliever ${index}`, role: "RP", ip: 1, points: 80 - index
  }));
  return { hitters, benchBats, starters, relievers };
}

function fullFormatManager(overrides = {}) {
  const { hitters, benchBats, starters, relievers } = fullFormatRoster();
  return {
    id: "full",
    name: "Full Roster Club",
    roster: [...hitters, ...benchBats, ...starters, ...relievers],
    lineupAssignments: {},
    rosterFormat: "full",
    rosterSize: 20,
    startingPitchers: 4,
    bullpenSlots: 3,
    includeBench: true,
    ...overrides
  };
}

test("staff slots grow with a configured bullpen", () => {
  assert.deepEqual(staffSlotLabels(4, 7), ["SP1", "SP2", "SP3", "SP4", "RP1", "RP2", "RP3", "RP4", "RP5", "RP6", "RP7"]);
  assert.deepEqual(staffSlotLabels(), ["SP1", "SP2", "RP1", "RP2"], "the default stays the classic four");
  const team = buildTeam(fullFormatManager(), { starterIndex: 2 });
  assert.equal(team.starters.length, 4, "the whole rotation suits up");
  assert.equal(team.bullpen.length, 3, "and the whole pen");
  assert.equal(team.pitchers[0].id, "fr-sp-2", "the asked-for starter opens");
});

test("buildTeam emits a bench only when asked", () => {
  const manager = fullFormatManager();
  const team = buildTeam(manager);
  assert.deepEqual(team.bench.map((card) => card.id).sort(), ["fr-b-0", "fr-b-1", "fr-b-2", "fr-b-3"],
    "the unseated bats are the bench");
  const classic = buildTeam({ ...manager, includeBench: false });
  assert.equal(classic.bench, undefined, "nobody else's team grows a field");
});

test("a full-format roster validates the twenty-man shape", () => {
  const manager = fullFormatManager();
  assert.deepEqual(validateRoster(manager), [], "the fixture is legal");
  // The flex splits freely: zero relievers is a choice, not a hole.
  const { relievers } = fullFormatRoster();
  const noPen = fullFormatManager();
  noPen.roster = noPen.roster.filter((card) => card.role !== "RP");
  noPen.roster.push(
    makeHitter({ id: "fr-x-0", name: "Extra Bat 0", position: "2B", points: 50 }),
    makeHitter({ id: "fr-x-1", name: "Extra Bat 1", position: "3B", points: 51 }),
    makeHitter({ id: "fr-x-2", name: "Extra Bat 2", position: "RF", points: 52 })
  );
  noPen.bullpenSlots = 0;
  assert.deepEqual(validateRoster(noPen), [], "an all-bench flex is legal");
  // A fifth starter is not.
  const fiveSp = fullFormatManager();
  fiveSp.roster = [...fiveSp.roster.filter((card) => card.role !== "RP"),
    makePitcher({ id: "fr-sp-4", name: "FR Starter 4", role: "SP", points: 10 }),
    ...relievers.slice(0, 2)];
  assert.ok(validateRoster(fiveSp).some((issue) => issue.includes("too many starters")), "five starters flagged");
  // Twenty-one cards is not twenty.
  const oversized = fullFormatManager();
  oversized.roster = [...oversized.roster, makeHitter({ id: "fr-extra", name: "Twenty First", position: "C" })];
  assert.ok(validateRoster(oversized).some((issue) => issue.includes("20 cards")), "size is enforced");
  // Classic managers are untouched: a tenth hitter still complains.
  const classic = { name: "C", roster: [...fullFormatRoster().hitters, makeHitter({ id: "extra-c", position: "C" })], lineupAssignments: {} };
  assert.ok(validateRoster(classic).some((issue) => issue.includes("too many")), "classic keeps its complaint");
});

test("the rotation draw is seeded and honors the series cap", () => {
  assert.equal(maxSeriesStarts(3), 1);
  assert.equal(maxSeriesStarts(5), 2);
  assert.equal(maxSeriesStarts(7), 2);
  const draw = (seedPrefix, bestOf, games) => {
    const counts = {};
    const picks = [];
    for (let game = 1; game <= games; game += 1) {
      const pick = pickRandomStarter({
        rng: createRng(`${seedPrefix}:${game}`), starterCount: 4, priorStartCounts: counts, bestOf
      });
      counts[pick] = (counts[pick] ?? 0) + 1;
      picks.push(pick);
    }
    return { picks, counts };
  };
  const bo3 = draw("bo3", 3, 3);
  assert.equal(new Set(bo3.picks).size, 3, "a best-of-3 uses three different arms");
  const bo7 = draw("bo7", 7, 7);
  assert.ok(Math.max(...Object.values(bo7.counts)) <= 2, "no arm starts more than twice in a best-of-7");
  assert.deepEqual(draw("bo7", 7, 7).picks, bo7.picks, "the same seeds draw the same rotation");
});

// ---- In-game substitutions ---------------------------------------------------

function subTeam(prefix, { bench } = {}) {
  return {
    name: prefix.toUpperCase(),
    lineup: strongDefense.lineup.map((player, index) => ({
      ...player,
      id: `${prefix}-h-${index}`,
      name: `${prefix} Hitter ${index}`,
      assignedPosition: ["1B", "2B", "3B", "SS", "C", "LF", "CF", "RF", "DH"][index]
    })),
    pitchers: [{ ...pitcher, id: `${prefix}-p`, name: `${prefix} Pitcher` }],
    bench: bench ?? [
      makeHitter({ id: `${prefix}-bench-0`, name: `${prefix} Bench Bat`, position: "1B", onBase: 14, speed: 20 }),
      makeHitter({ id: `${prefix}-bench-1`, name: `${prefix} Bench Legs`, position: "SS", speed: 20, onBase: 6 })
    ]
  };
}

test("a pinch-hitter replaces the due batter in place, from the seventh on", () => {
  const state = createInitialState(subTeam("away"), subTeam("home"));
  const due = state.away.lineup[0];
  assert.equal(substitutionEligibility(state, "away").allowed, false, "the bench is closed in the first");
  assert.equal(pinchHit(state, "away", "away-bench-0"), null, "and the mutator says no");
  state.inning = SUB_MIN_INNING;
  const lineupBefore = state.away.lineup;
  state.pendingAdvance = { candidates: [] };
  assert.equal(pinchHit(state, "away", "away-bench-0"), null, "a live play blocks the door");
  state.pendingAdvance = null;
  const event = pinchHit(state, "away", "away-bench-0");
  assert.equal(event.type, "pinch-hitter");
  assert.equal(event.out.id, due.id);
  assert.equal(state.away.lineup[0].id, "away-bench-0", "the sub bats in the same spot");
  assert.equal(state.away.lineup.length, 9, "nine men, still");
  assert.notEqual(state.away.lineup, lineupBefore, "the lineup is a NEW array (the relief memo must refresh)");
  assert.equal(state.away.lineup[0].assignedPosition, due.assignedPosition, "he inherits the slot");
  assert.deepEqual(state.removed.away, [due.id], "the man who left is written down");
  assert.equal(availableBench(state, "away").some((card) => card.id === "away-bench-0"), false, "and the sub is off the bench");
  assert.equal(pinchHit(state, "home", "home-bench-0"), null, "the fielding side cannot pinch hit");
});

test("a pinch-runner takes the base, the lineup spot, and the pitcher's tab", () => {
  const state = createInitialState(subTeam("away"), subTeam("home"));
  state.inning = 9;
  const runner = state.away.lineup[3];
  state.bases[0] = { id: runner.id, name: runner.name, speed: runner.speed, responsiblePitcherId: "home-p", responsiblePitcherFresh: true };
  state.stealAttemptsThisPA = [runner.id];
  const event = pinchRun(state, "away", "away-bench-1", 0);
  assert.equal(event.type, "pinch-runner");
  assert.equal(state.bases[0].id, "away-bench-1", "the base changes feet");
  assert.equal(state.bases[0].speed, 20, "and gains the speed");
  assert.equal(state.bases[0].responsiblePitcherId, "home-p", "the run still belongs to the arm that allowed it");
  assert.equal(state.bases[0].responsiblePitcherFresh, true);
  assert.equal(state.away.lineup[3].id, "away-bench-1", "the lineup spot follows");
  assert.ok(state.stealAttemptsThisPA.includes("away-bench-1"), "a spent green light stays spent");
});

test("a defensive replacement changes the glove the engine reads", () => {
  const state = createInitialState(subTeam("away"), subTeam("home"));
  state.inning = 8;
  state.half = "top"; // home fields
  const target = state.home.lineup.find((player) => player.assignedPosition === "SS");
  const glove = makeHitter({ id: "home-glove", name: "Home Glove", position: "SS", fielding: 5 });
  state.home.bench.push({ ...glove });
  const event = defensiveSub(state, "home", "home-glove", target.id);
  assert.equal(event.type, "defensive-sub");
  assert.equal(event.slot, "SS");
  const fielding = state.home.lineup.find((player) => player.id === "home-glove");
  assert.equal(fielding.assignedPosition, "SS");
  assert.equal(fielding.fielding, 5, "his own glove rates the slot");
  const box = buildTeamLine(state);
  assert.ok(box.some((line) => line.id === "home-glove"), "the glove man is in the box score without ever batting");
  assert.equal(defensiveSub(state, "away", "away-bench-0", state.away.lineup[0].id), null, "the batting side cannot field a glove");
});

function buildTeamLine(state) {
  return [...state.stats.hitters.values()].filter((line) => line.side === "home");
}

test("bench gloves rate the slot they inherit, or a flat -1 off their card", () => {
  const ss = makeHitter({ position: "SS", fielding: 4 });
  assert.deepEqual(benchSlotFielding(ss, "SS"), { value: 4, outOfPosition: false });
  assert.deepEqual(benchSlotFielding(ss, "C"), { value: -1, outOfPosition: true }, "a shortstop behind the plate is a -1");
  assert.deepEqual(benchSlotFielding(ss, "DH"), { value: 4, outOfPosition: false }, "the DH slot rates nothing");
  const corner = makeHitter({ position: "LF/RF", fielding: 2 });
  assert.equal(benchSlotFielding(corner, "RF").value, 2, "corners lump, as everywhere");
});

test("the substituted man is out of the game for good", () => {
  const state = createInitialState(subTeam("away"), subTeam("home"));
  state.inning = 7;
  const due = state.away.lineup[0];
  pinchHit(state, "away", "away-bench-0");
  // Put the removed man back on the bench by hand: the ledger still bars him.
  state.away.bench.push({ ...due });
  assert.equal(availableBench(state, "away").some((card) => card.id === due.id), false,
    "a removed man never reads as available");
  assert.equal(pinchHit(state, "away", due.id), null, "and cannot re-enter");
});

// ---- The bench decisions -----------------------------------------------------

const singlesChart = [{ from: 1, to: 20, result: RESULTS.SINGLE }];
const strikeoutChart = [{ from: 1, to: 20, result: RESULTS.SO }];

test("a pinch-hitter fires on a real upgrade at real leverage, and holds otherwise", () => {
  const arm = makePitcher({ control: 4, chart: strikeoutChart });
  const due = makeHitter({ id: "due", onBase: 8, chart: singlesChart, assignedPosition: "DH" });
  const slugger = makeHitter({ id: "slugger", onBase: 14, chart: singlesChart });
  const fired = pinchHitDecision({ bench: [slugger], dueBatter: due, pitcher: arm, leverage: 2, inning: 7, inningsLeftToField: 0 });
  assert.equal(fired?.sub.id, "slugger", "a big upgrade in a big moment fires");
  assert.equal(pinchHitDecision({ bench: [slugger], dueBatter: due, pitcher: arm, leverage: 0.3, inning: 7, inningsLeftToField: 0 }), null,
    "a blowout keeps the bench seated");
  assert.ok(pinchHitDecision({ bench: [slugger], dueBatter: due, pitcher: arm, leverage: 0.3, inning: 9, inningsLeftToField: 0 }),
    "the ninth spends freely");
  // The last bench bat needs to be twice the man before the ninth.
  const modest = makeHitter({ id: "modest", onBase: 9, chart: singlesChart });
  const gain = batterRunsPerPa(modest, arm) - batterRunsPerPa(due, arm);
  const bar = 0.045;
  assert.ok(gain > bar / 1 / 2 && gain < bar * 2, "fixture sanity: a modest, single-bar upgrade");
  assert.ok(pinchHitDecision({ bench: [modest, slugger], dueBatter: due, pitcher: arm, leverage: 1, inning: 8, inningsLeftToField: 0 }),
    "with a bench behind him the modest bar clears");
});

test("the aggressive skipper spends the bench where the balanced one holds", () => {
  const arm = makePitcher({ control: 4, chart: strikeoutChart });
  const due = makeHitter({ id: "due", onBase: 10, chart: singlesChart, assignedPosition: "DH" });
  const slight = makeHitter({ id: "slight", onBase: 11, chart: singlesChart });
  const gain = batterRunsPerPa(slight, arm) - batterRunsPerPa(due, arm);
  assert.ok(gain > 0.045 * 0.8 && gain < 0.045, `fixture sanity: gain ${gain.toFixed(3)} sits between the two bars`);
  assert.equal(pinchHitDecision({ bench: [slight, slight], dueBatter: due, pitcher: arm, leverage: 1, inning: 7, inningsLeftToField: 0, bias: 1 }), null,
    "balanced holds");
  assert.ok(pinchHitDecision({ bench: [slight, slight], dueBatter: due, pitcher: arm, leverage: 1, inning: 7, inningsLeftToField: 0, bias: 0.8 }),
    "aggressive fires");
});

test("fresh legs come on for a slow man whose run matters, late and close", () => {
  const slow = { id: "slow", name: "Slow", speed: 8 };
  const legs = makeHitter({ id: "legs", speed: 20, points: 40 });
  const bat = makeHitter({ id: "bat", speed: 20, points: 400 });
  const fired = pinchRunDecision({ bases: [slow, null, null], bench: [bat, legs], diff: 0, leverage: 2, inning: 8 });
  assert.equal(fired?.sub.id, "legs", "the CHEAPEST bat that runs is the one spent");
  assert.equal(fired?.baseIndex, 0);
  assert.equal(pinchRunDecision({ bases: [slow, null, null], bench: [bat, legs], diff: 0, leverage: 1, inning: 8 }), null,
    "a quiet moment keeps the bench");
  assert.equal(pinchRunDecision({ bases: [slow, null, null], bench: [bat, legs], diff: -4, leverage: 2, inning: 8 }), null,
    "a run that does not matter is not bought");
  assert.equal(pinchRunDecision({ bases: [slow, null, null], bench: [legs], diff: 0, leverage: 2, inning: 8 }), null,
    "the last bench bat is not spent on legs before the ninth");
  assert.ok(pinchRunDecision({ bases: [slow, null, null], bench: [legs], diff: 0, leverage: 2, inning: 9 }),
    "in the ninth he is");
});

test("a glove comes on to protect a lead", () => {
  const shaky = makeHitter({ id: "shaky", position: "SS", assignedPosition: "SS", fielding: 0 });
  const glove = makeHitter({ id: "glove", position: "SS", fielding: 4, onBase: 6 });
  const fired = defensiveSubDecision({ lineup: [shaky], bench: [glove], lead: 2, inning: 8 });
  assert.equal(fired?.sub.id, "glove");
  assert.equal(fired?.targetId, "shaky");
  assert.equal(defensiveSubDecision({ lineup: [shaky], bench: [glove], lead: 0, inning: 8 }), null, "no lead, no protecting");
  assert.equal(defensiveSubDecision({ lineup: [shaky], bench: [glove], lead: 5, inning: 8 }), null, "a blowout needs none");
  assert.equal(defensiveSubDecision({ lineup: [shaky], bench: [glove], lead: 2, inning: 7 }), null, "the eighth is the earliest trip");
});

test("auto play only substitutes for teams that carry a bench", () => {
  const result = simulateGame(teamA, teamB, "no-bench-sim");
  const subTypes = ["pinch-hitter", "pinch-runner", "defensive-sub"];
  assert.equal(result.events.filter((event) => subTypes.includes(event.type)).length, 0,
    "a benchless game never substitutes");
  // And the executor itself declines politely.
  const state = createInitialState(teamA, teamB);
  state.inning = 9;
  assert.equal(autoSubstituteFor(state, "away"), null);
});

// ---- Defensive legality: coverage, double-switches, forfeits -----------------

// Every plate appearance is an out (all-SO pitcher chart beats OB 1 bats),
// so a half-inning is exactly three PAs — the clock these tests need.
function outsOnlyTeam(prefix, bench) {
  const spots = ["1B", "2B", "3B", "SS", "C", "LF", "CF", "RF", "1B"];
  return {
    name: prefix.toUpperCase(),
    lineup: spots.map((pos, index) => makeHitter({
      id: `${prefix}-h-${index}`,
      name: `${prefix} Hitter ${index}`,
      position: pos,
      assignedPosition: index === 8 ? "DH" : pos,
      onBase: 1,
      chart: [{ from: 1, to: 20, result: RESULTS.SO }]
    })),
    pitchers: [makePitcher({ id: `${prefix}-p`, name: `${prefix} Pitcher`, control: 10, chart: [{ from: 1, to: 20, result: RESULTS.SO }] })],
    bench
  };
}

test("a pinch-hitter who strands the defense is refused outside the walk-off spot", () => {
  const bench = () => [makeHitter({ id: "gamble", name: "Gamble Bat", position: "1B", onBase: 14 })];
  const state = createInitialState(outsOnlyTeam("away", bench()), outsOnlyTeam("home", bench()));
  state.inning = 7;
  state.lineupIndex.away = 4; // the catcher is due, and nobody on the bench can catch
  assert.equal(pinchHit(state, "away", "gamble"), null, "the road club may not strand its defense");
  state.inning = 9;
  assert.equal(pinchHit(state, "away", "gamble"), null, "not even in the ninth — it will field again");
});

test("the walk-off gamble: allowed in the bottom of the ninth, forfeited at the turn", () => {
  const bench = () => [makeHitter({ id: "gamble", name: "Gamble Bat", position: "1B", onBase: 14, chart: [{ from: 1, to: 20, result: RESULTS.SO }] })];
  const state = createInitialState(outsOnlyTeam("away", []), outsOnlyTeam("home", bench()));
  state.inning = 9;
  state.half = "bottom";
  state.score = { away: 4, home: 4 };
  state.lineupIndex.home = 4; // the catcher is due
  const event = pinchHit(state, "home", "gamble");
  assert.equal(event?.type, "pinch-hitter", "the home ninth may gamble the defense");
  // The gamble fails: three outs, the inning turns, and the club must field.
  const rng = createRng("walkoff-gamble");
  for (let i = 0; i < 3; i += 1) playPlateAppearance(state, rng);
  assert.equal(state.gameOver, true, "the game is over");
  assert.equal(state.forfeitedBy, "home", "because the home club cannot field");
  assert.equal(state.pendingSubEvents.some((queued) => queued.type === "forfeit"), true, "and the forfeit is announced");
  assert.equal(isGameOver(state), true);
});

test("the double-switch: the bench covers the hole a pinch-hitter left", () => {
  const bench = () => [
    makeHitter({ id: "big-bat", name: "Big Bat", position: "1B", onBase: 14, chart: [{ from: 1, to: 20, result: RESULTS.SO }] }),
    makeHitter({ id: "backup-c", name: "Backup Catcher", position: "C", fielding: 1, onBase: 1, chart: [{ from: 1, to: 20, result: RESULTS.SO }] })
  ];
  const state = createInitialState(outsOnlyTeam("away", []), outsOnlyTeam("home", bench()));
  state.inning = 8;
  state.half = "bottom";
  state.lineupIndex.home = 4;
  assert.equal(pinchHit(state, "home", "big-bat")?.type, "pinch-hitter",
    "legal anywhere: the backup catcher can cover the hole later");
  const rng = createRng("double-switch");
  for (let i = 0; i < 3; i += 1) playPlateAppearance(state, rng);
  assert.equal(state.gameOver, undefined, "no forfeit — the bench covered it");
  const catcher = state.home.lineup.find((player) => player.assignedPosition === "C");
  assert.equal(catcher?.id, "backup-c", "the backup catcher came on at the turn");
  const forced = state.pendingSubEvents.find((queued) => queued.type === "defensive-sub" && queued.forced);
  assert.ok(forced, "the forced switch is announced");
  assert.equal(forced.in.id, "backup-c");
  assert.ok(state.home.lineup.some((player) => player.id === "big-bat"), "the pinch-hitter stays in the game");
  assert.ok(state.removed.home.length >= 2, "the man he hit for AND the man who left for the catcher are out");
});

test("a defensive sub can shuffle the men already out there", () => {
  const flexCf = makeHitter({
    id: "flex-cf", name: "Flex CF", position: "CF",
    positions: [{ pos: "CF", fielding: 2 }, { pos: "LF/RF", fielding: 1 }]
  });
  const home = outsOnlyTeam("home", [makeHitter({ id: "pure-cf", name: "Pure CF", position: "CF", fielding: 3 })]);
  home.lineup[6] = { ...flexCf, assignedPosition: "CF" };
  const state = createInitialState(outsOnlyTeam("away", []), home);
  state.inning = 8;
  state.half = "top"; // home fields
  const leftFielder = state.home.lineup.find((player) => player.assignedPosition === "LF");
  const event = defensiveSub(state, "home", "pure-cf", leftFielder.id);
  assert.equal(event?.type, "defensive-sub", "the pure CF may replace the left fielder");
  const byLabel = (label) => state.home.lineup.find((player) => player.assignedPosition === label)?.id;
  assert.equal(byLabel("CF"), "pure-cf", "he plays center");
  const flexLabel = state.home.lineup.find((player) => player.id === "flex-cf")?.assignedPosition;
  assert.ok(flexLabel === "LF" || flexLabel === "RF", `the corner-capable man slides to a corner (${flexLabel})`);
  // A man nobody can cover for is refused outright — no forfeit door here.
  const ssOnly = makeHitter({ id: "ss-only", name: "SS Only", position: "SS" });
  state.home.bench.push({ ...ssOnly });
  const catcher = state.home.lineup.find((player) => player.assignedPosition === "C");
  assert.equal(defensiveSub(state, "home", "ss-only", catcher.id), null, "a shortstop cannot take the plate gear");
});

test("the CPU never subs its way out of a legal defense", () => {
  const bench = () => [makeHitter({ id: "temptation", name: "Temptation", position: "1B", onBase: 16 })];
  const state = createInitialState(outsOnlyTeam("away", bench()), outsOnlyTeam("home", []));
  state.inning = 9;
  state.half = "top";
  state.lineupIndex.away = 4; // the catcher due, a monster bat on the bench, nobody to cover
  state.bases = [null, { id: "away-h-2", name: "away Hitter 2", speed: 8 }, null];
  assert.equal(autoSubstituteFor(state, "away"), null, "the slugger stays seated");
  assert.equal(state.away.lineup[4].id, "away-h-4", "the catcher stays in the game");
});
