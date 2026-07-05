// Regenerates src/data/winExpectancy.js from scripts/data/probs.txt.
//
// probs.txt is Greg Stoll's win-expectancy dataset
// (https://github.com/gregstoll/baseballstats, built from Retrosheet event
// files, MLB 1903-2025). Row format:
//   "V"|"H", inning, outs, runnerCode, scoreDiff, samples, battingTeamWins
// where "V" means the visiting team is batting (top half), runnerCode is
// 1 + first + 2*second + 4*third, and scoreDiff is batting minus fielding.
//
// Usage: node scripts/build-win-expectancy.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, "data", "probs.txt");
const outputPath = path.join(here, "..", "src", "data", "winExpectancy.js");

const MAX_DIFF = 10; // score diffs beyond ±10 pool into the edge cells
const EXTRA_BAND = 10; // innings 10+ pool into one structurally identical band
const DIFFS = MAX_DIFF * 2 + 1;
const PRIOR_WEIGHT = 60; // pseudo-samples of the pooled (half, inning, diff) curve

function emptyCells() {
  // cells[halfIdx][inningBand 0-9][outs][runnerCode-1][diffIdx] = {n, wins}
  return Array.from({ length: 2 }, () =>
    Array.from({ length: EXTRA_BAND }, () =>
      Array.from({ length: 3 }, () =>
        Array.from({ length: 8 }, () =>
          Array.from({ length: DIFFS }, () => ({ n: 0, wins: 0 }))
        )
      )
    )
  );
}

function parseRows(text) {
  return text
    .trim()
    .split("\n")
    .map((line) => {
      const [half, inning, outs, code, diff, n, wins] = line.split(",");
      return {
        half: half === '"V"' ? 0 : 1,
        inning: Number(inning),
        outs: Number(outs),
        code: Number(code),
        diff: Number(diff),
        n: Number(n),
        wins: Number(wins)
      };
    });
}

const cells = emptyCells();
for (const row of parseRows(fs.readFileSync(sourcePath, "utf8"))) {
  const inningBand = Math.min(row.inning, EXTRA_BAND) - 1;
  const diffIdx = Math.max(-MAX_DIFF, Math.min(MAX_DIFF, row.diff)) + MAX_DIFF;
  const cell = cells[row.half][inningBand][row.outs][row.code - 1][diffIdx];
  cell.n += row.n;
  cell.wins += row.wins;
}

// Weighted isotonic regression (pool adjacent violators), increasing.
function isotonic(values, weights) {
  const blocks = values.map((value, i) => ({ value, weight: weights[i], span: 1 }));
  for (let i = 0; i < blocks.length - 1; ) {
    if (blocks[i].value > blocks[i + 1].value + 1e-12) {
      const a = blocks[i];
      const b = blocks[i + 1];
      const weight = a.weight + b.weight;
      blocks.splice(i, 2, {
        value: (a.value * a.weight + b.value * b.weight) / weight,
        weight,
        span: a.span + b.span
      });
      if (i > 0) i -= 1;
    } else {
      i += 1;
    }
  }
  return blocks.flatMap((block) => Array.from({ length: block.span }, () => block.value));
}

// Pooled batting-team win rate by (half, inningBand, diff) — the shrinkage
// prior. Gaps (huge early-inning diffs) interpolate between observed
// neighbors and the hard bounds just past the table edges.
function pooledCurve(half, inningBand) {
  const totals = Array.from({ length: DIFFS }, () => ({ n: 0, wins: 0 }));
  for (const outs of [0, 1, 2]) {
    for (let code = 0; code < 8; code += 1) {
      for (let d = 0; d < DIFFS; d += 1) {
        const cell = cells[half][inningBand][outs][code][d];
        totals[d].n += cell.n;
        totals[d].wins += cell.wins;
      }
    }
  }
  const anchors = [{ d: -1, p: 0.002 }];
  for (let d = 0; d < DIFFS; d += 1) {
    if (totals[d].n >= 50) anchors.push({ d, p: totals[d].wins / totals[d].n });
  }
  anchors.push({ d: DIFFS, p: 0.998 });
  const curve = [];
  for (let d = 0; d < DIFFS; d += 1) {
    let before = anchors[0];
    let after = anchors[anchors.length - 1];
    for (const anchor of anchors) {
      if (anchor.d <= d && anchor.d >= before.d) before = anchor;
      if (anchor.d >= d && anchor.d <= after.d) after = anchor;
    }
    curve.push(
      before.d === after.d
        ? before.p
        : before.p + ((after.p - before.p) * (d - before.d)) / (after.d - before.d)
    );
  }
  return isotonic(curve, curve.map(() => 1));
}

const table = emptyCells();
for (const half of [0, 1]) {
  for (let inningBand = 0; inningBand < EXTRA_BAND; inningBand += 1) {
    const prior = pooledCurve(half, inningBand);
    const series = [];
    for (const outs of [0, 1, 2]) {
      for (let code = 0; code < 8; code += 1) {
        const raw = cells[half][inningBand][outs][code];
        const shrunk = raw.map(
          (cell, d) => (cell.wins + PRIOR_WEIGHT * prior[d]) / (cell.n + PRIOR_WEIGHT)
        );
        const weights = raw.map((cell) => cell.n + PRIOR_WEIGHT);
        series.push({ outs, code, values: shrunk, weights });
      }
    }
    // Two passes: more outs can't help the batting team at fixed runners/diff,
    // then re-impose monotonicity in score diff.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let code = 0; code < 8; code += 1) {
        for (let d = 0; d < DIFFS; d += 1) {
          const byOuts = [0, 1, 2].map(
            (outs) => series.find((s) => s.outs === outs && s.code === code)
          );
          const descending = isotonic(
            byOuts.map((s) => -s.values[d]),
            byOuts.map((s) => s.weights[d])
          );
          byOuts.forEach((s, i) => {
            s.values[d] = -descending[i];
          });
        }
      }
      for (const s of series) {
        s.values = isotonic(s.values, s.weights);
      }
    }
    for (const s of series) {
      table[half][inningBand][s.outs][s.code] = s.values.map(
        (p) => Math.round(Math.min(0.998, Math.max(0.002, p)) * 10000) / 10000
      );
    }
  }
}

const header = `// Generated by scripts/build-win-expectancy.js — do not edit by hand.
//
// MLB historical win expectancy, 1903-2025, from Greg Stoll's dataset
// (https://github.com/gregstoll/baseballstats) built on Retrosheet event
// files. The information used here was obtained free of charge from and is
// copyrighted by Retrosheet (https://www.retrosheet.org).
//
// WIN_EXPECTANCY[half][inning - 1][outs][runnerCode - 1][diff + ${MAX_DIFF}] is the
// probability that the BATTING team wins, where half is 0 for the top and
// 1 for the bottom, innings past ${EXTRA_BAND} share the inning-${EXTRA_BAND} band, runnerCode
// is 1 + first + 2*second + 4*third, and diff is batting minus fielding
// score, clamped to ±${MAX_DIFF}. Cells are shrunk toward a pooled per-inning curve
// and kept monotone in score diff and outs.
`;

const body = `export const WIN_EXPECTANCY_MAX_DIFF = ${MAX_DIFF};

export const WIN_EXPECTANCY = ${JSON.stringify(table)};

// Batting-team win probability for a live (pre-third-out) state.
export function winExpectancy({ half, inning, outs, bases, diff }) {
  const halfIndex = half === "top" ? 0 : 1;
  const inningBand = Math.min(inning, ${EXTRA_BAND}) - 1;
  const runnerCode = 1 + (bases[0] ? 1 : 0) + (bases[1] ? 2 : 0) + (bases[2] ? 4 : 0);
  const clamped = Math.max(-${MAX_DIFF}, Math.min(${MAX_DIFF}, diff));
  return WIN_EXPECTANCY[halfIndex][inningBand][outs][runnerCode - 1][clamped + ${MAX_DIFF}];
}
`;

fs.writeFileSync(outputPath, `${header}\n${body}`);
const size = fs.statSync(outputPath).size;
console.log(`wrote ${outputPath} (${(size / 1024).toFixed(0)}KB)`);
