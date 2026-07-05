import test from "node:test";
import assert from "node:assert/strict";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { autopick, buildTeam, createDraft } from "../src/rules/draft.js";
import { simulateGame, winProbabilityHome, createInitialState } from "../src/rules/game.js";

function draftTeams(seed, teamCount = 4) {
  const managers = Array.from({ length: teamCount }, (_, index) => `Team ${index + 1}`);
  const pool = generatePlayerPool(`${seed}-pool`, teamCount * 2, 13);
  const draft = createDraft(managers, pool, 13, seed);
  while (!draft.complete) autopick(draft);
  return draft.managers.map((manager) => buildTeam(manager));
}

function playGame(seed) {
  const teams = draftTeams(seed, 2);
  return simulateGame(teams[0], teams[1], seed);
}

test("win probability starts near a coin flip and telescopes event to event", () => {
  const result = playGame("wpa-telescope");

  assert.ok(result.events[0].wpBefore > 0.35 && result.events[0].wpBefore < 0.65);
  for (let index = 1; index < result.events.length; index += 1) {
    assert.ok(
      Math.abs(result.events[index].wpBefore - result.events[index - 1].wpAfter) < 1e-9,
      `event ${index} win probability chains from the previous event`
    );
  }
  for (const event of result.events) {
    assert.ok(event.wpBefore >= 0 && event.wpBefore <= 1);
    assert.ok(event.wpAfter >= 0 && event.wpAfter <= 1);
  }
});

test("the final event lands on the actual winner", () => {
  for (const seed of ["wpa-final-1", "wpa-final-2", "wpa-final-3"]) {
    const result = playGame(seed);
    const last = result.events[result.events.length - 1];
    const homeWon = result.winner === result.home.name;
    assert.equal(last.wpAfter, homeWon ? 1 : 0, seed);
  }
});

test("every game settles the winner's full pregame win probability gap", () => {
  const teams = draftTeams("wpa-settlement", 2);
  for (let index = 0; index < 40; index += 1) {
    const result = simulateGame(teams[0], teams[1], `wpa-settlement-${index}`);
    const homeWon = result.winner === result.home.name;
    const box = homeWon ? result.boxScore.home : result.boxScore.away;
    const net = [...box.hitters, ...box.pitchers].reduce((sum, line) => sum + (line.wpa ?? 0), 0);
    // The MLB win-expectancy table opens with real home-field advantage, so
    // the winner's net WPA is the distance from that prior to a sure win —
    // not a symmetric 0.5.
    const pregame = result.events[0].wpBefore;
    const expected = homeWon ? 1 - pregame : pregame;
    assert.ok(Math.abs(net - expected) < 1e-9, `game ${index}: winner net WPA ${net} should be ${expected}`);

    // Per docs/rules.md the away team can only win after a completed inning,
    // never by ending the game mid-half in extras.
    const last = result.events[result.events.length - 1];
    if (!homeWon) {
      assert.ok(
        last.half === "bottom" && last.outsAfter >= 3,
        `game ${index}: away win must come after a completed bottom half`
      );
    }
  }
});

test("player WPA is zero-sum between offense and defense", () => {
  const result = playGame("wpa-zero-sum");
  const lines = [
    ...result.boxScore.away.hitters,
    ...result.boxScore.home.hitters,
    ...result.boxScore.away.pitchers,
    ...result.boxScore.home.pitchers
  ];
  const total = lines.reduce((sum, line) => sum + (line.wpa ?? 0), 0);
  assert.ok(Math.abs(total) < 1e-9, `total WPA ${total} should cancel out`);
});

test("runs scored by hitters account for every run in the game", () => {
  const result = playGame("wpa-runs");
  const hitterRuns = [...result.boxScore.away.hitters, ...result.boxScore.home.hitters]
    .reduce((sum, line) => sum + (line.r ?? 0), 0);
  assert.equal(hitterRuns, result.away.runs + result.home.runs);
});

test("the top swing is the biggest single positive event in the game", () => {
  const result = playGame("wpa-top-swing");
  assert.ok(result.topSwing);
  const maxDelta = Math.max(...result.events.map((event) => event.wpa));
  assert.ok(Math.abs(result.topSwing.wpa - maxDelta) < 1e-9);
});

test("winProbabilityHome respects terminal and dominant states", () => {
  const teams = draftTeams("wpa-states", 2);
  const state = createInitialState(teams[0], teams[1]);

  state.inning = 9;
  state.half = "bottom";
  state.score = { away: 3, home: 4 };
  assert.equal(winProbabilityHome(state), 1, "home ahead in the bottom 9th is a walk-off state");

  state.score = { away: 5, home: 1 };
  state.outs = 3;
  assert.equal(winProbabilityHome(state), 0, "down four after the bottom of the 9th is a loss");

  state.inning = 5;
  state.half = "top";
  state.outs = 0;
  state.score = { away: 0, home: 8 };
  const bigLead = winProbabilityHome(state);
  assert.ok(bigLead > 0.95, `an eight-run lead in the 5th should be near certain, got ${bigLead}`);
});

test("extra innings stay live until the home team has batted", () => {
  const teams = draftTeams("wpa-extras", 2);
  const state = createInitialState(teams[0], teams[1]);

  state.inning = 10;
  state.half = "top";
  state.outs = 0;
  state.score = { away: 1, home: 0 };
  const awayLeadTop10 = winProbabilityHome(state);
  assert.ok(
    awayLeadTop10 > 0.02 && awayLeadTop10 < 0.45,
    `home still bats in the bottom of the 10th, got ${awayLeadTop10}`
  );

  state.score = { away: 0, home: 0 };
  const tiedTop10 = winProbabilityHome(state);
  assert.ok(tiedTop10 > 0.35 && tiedTop10 < 0.65, `tied extras stay near a coin flip, got ${tiedTop10}`);
  assert.ok(awayLeadTop10 < tiedTop10, "an away lead must cost the home team win probability");

  state.half = "bottom";
  state.outs = 3;
  state.score = { away: 1, home: 0 };
  assert.equal(winProbabilityHome(state), 0, "down one after the bottom of the 10th is a loss");

  state.outs = 1;
  state.score = { away: 0, home: 1 };
  assert.equal(winProbabilityHome(state), 1, "leading in the bottom of the 10th is a walk-off state");
});
