import test from "node:test";
import assert from "node:assert/strict";
import { winExpectancy, WIN_EXPECTANCY_MAX_DIFF } from "../src/data/winExpectancy.js";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { autopick, buildTeam, createDraft } from "../src/rules/draft.js";
import { createInitialState, winProbabilityHome } from "../src/rules/game.js";

const EMPTY = [null, null, null];

test("table matches well-known MLB win expectancy landmarks", () => {
  const gameStart = winExpectancy({ half: "top", inning: 1, outs: 0, bases: EMPTY, diff: 0 });
  assert.ok(gameStart > 0.44 && gameStart < 0.48, `visitors open around 46%, got ${gameStart}`);

  const bottomNineTied = winExpectancy({ half: "bottom", inning: 9, outs: 0, bases: EMPTY, diff: 0 });
  assert.ok(bottomNineTied > 0.6 && bottomNineTied < 0.72, `bottom 9 tied is a big home edge, got ${bottomNineTied}`);

  const downOneLastOut = winExpectancy({ half: "bottom", inning: 9, outs: 2, bases: EMPTY, diff: -1 });
  assert.ok(downOneLastOut < 0.08, `down one with two outs in the 9th is dire, got ${downOneLastOut}`);
});

test("win expectancy is monotone in score differential", () => {
  for (const half of ["top", "bottom"]) {
    for (const inning of [1, 5, 9, 12]) {
      for (const outs of [0, 1, 2]) {
        let previous = 0;
        for (let diff = -WIN_EXPECTANCY_MAX_DIFF; diff <= WIN_EXPECTANCY_MAX_DIFF; diff += 1) {
          const p = winExpectancy({ half, inning, outs, bases: EMPTY, diff });
          assert.ok(p >= previous - 1e-9, `${half} ${inning} ${outs} diff ${diff}: ${p} < ${previous}`);
          previous = p;
        }
      }
    }
  }
});

test("more outs never help the batting team", () => {
  for (const inning of [3, 7, 9]) {
    for (const diff of [-2, 0, 2]) {
      const [zero, one, two] = [0, 1, 2].map((outs) =>
        winExpectancy({ half: "bottom", inning, outs, bases: ["r", null, null], diff })
      );
      assert.ok(zero >= one - 1e-9 && one >= two - 1e-9, `bottom ${inning} diff ${diff}: ${zero}, ${one}, ${two}`);
    }
  }
});

function draftState(seed) {
  const managers = ["Team 1", "Team 2"];
  const pool = generatePlayerPool(`${seed}-pool`, 4, 13);
  const draft = createDraft(managers, pool, 13, seed);
  while (!draft.complete) autopick(draft);
  const teams = draft.managers.map((manager) => buildTeam(manager));
  return createInitialState(teams[0], teams[1]);
}

test("a mid-half away lead in extras is not treated as game over", () => {
  const state = draftState("wpx-extras");
  state.inning = 10;
  state.half = "top";
  state.outs = 1;
  state.score = { away: 4, home: 3 };
  const wp = winProbabilityHome(state);
  assert.ok(wp > 0 && wp < 0.5, `home still bats in the bottom 10th, got ${wp}`);
});

test("a completed bottom half in extras with a lead is decided", () => {
  const state = draftState("wpx-final");
  state.inning = 10;
  state.half = "bottom";
  state.outs = 3;
  state.score = { away: 5, home: 3 };
  assert.equal(winProbabilityHome(state), 0, "away wins once the bottom 10th is in the books");
});
