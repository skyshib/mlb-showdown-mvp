import test from "node:test";
import assert from "node:assert/strict";
import { advanceBreakeven, baseRunValues } from "../src/rules/breakeven.js";

const R = { id: "runner" };
const EMPTY = [null, null, null];

function steal(fromIndex, situation) {
  return advanceBreakeven({
    half: "top",
    inning: 4,
    diff: 0,
    ...situation,
    bases: situation.bases ?? (fromIndex === 0 ? [R, null, null] : [null, R, null]),
    fromIndex,
    toIndex: fromIndex + 1
  });
}

// The run values are the whole model's foundation, and they were derived from
// win probabilities without ever seeing a run expectancy table. That they land
// anywhere near one is the check that the derivation is sound.
test("the base states price themselves in runs, against the run table", () => {
  const values = baseRunValues();

  // 2010-2015 MLB run expectancy, each state against an empty diamond with the
  // same outs. A man on first or second is worth what the run table says he is.
  for (const { outs, code, runs } of [
    { outs: 0, code: 1, runs: 0.378 },
    { outs: 0, code: 2, runs: 0.619 },
    { outs: 1, code: 1, runs: 0.255 },
    { outs: 1, code: 2, runs: 0.410 },
    { outs: 2, code: 1, runs: 0.126 },
    { outs: 2, code: 2, runs: 0.221 }
  ]) {
    const derived = values[outs][code];
    assert.ok(
      Math.abs(derived - runs) < 0.09,
      `${outs} out, base code ${code}: derived ${derived.toFixed(3)} vs ${runs} in the run table`
    );
  }

  // The states that hold a lot of unbanked scoring — a man ninety feet away,
  // a full diamond — come in UNDER their run value, and should. A score edge is
  // money in the bank; a runner is a runner. The win surface pays for the first
  // and only partly for the second, which is the whole reason these are called
  // win-equivalent runs.
  for (const { outs, code, runs } of [
    { outs: 0, code: 4, runs: 0.869 },
    { outs: 0, code: 7, runs: 1.811 },
    { outs: 1, code: 7, runs: 1.287 }
  ]) {
    const derived = values[outs][code];
    assert.ok(derived < runs, `${outs} out, code ${code}: ${derived.toFixed(3)} should sit under ${runs}`);
    assert.ok(derived > runs * 0.6, `${outs} out, code ${code}: ${derived.toFixed(3)} is too deep a discount`);
  }

  assert.equal(values[0][0], 0, "an empty diamond is the zero of the scale");
  for (const outs of [0, 1, 2]) {
    for (let code = 1; code < 8; code += 1) {
      assert.ok(values[outs][code] > values[outs][0], "any man on beats nobody on");
    }
    assert.ok(values[outs][4] > values[outs][2], "third beats second");
    assert.ok(values[outs][2] > values[outs][1], "second beats first");
    assert.ok(values[outs][7] > values[outs][4], "a full diamond beats one man home-ready");
  }
});

test("a stolen base has to work about seven times in ten, the way it always has", () => {
  for (const outs of [0, 1, 2]) {
    const bar = steal(0, { outs });
    assert.ok(bar > 0.6 && bar < 0.8, `${outs} out: ${bar}`);
  }
});

// The two rules the old hand-written matrix was built to encode. Neither is
// written down anywhere now; both fall out of the division.
test("never make the third out at third, and with two down send him home", () => {
  const thirdWithTwoOut = steal(1, { outs: 2 });
  assert.ok(thirdWithTwoOut > 0.85, `two down, stealing third: ${thirdWithTwoOut}`);

  const thirdWithNobodyOut = steal(1, { outs: 0 });
  assert.ok(thirdWithNobodyOut > 0.85, "nobody out, there is a whole inning to cash him in");

  const thirdWithOneOut = steal(1, { outs: 1 });
  assert.ok(thirdWithOneOut < 0.8, `one out is the window: ${thirdWithOneOut}`);

  const homeWithTwoOut = advanceBreakeven({
    half: "top", inning: 4, outs: 2, diff: 0, bases: [null, null, R], fromIndex: 2, toIndex: 3
  });
  assert.ok(homeWithTwoOut < 0.45, `two down, send him: ${homeWithTwoOut}`);

  const homeWithNobodyOut = advanceBreakeven({
    half: "top", inning: 4, outs: 0, diff: 0, bases: [null, null, R], fromIndex: 2, toIndex: 3
  });
  assert.ok(homeWithNobodyOut > homeWithTwoOut + 0.2, "with nobody out he stays put and waits to be driven in");
});

// The thing the static matrix could not say at all.
test("the same runner is a different decision in a different ball game", () => {
  const tie = steal(0, { half: "bottom", inning: 9, outs: 0 });
  const downFour = steal(0, { half: "bottom", inning: 9, outs: 0, diff: -4 });
  assert.notEqual(tie, downFour, "the ninth in a tie is not the ninth down four");

  // Down one in the last of the ninth with two out, a man on second is a
  // different animal from the same man in the second inning: the inning is the
  // ball game, and the base he is standing on is nearly free.
  const lastChance = advanceBreakeven({
    half: "bottom", inning: 9, outs: 2, diff: -1, bases: [null, R, null], fromIndex: 1, toIndex: 2
  });
  const early = advanceBreakeven({
    half: "top", inning: 2, outs: 2, diff: -1, bases: [null, R, null], fromIndex: 1, toIndex: 2
  });
  assert.ok(lastChance < early, `${lastChance} should be a greener light than ${early}`);
});

test("a run in the home ninth ends it, and the break-even knows", () => {
  // Tagging home from third, bottom of the ninth, tied. The run wins the game,
  // so the only thing on the other side of the scale is the out.
  const walkoff = advanceBreakeven({
    half: "bottom", inning: 9, outs: 1, diff: 0, bases: [null, null, R], fromIndex: 2, toIndex: 3
  });
  const sameSpotEarly = advanceBreakeven({
    half: "bottom", inning: 4, outs: 1, diff: 0, bases: [null, null, R], fromIndex: 2, toIndex: 3
  });
  assert.ok(walkoff < sameSpotEarly, `${walkoff} should be greener than ${sameSpotEarly}`);
});

test("a decided game still plays baseball", () => {
  // Thirteen runs up in the third, every outcome wins and the ratio is a zero
  // over a zero. The answer falls back to how the game is played when it counts
  // rather than freezing every runner where he stands.
  const laugher = steal(0, { inning: 3, outs: 0, diff: 13 });
  const tie = steal(0, { inning: 3, outs: 0, diff: 0 });
  assert.equal(laugher, tie, "the blowout borrows the tie game's answer");
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
            [EMPTY.slice(0, 2).concat([R]), 2, 3]
          ]) {
            const bar = advanceBreakeven({ half, inning, outs, diff, bases, fromIndex, toIndex });
            assert.ok(
              Number.isFinite(bar) && bar >= 0 && bar <= 1,
              `${half} ${inning}, ${outs} out, ${diff} runs, ${fromIndex}->${toIndex}: ${bar}`
            );
          }
        }
      }
    }
  }
});
