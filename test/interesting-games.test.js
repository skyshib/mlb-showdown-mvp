import test from "node:test";
import assert from "node:assert/strict";
import {
  considerInterestingGame,
  createInterestingGameState,
  summarizeInterestingGames
} from "../src/rules/interestingGames.js";

function hitter(name, sb = 0, hr = 0) {
  return { id: name, name, sb, hr };
}

function pitcher(name, overrides = {}) {
  return { id: name, name, outs: 27, h: 8, bb: 2, so: 6, ...overrides };
}

function game({
  awayRuns,
  homeRuns,
  events = [],
  awayHitters = [hitter("Away bat")],
  homeHitters = [hitter("Home bat")],
  awayPitchers = [pitcher("Away arm")],
  homePitchers = [pitcher("Home arm")]
}) {
  const away = { name: "Away", runs: awayRuns };
  const home = { name: "Home", runs: homeRuns };
  return {
    away,
    home,
    winner: awayRuns > homeRuns ? away.name : home.name,
    events,
    boxScore: {
      away: { team: away.name, runs: awayRuns, hitters: awayHitters, pitchers: awayPitchers },
      home: { team: home.name, runs: homeRuns, hitters: homeHitters, pitchers: homePitchers }
    }
  };
}

test("interesting-game shelves keep the top three across varied game stories", () => {
  const state = createInterestingGameState();
  considerInterestingGame(state, game({
    awayRuns: 10,
    homeRuns: 9,
    events: [{ inning: 9, half: "top", batter: "Slugger", result: "HR", wpa: 0.4, scoreAfter: { away: 10, home: 9 } }],
    awayHitters: [hitter("Runner", 1, 5)],
    homeHitters: [hitter("Home slugger", 0, 2)]
  }), 0);
  considerInterestingGame(state, game({
    awayRuns: 4,
    homeRuns: 5,
    events: [
      { inning: 4, half: "top", batter: "Visitor", result: "2B", wpa: 0.2, scoreAfter: { away: 3, home: 0 } },
      { inning: 11, half: "bottom", batter: "Hero", result: "HR", wpa: -0.65, scoreAfter: { away: 4, home: 5 } }
    ],
    homeHitters: [hitter("Thief", 4)]
  }), 1);
  considerInterestingGame(state, game({
    awayRuns: 1,
    homeRuns: 0,
    events: [{ inning: 9, half: "bottom", batter: "Last out", result: "SO", wpa: 0.1, scoreAfter: { away: 1, home: 0 } }],
    awayPitchers: [pitcher("Perfect Pat", { h: 0, bb: 0, so: 12 })]
  }), 2);
  considerInterestingGame(state, game({
    awayRuns: 7,
    homeRuns: 6,
    events: [{ inning: 9, half: "bottom", batter: "Final batter", result: "GB", wpa: -0.2, scoreAfter: { away: 7, home: 6 } }]
  }), 3);
  considerInterestingGame(state, game({
    awayRuns: 6,
    homeRuns: 5,
    events: [{ inning: 9, half: "bottom", batter: "Final batter", result: "FB", wpa: -0.15, scoreAfter: { away: 6, home: 5 } }]
  }), 4);

  const summary = summarizeInterestingGames(state);
  const leader = (category) => summary.find((entry) => entry.categoryKey === category);
  const highestScoring = summary.filter((entry) => entry.categoryKey === "highestScoring");
  assert.deepEqual(highestScoring.map((entry) => entry.index), [0, 3, 4]);
  assert.deepEqual(highestScoring.map((entry) => entry.place), [1, 2, 3]);
  for (const category of new Set(summary.map((entry) => entry.categoryKey))) {
    assert.ok(summary.filter((entry) => entry.categoryKey === category).length <= 3);
  }
  assert.equal(leader("highestScoring").index, 0);
  assert.equal(leader("biggestComeback").index, 1);
  assert.equal(leader("biggestComeback").value, 3);
  assert.equal(leader("biggestWpaSwing").index, 1);
  assert.equal(leader("mostLeadChanges").index, 1);
  assert.equal(leader("walkOff").index, 1);
  assert.equal(leader("mostHomeRuns").index, 0);
  assert.equal(leader("mostSteals").index, 1);
  assert.equal(leader("longestGame").index, 1);
  assert.equal(leader("pitchingGem").index, 2);
  assert.equal(leader("pitchingGem").label, "Perfect game");
  assert.match(leader("pitchingGem").note, /Perfect Pat/);
});
