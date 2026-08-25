import { winExpectancy, WIN_EXPECTANCY_MAX_DIFF } from "../data/winExpectancy.js";

// How often a runner has to be safe for the base to be worth trying for.
//
// This used to be a hand-written table — 90% to take second with nobody out,
// 40% to come home with two — and those numbers were guesses dressed as policy.
// They are answerable instead, off the same win expectancy the rest of the game
// scores itself with: a send is worth making when the win probability it stands
// to gain, times the share of the time it works, beats the win probability it
// stands to lose the rest of the time. Set the two sides equal and the
// break-even falls out:
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
// The three states are read straight off the table, which is only possible
// because that table is SIMULATED. An empirical one cannot be divided like
// this: history's cells are thin, thin cells disagree with their neighbors, and
// a ratio of differences between disagreeing neighbors is noise with a decimal
// point. Off the Retrosheet table this same arithmetic returned break-evens
// from −100% to +757% for stealing second, and flipped sign wherever the
// surface happened to rate a runner on second below a runner on first. Off the
// simulated one it returns about 71% in a tie, tightening past 90% when the
// side at bat is behind late and needs the baserunner more than the base. See
// scripts/build-win-expectancy.js for the swap and what it fixed.

// The home half of the ninth and everything after it: the half where the game
// can simply end, in the middle of an at-bat, the moment a run scores.
function isWalkoffHalf(half, inning) {
  return half === "bottom" && inning >= 9;
}

function clampDiff(diff) {
  return Math.max(-WIN_EXPECTANCY_MAX_DIFF, Math.min(WIN_EXPECTANCY_MAX_DIFF, diff));
}

function baseCode(bases) {
  return (bases[0] ? 1 : 0) + (bases[1] ? 2 : 0) + (bases[2] ? 4 : 0);
}

// The batting team's win probability from a live state. Walk-offs need no
// special case: the table carries an exact 1 in every cell where the home team
// is ahead in the ninth or later, because those games are over.
function stateWp(half, inning, outs, bases, diff) {
  return winExpectancy({ half, inning, outs, bases, diff: clampDiff(diff) });
}

// Three outs and the inning is over: the other side comes to bat with nobody on
// and nobody out. This is what makes a break-even blow up with two down — the
// runner is not risking a base, he is risking the whole rest of the inning.
//
// Unless there is no rest of the game. The last out of the home half of the
// ninth with the score settled is not a half-inning changing hands, it is a
// final score. Coming the other way needs no such rule: three outs in the top
// of the ninth hands the ball to a home team that is already ahead, and the
// table prices that at 1 on its own.
function inningOverWp(half, inning, diff) {
  if (isWalkoffHalf(half, inning) && diff !== 0) return diff > 0 ? 1 : 0;
  const nextHalf = half === "top" ? "bottom" : "top";
  const nextInning = half === "top" ? inning : inning + 1;
  return 1 - stateWp(nextHalf, nextInning, 0, [null, null, null], -diff);
}

// The swing a decision has to be worth before the win column can price it. A
// base worth under a hundredth of a win is a zero over a zero, not an answer:
// tie games and one-run games are never anywhere near it, and it is the five
// and six-run leads that fall through — exactly where the surface has stopped
// saying anything.
const MIN_SWING = 0.01;

function rawBreakeven(half, inning, outs, bases, diff, fromIndex, toIndex) {
  const holdWp = stateWp(half, inning, outs, bases, diff);

  const safeBases = [...bases];
  safeBases[fromIndex] = null;
  const runs = toIndex >= 3 ? 1 : 0;
  if (!runs) safeBases[toIndex] = bases[fromIndex] ?? "runner";
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

// The batting team's win probability with the diamond in a given state — the same
// reckoning a break-even is built out of, exposed on its own because the DEFENSE
// has a decision to price too. One throw, two runners: which of them to contest is
// a question about what each out is worth, and it is asked in these numbers (see
// chooseThrowTarget in game.js).
//
// Three outs is a state like any other here: the inning is over and the number is
// what the other side's half is worth, which is the whole reason an out with two
// down is worth so much more than an out with none.
export function battingWp({ half, inning, outs, bases, diff }) {
  const band = Math.min(inning, 10);
  return outs >= 3 ? inningOverWp(half, band, diff) : stateWp(half, band, outs, bases, diff);
}

const CACHE = new Map();

// The share of the time a runner must beat the throw for the attempt to be worth
// making. Everything is from the BATTING team's side: `diff` is their score
// minus the other team's, `bases` is the diamond as it stands with the decision
// still to be made, and `outs` is the count the runner would be going on.
//
// Returns a number in [0, 1]. A break-even that comes out above 1 — the base is
// worth less than the man standing still — clamps to 1, so only a runner who
// cannot be thrown out takes it. The surface does say that in a few places, and
// means it: with one out, a man on third and first base open, putting a runner
// on first hands the defense a double play, and the batting side is worse off
// for the extra baserunner. That clamp is also load-bearing elsewhere — a free
// advance has to stay free, because the interactive layer counts on uncontested
// bases being taken without asking.
//
// A game already decided has no answer to give — thirteen runs up, every outcome
// wins — so the question is asked again of the nearest score that is still a
// ball game, walking in one run at a time. Nearest and not a tie, because the
// two say opposite things: a tie says run, and a team down six in the ninth
// wants baserunners rather than bases and should not be handing over outs. The
// closest live game is the one this one most resembles.
export function advanceBreakeven({ half, inning, outs, bases, diff, fromIndex, toIndex }) {
  const inningBand = Math.min(inning, 10);
  const scoreEdge = clampDiff(diff);
  const key = (((((baseCode(bases) * 3 + outs) * 4 + fromIndex) * 4 + toIndex) * 11 + inningBand)
    * 21 + scoreEdge + WIN_EXPECTANCY_MAX_DIFF) * 2 + (half === "bottom" ? 1 : 0);
  const cached = CACHE.get(key);
  if (cached !== undefined) return cached;

  let breakeven = null;
  const towardTie = Math.sign(-scoreEdge);
  for (let edge = scoreEdge; breakeven === null; edge += towardTie) {
    breakeven = rawBreakeven(half, inningBand, outs, bases, edge, fromIndex, toIndex);
    if (!towardTie || edge === 0) break;
  }
  breakeven ??= 1;
  CACHE.set(key, breakeven);
  return breakeven;
}
