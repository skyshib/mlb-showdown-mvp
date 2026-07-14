import test from "node:test";
import assert from "node:assert/strict";
import { compactChart, RESULTS, resolveChart } from "../src/rules/cards.js";
import { applyDraftAction, assignLineupSlots, autopick, availablePlayers, buildTeam, canPickPlayer, createDraft, currentManager, draftHistory, managerValuation, normalizeCardPosition, pauseSnake, pickPlayer, repairDraftRosters, resumeSnake, snakeClockBankMs, snakeClockEnabled, snakeClockFlagged, snakeTimeRemainingMs, startSnakeClock, sweepRosters, undoLastPick, validateRoster } from "../src/rules/draft.js";
import { createValuationModel, VALUATION_BASE_WEIGHTS, VALUATION_PERTURBATION } from "../src/rules/valuation.js";
import {
  applyDouble,
  applyFlyout,
  applyGroundout,
  applyHomer,
  applySingle,
  applyWalk,
  attemptSteal,
  createInitialState,
  pitcherStatus,
  playGameEvent,
  playPlateAppearance,
  playStealAttempt,
  simulateGame
} from "../src/rules/game.js";
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
  // SPD 18 clears the tightened two-out bar for third (85%) yet stays the
  // shakiest runner, so the forced-20 throw cuts him down while home scores.
  state.bases = [null, { name: "Runner 2", speed: 18 }, { name: "Runner 3", speed: 20 }];

  const runs = applyFlyout(state, makeHitter({ id: "fly-b", name: "Fly Batter" }), "away", "home", { d20: () => 20 });

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
    return pitcherStatus(state, "home").pitcher.name;
  };

  // Fresh, first batter of the game, nothing has happened yet.
  assert.equal(moundIn(1), "Weak Starter", "he is not pulled before he has thrown a pitch");
  assert.equal(moundIn(2), "Weak Starter", "nor in the second");
  // Same staff, same gap, same fatigue — but now his outs are worth nothing.
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

test("a manager who runs out of time keeps drafting — the picks are just made for him", () => {
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
  assert.equal(snakeClockBankMs(draft, ana), 0, "and the increment does not bring her back");

  // Round 2 comes back to her (snake): still flagged, still automatic.
  autopick(draft, late + 1000);
  assert.equal(snakeClockBankMs(draft, ana), 0, "a flagged manager stays flagged");
  assert.equal(snakeClockFlagged(draft, ana, late + 2000), true);
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

test("a starter getting hit around comes out early, tired or not", () => {
  const batteringPractice = {
    name: "Batting Practice",
    lineup: teamB.lineup,
    pitchers: [
      // Fresh as a daisy and utterly hittable.
      makePitcher({ id: "bp", name: "Batting Practice Guy", control: 0, ip: 7 }),
      makePitcher({ id: "good-1", name: "Good Arm", control: 9, ip: 3 }),
      makePitcher({ id: "good-2", name: "Good Arm Two", control: 8, ip: 3 })
    ]
  };
  const state = createInitialState(teamA, batteringPractice);
  // Nobody is tired. The old rule would have let him throw into the seventh.
  state.pitching.home.battersFaced = 0;

  const event = playPlateAppearance(state, repeatingRng(20, 1));

  assert.equal(event.pitcher, "Good Arm", "quality innings in the pen do not sit idle behind a bad start");
  assert.equal(event.fatiguePenalty, 0);
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
