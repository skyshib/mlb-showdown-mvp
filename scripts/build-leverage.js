// Regenerates src/data/leverage.js from scripts/data/leverage.txt.
//
// leverage.txt is Greg Stoll's leverage-index dataset
// (https://github.com/gregstoll/baseballstats/blob/master/statsyears/leverage,
// built from Retrosheet event files, MLB 1903-2025). It is keyed exactly like
// probs.txt — the two files line up row for row — so the win-expectancy build
// and this one pool their cells the same way and index the same.
//
// Row format:
//   "V"|"H", inning, outs, runnerCode, scoreDiff, leverageIndex
// where "V" means the visiting team is batting (top half), runnerCode is
// 1 + first + 2*second + 4*third, and scoreDiff is batting minus fielding.
//
// Leverage index is already on its conventional scale: ~1.0 is an average
// plate appearance, 0.86 is the first pitch of a ball game, 3.06 is the bases
// loaded with two out in a tie, and a blowout is 0.
//
// The rows carry no sample counts, so the counts come from probs.txt — the same
// keys — and are used two ways: to weight the rows that pool into one cell
// (innings past 10, score diffs past ±10), and to tell an unobserved cell from
// a genuinely zero-leverage one. A cell nobody ever played takes the value of
// the nearest score diff that WAS played, which is what makes the deep-blowout
// corners read 0 rather than a hole.
//
// Usage: node scripts/build-leverage.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const leveragePath = path.join(here, "data", "leverage.txt");
const countsPath = path.join(here, "data", "probs.txt");
const outputPath = path.join(here, "..", "src", "data", "leverage.js");

const MAX_DIFF = 10;
const EXTRA_BAND = 10;
const DIFFS = MAX_DIFF * 2 + 1;
// A cell has to have been played enough times to mean anything. Below this, the
// "leverage" of a state is one team's freak afternoon in 1911 — the raw file
// carries cells with an index of 21 in them, off a handful of plate appearances
// — and a threshold that lets those through would stop the game dead on a
// nothing play. Under the gate, a cell borrows its nearest played neighbour.
const MIN_SAMPLES = 30;

function cellGrid(make) {
  return Array.from({ length: 2 }, () =>
    Array.from({ length: EXTRA_BAND }, () =>
      Array.from({ length: 3 }, () =>
        Array.from({ length: 8 }, () => Array.from({ length: DIFFS }, make))
      )
    )
  );
}

function key(line) {
  const [half, inning, outs, code, diff] = line.split(",");
  return {
    half: half === '"V"' ? 0 : 1,
    band: Math.min(Number(inning), EXTRA_BAND) - 1,
    outs: Number(outs),
    code: Number(code) - 1,
    diffIdx: Math.max(-MAX_DIFF, Math.min(MAX_DIFF, Number(diff))) + MAX_DIFF
  };
}

// Every row's own sample count, keyed on the raw row — half, inning, outs,
// runners, diff — so a row that pools into a band is weighted by how often it
// was actually played rather than counting as much as its neighbours.
const rowKey = (parts) => parts.slice(0, 5).join(",");
const samples = new Map();
for (const line of fs.readFileSync(countsPath, "utf8").trim().split("\n")) {
  const parts = line.split(",");
  samples.set(rowKey(parts), Number(parts[5]) || 0);
}

// Which cells were ever played at all: an unobserved cell is not a zero-leverage
// cell, and the two must not be confused.
const played = cellGrid(() => 0);
for (const [raw, n] of samples) {
  const at = key(raw);
  played[at.half][at.band][at.outs][at.code][at.diffIdx] += n;
}

// Leverage, pooled by plate appearances: an inning-14 row with nine samples in
// it must not drag the inning-10 band around.
const totals = cellGrid(() => ({ weight: 0, sum: 0 }));
for (const line of fs.readFileSync(leveragePath, "utf8").trim().split("\n")) {
  const parts = line.split(",");
  const li = Number(parts[5]);
  if (!Number.isFinite(li)) continue;
  const n = samples.get(rowKey(parts)) ?? 0;
  if (n <= 0) continue;
  const at = key(line);
  const cell = totals[at.half][at.band][at.outs][at.code][at.diffIdx];
  cell.weight += n;
  cell.sum += li * n;
}

const table = cellGrid(() => 0);
for (let half = 0; half < 2; half += 1) {
  for (let band = 0; band < EXTRA_BAND; band += 1) {
    for (let outs = 0; outs < 3; outs += 1) {
      for (let code = 0; code < 8; code += 1) {
        const row = totals[half][band][outs][code];
        const seen = played[half][band][outs][code];
        const values = row.map((cell, d) =>
          (cell.weight >= MIN_SAMPLES && seen[d] >= MIN_SAMPLES ? cell.sum / cell.weight : null));
        // A cell nobody ever played borrows the nearest one that was. Leverage
        // is smooth in score diff — it decays to nothing either side of a tie —
        // so the nearest neighbour is the honest guess, and it keeps the deep
        // corners at 0 instead of leaving holes there.
        for (let d = 0; d < DIFFS; d += 1) {
          if (values[d] !== null) continue;
          let best = null;
          let bestDistance = Infinity;
          for (let other = 0; other < DIFFS; other += 1) {
            if (values[other] === null) continue;
            const distance = Math.abs(other - d);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = values[other];
            }
          }
          values[d] = best ?? 0;
        }
        table[half][band][outs][code] = values.map((value) => Number(value.toFixed(2)));
      }
    }
  }
}

const body = `// Generated by scripts/build-leverage.js — do not edit by hand.
//
// MLB historical LEVERAGE INDEX, 1903-2025, from Greg Stoll's dataset
// (https://github.com/gregstoll/baseballstats) built on Retrosheet event
// files. The information used here was obtained free of charge from and is
// copyrighted by Retrosheet (https://www.retrosheet.org).
//
// LEVERAGE[half][inning - 1][outs][runnerCode - 1][diff + 10] is how much the
// plate appearance MATTERS: the swing the next play can make in the game's
// outcome, against the swing an average plate appearance makes. 1.0 is average.
// The first pitch of a ball game is 0.86. The bases loaded with two out in a
// tie is 3.06. A blowout is 0.
//
// half is 0 for the top and 1 for the bottom, innings past 10 share the
// inning-10 band, runnerCode is 1 + first + 2*second + 4*third, and diff is
// batting minus fielding score, clamped to ±10.

export const LEVERAGE_MAX_DIFF = ${MAX_DIFF};

export const LEVERAGE = ${JSON.stringify(table)};

// The leverage of the state a batter is walking into. Read from the BATTING
// team's side, the way the table is keyed.
export function leverageIndex({ half, inning, outs, bases, diff }) {
  const halfIndex = half === "top" ? 0 : 1;
  const inningBand = Math.min(inning, 10) - 1;
  const runnerCode = 1 + (bases[0] ? 1 : 0) + (bases[1] ? 2 : 0) + (bases[2] ? 4 : 0);
  const clamped = Math.max(-${MAX_DIFF}, Math.min(${MAX_DIFF}, diff));
  return LEVERAGE[halfIndex][inningBand][Math.min(outs, 2)][runnerCode - 1][clamped + ${MAX_DIFF}];
}
`;

fs.writeFileSync(outputPath, body);
console.log(`wrote ${outputPath}`);
