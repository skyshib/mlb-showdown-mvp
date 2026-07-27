import { winExpectancy, WIN_EXPECTANCY_MAX_DIFF } from "../data/winExpectancy.js";

// How often a runner has to be safe for the base to be worth trying for.
//
// This used to be a hand-written table — 90% to take second with nobody out,
// 40% to come home with two — and those numbers were guesses dressed as policy.
// They are answerable instead, off the same MLB win expectancy the rest of the
// game scores itself with: a send is worth making when the win probability it
// stands to gain, times the share of the time it works, beats the win
// probability it stands to lose the rest of the time. Set the two sides equal
// and the break-even falls out:
//
//   p* = (WP hold − WP out) / (WP safe − WP out)
//
// The numerator is what the runner has to lose by standing still, the
// denominator is the whole distance between the two outcomes. Everything the
// old matrix hard-coded — never make the third out at third, two down so send
// him — comes out of that division on its own, and so does everything it could
// not say: that a one-run game in the eighth is not a five-run game in the
// second, and that the man on first is a different decision when there is
// already a man on third.
//
// WHY NOT READ THE THREE STATES STRAIGHT OFF THE TABLE. Because the ratio is a
// small number over a small number, and the win expectancy table's per-cell
// noise is not small next to it. Read raw, the break-even for stealing second
// swings between −100% and +757% across neighboring cells, and flips sign
// wherever the surface happens to rate a runner on second below a runner on
// first. The table is only smoothed monotone in score and outs — not in bases.
//
// So the bases are priced ONCE, in runs, pooled over the whole surface (see
// baseRunValues), and the three win probabilities are then read off the part of
// the table that is smooth and thickly sampled: the bases-empty row at the
// relevant out count, indexed at a fractional score edge. Outs still come from
// the table directly, which is what keeps "the third out ends the inning" exact.
// The result is stable to a point or two across neighboring situations and lands
// where a century of baseball says it should — about 70% to steal second, about
// 95% to steal third with two down, about 35% to come home from third with two.

const EMPTY_BASES = [null, null, null];

// The home half of the ninth and everything after it: the half where the game
// can simply end, in the middle of an at-bat, the moment a run scores.
function isWalkoffHalf(half, inning) {
  return half === "bottom" && inning >= 9;
}

// Innings the run values are pooled over. The ninth and extras are left out on
// purpose: down there the surface stops being a function of runs at all and
// becomes a question about needing exactly one, and a state's worth in runs
// measured against that curve is not the same quantity.
const POOL_INNINGS = 8;
const POOL_MAX_DIFF = 4;

// A score edge only tells you something where the win curve actually moves. Flat
// stretches — a six-run lead in the second — invert to nonsense.
const MIN_SLOPE = 0.008;

function clampDiff(diff) {
  return Math.max(-WIN_EXPECTANCY_MAX_DIFF, Math.min(WIN_EXPECTANCY_MAX_DIFF, diff));
}

export function baseCode(bases) {
  return (bases[0] ? 1 : 0) + (bases[1] ? 2 : 0) + (bases[2] ? 4 : 0);
}

// The batting team's win probability with nobody on, at a whole-run score edge.
function emptyBasesWp(half, inning, outs, diff) {
  return winExpectancy({ half, inning, outs, bases: EMPTY_BASES, diff: clampDiff(diff) });
}

// The same row read at a FRACTIONAL edge — the currency base runners are priced
// in. Half a run ahead means half the distance from tied to a run up.
//
// A lead in the home half of the ninth is the exception, and it has to be: the
// run that takes it ends the ball game. The table's cells for that are filled in
// rather than observed — the home team does not bat with a lead in the ninth —
// so they are worth nothing and the truth, 1, is used instead.
function curveWp(half, inning, outs, edge) {
  if (isWalkoffHalf(half, inning) && edge > 0) return 1;
  const lower = Math.floor(edge);
  const fraction = edge - lower;
  const low = emptyBasesWp(half, inning, outs, lower);
  if (!fraction) return low;
  const high = emptyBasesWp(half, inning, outs, lower + 1);
  return low + fraction * (high - low);
}

// The score edge that would buy the same win probability as `wp`, found by
// walking the bases-empty row until the value is bracketed. The row is monotone
// in score by construction, so the first bracket is the only one.
function impliedEdge(half, inning, outs, wp) {
  for (let low = -WIN_EXPECTANCY_MAX_DIFF; low < WIN_EXPECTANCY_MAX_DIFF; low += 1) {
    const a = emptyBasesWp(half, inning, outs, low);
    const b = emptyBasesWp(half, inning, outs, low + 1);
    if (b - a < MIN_SLOPE) continue;
    if (wp >= a && wp <= b) return low + (wp - a) / (b - a);
  }
  return null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

let RUN_VALUES = null;

// What every base state is worth, in runs, against an empty diamond with the
// same number of outs. Asked of the win expectancy surface itself: for each
// inning, half and score, find the score edge that wins as often as the runners
// do, and take the median across all of them. Pooling thousands of cells into
// 24 numbers is what turns a noisy surface into a usable one.
//
// It lands within a couple hundredths of the published 2010-2015 run expectancy
// table for every one-man state, which is a real check on both — the numbers
// were derived from win probabilities and never saw a run expectancy. The
// crowded states come in lower (bases loaded, nobody out: 1.34 against 1.81)
// and that is the model telling the truth rather than missing it: these are
// WIN-equivalent runs, and the fifth run of a rally does not buy what the first
// one does.
export function baseRunValues() {
  if (RUN_VALUES) return RUN_VALUES;
  RUN_VALUES = [0, 1, 2].map((outs) => {
    const row = [];
    for (let code = 0; code < 8; code += 1) {
      const bases = [code & 1 ? {} : null, code & 2 ? {} : null, code & 4 ? {} : null];
      const samples = [];
      for (const half of ["top", "bottom"]) {
        for (let inning = 1; inning <= POOL_INNINGS; inning += 1) {
          for (let diff = -POOL_MAX_DIFF; diff <= POOL_MAX_DIFF; diff += 1) {
            const wp = winExpectancy({ half, inning, outs, bases, diff });
            const edge = impliedEdge(half, inning, outs, wp);
            if (edge != null) samples.push(edge - diff);
          }
        }
      }
      row.push(median(samples) ?? 0);
    }
    // Nobody on is the zero of this scale by definition; the pooled estimate of
    // it is a rounding error, and subtracting it keeps the row honest.
    const empty = row[0];
    return row.map((value) => value - empty);
  });
  return RUN_VALUES;
}

// Win probability for the batting team from a base/out state, priced as runs and
// read off the empty-bases curve.
//
// EXCEPT in the walkoff half, where the runs a state is worth is the wrong
// question — the only run that matters there is the first one, and a state worth
// 1.03 expected runs is not a game already won. That is the one region where the
// raw cells are the better instrument anyway: bottom-of-the-ninth ball games are
// thick in the history, and the win swings down there are the biggest in the
// sport, so the noise that ruins the ratio everywhere else is small against them.
// It also keeps the last inning's decisions honest with the WPA the game itself
// will credit them, which is read off these same cells. The price is a rougher
// number once the home team is down two or more late — small swings, thin cells —
// and that is the cheapest place in the game to be approximate.
function stateWp(half, inning, outs, bases, diff) {
  if (isWalkoffHalf(half, inning)) {
    if (diff > 0) return 1;
    return winExpectancy({ half, inning, outs, bases, diff: clampDiff(diff) });
  }
  return curveWp(half, inning, outs, diff + baseRunValues()[outs][baseCode(bases)]);
}

// Three outs and the inning is over: the other side comes to bat with nobody on
// and nobody out, which the table knows exactly. This is also what makes a
// break-even blow up with two down — the runner is not risking a base, he is
// risking the whole rest of the inning.
//
// Unless there is no rest of the game. The last out of the home half of the
// ninth with the score settled is not a half-inning changing hands, it is a
// final score, and pricing it as a fresh top of the tenth had the losing side
// still holding 16% of a win after the game was over.
function inningOverWp(half, inning, diff) {
  if (isWalkoffHalf(half, inning) && diff !== 0) return diff > 0 ? 1 : 0;
  const nextHalf = half === "top" ? "bottom" : "top";
  const nextInning = half === "top" ? inning : inning + 1;
  return 1 - curveWp(nextHalf, nextInning, 0, -diff);
}

// The swing a decision has to be worth before the win column can price it. A
// base worth under a hundredth of a win is a zero over a zero, not an answer:
// tie games and one-run games are never anywhere near it (the tightest is 3.5
// points, the middle of them 14), and it is five and six-run leads that fall
// through — exactly where the surface has stopped saying anything.
const MIN_SWING = 0.01;

function rawBreakeven(half, inning, outs, bases, diff, fromIndex, toIndex) {
  const holdWp = stateWp(half, inning, outs, bases, diff);

  const safeBases = [...bases];
  safeBases[fromIndex] = null;
  const runs = toIndex >= 3 ? 1 : 0;
  if (!runs) safeBases[toIndex] = bases[fromIndex] ?? {};
  const safeWp = stateWp(half, inning, outs, safeBases, diff + runs);

  const outBases = [...bases];
  outBases[fromIndex] = null;
  const outWp = outs + 1 >= 3
    ? inningOverWp(half, inning, diff)
    : stateWp(half, inning, outs + 1, outBases, diff);

  const swing = safeWp - outWp;
  if (swing < MIN_SWING) return null;
  return Math.max(0, Math.min(1, (holdWp - outWp) / swing));
}

const CACHE = new Map();

// The share of the time a runner must beat the throw for the attempt to be worth
// making. Everything is from the BATTING team's side: `diff` is their score
// minus the other team's, `bases` is the diamond as it stands with the decision
// still to be made, and `outs` is the count the runner would be going on.
//
// Returns a number in [0, 1]. A break-even that comes out above 1 — the base is
// worth less than the man standing still, which the surface does say here and
// there — clamps to 1, so only a runner who cannot be thrown out takes it. That
// clamp is load-bearing elsewhere: a free advance has to stay free, because the
// interactive layer counts on uncontested bases being taken without asking.
//
// A game already decided has no answer to give — thirteen runs up, every outcome
// wins — so the fallback is the same call in a tie game, which is the closest
// thing to "how baseball is played" the model has. Runners in a laugher keep
// running the way runners do rather than freezing on a division by zero.
export function advanceBreakeven({ half, inning, outs, bases, diff, fromIndex, toIndex }) {
  const inningBand = Math.min(inning, 10);
  const scoreEdge = clampDiff(diff);
  const key = (((((baseCode(bases) * 3 + outs) * 4 + fromIndex) * 4 + toIndex) * 11 + inningBand)
    * 21 + scoreEdge + WIN_EXPECTANCY_MAX_DIFF) * 2 + (half === "bottom" ? 1 : 0);
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;

  const breakeven = rawBreakeven(half, inningBand, outs, bases, scoreEdge, fromIndex, toIndex)
    ?? rawBreakeven(half, inningBand, outs, bases, 0, fromIndex, toIndex)
    ?? 1;
  CACHE.set(key, breakeven);
  return breakeven;
}
