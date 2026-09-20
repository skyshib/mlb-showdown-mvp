import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_STAR_POSITIONS,
  allStarComparisonCandidates,
  buildAllStarDepthChart,
  buildWpaaIndex,
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

test("All-Stars rank on WPAR when the sim measured it and keep WPA alongside", () => {
  const alphaCatcher = hitter("a-c", "Alpha Catcher", "C");
  const betaCatcher = hitter("b-c", "Beta Catcher", "C");
  const teams = [
    { name: "Alpha", lineup: [alphaCatcher] },
    { name: "Beta", lineup: [betaCatcher] }
  ];
  const lines = [
    { id: alphaCatcher.id, name: alphaCatcher.name, team: "Alpha", wpaPer162: 1.0, warPer162: { total: 3.5 } },
    { id: betaCatcher.id, name: betaCatcher.name, team: "Beta", wpaPer162: 4.0, warPer162: { total: 0.5 } }
  ];

  const byWpa = buildAllStarDepthChart(teams, { hitters: lines, pitchers: [] }).find((slot) => slot.position === "C");
  assert.equal(byWpa.leader.name, betaCatcher.name, "a sim without attribution still ranks on WPA");

  const byWpar = buildAllStarDepthChart(teams, { attribution: true, hitters: lines, pitchers: [] }).find((slot) => slot.position === "C");
  assert.equal(byWpar.leader.name, alphaCatcher.name);
  assert.equal(byWpar.leader.wparPer162, 3.5);
  assert.equal(byWpar.leader.wpaPer162, 1.0);
});

test("small All-Star fields show every challenger while large fields summarize two", () => {
  const depth = Array.from({ length: 7 }, (_, index) => ({ rank: index + 1 }));

  assert.deepEqual(allStarComparisonCandidates(depth.slice(0, 3)).map((row) => row.rank), [2, 3]);
  assert.deepEqual(allStarComparisonCandidates(depth.slice(0, 5)).map((row) => row.rank), [2, 3, 4, 5]);
  assert.deepEqual(allStarComparisonCandidates(depth.slice(0, 6)).map((row) => row.rank), [2, 3]);
  assert.equal(shouldShowFullAllStarDepth(depth.slice(0, 5)), false);
  assert.equal(shouldShowFullAllStarDepth(depth.slice(0, 6)), true);
});

test("left and right field pool into one LF/RF shelf", () => {
  const alphaLeft = hitter("a-lf", "Alpha Left", "LF");
  const alphaRight = hitter("a-rf", "Alpha Right", "RF");
  const betaLeft = hitter("b-lf", "Beta Left", "RF");
  const teams = [
    { name: "Alpha", lineup: [alphaLeft, alphaRight] },
    { name: "Beta", lineup: [betaLeft] }
  ];
  const summary = {
    hitters: [
      { id: alphaLeft.id, name: alphaLeft.name, team: "Alpha", wpaPer162: 1.0 },
      { id: alphaRight.id, name: alphaRight.name, team: "Alpha", wpaPer162: 3.0 },
      { id: betaLeft.id, name: betaLeft.name, team: "Beta", wpaPer162: 2.0 }
    ],
    pitchers: []
  };

  const chart = buildAllStarDepthChart(teams, summary);
  assert.equal(chart.filter((slot) => slot.position === "LF/RF").length, 1, "one corner shelf, not one per corner");
  assert.equal(chart.some((slot) => slot.position === "LF" || slot.position === "RF"), false);
  const corners = chart.find((slot) => slot.position === "LF/RF");
  assert.deepEqual(corners.depth.map((candidate) => candidate.name), ["Alpha Right", "Beta Left", "Alpha Left"]);
  assert.equal(corners.leader.name, "Alpha Right");
});

test("WPAA reads WPAR against the average of the position's rostered cards", () => {
  const alphaCatcher = hitter("a-c", "Alpha Catcher", "C");
  const betaCatcher = hitter("b-c", "Beta Catcher", "C");
  const alphaLeft = hitter("a-lf", "Alpha Left", "LF");
  const betaRight = hitter("b-rf", "Beta Right", "RF");
  const alphaStarter = pitcher("a-sp", "Alpha Starter", "SP");
  const betaStarter = pitcher("b-sp", "Beta Starter", "SP");
  const teams = [
    { name: "Alpha", lineup: [alphaCatcher, alphaLeft], starters: [alphaStarter], bullpen: [] },
    { name: "Beta", lineup: [betaCatcher, betaRight], starters: [betaStarter], bullpen: [] }
  ];
  // A bench catcher who got into games but never held the roster spot: he is
  // measured against the same catcher average without moving it.
  const benchCatcher = { id: "b-c2", name: "Beta Backup", team: "Beta", position: "C", warPer162: { total: -1.0 } };
  const summary = {
    attribution: true,
    hitters: [
      { id: alphaCatcher.id, name: alphaCatcher.name, team: "Alpha", warPer162: { total: 3.0 } },
      { id: betaCatcher.id, name: betaCatcher.name, team: "Beta", warPer162: { total: 1.0 } },
      { id: alphaLeft.id, name: alphaLeft.name, team: "Alpha", warPer162: { total: 5.0 } },
      { id: betaRight.id, name: betaRight.name, team: "Beta", warPer162: { total: 1.0 } },
      benchCatcher
    ],
    pitchers: [
      { id: alphaStarter.id, name: alphaStarter.name, team: "Alpha", role: "SP", warPer162: { total: 8.0 } },
      { id: betaStarter.id, name: betaStarter.name, team: "Beta", role: "SP", warPer162: { total: 4.0 } }
    ]
  };

  const index = buildWpaaIndex(teams, summary);
  assert.equal(index.averages.get("C"), 2.0, "the bench catcher stays out of the average");
  assert.equal(index.averages.get("LF/RF"), 3.0, "both corners average together");
  assert.equal(index.averages.get("SP"), 6.0);
  assert.equal(index.wpaaByPlayerId.get(alphaCatcher.id), 1.0);
  assert.equal(index.wpaaByPlayerId.get(betaCatcher.id), -1.0);
  assert.equal(index.wpaaByPlayerId.get(benchCatcher.id), -3.0);
  assert.equal(index.wpaaByPlayerId.get(alphaLeft.id), 2.0);
  assert.equal(index.wpaaByPlayerId.get(betaRight.id), -2.0);
  assert.equal(index.wpaaByPlayerId.get(alphaStarter.id), 2.0);
  // A position's rostered cards are average by construction: their WPAA sums to zero.
  const corners = [alphaLeft.id, betaRight.id].reduce((sum, id) => sum + index.wpaaByPlayerId.get(id), 0);
  assert.ok(Math.abs(corners) < 1e-9);
  assert.equal(index.wpaaFor({ id: "nobody" }), null);
});

test("a sim that never measured WPAR has no WPAA to show", () => {
  const catcher = hitter("a-c", "Alpha Catcher", "C");
  const teams = [{ name: "Alpha", lineup: [catcher] }];
  const summary = { hitters: [{ id: catcher.id, name: catcher.name, team: "Alpha", wpaPer162: 2.0 }], pitchers: [] };

  assert.equal(buildWpaaIndex(teams, summary), null);
});

test("the Not-tired split measures WPAA against its own averages", () => {
  const alphaStarter = pitcher("a-sp", "Alpha Starter", "SP");
  const betaStarter = pitcher("b-sp", "Beta Starter", "SP");
  const teams = [
    { name: "Alpha", lineup: [], starters: [alphaStarter], bullpen: [] },
    { name: "Beta", lineup: [], starters: [betaStarter], bullpen: [] }
  ];
  const summary = {
    attribution: true,
    hitters: [],
    pitchers: [
      { id: alphaStarter.id, name: alphaStarter.name, team: "Alpha", role: "SP", warPer162: { total: 8.0 }, fresh: { warPer162: { total: 5.0 } } },
      { id: betaStarter.id, name: betaStarter.name, team: "Beta", role: "SP", warPer162: { total: 4.0 }, fresh: { warPer162: { total: 3.0 } } }
    ]
  };

  const fresh = buildWpaaIndex(teams, summary, { value: (line) => line.fresh?.warPer162?.total });
  assert.equal(fresh.averages.get("SP"), 4.0);
  assert.equal(fresh.wpaaByPlayerId.get(alphaStarter.id), 1.0);
  assert.equal(fresh.wpaaByPlayerId.get(betaStarter.id), -1.0);
});
