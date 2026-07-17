import { RESULTS, chartSpan } from "./cards.js?v=20260716-records";

// When to go to the pen.
//
// The old rule was a number: pull at fatigue 2. It never looked at WHO was
// pitching or WHO was warm, and so it got both halves of the job wrong. A
// batting-practice starter cruised to the end of his tank while three good
// innings sat in the bullpen, because he wasn't tired yet. And an ace was taken
// out the moment he tired and handed to a mop-up arm two runs an inning worse,
// because tired was the only thing the rule could see.
//
// A hook is a COMPARISON, not a threshold. The only question worth asking is:
// is somebody out there better than the man I have, right now, as he is? Fatigue
// belongs in that question — it makes the man on the mound worse — but it is not
// the question. So a tired ace with nothing behind him keeps the ball, and a
// fresh arm who is worse than a tired ace never touches it.

// Runs above average per plate appearance — standard linear weights. They are
// what makes a walk and a homer commensurable, which is what lets two pitchers
// be compared by one number.
const RUN_VALUE = {
  [RESULTS.PU]: -0.27,
  [RESULTS.SO]: -0.27,
  [RESULTS.GB]: -0.27,
  [RESULTS.FB]: -0.27,
  [RESULTS.BB]: 0.33,
  [RESULTS.SINGLE]: 0.47,
  [RESULTS.SINGLE_PLUS]: 0.5,
  [RESULTS.DOUBLE]: 0.78,
  [RESULTS.TRIPLE]: 1.09,
  [RESULTS.HR]: 1.4
};

const DIE = 20;

// Charts and lineups don't change during a game, and this is asked once per
// batter faced per arm in the pen. Cache on the object itself.
const chartCache = new WeakMap();
const lineupCache = new WeakMap();

// What one d20 chart is worth, per plate appearance, in runs.
export function chartRunValue(chart) {
  if (!Array.isArray(chart) || !chart.length) return 0;
  const cached = chartCache.get(chart);
  if (cached !== undefined) return cached;
  let total = 0;
  for (const row of chart) {
    total += (RUN_VALUE[row.result] ?? 0) * chartSpan(row);
  }
  const value = total / DIE;
  chartCache.set(chart, value);
  return value;
}

// The lineup you actually have to get out, averaged: how hard they are to beat
// (on-base) and what they do with the bat when they beat you. A hook decision
// made against a league-average ghost is a worse decision than one made against
// the nine men in the other dugout.
export function lineupProfile(lineup) {
  const bats = (lineup ?? []).filter(Boolean);
  if (!bats.length) return { onBase: 9, runValue: 0 };
  const cached = lineupCache.get(lineup);
  if (cached !== undefined) return cached;
  const profile = {
    onBase: bats.reduce((sum, bat) => sum + (Number(bat.onBase) || 0), 0) / bats.length,
    runValue: bats.reduce((sum, bat) => sum + chartRunValue(bat.chart), 0) / bats.length
  };
  lineupCache.set(lineup, profile);
  return profile;
}

// The runs this arm is expected to give up per plate appearance, as he is right
// now, against these hitters. Lower is better.
//
// The engine's whole contest is the control roll: d20 + (control - fatigue) vs
// the batter's on-base. Win it and the batter has to hit off the PITCHER's card;
// lose it and he hits off his own. So an arm's quality is exactly how often he
// wins that roll, weighted by how much better his card is than theirs — and
// fatigue enters where the engine puts it, on the control, which is why a tired
// man's number rises smoothly instead of falling off a cliff at some threshold.
export function runsPerPa(pitcher, fatiguePenalty, batters) {
  if (!pitcher) return Infinity;
  const effectiveControl = (Number(pitcher.control) || 0) - (fatiguePenalty ?? 0);
  // Faces of the die that beat the batter: roll > onBase - effectiveControl.
  const needed = batters.onBase - effectiveControl;
  const winningFaces = Math.max(0, Math.min(DIE, DIE - needed));
  const pitcherAdvantage = winningFaces / DIE;
  return pitcherAdvantage * chartRunValue(pitcher.chart) + (1 - pitcherAdvantage) * batters.runValue;
}

// How many outs an arm can record before he starts to tire: his printed IP.
function armOuts(pitcher) {
  const ip = Number(pitcher?.ip ?? 0);
  return Number.isFinite(ip) ? Math.max(0, Math.round(ip * 3)) : 0;
}

// What one point of control is worth, in runs, against these hitters: a point
// moves one face of the die from their card to his.
//
// Thresholds get quoted in CONTROL POINTS rather than runs for exactly this
// reason. A run means different things in different leagues — the same hook that
// is a hair-trigger against a lineup that singles and homers off every roll is a
// dead switch against one that cannot hit — whereas "the pen is a control point
// better than him" means the same thing everywhere, and it is the unit the cards
// are actually printed in.
function runsPerControlPoint(pitcher, batters) {
  const swing = (batters.runValue - chartRunValue(pitcher.chart)) / DIE;
  return Math.max(swing, 1e-6);
}

// The bar the pen has to clear, in control points — and it FALLS as the game
// gets shorter.
//
// A flat bar was the last thing wrong with this rule. The gap it is compared
// against does not depend on the inning, the score, or a single thing the man
// on the mound has actually done; fatigue is its only moving part, and fatigue
// only ever pushes it UP. So a flat bar is a decision that, once it is true, was
// already true before the first pitch — which is exactly what it looked like: a
// starter pulled after one batter, for a gap that had nothing to do with the
// batter.
//
// What a starter really has, early, is OUTS, and they are worth something
// precisely because the pen cannot cover the game without them. That worth
// decays: by the seventh there is nothing left to protect and the pen should be
// spending whatever it has. So the bar to walk out there is the option value of
// his remaining tank, and it slides down with the outs left to get.
//
// The floor is where I put a HEDGE and put it in the wrong shape. It was a flat
// toll — keep a real point of control between the two men before spending an arm
// you cannot get back — and a toll gets charged even when there is nothing left
// to protect. In the eleventh inning, with three outs to get and six sitting in
// the pen, a starter's remaining outs are worth exactly NOTHING: the pen covers
// everything that is left. A bar of any size there is a bar against the truth,
// and it bought an eleven-inning complete game from a man who by then was three
// control points worse than the arm warming up behind him.
//
// So the floor comes down to a half point — enough that a coin-flip upgrade does
// not churn an arm, and no more than that. The hedging is done by the clause that
// can actually TELL whether the pen is too short to spend: while it cannot cover
// what is left, the bar is DESPERATION_GAP and the sliding one does not apply.
// That clause knows what a floor can only guess at.
//
// Both ends of the line are points the game really visits. `outsRemaining` bottoms
// out at 3 (see outsRemainingToPitch) — every extra inning looks to this rule like
// the ninth — so the line is anchored THERE and not at a zero it never reaches.
const MARGIN_EARLY = 5.5;   // the bar with a whole game still to get
const MARGIN_LATE = 0.5;    // the bar with three outs left, and in every extra inning
const REGULATION_OUTS = 27;
const FLOOR_OUTS = 3;

// Leverage lowers the bar, a little. How much a plate appearance MATTERS —
// Greg Stoll's leverage index, 1.0 for an average moment, up past 10 for a tie
// game with the bags full in the ninth — is exactly the thing a skipper reads
// when he decides how hard to chase a small upgrade. In a moment the game can
// turn on, an arm a fraction of a control point better is worth spending; in a
// blowout it is not worth a warm-up toss. So the bar comes down as leverage
// climbs above an average moment.
//
// It is a NUDGE, not a new bar: a fraction of a control point per unit of
// leverage, capped low, so the drama can shave the margin but never erase it.
// A blowup in the pen's own math (the desperation clause, the coverage clause)
// still stands; leverage only bends the ordinary sliding bar, and only enough
// that a genuine coin-flip upgrade in a genuine crisis gets made.
const LEVERAGE_WEIGHT = 0.4;   // control points shaved per unit of leverage over average
const LEVERAGE_MAX_DROP = 1.5; // and no more than this, however wild the moment
const AVERAGE_LEVERAGE = 1;

export function leverageDrop(leverage = AVERAGE_LEVERAGE) {
  const li = Number(leverage);
  if (!Number.isFinite(li)) return 0;
  return Math.min(LEVERAGE_MAX_DROP, Math.max(0, (li - AVERAGE_LEVERAGE) * LEVERAGE_WEIGHT));
}

// The bar, at this point in the game. `bias` is the skipper's temperament in
// control points: positive rides his starter, negative is a quick hook.
// `leverage` shaves it down in moments the game can turn on (see leverageDrop).
export function pullMargin(outsRemaining = REGULATION_OUTS, bias = 0, leverage = AVERAGE_LEVERAGE) {
  const outs = Number(outsRemaining);
  const clamped = Math.max(FLOOR_OUTS, Number.isFinite(outs) ? outs : REGULATION_OUTS);
  const share = Math.min(1, (clamped - FLOOR_OUTS) / (REGULATION_OUTS - FLOOR_OUTS));
  const sliding = MARGIN_LATE + (MARGIN_EARLY - MARGIN_LATE) * share + bias;
  return Math.max(0, sliding - leverageDrop(leverage));
}

// The bar when the pen CANNOT cover what is left, which is flat and higher. Late
// in a game a short pen is the last thing between you and extra innings, so the
// sliding bar is not allowed to talk you into emptying it for a small upgrade.
// This is the hedge the floor used to be pretending to be.
const DESPERATION_GAP = 4;

// The hook, as one decision.
//
// The bar the pen must clear is `margin`, which slides with the outs left to get
// (see pullMargin) and is nudged by the skipper's temperament (`bias`). Early it
// is high, because the starter's tank is holding the game up. Late it is low,
// because there is nothing left to hold up.
//
// The coverage clause is what keeps this honest. Pulling a man is FINAL — he
// does not come back — and a staff is three or four arms deep, not eight. The
// outs he would have eaten still have to come from somebody, so going to get a
// mild upgrade in the fourth just means a worse arm throws the eighth on fumes.
// While the pen cannot cover what is left of the game, only a genuinely bad
// outing (`desperationGap`) buys the hook — which is the case this is all for: a
// man getting hit around while good innings sit idle behind him.
//
// I thought this clause should lift once he was tired — his tank is spent, so
// what is left to protect? — and the balance simulator said no, twice, and it
// was right and I was wrong. What a tired starter still has is OUTS. He is worse
// at getting them than he was, but the pen's tank is small and the game is long,
// and a bullpen emptied in the sixth pitches the ninth on nothing at all. The
// tiredness is priced already: it is in his control, which is in the gap. It
// does not need a second vote.
//
// `leverage` shaves the bar down in moments the game can turn on (see
// leverageDrop) — the skipper is quicker with the hook when the plate
// appearance matters. `margin` stays overridable so a caller can ask the
// question at a bar of its own choosing; leave it alone and the sliding one,
// bent by leverage, answers.
export function reliefDecision({
  current,
  currentFatigue = 0,
  bullpen = [],
  batters,
  outsRemaining = 27,
  bias = 0,
  leverage = AVERAGE_LEVERAGE,
  margin = pullMargin(outsRemaining, bias, leverage),
  desperationGap = DESPERATION_GAP
}) {
  const stay = (reason) => ({ pull: false, index: null, reliever: null, reason });
  if (!current || !bullpen.length) return stay("no relief available");

  const facing = batters ?? { onBase: 9, runValue: 0 };
  const currentRpa = runsPerPa(current, currentFatigue, facing);

  // Everyone in the pen comes in fresh — that is the point of him.
  const rated = bullpen
    .map((arm, index) => ({ arm, index, rpa: runsPerPa(arm, 0, facing) }))
    .sort((a, b) => a.rpa - b.rpa);
  const best = rated[0];

  // The gap, said in control points, so the thresholds mean the same thing in
  // every league. Read it as an EXCHANGE RATE, not a difference of ratings: how
  // many points of control you would have to hand the man on the mound to make
  // him the man in the pen. It is not bounded by the 0-6 the cards are printed
  // on, because chart quality is bought with the same currency — two control-4
  // arms can be four points apart on their charts alone.
  const perPoint = runsPerControlPoint(current, facing);
  const gap = (currentRpa - best.rpa) / perPoint;
  const decision = { currentRpa, bestRpa: best.rpa, gap };
  // Thresholds are quoted in whole control points and the gap is arrived at by
  // division, so "exactly two points better" must not turn on the last bit of a
  // float. Meet the bar and you have met it.
  const EPSILON = 1e-9;
  if (gap <= margin + EPSILON) {
    return { ...stay("the man on the mound is still the best arm we have"), ...decision };
  }

  const penOuts = bullpen.reduce((sum, arm) => sum + armOuts(arm), 0);
  const canCover = penOuts >= outsRemaining;
  if (!canCover && gap < desperationGap - EPSILON) {
    return { ...stay("the pen cannot cover what's left and the arm on the mound is not bad enough to burn it"), ...decision };
  }

  return {
    pull: true,
    index: best.index,
    reliever: best.arm,
    reason: canCover ? "the pen has a better arm and the innings to spend" : "the arm on the mound is getting hit around; go make the change",
    ...decision
  };
}
