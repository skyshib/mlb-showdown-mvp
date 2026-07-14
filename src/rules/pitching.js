import { RESULTS, chartSpan } from "./cards.js?v=20260714-b";

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

// Both numbers are TUNED, by sweeping them through the balance simulator (four
// drafted teams, a hundred tournaments) and reading runs per game off the other
// end. Lower is better: both dugouts run the same skipper, so the only thing the
// number can be measuring is how well the staffs are being used.
//
//   never go to the pen at all ... 15.30   (so the pen is worth going to)
//   the old "pull at fatigue 2" .. 12.07
//   margin 2, desperation 4 ...... 11.85   <- here
//
// It is a real interior optimum, not a slide toward never pulling: widen the
// margin past 3 and the runs climb again. And it holds on seeds it was not tuned
// on — 12.38 -> 12.24, 12.38 -> 11.57, 12.59 -> 12.02, 12.49 -> 12.01 — which is
// what says this is a better skipper rather than a luckier one.
//
// The surface is flat around the peak (1.5-2 x 4-5 all land within 0.1 runs), so
// these are round numbers off a plateau, not a knife edge. Do not read precision
// into them that isn't there.
const MARGIN = 2;
const DESPERATION_GAP = 4;

// The hook, as one decision.
//
// `margin` is the skipper's temperament, in control points: how much better the
// pen has to be before he'll actually walk out there. Zero is a quick hook —
// take any upgrade going. A wide margin rides his starter and moves only for a
// real one.
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
// The numbers below are tuned, not chosen. See MARGIN and DESPERATION_GAP.
export function reliefDecision({
  current,
  currentFatigue = 0,
  bullpen = [],
  batters,
  outsRemaining = 27,
  margin = MARGIN,
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
  // every league.
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
    return { ...stay("the pen cannot cover what's left and he is not bad enough to burn it"), ...decision };
  }

  return {
    pull: true,
    index: best.index,
    reliever: best.arm,
    reason: canCover ? "the pen has a better arm and the innings to spend" : "he is getting hit around; go get him",
    ...decision
  };
}
