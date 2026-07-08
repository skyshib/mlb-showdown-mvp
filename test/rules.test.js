import test from "node:test";
import assert from "node:assert/strict";
import { compactChart, RESULTS, resolveChart } from "../src/rules/cards.js";
import { assignLineupSlots, autopick, buildTeam, canPickPlayer, createDraft, currentManager, draftHistory, managerValuation, normalizeCardPosition, pickPlayer, repairDraftRosters, undoLastPick, validateRoster } from "../src/rules/draft.js";
import { createValuationModel, VALUATION_BASE_WEIGHTS, VALUATION_PERTURBATION } from "../src/rules/valuation.js";
import { applyDouble, applyFlyout, applyGroundout, applyHomer, applySingle, applyWalk, attemptSteal, createInitialState, playGameEvent, playPlateAppearance, playStealAttempt, simulateGame } from "../src/rules/game.js";
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

const teamA = {
  name: "A",
  lineup: Array.from({ length: 9 }, (_, index) => ({ ...hitter, id: `a-h-${index}`, name: `A Hitter ${index}` })),
  pitchers: [{ ...pitcher, id: "a-p", name: "A Pitcher" }]
};

const teamB = {
  name: "B",
  lineup: Array.from({ length: 9 }, (_, index) => ({ ...hitter, id: `b-h-${index}`, name: `B Hitter ${index}` })),
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
  state.bases = [{ name: "Runner 1", speed: 12 }, null, null];

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
  assert.equal(state.stats.hitters.get("away:a-h-0").sb, 1);
});

test("stealing third fights the shorter throw: +5 to the catcher, not the runner", () => {
  const state = createInitialState(teamA, strongCatcherDefense);
  state.outs = 1;
  state.bases = [null, { name: "Runner 2", speed: 15 }, null];

  // The penalized odds fall below the decision matrix, so the auto-runner
  // now declines this jump...
  assert.equal(playStealAttempt(state, { d20: () => 16 }), null);

  // ...but a forced attempt shows the penalized target and pays for it.
  const event = attemptSteal(state, 1, { d20: () => 16 });

  assert.equal(event.result, "CS");
  assert.equal(event.outsAfter, 2);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(event.playDetails.stealAttempt.fielding, 5);
  assert.equal(event.playDetails.stealAttempt.target, 10);
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
  state.bases = [{ name: "Runner 1", speed: 14 }, null, null];

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

  const runs = applyFlyout(state, "away", "home", { d20: () => 17 });

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

  const runs = applyFlyout(state, "away", "home", { d20: () => 11 });

  assert.equal(runs, 1);
  assert.equal(state.outs, 2);
  assert.equal(state.lastPlayDetails.thrownAttempt.outsForDecision, 2);
  assert.equal(state.lastPlayDetails.thrownAttempt.safeChance, 0.55);
});

test("flyout does not allow tag-up when the catch is the third out", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 2;
  state.bases = [null, null, { name: "Runner 3", speed: 20 }];

  const runs = applyFlyout(state, "away", "home", { d20: () => 1 });

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

  const runs = applyFlyout(state, "away", "home", { d20: () => 20 });

  assert.equal(runs, 0);
  assert.equal(state.outs, 3);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(state.lastPlayDetails.thrownAttempt.safe, false);
  assert.equal(state.lastPlayDetails.thrownAttempt.total, 20);
});

test("runner tagging home scores when defense throws out another tag-up for the third out", () => {
  const state = createInitialState(teamA, weakDefense);
  state.outs = 1;
  // SPD 18 clears the tightened two-out bar for third (85%) yet stays the
  // shakiest runner, so the forced-20 throw cuts him down while home scores.
  state.bases = [null, { name: "Runner 2", speed: 18 }, { name: "Runner 3", speed: 20 }];

  const runs = applyFlyout(state, "away", "home", { d20: () => 20 });

  assert.equal(runs, 1);
  assert.equal(state.score.away, 1);
  assert.equal(state.outs, 3);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(state.lastPlayDetails.thrownAttempt.runner, "Runner 2");
  assert.equal(state.lastPlayDetails.thrownAttempt.safe, false);
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

test("bullpen follows low-control to high-control order after starter target", () => {
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
  state.pitching.home.outsRecorded = 18;

  const event = playPlateAppearance(state, repeatingRng(20, 1));

  assert.equal(event.pitcher, "Low RP");
  assert.equal(event.fatiguePenalty, 0);
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
  state.bases = [null, { name: "Inherited Runner", speed: 12, responsiblePitcherId: "starter" }, null];

  const runs = applyDouble(state, hitter, "away", "home", null, state.home.pitchers[1]);

  assert.equal(runs, 1);
  assert.equal(state.stats.pitchers.get("home:starter").r, 1);
  assert.equal(state.stats.pitchers.get("home:reliever")?.r ?? 0, 0);
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

test("repairDraftRosters adds emergency hitter when a required position is exhausted", () => {
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
  assert.ok(draft.managers[0].roster.some((player) => player.id.startsWith("emergency-h-") && player.position === "3B"));
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
