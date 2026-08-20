// Regenerates src/data/winExpectancy.js from
// scripts/data/simulated-win-probabilities.csv.
//
// The source is a SIMULATED win-expectancy surface: every base/out/score/inning
// state played forward many times rather than counted out of history. It
// replaced a Retrosheet-derived empirical table (1903-2025, Greg Stoll's
// dataset; see git history for that build, which read scripts/data/probs.txt —
// still vendored, because build-leverage.js takes its sample counts from it).
//
// WHY THE SWAP. Two reasons, both of which the empirical table got wrong for
// this game:
//
// 1. NOISE. History has thin cells, and thin cells do not divide. The old table
//    was monotone in score and outs but not in BASES: 2,734 of its cells rated
//    a state worse for the batting team after adding a runner. Break-evens are
//    ratios of differences between neighboring cells (see src/rules/breakeven.js)
//    and that noise made them unusable — the break-even for stealing second
//    swung from -100% to +757% across neighboring cells. The simulated surface
//    has 58 such inversions, none bigger than 0.007, and every one of them is
//    real baseball rather than sampling: they are the double-play states, where
//    putting a man on first with one out genuinely costs the batting team.
//
// 2. HOME FIELD ADVANTAGE. The empirical table opened the home team at 54%,
//    because real home teams win 54% of the time. This game has no such thumb
//    on the scale — the same nine cards score the same either way — and the
//    same team playing itself here wins 49.5% of the time at home (n=20,000).
//    Every win probability and every WPA in the app was carrying a four-point
//    bias that the ball game itself never produced. The simulated surface is
//    neutral: the visitors open at exactly 0.5000.
//
// EXTRA INNINGS. The source's inning-10 rows model the modern automatic runner
// on second — its "top 10, runner on second, nobody out, tied" is exactly
// 0.5000, the giveaway. This game plays classic extras (advanceHalfInning
// clears the bases), so those rows are DISCARDED and the extras band is filled
// from the source's 9th, which is the structurally identical inning: the
// visitors bat, the home team answers, and a home lead ends it. That inning's
// own numbers do assume any further extras are played with the automatic
// runner, which costs nothing here — the rule is symmetric, so the value of
// reaching another inning tied is 0.5 under either version.
//
// Nothing is smoothed, shrunk, or monotonized on the way in. A simulated
// surface is already the answer to the question the table asks, and the places
// where it bends are places baseball bends.
//
// Usage: node scripts/build-win-expectancy.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(here, "data", "simulated-win-probabilities.csv");
const outputPath = path.join(here, "..", "src", "data", "winExpectancy.js");

const MAX_DIFF = 10; // the source is built to ±10 and clamps there
const EXTRA_BAND = 10; // innings 10+ share one band
const EXTRAS_SOURCE_INNING = 9; // ...filled from the 9th, not the source's 10th
const DIFFS = MAX_DIFF * 2 + 1;

function parseRows(text) {
  const [headerLine, ...lines] = text.trim().split("\n");
  const header = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    const row = {};
    header.forEach((name, index) => {
      row[name] = Number(values[index]);
    });
    return row;
  });
}

// table[half][inningBand][outs][runnerCode - 1][diff + MAX_DIFF]
const table = Array.from({ length: 2 }, () =>
  Array.from({ length: EXTRA_BAND }, () =>
    Array.from({ length: 3 }, () =>
      Array.from({ length: 8 }, () => Array.from({ length: DIFFS }, () => null))
    )
  )
);

const rows = parseRows(fs.readFileSync(sourcePath, "utf8"));
for (const row of rows) {
  // The source speaks in HOME terms: score_diff is home minus away and
  // home_win_prob is the home team's. The table speaks in BATTING terms.
  const battingIsHome = row.is_top_inning === 0;
  const halfIndex = battingIsHome ? 1 : 0;
  const battingDiff = battingIsHome ? row.score_diff : -row.score_diff;
  const battingWin = battingIsHome ? row.home_win_prob : 1 - row.home_win_prob;
  const code = row.is_runner_on_first + 2 * row.is_runner_on_second + 4 * row.is_runner_on_third;
  const rounded = Math.round(battingWin * 10000) / 10000;

  const bands = [];
  if (row.inning <= EXTRA_BAND - 1) bands.push(row.inning - 1);
  if (row.inning === EXTRAS_SOURCE_INNING) bands.push(EXTRA_BAND - 1);
  for (const band of bands) {
    table[halfIndex][band][row.outs][code][battingDiff + MAX_DIFF] = rounded;
  }
}

for (const [halfIndex, half] of table.entries()) {
  for (const [band, innings] of half.entries()) {
    for (const [outs, outRow] of innings.entries()) {
      for (const [code, cells] of outRow.entries()) {
        const hole = cells.findIndex((cell) => cell === null);
        if (hole >= 0) {
          throw new Error(`no source row for half ${halfIndex}, band ${band}, ${outs} out, code ${code}, diff ${hole - MAX_DIFF}`);
        }
      }
    }
  }
}

const header = `// Generated by scripts/build-win-expectancy.js — do not edit by hand.
//
// SIMULATED win expectancy: each state played forward many times rather than
// counted out of history, which is what keeps it smooth enough to take
// differences of (see src/rules/breakeven.js) and neutral enough to describe
// this game, where the home team gets no advantage but the last at-bat.
//
// WIN_EXPECTANCY[half][inning - 1][outs][runnerCode - 1][diff + ${MAX_DIFF}] is the
// probability that the BATTING team wins, where half is 0 for the top and
// 1 for the bottom, innings past ${EXTRA_BAND} share the inning-${EXTRA_BAND} band, runnerCode
// is 1 + first + 2*second + 4*third, and diff is batting minus fielding
// score, clamped to ±${MAX_DIFF}.
//
// The visitors open a ball game at exactly .5000, a home lead in the ninth is
// exactly 1, and the extras band is the ninth's — this game plays classic
// extra innings, with nobody spotted on second.
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
console.log(`wrote ${outputPath} (${(size / 1024).toFixed(0)}KB) from ${rows.length} source rows`);
