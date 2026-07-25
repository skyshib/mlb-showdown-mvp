import test from "node:test";
import assert from "node:assert/strict";
import {
  considerInterestingGame,
  createInterestingGameState,
  summarizeInterestingGames
} from "../src/rules/interestingGames.js";

function hitter(name, sb = 0) {
  return { id: name, name, sb };
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

test("interesting-game leaders cover scoring, comebacks, WPA, steals, length, and pitching gems", () => {
  const state = createInterestingGameState();
  considerInterestingGame(state, game({
    awayRuns: 10,
    homeRuns: 9,
    events: [{ inning: 9, half: "top", batter: "Slugger", result: "HR", wpa: 0.4, scoreAfter: { away: 10, home: 9 } }],
    awayHitters: [hitter("Runner", 1)]
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

  const leaders = new Map(summarizeInterestingGames(state).map((entry) => [entry.label, entry]));
  assert.equal(leaders.get("Highest scoring").index, 0);
  assert.equal(leaders.get("Biggest comeback").index, 1);
  assert.equal(leaders.get("Biggest comeback").value, 3);
  assert.equal(leaders.get("Biggest WPA swing").index, 1);
  assert.equal(leaders.get("Most steals").index, 1);
  assert.equal(leaders.get("Longest game").index, 1);
  assert.equal(leaders.get("Perfect game").index, 2);
  assert.match(leaders.get("Perfect game").note, /Perfect Pat/);
});
