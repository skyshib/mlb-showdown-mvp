import test from "node:test";
import assert from "node:assert/strict";
import { advanceBreakeven } from "../src/rules/breakeven.js";

const R = "runner";

function bar(situation) {
  return advanceBreakeven({ half: "top", inning: 4, diff: 0, outs: 0, ...situation });
}

const STEAL_SECOND = { bases: [R, null, null], fromIndex: 0, toIndex: 1 };
const STEAL_THIRD = { bases: [null, R, null], fromIndex: 1, toIndex: 2 };
const TAG_HOME = { bases: [null, null, R], fromIndex: 2, toIndex: 3 };

test("a stolen base has to work about seven times in ten, the way it always has", () => {
  for (const outs of [0, 1, 2]) {
    const asked = bar({ ...STEAL_SECOND, outs });
    assert.ok(asked > 0.6 && asked < 0.8, `${outs} out: ${asked}`);
  }
});

// Third base is the one the old hand-written matrix had backwards. Its shape is
// not a slope but a window: with nobody out there is a whole inning to be
// driven in and no need to risk it, with two outs the out ends everything, and
// in between is the one moment the ninety feet are worth having.
test("stealing third is a window at one out, not a slope", () => {
  const [nobodyOut, oneOut, twoOut] = [0, 1, 2].map((outs) => bar({ ...STEAL_THIRD, outs }));
  assert.ok(oneOut < nobodyOut, `one out ${oneOut} should be the greener light over ${nobodyOut}`);
  assert.ok(oneOut < twoOut, `one out ${oneOut} should be the greener light over ${twoOut}`);
  assert.ok(twoOut > 0.85, `never make the third out at third: ${twoOut}`);
  assert.ok(oneOut < 0.7, `one out is the window: ${oneOut}`);
});

test("with two down, send him", () => {
  const twoOut = bar({ ...TAG_HOME, outs: 2 });
  const nobodyOut = bar({ ...TAG_HOME, outs: 0 });
  assert.ok(twoOut < 0.4, `two down, send him: ${twoOut}`);
  assert.ok(nobodyOut > twoOut + 0.4, `with nobody out he waits to be driven in: ${nobodyOut}`);
});

// The thing the static matrix could not say at all.
test("the same runner is a different decision in a different ball game", () => {
  const tied = bar({ ...STEAL_SECOND, inning: 9, outs: 1 });
  const downTwo = bar({ ...STEAL_SECOND, inning: 9, outs: 1, diff: -2 });
  assert.ok(
    downTwo > tied + 0.2,
    `down two in the ninth you need the baserunner, not the base: ${downTwo} vs ${tied}`
  );

  // A run behind is a different game again from two behind: the man on second
  // is the tying run, and he is worth going after.
  const downOne = bar({ ...STEAL_SECOND, inning: 9, outs: 1, diff: -1 });
  assert.ok(downOne < downTwo, `${downOne} should be greener than ${downTwo}`);
});

test("a run in the home ninth ends it, and the break-even knows", () => {
  const walkoff = advanceBreakeven({ half: "bottom", inning: 9, outs: 1, diff: 0, ...TAG_HOME });
  const sameSpotEarly = advanceBreakeven({ half: "bottom", inning: 4, outs: 1, diff: 0, ...TAG_HOME });
  assert.ok(walkoff < sameSpotEarly, `${walkoff} should be greener than ${sameSpotEarly}`);
});

test("a decided game plays like the nearest ball game, not like a tie", () => {
  // Down nine in the ninth every outcome loses, so the ratio has nothing to
  // divide. The answer comes from the nearest score that is still a game — a
  // side that needs baserunners — and NOT from a tie, which would say run.
  const hopeless = bar({ ...STEAL_SECOND, inning: 9, outs: 1, diff: -9 });
  const tied = bar({ ...STEAL_SECOND, inning: 9, outs: 1, diff: 0 });
  const downSome = bar({ ...STEAL_SECOND, inning: 9, outs: 1, diff: -3 });
  assert.ok(hopeless > tied, `a laugher should not read like a tie: ${hopeless} vs ${tied}`);
  assert.ok(Math.abs(hopeless - downSome) < 0.1, `it should read like the game it resembles: ${hopeless} vs ${downSome}`);
});

test("the bar comes down as a deficit closes, and bottoms out at the tie", () => {
  // Behind, outs are dear and a team needs men on base more than it needs them
  // ninety feet further along, so the bar is high and comes down every run it
  // closes. Once ahead it flattens, and never climbs back to what a team a run
  // down is asked for.
  for (const inning of [2, 5, 8]) {
    let previous = 1;
    for (const diff of [-4, -3, -2, -1, 0]) {
      const asked = bar({ ...STEAL_SECOND, inning, diff });
      assert.ok(asked < previous, `inning ${inning}, diff ${diff}: ${asked} did not come down from ${previous}`);
      previous = asked;
    }
    const downOne = bar({ ...STEAL_SECOND, inning, diff: -1 });
    for (const diff of [1, 2, 3, 4]) {
      const ahead = bar({ ...STEAL_SECOND, inning, diff });
      assert.ok(ahead < downOne, `inning ${inning}, up ${diff}: ${ahead} should sit under a run down (${downOne})`);
    }
  }
});

// Late, the tie stops being just another point on the slope. The runner going
// to second in a tie IS the winning run going into scoring position, and no
// lead buys that back — so the bar bottoms there and ticks up on the other
// side. Early it is still a plain slope: in the second inning runs are runs.
test("late in a tie game the go-ahead run is the one worth moving", () => {
  const lateTie = bar({ ...STEAL_SECOND, inning: 8, diff: 0 });
  const lateUpOne = bar({ ...STEAL_SECOND, inning: 8, diff: 1 });
  assert.ok(lateTie < lateUpOne, `eighth inning: tie ${lateTie} should be the greenest light, under ${lateUpOne}`);

  const earlyTie = bar({ ...STEAL_SECOND, inning: 2, diff: 0 });
  const earlyUpOne = bar({ ...STEAL_SECOND, inning: 2, diff: 1 });
  assert.ok(earlyUpOne < earlyTie, `second inning: a lead is simply better, ${earlyUpOne} vs ${earlyTie}`);
});

test("every break-even is a probability, in every state the game can reach", () => {
  for (const half of ["top", "bottom"]) {
    for (let inning = 1; inning <= 12; inning += 1) {
      for (let outs = 0; outs <= 2; outs += 1) {
        for (let diff = -12; diff <= 12; diff += 1) {
          for (const [bases, fromIndex, toIndex] of [
            [[R, null, null], 0, 1],
            [[null, R, null], 1, 2],
            [[R, R, null], 1, 2],
            [[R, null, R], 2, 3],
            [[R, R, R], 2, 3],
            [[null, null, R], 2, 3]
          ]) {
            const asked = advanceBreakeven({ half, inning, outs, diff, bases, fromIndex, toIndex });
            assert.ok(
              Number.isFinite(asked) && asked >= 0 && asked <= 1,
              `${half} ${inning}, ${outs} out, ${diff} runs, ${fromIndex}->${toIndex}: ${asked}`
            );
          }
        }
      }
    }
  }
});
