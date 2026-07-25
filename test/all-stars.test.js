import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_STAR_POSITIONS,
  allStarComparisonCandidates,
  buildAllStarDepthChart,
  shouldShowFullAllStarDepth
} from "../src/rules/allStars.js";

function hitter(id, name, assignedPosition) {
  return { id, name, kind: "hitter", assignedPosition };
}

function pitcher(id, name, role) {
  return { id, name, kind: "pitcher", role };
}

test("the simulation All-Star roster picks each positional WPA leader and ranks its depth chart", () => {
  const alphaCatcher = hitter("a-c", "Alpha Catcher", "C");
  const betaCatcher = hitter("b-c", "Beta Catcher", "C");
  const alphaShortstop = hitter("a-ss", "Alpha Shortstop", "SS");
  const betaShortstop = hitter("b-ss", "Beta Shortstop", "SS");
  const alphaStarter = pitcher("a-sp", "Alpha Starter", "SP");
  const betaStarter = pitcher("b-sp", "Beta Starter", "SP");
  const alphaReliever = pitcher("a-rp", "Alpha Reliever", "RP");
  const betaReliever = pitcher("b-rp", "Beta Reliever", "RP");
  const teams = [
    { name: "Alpha", lineup: [alphaCatcher, alphaShortstop], starters: [alphaStarter], bullpen: [alphaReliever] },
    { name: "Beta", lineup: [betaCatcher, betaShortstop], starters: [betaStarter], bullpen: [betaReliever] }
  ];
  const summary = {
    hitters: [
      { id: alphaCatcher.id, name: alphaCatcher.name, team: "Alpha", wpaPer162: 2.4 },
      { id: betaCatcher.id, name: betaCatcher.name, team: "Beta", wpaPer162: 4.1 },
      { id: alphaShortstop.id, name: alphaShortstop.name, team: "Alpha", wpaPer162: 3.2 },
      { id: betaShortstop.id, name: betaShortstop.name, team: "Beta", wpaPer162: 1.2 }
    ],
    pitchers: [
      { id: alphaStarter.id, name: alphaStarter.name, team: "Alpha", wpaPer162: 5.5 },
      { id: betaStarter.id, name: betaStarter.name, team: "Beta", wpaPer162: 4.0 },
      { id: alphaReliever.id, name: alphaReliever.name, team: "Alpha", wpaPer162: 0.2 },
      { id: betaReliever.id, name: betaReliever.name, team: "Beta", wpaPer162: 1.8 }
    ]
  };

  const chart = buildAllStarDepthChart(teams, summary);
  assert.deepEqual(chart.map((slot) => slot.position), ALL_STAR_POSITIONS);
  const catcher = chart.find((slot) => slot.position === "C");
  assert.equal(catcher.leader.name, betaCatcher.name);
  assert.equal(catcher.depth[1].name, alphaCatcher.name);
  assert.equal(catcher.depth[1].rank, 2);
  assert.equal(chart.find((slot) => slot.position === "SS").leader.name, alphaShortstop.name);
  assert.equal(chart.find((slot) => slot.position === "SP").leader.name, alphaStarter.name);
  assert.equal(chart.find((slot) => slot.position === "RP").leader.name, betaReliever.name);
  assert.equal(chart.find((slot) => slot.position === "1B").leader, null);
});

test("small All-Star fields show every challenger while large fields summarize two", () => {
  const depth = Array.from({ length: 7 }, (_, index) => ({ rank: index + 1 }));

  assert.deepEqual(allStarComparisonCandidates(depth.slice(0, 3)).map((row) => row.rank), [2, 3]);
  assert.deepEqual(allStarComparisonCandidates(depth.slice(0, 5)).map((row) => row.rank), [2, 3, 4, 5]);
  assert.deepEqual(allStarComparisonCandidates(depth.slice(0, 6)).map((row) => row.rank), [2, 3]);
  assert.equal(shouldShowFullAllStarDepth(depth.slice(0, 5)), false);
  assert.equal(shouldShowFullAllStarDepth(depth.slice(0, 6)), true);
});
