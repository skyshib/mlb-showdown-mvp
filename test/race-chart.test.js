import test from "node:test";
import assert from "node:assert/strict";
import { renderRaceChart } from "../src/ui/render.js";

const RACE = {
  teamNames: ["Kasey", "Milo", "Nico", "Rafa"],
  totalRuns: 100,
  series: [
    { n: 5, shares: [0.4, 0.2, 0.2, 0.2] },
    { n: 50, shares: [0.3, 0.3, 0.2, 0.2] },
    { n: 100, shares: [0.31, 0.29, 0.22, 0.18] }
  ]
};

test("renderRaceChart draws a polyline per team with end labels", () => {
  const svg = renderRaceChart(RACE);
  assert.match(svg, /<svg /);
  assert.equal((svg.match(/<polyline /g) ?? []).length, RACE.teamNames.length);
  for (const name of RACE.teamNames) {
    assert.ok(svg.includes(name), `${name} labeled`);
  }
  assert.ok(svg.includes("even draft (25%)"));
});

test("renderRaceChart escapes team names", () => {
  const svg = renderRaceChart({
    teamNames: ["<b>Sam</b>", "Ana"],
    totalRuns: 10,
    series: [
      { n: 2, shares: [0.5, 0.5] },
      { n: 10, shares: [0.6, 0.4] }
    ]
  });
  assert.ok(!svg.includes("<b>Sam</b>"));
  assert.ok(svg.includes("&lt;b&gt;Sam&lt;/b&gt;"));
});

test("renderRaceChart shows a placeholder until there is enough data", () => {
  assert.match(renderRaceChart({ teamNames: [], series: [] }), /Waiting for the first seasons/);
  assert.match(renderRaceChart({ teamNames: ["A"], series: [{ n: 1, shares: [1] }] }), /Waiting for the first seasons/);
});
