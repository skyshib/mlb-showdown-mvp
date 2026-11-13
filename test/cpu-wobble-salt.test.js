// THE PLACEBO'S ONE REAL JOB, DONE IN A SECOND INSTEAD OF AN HOUR.
//
// The shipped bidder gives every manager a private per-card bid multiplier —
// `aggressionFloor + rng() * aggressionSpan`, keyed on (draft seed, manager,
// card) — so two identical CPUs with the same money and the same board do not
// arrive at the same number and tie on every lot.
//
// The `jiggle` fixture salts that key, so one manager draws a DIFFERENT set of
// multipliers from the SAME distribution. Every manager already carries their
// own independent wobble, so re-rolling one does not make him any more
// different from the rest than he already was: it swaps one arbitrary draw for
// another, and the expected effect is zero by symmetry.
//
// Which leaves exactly one way it could go wrong, and it is a property of the
// random number generator rather than of drafting: if the hash behind
// createRng responded badly to a longer key, the salted manager could draw
// from a SHIFTED distribution and bid systematically higher or lower. That
// would put a constant offset under every candidate and no confidence interval
// would reveal it.
//
// This test is that check. Running `jiggle` across the grid was the same check
// done by simulation, at about forty-five minutes a pass — and it could not
// even see the nineteen snake rooms, because the wobble is auction-only. The
// spread it also showed is already inside every measurement's error bars: the
// wobble is on for every manager in every league, so its variation is part of
// what the intervals are made of.

import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "../src/rules/rng.js";
import { CPU_TUNABLE_DEFAULTS } from "../src/rules/cpuTunables.js";

const { aggressionFloor: FLOOR, aggressionSpan: SPAN } = CPU_TUNABLE_DEFAULTS;

function multipliers(salt) {
  const out = [];
  for (let manager = 0; manager < 40; manager += 1) {
    for (let card = 0; card < 400; card += 1) {
      out.push(FLOOR + createRng(`seed:bid:T${manager}:card${card}${salt}`).next() * SPAN);
    }
  }
  return out;
}

const summarize = (values) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
  return { mean, sd, se: sd / Math.sqrt(values.length) };
};

test("salting the wobble re-rolls it without shifting the distribution", () => {
  const plain = summarize(multipliers(""));
  const salted = summarize(multipliers(":placebo"));

  // Same distribution: the salt must not move the mean bid.
  const gap = Math.abs(salted.mean - plain.mean);
  const band = 1.96 * Math.sqrt(plain.se ** 2 + salted.se ** 2);
  assert.ok(gap < band, `the salt shifts the mean multiplier by ${gap.toFixed(5)}, outside ±${band.toFixed(5)}. `
    + "A salted manager would bid systematically differently rather than merely differently, "
    + "which puts a constant offset under every candidate the bench measures.");

  // ...and must not change its width either.
  assert.ok(Math.abs(salted.sd - plain.sd) < 0.1 * plain.sd,
    `the salt changes the spread of the multiplier: ${plain.sd.toFixed(5)} -> ${salted.sd.toFixed(5)}`);

  // It does have to actually re-roll, or it is not a placebo at all — which is
  // what the old `aggressionFloor: 0.8601` version failed at, moving 0 of 8
  // rosters at four seats.
  const moved = multipliers("").filter((v, i) => v !== multipliers(":placebo")[i]).length;
  assert.ok(moved > 15000, `the salt changed only ${moved} of 16000 multipliers — that is not a re-roll`);
});
