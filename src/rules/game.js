import { RESULTS, resolveChart } from "./cards.js?v=20260716-records";
import { reliefDecision, lineupProfile } from "./pitching.js?v=20260716-records";
import { createRng } from "./rng.js?v=20260716-records";
import { winExpectancy } from "../data/winExpectancy.js";
import { leverageIndex } from "../data/leverage.js";
import { advanceBreakeven } from "./breakeven.js?v=20260716-records";
import { SUB_MIN_INNING, benchSlotFielding, pinchHitDecision, pinchRunDecision, defensiveSubDecision, coverageAssignment, canCoverField, alignmentLegal, roughBatValue } from "./substitutions.js?v=20260716-records";

export { SUB_MIN_INNING };

// Go/no-go floors for taking a base, by outs and destination.
//
// This was the whole decision once. It is now only the backstop: every candidate
// gets its own break-even figured off the win expectancy for the situation it is
// actually in (see breakeven.js and annotateAdvanceChain), and these numbers are
// what a candidate falls back on if it was built without a game around it.
//
// They are kept because they were a decent guess, and because they read as what
// the derived numbers turn out to say: second and home loosen as the outs mount,
// third tightens, and nobody makes the third out there.
const ADVANCE_DECISION_MATRIX = {
  0: { second: 0.9, third: 0.65, home: 0.75 },
  1: { second: 0.8, third: 0.75, home: 0.65 },
  2: { second: 0.7, third: 0.85, home: 0.4 }
};

export function advanceDecisionMinimum(outs, destination) {
  return ADVANCE_DECISION_MATRIX[outs]?.[destination] ?? 1;
}

// The batting team's score edge — the currency every win-probability question in
// this file is asked in.
function battingEdge(state) {
  const battingSide = state.half === "top" ? "away" : "home";
  const fieldingSide = battingSide === "away" ? "home" : "away";
  return state.score[battingSide] - state.score[fieldingSide];
}

// Hang each candidate's own go/no-go number on it: how often this runner has to
// beat this throw for the base to be worth what it risks, in this ball game.
//
// Sends are a CHAIN. A trailing runner can only go if every man ahead of him
// goes too, so the world his number is figured in is the one where they already
// have — the lead runner off the bases, his base filled, his run in. That is the
// same prefix the send itself resolves under (see leadPrefixAttempts), and it is
// also the question the interactive layer is really asking when it offers to
// send two men: the second man's price assumes the first one went.
function annotateAdvanceChain(state, candidates) {
  const { half, inning } = state;
  let bases = state.bases;
  let diff = battingEdge(state);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    priceAdvance(candidate, half, inning, bases, diff);
    if (index === candidates.length - 1) break;
    const after = [...bases];
    after[candidate.fromIndex] = null;
    if (candidate.toIndex >= 3) {
      diff += 1;
    } else {
      after[candidate.toIndex] = candidate.runner;
    }
    bases = after;
  }

  return candidates;
}

// Steals are not a chain — the two of them are alternatives, and only one man is
// going — so each is priced against the bases as they stand.
function annotateAdvanceOptions(state, candidates) {
  const { half, inning } = state;
  const diff = battingEdge(state);
  for (const candidate of candidates) priceAdvance(candidate, half, inning, state.bases, diff);
  return candidates;
}

function priceAdvance(candidate, half, inning, bases, diff) {
  candidate.decisionMinimum = advanceBreakeven({
    half,
    inning,
    outs: candidate.outsForDecision,
    bases,
    diff,
    fromIndex: candidate.fromIndex,
    toIndex: candidate.toIndex
  });
}

// How much this plate appearance MATTERS, looked up in the same MLB history the
// win expectancy comes from: the swing the next play can make in the game's
// outcome, measured against the swing an average plate appearance makes.
//
// 1.0 is an average moment. 0.86 is the first pitch of a ball game. Bases loaded
// with two out in a tie is 3.06, and the same with your side down one in the
// bottom of the ninth is 10.4, which is about as much as a single plate
// appearance has ever been worth. A blowout is 0.
//
// This is a REAL number about a real game, and it replaces the hand-written
// rules that used to guess at the same thing.
export function stateLeverage(state) {
  const battingSide = state.half === "top" ? "away" : "home";
  const fieldingSide = battingSide === "away" ? "home" : "away";
  return leverageIndex({
    half: state.half,
    inning: state.inning,
    outs: Math.min(state.outs, 2),
    bases: state.bases,
    diff: state.score[battingSide] - state.score[fieldingSide]
  });
}

// The same number for a play already in the books, read off the state the play
// STARTED from. Leverage is what was at stake going in, so it is a fact about
// the situation and not about how the swing turned out — a bases-loaded pop-up
// in a tie ninth was a huge moment that happened to produce nothing, and a
// three-run homer in a 12-0 game was no moment at all.
//
// A pitching change carries no base-out state of its own, so it has no leverage
// to report and returns null rather than a misleading zero.
export function eventLeverage(event) {
  if (!event?.basesBefore || !event.scoreBefore || !Number.isFinite(event.outsBefore)) return null;
  return stateLeverage({
    half: event.half,
    inning: event.inning,
    outs: event.outsBefore,
    bases: event.basesBefore,
    score: event.scoreBefore
  });
}

// Probability that the home team wins from the given state, off MLB history
// (Retrosheet 1903-2025 via Greg Stoll's dataset — see src/data/winExpectancy.js).
// Terminal states are exact.
//
// Batches used to learn their own table from a calibration pass and score
// against that instead. It had to go: a per-league table is estimated per
// (inning, half, outs, bases, diff) cell WITHOUT conditioning on which team is
// batting, so in any league with a dominant offense the base-state axis becomes
// a proxy for "the good team is up" rather than a measure of what the base is
// worth. In one 20-runs-per-game draft that team supplied 25% of the
// bases-empty observations but 65% of the runner-on-second ones, which priced a
// stolen base at +0.159 win probability against +0.093 for a two-run homer and
// +0.043 for a grand slam — the more men a homer drove in, the less the model
// paid for it, because it valued the runners it erased above the runs it
// scored. Scoring a run LOWERED win probability in 9.4% of cells. That is
// composition bias, not sampling noise, so more games only sharpened the wrong
// number. MLB history has no such skew: across 120 years every base state is
// drawn from the same league-average mix of offenses.
export function winProbabilityHome(state) {
  const diff = state.score.home - state.score.away;
  if (state.walkoff) return 1;
  if (state.gameOver) return diff > 0 ? 1 : 0;

  const view = { inning: state.inning, half: state.half, outs: state.outs, bases: state.bases };
  if (view.outs >= 3) {
    view.outs = 0;
    view.bases = [null, null, null];
    if (view.half === "top") {
      view.half = "bottom";
    } else {
      view.half = "top";
      view.inning += 1;
    }
  }

  // A completed bottom of the 9th or later with a lead ends the game. A live
  // top of an extra inning does not — the home team still gets to bat, so a
  // mid-half away lead stays a table lookup.
  if (view.half === "top" && view.inning > 9 && diff !== 0 && state.outs >= 3) return diff > 0 ? 1 : 0;
  if (view.half === "bottom" && view.inning >= 9 && diff > 0) return 1;

  const battingHome = view.half === "bottom";
  const battingWin = winExpectancy({
    half: view.half,
    inning: view.inning,
    outs: view.outs,
    bases: view.bases,
    diff: battingHome ? diff : -diff
  });
  return battingHome ? battingWin : 1 - battingWin;
}

function trackTopSwing(state, player, wpa, result) {
  if (!state.topSwing || wpa > state.topSwing.wpa) {
    state.topSwing = {
      playerId: player.id,
      name: player.name,
      wpa,
      result,
      inning: state.inning,
      half: state.half
    };
  }
}

export function simulateGame(awayTeam, homeTeam, seed = "showdown", options = {}) {
  const rng = createRng(seed);
  const state = createInitialState(awayTeam, homeTeam, options);
  const events = [];

  while (shouldContinue(state)) {
    const event = playGameEvent(state, rng);
    events.push(event);
  }
  // A forfeit ends the loop with its event still queued; put it in the book.
  events.push(...state.pendingSubEvents.splice(0));

  return {
    seed,
    away: summarizeTeam(state, "away"),
    home: summarizeTeam(state, "home"),
    winner: state.forfeitedBy
      ? state[state.forfeitedBy === "away" ? "home" : "away"].name
      : state.score.away > state.score.home ? state.away.name : state.home.name,
    boxScore: buildBoxScore(state),
    events,
    innings: inningsPlayed(state),
    topSwing: state.topSwing,
    twenties: state.twenties,
    // The board this game was played on, so a simulated game hangs one too.
    lineScore: state.lineScore
  };
}

// Every d20 the game throws goes through here, so a natural 20 is counted no
// matter which kind of roll it was — a pitch, a swing, a throw to a base. The
// count rides on the state and is read off the finished game (twenties-game).
function rollD20(state, rng) {
  const roll = rng.d20();
  if (roll === 20) state.twenties = (state.twenties ?? 0) + 1;
  return roll;
}

// Innings actually played in a finished game. The final out of a bottom half
// rolls the state to the top of the NEXT inning before the game-over check,
// so a terminal "top of the 10th" state was a nine-inning game.
export function inningsPlayed(state) {
  return state.half === "top" ? state.inning - 1 : state.inning;
}

export function playGameEvent(state, rng) {
  // Between-play engine events first: a forced double-switch at the turn of
  // an inning, or the forfeit that ends the game.
  if (state.pendingSubEvents?.length) return state.pendingSubEvents.shift();
  return autoSubstitute(state) ?? playStealAttempt(state, rng) ?? playPlateAppearance(state, rng);
}

export function playPlateAppearance(state, rng) {
  const battingSide = state.half === "top" ? "away" : "home";
  const pitchingSide = battingSide === "away" ? "home" : "away";
  const battingTeam = state[battingSide];
  const pitchingTeam = state[pitchingSide];
  const batter = battingTeam.lineup[state.lineupIndex[battingSide] % battingTeam.lineup.length];
  const pitcher = currentPitcher(state, pitchingSide);
  const fatiguePenalty = pitcherFatigue(state.pitching[pitchingSide], pitcher);
  const pitcherWasFresh = fatiguePenalty === 0;
  const responsiblePitcher = { id: pitcher.id, freshAtReach: pitcherWasFresh };

  const before = snapshotBases(state);
  const outsBefore = state.outs;
  const scoreBefore = { ...state.score };
  const wpBefore = winProbabilityHome(state);
  const controlRoll = rollD20(state, rng);
  const effectiveControl = pitcher.control - fatiguePenalty;
  const controlTotal = controlRoll + effectiveControl;
  const chartOwner = controlTotal > batter.onBase ? "pitcher" : "hitter";
  const resultRoll = rollD20(state, rng);
  const result = resolveChart(chartOwner === "pitcher" ? pitcher.chart : batter.chart, resultRoll);
  state.lastPlayDetails = null;
  const runs = applyResult(state, result, batter, battingSide, pitchingSide, rng, responsiblePitcher);
  if (state.pendingAdvance) state.pendingAdvance.batter = { id: batter.id, name: batter.name };

  const outsOnPlay = Math.max(0, state.outs - outsBefore);
  recordStats(state, battingSide, pitchingSide, batter, pitcher, result, runs, outsOnPlay, pitcherWasFresh, { controlRoll, resultRoll });
  battingTeam.plateAppearances += 1;
  state.lineupIndex[battingSide] += 1;
  // The at-bat is over: every runner's steal attempt refreshes.
  //
  // Except the man who just trotted into second on a 1B+. He has taken a base on
  // this play already — uncontested, no throw, no die — and letting him break for
  // third before a pitch is thrown turns the free base into a down payment on
  // another one. It is one advance per hit: the base he walked into spends the
  // steal he would have had, and the at-bat after that hands it back.
  const trotted = result === RESULTS.SINGLE_PLUS && state.bases[1]?.id === batter.id;
  state.stealAttemptsThisPA = trotted ? [batter.id] : [];
  state.pitching[pitchingSide].outsRecorded += outsOnPlay;
  state.pitching[pitchingSide].battersFaced += 1;

  const wpAfter = winProbabilityHome(state);
  const battingWpa = battingSide === "home" ? wpAfter - wpBefore : wpBefore - wpAfter;
  ensureHitterLine(state, batter).wpa += battingWpa;
  const pitcherLine = ensurePitcherLine(state, pitcher);
  pitcherLine.wpa -= battingWpa;
  if (pitcherWasFresh) pitcherLine.fresh.wpa -= battingWpa;
  trackTopSwing(state, batter, battingWpa, result);

  const event = {
    inning: state.inning,
    half: state.half,
    battingTeam: battingTeam.name,
    pitchingTeam: pitchingTeam.name,
    batter: batter.name,
    batterId: batter.id ?? null,
    pitcher: pitcher.name,
    pitcherId: pitcher.id ?? null,
    controlRoll,
    pitcherControl: pitcher.control,
    effectiveControl,
    fatiguePenalty,
    controlTotal,
    onBase: batter.onBase,
    chartOwner,
    resultRoll,
    result,
    outsBefore,
    outsAfter: state.outs,
    basesBefore: before,
    basesAfter: snapshotBases(state),
    scoreBefore,
    scoreAfter: { ...state.score },
    runs,
    wpBefore,
    wpAfter,
    wpa: battingWpa,
    playDetails: state.lastPlayDetails
  };

  if (state.half === "bottom" && state.inning >= 9 && state.score.home > state.score.away) {
    state.walkoff = true;
    state.pendingAdvance = null;
    return event;
  }

  if (state.outs >= 3) {
    advanceHalfInning(state);
  }

  return event;
}

export function playStealAttempt(state, rng) {
  const pitchingSide = state.half === "top" ? "home" : "away";
  const stealAttempt = chooseStealAttempt(state, pitchingSide);
  if (!stealAttempt) return null;
  return performStealAttempt(state, stealAttempt, rng);
}

// Every steal opportunity on the current bases, unfiltered by the auto-play
// break-even, so an interactive layer can offer (and force) attempts the
// auto-runner would decline. Auto play never calls this.
export function stealCandidates(state) {
  if (state.outs >= 3 || state.pendingAdvance) return [];
  const pitchingSide = state.half === "top" ? "home" : "away";
  const [runnerOnFirst, runnerOnSecond, runnerOnThird] = state.bases;
  const fielding = totalCatcherFielding(state[pitchingSide]);
  const candidates = [];

  // Real occupancy decides which bases are open; canStealThisPA only gates
  // the runner's own eligibility (one attempt per runner per at-bat).
  if (runnerOnSecond && !runnerOnThird && canStealThisPA(state, runnerOnSecond)) {
    candidates.push(createAdvanceCandidate({
      runner: runnerOnSecond,
      fromIndex: 1,
      toIndex: 2,
      outsForDecision: state.outs,
      fielding,
      // The throw to third is shorter: +5 to the catcher, not the runner.
      targetBonus: -5
    }));
  }
  if (runnerOnFirst && !runnerOnSecond && canStealThisPA(state, runnerOnFirst)) {
    candidates.push(createAdvanceCandidate({
      runner: runnerOnFirst,
      fromIndex: 0,
      toIndex: 1,
      outsForDecision: state.outs,
      fielding,
      targetBonus: 0
    }));
  }

  return annotateAdvanceOptions(state, candidates);
}

// Force a steal attempt for the runner on the given base index, regardless of
// what the break-even says. Returns the steal event, or null when that runner
// has no open base ahead.
export function attemptSteal(state, fromIndex, rng) {
  const candidate = stealCandidates(state).find((item) => item.fromIndex === fromIndex);
  if (!candidate) return null;
  return performStealAttempt(state, candidate, rng);
}

function performStealAttempt(state, stealAttempt, rng) {
  // Safe or gunned down, this runner's attempt is spent until the next batter.
  state.stealAttemptsThisPA = [...(state.stealAttemptsThisPA ?? []), stealAttempt.runner.id];
  const battingSide = state.half === "top" ? "away" : "home";
  const pitchingSide = battingSide === "away" ? "home" : "away";
  const battingTeam = state[battingSide];
  const pitchingTeam = state[pitchingSide];
  const batter = battingTeam.lineup[state.lineupIndex[battingSide] % battingTeam.lineup.length];
  const pitcher = currentPitcher(state, pitchingSide);
  const before = snapshotBases(state);
  const outsBefore = state.outs;
  const scoreBefore = { ...state.score };
  const wpBefore = winProbabilityHome(state);
  const runner = { id: stealAttempt.runner.id, name: stealAttempt.runner.name };
  const attemptResult = resolveStealAttempt(state, stealAttempt, rng);
  if (!attemptResult.safe) {
    state.pitching[pitchingSide].outsRecorded += 1;
    ensurePitcherLine(state, pitcher).outs += 1;
    // The runner is charged the caught-stealing on his own line (see
    // resolveStealAttempt); the man who threw him out gets the credit on his.
    const catcher = catcherOf(pitchingTeam);
    if (catcher?.id) ensureHitterLine(state, catcher, pitchingSide).csCaught += 1;
  }
  const wpAfter = winProbabilityHome(state);
  const battingWpa = battingSide === "home" ? wpAfter - wpBefore : wpBefore - wpAfter;
  ensureHitterLine(state, runner).wpa += battingWpa;
  ensurePitcherLine(state, pitcher).wpa -= battingWpa;
  trackTopSwing(state, runner, battingWpa, attemptResult.safe ? "SB" : "CS");
  const event = {
    type: "steal",
    inning: state.inning,
    half: state.half,
    battingTeam: battingTeam.name,
    pitchingTeam: pitchingTeam.name,
    batter: batter.name,
    batterId: batter.id ?? null,
    // Whose base it is. The row shows the RUNNER's name, and without his id it
    // was hovering the man standing at the plate — who had nothing to do with it.
    runner: runner.name,
    runnerId: runner.id ?? null,
    pitcher: pitcher.name,
    pitcherId: pitcher.id ?? null,
    controlRoll: null,
    pitcherControl: pitcher.control,
    effectiveControl: pitcher.control,
    fatiguePenalty: 0,
    controlTotal: null,
    onBase: batter.onBase,
    chartOwner: "steal",
    resultRoll: null,
    result: attemptResult.safe ? "SB" : "CS",
    outsBefore,
    outsAfter: state.outs,
    basesBefore: before,
    basesAfter: snapshotBases(state),
    scoreBefore,
    scoreAfter: { ...state.score },
    runs: 0,
    wpBefore,
    wpAfter,
    wpa: battingWpa,
    playDetails: {
      kind: "steal",
      stealAttempt: attemptResult,
      // Nobody swung: the whole win-probability swing is baserunning.
      baserunningWpa: battingWpa
    }
  };

  if (state.outs >= 3) {
    advanceHalfInning(state);
  }

  return event;
}

// Can the batting team drop a sacrifice bunt right now? Needs a runner to
// move, fewer than two outs, and no play already waiting on a decision.
// Squeeze plays are disallowed: with a runner on third, the bunt is off.
export function canBunt(state) {
  const [first, second, third] = state.bases;
  return state.outs < 2 && Boolean(first || second) && !third && !state.pendingAdvance;
}

// Traditional Showdown: the sacrifice always gets down, so the only call is
// whether the out is worth the bases. Shown as 1 wherever a chance is asked.
export function buntSuccessChance(state) {
  return canBunt(state) ? 1 : 0;
}

// A sacrifice bunt as a full plate appearance, traditional MLB Showdown
// rules: no roll — the batter is out and every runner moves up, always
// (never from third: canBunt disallows the squeeze). Auto play never bunts.
export function attemptBunt(state) {
  if (!canBunt(state)) return null;
  const battingSide = state.half === "top" ? "away" : "home";
  const pitchingSide = battingSide === "away" ? "home" : "away";
  const battingTeam = state[battingSide];
  const pitchingTeam = state[pitchingSide];
  const batter = battingTeam.lineup[state.lineupIndex[battingSide] % battingTeam.lineup.length];
  const pitcher = currentPitcher(state, pitchingSide);

  const before = snapshotBases(state);
  const outsBefore = state.outs;
  const scoreBefore = { ...state.score };
  const wpBefore = winProbabilityHome(state);

  // canBunt guarantees third is empty — no squeeze plays.
  const [first, second] = state.bases;
  const runs = 0;

  state.outs += 1;
  state.bases = [null, first ?? null, second ?? null];
  const result = "SAC";

  state.lastPlayDetails = {
    kind: "bunt",
    outsBefore,
    clean: true,
    leadOut: null
  };

  const hitterLine = ensureHitterLine(state, batter);
  const pitcherLine = ensurePitcherLine(state, pitcher);
  hitterLine.pa += 1;
  hitterLine.rbi += runs;
  pitcherLine.bf += 1;
  const outsOnPlay = state.outs - outsBefore;
  pitcherLine.outs += outsOnPlay;
  battingTeam.plateAppearances += 1;
  state.lineupIndex[battingSide] += 1;
  // The at-bat is over: every runner's steal attempt refreshes.
  state.stealAttemptsThisPA = [];
  state.pitching[pitchingSide].outsRecorded += outsOnPlay;
  state.pitching[pitchingSide].battersFaced += 1;
  state[battingSide].runs = state.score[battingSide];
  state[pitchingSide].runsAllowed = state.score[battingSide];

  const wpAfter = winProbabilityHome(state);
  const battingWpa = battingSide === "home" ? wpAfter - wpBefore : wpBefore - wpAfter;
  hitterLine.wpa += battingWpa;
  pitcherLine.wpa -= battingWpa;
  trackTopSwing(state, batter, battingWpa, result);

  const event = {
    type: "bunt",
    inning: state.inning,
    half: state.half,
    battingTeam: battingTeam.name,
    pitchingTeam: pitchingTeam.name,
    batter: batter.name,
    batterId: batter.id ?? null,
    pitcher: pitcher.name,
    pitcherId: pitcher.id ?? null,
    controlRoll: null,
    pitcherControl: pitcher.control,
    effectiveControl: pitcher.control,
    fatiguePenalty: 0,
    controlTotal: null,
    onBase: batter.onBase,
    chartOwner: "bunt",
    resultRoll: null,
    result,
    outsBefore,
    outsAfter: state.outs,
    basesBefore: before,
    basesAfter: snapshotBases(state),
    scoreBefore,
    scoreAfter: { ...state.score },
    runs,
    wpBefore,
    wpAfter,
    wpa: battingWpa,
    playDetails: state.lastPlayDetails
  };

  if (state.half === "bottom" && state.inning >= 9 && state.score.home > state.score.away) {
    state.walkoff = true;
    return event;
  }
  if (state.outs >= 3) advanceHalfInning(state);
  return event;
}

// Put the batter on intentionally — no rolls, runners advance only if forced.
// A defense-side call; auto play never issues one.
export function intentionalWalk(state) {
  if (isGameOver(state)) return null;
  const battingSide = state.half === "top" ? "away" : "home";
  const pitchingSide = battingSide === "away" ? "home" : "away";
  const battingTeam = state[battingSide];
  const pitchingTeam = state[pitchingSide];
  const batter = battingTeam.lineup[state.lineupIndex[battingSide] % battingTeam.lineup.length];
  const pitcher = currentPitcher(state, pitchingSide);

  const before = snapshotBases(state);
  const outsBefore = state.outs;
  const scoreBefore = { ...state.score };
  const wpBefore = winProbabilityHome(state);

  const runs = applyWalk(state, batter, battingSide, pitchingSide, pitcher);
  state.lastPlayDetails = { kind: "ibb", outsBefore };

  const hitterLine = ensureHitterLine(state, batter);
  const pitcherLine = ensurePitcherLine(state, pitcher);
  hitterLine.pa += 1;
  hitterLine.bb += 1;
  hitterLine.rbi += runs;
  // No pitches thrown: an intentional pass charges the walk but never counts
  // as a batter faced — neither in the box score nor against the arm's
  // fatigue tank.
  pitcherLine.bb += 1;
  battingTeam.plateAppearances += 1;
  state.lineupIndex[battingSide] += 1;
  // The at-bat is over: every runner's steal attempt refreshes.
  state.stealAttemptsThisPA = [];
  state[battingSide].runs = state.score[battingSide];
  state[pitchingSide].runsAllowed = state.score[battingSide];

  const wpAfter = winProbabilityHome(state);
  const battingWpa = battingSide === "home" ? wpAfter - wpBefore : wpBefore - wpAfter;
  hitterLine.wpa += battingWpa;
  pitcherLine.wpa -= battingWpa;
  trackTopSwing(state, batter, battingWpa, "IBB");

  const event = {
    type: "intentional-walk",
    inning: state.inning,
    half: state.half,
    battingTeam: battingTeam.name,
    pitchingTeam: pitchingTeam.name,
    batter: batter.name,
    batterId: batter.id ?? null,
    pitcher: pitcher.name,
    pitcherId: pitcher.id ?? null,
    controlRoll: null,
    pitcherControl: pitcher.control,
    effectiveControl: pitcher.control,
    fatiguePenalty: 0,
    controlTotal: null,
    onBase: batter.onBase,
    chartOwner: "ibb",
    resultRoll: null,
    result: "IBB",
    outsBefore,
    outsAfter: state.outs,
    basesBefore: before,
    basesAfter: snapshotBases(state),
    scoreBefore,
    scoreAfter: { ...state.score },
    runs,
    wpBefore,
    wpAfter,
    wpa: battingWpa,
    playDetails: state.lastPlayDetails
  };

  if (state.half === "bottom" && state.inning >= 9 && state.score.home > state.score.away) {
    state.walkoff = true;
  }
  return event;
}

// The play waiting on a send-the-runners call, if any.
export function pendingAdvanceDecision(state) {
  return state.pendingAdvance ?? null;
}

// Resolve a deferred extra-base decision: send the first `sendCount` runners
// (lead runner first — a trailing runner can only go if the lead goes), hold
// the rest. Pass "auto" to fall back to the decision-matrix policy. Returns
// the advance event, or null when everyone holds. Auto play never defers, so
// it never calls this.
export function resolveAdvanceDecision(state, sendCount, rng) {
  const pending = state.pendingAdvance;
  if (!pending) return null;
  state.pendingAdvance = null;
  const { battingSide, pitchingSide, candidates, kind, batter } = pending;
  // The free men are going whatever is chosen. Holding a base nobody can throw
  // you out taking is not a choice the player is allowed to make by accident, so
  // the floor is the floor even if a stale menu says otherwise.
  const floor = pending.autoSend ?? 0;
  const chosen = sendCount === "auto"
    ? leadPrefixAttempts(candidates)
    : candidates.slice(0, Math.max(floor, Math.min(sendCount, candidates.length)));
  if (!chosen.length) return null;

  const before = snapshotBases(state);
  const outsBefore = state.outs;
  const scoreBefore = { ...state.score };
  const wpBefore = winProbabilityHome(state);
  const pitcher = currentPitcher(state, pitchingSide);
  const lead = chosen[0].runner;

  const attemptResult = resolveAdvanceAttempts(state, chosen, battingSide, pitchingSide, rng);
  // A 1B+ batter held at first while this call was pending: the send has now
  // emptied second, one way or the other, so he takes it as part of this play.
  // The at-bat is over by the time this resolves, so the base spends his steal
  // here rather than at the end of it — same rule, later doorway.
  const trotted = pending.batterTakesSecond ? takeUncontestedSecond(state) : null;
  if (trotted) state.stealAttemptsThisPA = [...(state.stealAttemptsThisPA ?? []), trotted.id];
  if (batter?.id && attemptResult.runs > 0) {
    ensureHitterLine(state, batter).rbi += attemptResult.runs;
  }
  const outsOnPlay = state.outs - outsBefore;
  if (outsOnPlay > 0) {
    state.pitching[pitchingSide].outsRecorded += outsOnPlay;
    ensurePitcherLine(state, pitcher).outs += outsOnPlay;
  }
  state[battingSide].runs = state.score[battingSide];
  state[pitchingSide].runsAllowed = state.score[battingSide];

  const wpAfter = winProbabilityHome(state);
  const battingWpa = battingSide === "home" ? wpAfter - wpBefore : wpBefore - wpAfter;
  // An extra base taken on a ball in play is TWO men's doing, so they split it:
  // the hitter put the ball where a base could be had, and the runner is the one
  // who went and got it. Half each.
  //
  // A steal is not that. Nobody swung — the runner took the base off nobody's
  // bat — so performStealAttempt gives him the whole swing, and this is the line
  // between the two.
  const hitter = batter?.id ? { id: batter.id, name: batter.name } : null;
  const taker = { id: lead.id, name: lead.name };
  if (hitter && hitter.id !== taker.id) {
    ensureHitterLine(state, hitter).wpa += battingWpa / 2;
    ensureHitterLine(state, taker).wpa += battingWpa / 2;
  } else {
    // The batter who took the extra base himself is both men, and gets both
    // halves — which is the whole swing, credited once.
    ensureHitterLine(state, hitter ?? taker).wpa += battingWpa;
  }
  ensurePitcherLine(state, pitcher).wpa -= battingWpa;
  // The play itself, for the biggest-swing record, belongs to the man who hit it.
  trackTopSwing(state, hitter ?? taker, battingWpa, attemptResult.thrownAttempt?.safe === false ? "ADV-OUT" : "ADV");

  state.lastPlayDetails = {
    kind: kind === "tagup" ? "tagup" : "advance",
    outsBefore,
    attempts: attemptResult.attempts,
    thrownAttempt: attemptResult.thrownAttempt,
    // A sent runner's advance is its own event, so its whole swing is baserunning.
    baserunningWpa: battingWpa
  };

  const event = {
    type: "advance",
    inning: state.inning,
    half: state.half,
    battingTeam: state[battingSide].name,
    pitchingTeam: state[pitchingSide].name,
    batter: batter?.name ?? lead.name,
    batterId: batter?.id ?? lead.id ?? null,
    pitcher: pitcher.name,
    pitcherId: pitcher.id ?? null,
    controlRoll: null,
    pitcherControl: pitcher.control,
    effectiveControl: pitcher.control,
    fatiguePenalty: 0,
    controlTotal: null,
    onBase: null,
    chartOwner: "advance",
    resultRoll: null,
    result: attemptResult.thrownAttempt?.safe === false ? "ADV-OUT" : "ADV",
    outsBefore,
    outsAfter: state.outs,
    basesBefore: before,
    basesAfter: snapshotBases(state),
    scoreBefore,
    scoreAfter: { ...state.score },
    runs: attemptResult.runs,
    wpBefore,
    wpAfter,
    wpa: battingWpa,
    playDetails: state.lastPlayDetails
  };

  if (state.half === "bottom" && state.inning >= 9 && state.score.home > state.score.away) {
    state.walkoff = true;
    return event;
  }
  if (state.outs >= 3) advanceHalfInning(state);
  return event;
}

export function createInitialState(awayTeam, homeTeam, options = {}) {
  return {
    away: createRuntimeTeam(awayTeam),
    home: createRuntimeTeam(homeTeam),
    inning: 1,
    half: "top",
    outs: 0,
    bases: [null, null, null],
    score: { away: 0, home: 0 },
    lineupIndex: { away: 0, home: 0 },
    pitching: {
      away: { pitcherIndex: 0, outsRecorded: 0, battersFaced: 0 },
      home: { pitcherIndex: 0, outsRecorded: 0, battersFaced: 0 }
    },
    stats: {
      hitters: new Map(),
      pitchers: new Map()
    },
    // Runs by inning, for the hand-operated board. Grows into extras.
    lineScore: { away: [], home: [] },
    lastPlayDetails: null,
    topSwing: null,
    walkoff: false,
    // Natural 20s rolled this game, either dugout, every kind of roll — the record
    // book keeps the luckiest afternoon (see rollD20 and the twenties-game record).
    twenties: 0,
    // Interactive-layer flags. Auto play leaves both null: pitching plans run
    // themselves and extra-base advances resolve by their own break-evens.
    manualPitchingFor: null,
    deferAdvancesFor: null,
    pendingAdvance: null,
    // Runner ids that already attempted a steal during the current at-bat —
    // one green light per runner per batter, safe or not.
    stealAttemptsThisPA: [],
    // Substituted-out player ids, per side. Baseball's one-way door: a man
    // who leaves the game does not come back into it.
    removed: { away: [], home: [] },
    // Events the engine generates BETWEEN plays — forced double-switch
    // completions at an inning turn, a forfeit — waiting for the caller to
    // read them into the book (playGameEvent and the battle controller both
    // drain this).
    pendingSubEvents: [],
    // The side that could not field a legal defense. Set with gameOver: the
    // game ends and the other club wins, whatever the score reads.
    forfeitedBy: null
  };
}

// One steal attempt per runner per at-bat: once a runner goes, he doesn't
// get another until the batter's turn resolves.
function canStealThisPA(state, runner) {
  return Boolean(runner) && !(state.stealAttemptsThisPA ?? []).includes(runner.id);
}

function createRuntimeTeam(team) {
  return {
    ...team,
    plateAppearances: 0,
    lineup: team.lineup.map((player) => ({ ...player })),
    // Only full-roster teams carry one; everyone else's dugout is just the nine.
    bench: (team.bench ?? []).map((player) => ({ ...player })),
    pitchers: buildPitchingPlan(team.pitchers)
  };
}

function shouldContinue(state) {
  if (state.walkoff) return false;
  if (state.gameOver) return false;
  if (state.half === "bottom" && state.inning >= 9 && state.score.home > state.score.away) return false;
  return true;
}

export function isGameOver(state) {
  return !shouldContinue(state);
}

// Manually bring in the next pitcher, ahead of the automatic plan. Returns the
// new pitcher, or null when the staff is spent. Auto play never calls this.
export function changePitcher(state, side, targetIndex = null) {
  const runtime = state.pitching[side];
  const team = state[side];
  if (runtime.pitcherIndex >= team.pitchers.length - 1) return null;
  // Picking a specific arm pulls him to the front of the remaining staff, so
  // skipped relievers stay available for later.
  if (targetIndex !== null) {
    if (targetIndex <= runtime.pitcherIndex || targetIndex >= team.pitchers.length) return null;
    const [picked] = team.pitchers.splice(targetIndex, 1);
    team.pitchers.splice(runtime.pitcherIndex + 1, 0, picked);
  }
  runtime.pitcherIndex += 1;
  runtime.outsRecorded = 0;
  runtime.battersFaced = 0;
  return team.pitchers[runtime.pitcherIndex];
}

// ---- Substitutions -----------------------------------------------------------
//
// The bench opens in the seventh (SUB_MIN_INNING and the decision rules live
// in substitutions.js). From the seventh on, a bench bat can hit for the man
// due up, run for a man on base, or take the field for a defender. Every
// door is one-way: the man who comes out is out for good.

// The bench bats still in the dugout: never entered, never removed.
export function availableBench(state, side) {
  const team = state[side];
  const removed = state.removed?.[side] ?? [];
  const inLineup = new Set(team.lineup.map((player) => player.id));
  return (team.bench ?? []).filter((card) => !removed.includes(card.id) && !inLineup.has(card.id));
}

export function substitutionEligibility(state, side) {
  if (isGameOver(state)) return { allowed: false, reason: "the game is over" };
  if (state.inning < SUB_MIN_INNING) return { allowed: false, reason: `the bench opens in the ${SUB_MIN_INNING}th` };
  // A play mid-resolution (runners waiting on a send call) is not a moment
  // anybody steps out of the dugout — and the due batter the HUD shows is
  // not the man the lineup index points at until the call resolves.
  if (state.pendingAdvance) return { allowed: false, reason: "the play is still live" };
  if (!availableBench(state, side).length) return { allowed: false, reason: "no bench left" };
  return { allowed: true, reason: "" };
}

// The runtime shape a bench card takes entering the lineup: he inherits the
// outgoing man's defensive slot (there are no mid-game position shuffles),
// rated by his own card at that spot.
function benchLineupPlayer(card, outgoing) {
  const label = outgoing.assignedPosition ?? outgoing.defensivePosition ?? outgoing.position;
  const glove = benchSlotFielding(card, label);
  return {
    ...card,
    cardPosition: card.position,
    defensivePosition: label,
    assignedPosition: label,
    fielding: glove.value,
    outOfPosition: glove.outOfPosition
  };
}

// Put a bench man into the lineup at `index`, in the outgoing man's spot in
// the order. The lineup is REPLACED, not mutated: relief decisions memoize
// their read of the opposing nine on the array's identity (see
// pitching.lineupProfile), and the nine just changed.
function applyLineupSub(state, side, index, sub) {
  const team = state[side];
  const outgoing = team.lineup[index];
  const entering = benchLineupPlayer(sub, outgoing);
  team.lineup = team.lineup.map((player, at) => (at === index ? entering : player));
  team.bench = (team.bench ?? []).filter((card) => card.id !== sub.id);
  state.removed[side].push(outgoing.id);
  return { entering, outgoing };
}

function substitutionEvent(state, side, type, entering, outgoing, extra = {}) {
  return {
    type,
    side,
    team: state[side].name,
    in: { id: entering.id, name: entering.name },
    out: { id: outgoing.id, name: outgoing.name },
    inning: state.inning,
    half: state.half,
    ...extra
  };
}

// The one spot where a club may LEGALLY strand its own defense: the home
// side batting in the ninth or later. Win it right here and the field never
// has to be taken; fail to, and the turn of the inning forfeits the game
// (see realignDefense). Everywhere else a sub that leaves no coverable
// defense is refused outright.
export function walkoffSpot(state, side) {
  return side === "home" && state.half === "bottom" && state.inning >= 9;
}

// Would the club still be able to field a legal defense after `benchId`
// replaces `outgoingId` — counting the bench men who could come on later to
// cover (the double-switch)? The gate on every batting-side substitution,
// and the question the UI's warnings ask.
export function pinchSubKeepsDefense(state, side, benchId, outgoingId) {
  const team = state[side];
  const sub = availableBench(state, side).find((card) => card.id === benchId);
  const index = team.lineup.findIndex((player) => player.id === outgoingId);
  if (!sub || index < 0) return false;
  const nextLineup = team.lineup.map((player, at) => (at === index ? sub : player));
  const remainingBench = availableBench(state, side).filter((card) => card.id !== sub.id);
  return canCoverField(nextLineup, remainingBench);
}

// Can `benchId` take the field for `targetPlayerId` RIGHT NOW — the nine that
// results must cover the eight positions by itself (shuffles allowed; the
// realignment seats everyone). A defensive sub has no walk-off to hide
// behind, so there is no exception.
export function defensiveSubFits(state, side, benchId, targetPlayerId) {
  const team = state[side];
  const sub = availableBench(state, side).find((card) => card.id === benchId);
  const index = team.lineup.findIndex((player) => player.id === targetPlayerId);
  if (!sub || index < 0) return false;
  return coverageAssignment(team.lineup.map((player, at) => (at === index ? sub : player))) !== null;
}

// Seat the nine per a coverage assignment: each matched man takes his label
// at his own rating there, whoever is unmatched bats on as the DH.
function applyDefenseAssignment(lineup, assignment) {
  const labelById = new Map();
  for (const [label, player] of assignment) labelById.set(player.id, label);
  for (const player of lineup) {
    const label = labelById.get(player.id) ?? "DH";
    const glove = benchSlotFielding(player, label);
    player.defensivePosition = label;
    player.assignedPosition = label;
    player.fielding = glove.value;
    player.outOfPosition = glove.outOfPosition;
  }
}

// The turn of an inning puts a defense on the field, and this is where the
// club must actually HAVE one. A nine standing legally is left alone. A nine
// broken by pinch moves is reseated — the double-switch: bench men come on
// (as recorded defensive subs) for the bats that stranded the alignment, and
// every glove lands where it legally can. A club that cannot cover the field
// even off its bench FORFEITS: out-of-position is not a penalty, it is not a
// team.
function realignDefense(state, side) {
  const team = state[side];
  if (!team.lineup.length || alignmentLegal(team.lineup)) return;
  let assignment = coverageAssignment(team.lineup);
  if (!assignment) {
    const bench = availableBench(state, side);
    const pooled = coverageAssignment([...team.lineup, ...bench]);
    if (!pooled) {
      state.gameOver = true;
      state.forfeitedBy = side;
      state.pendingSubEvents.push({
        type: "forfeit",
        side,
        team: team.name,
        inning: state.inning,
        half: state.half
      });
      return;
    }
    const matched = new Set([...pooled.values()].map((player) => player.id));
    const entering = bench.filter((card) => matched.has(card.id));
    const unmatched = team.lineup.filter((player) => !matched.has(player.id));
    // One unmatched man stays on to DH — the best bat among them; the rest
    // leave for the men who can actually cover the field.
    const keep = [...unmatched].sort((a, b) =>
      roughBatValue(b) - roughBatValue(a) || String(a.id).localeCompare(String(b.id)))[0];
    const leaving = unmatched.filter((player) => player !== keep);
    entering.forEach((card, at) => {
      const out = leaving[at];
      const index = team.lineup.findIndex((player) => player.id === out.id);
      const swapped = applyLineupSub(state, side, index, card);
      ensureHitterLine(state, swapped.entering, side);
      state.pendingSubEvents.push(substitutionEvent(state, side, "defensive-sub", swapped.entering, swapped.outgoing, {
        slot: [...pooled].find(([, player]) => player.id === card.id)?.[0] ?? null,
        forced: true
      }));
    });
    assignment = coverageAssignment(team.lineup);
    if (!assignment) return; // cannot happen: the pooled matching promised it
  }
  applyDefenseAssignment(team.lineup, assignment);
}

// A bench bat hits for the man due up. Returns the event, or null when the
// swap is illegal — the caller asked at the wrong moment or for the wrong
// man, or the move would strand the defense outside the walk-off spot.
export function pinchHit(state, side, benchId) {
  const battingSide = state.half === "top" ? "away" : "home";
  if (side !== battingSide) return null;
  if (!substitutionEligibility(state, side).allowed) return null;
  const sub = availableBench(state, side).find((card) => card.id === benchId);
  if (!sub) return null;
  const team = state[side];
  const index = state.lineupIndex[side] % team.lineup.length;
  if (!pinchSubKeepsDefense(state, side, benchId, team.lineup[index].id) && !walkoffSpot(state, side)) return null;
  const { entering, outgoing } = applyLineupSub(state, side, index, sub);
  return substitutionEvent(state, side, "pinch-hitter", entering, outgoing);
}

// A bench man runs for the man standing at `baseIndex`. He takes the base AND
// the lineup spot; the run he might score still belongs to the pitcher who
// put the original man on (the responsibility fields ride the base).
export function pinchRun(state, side, benchId, baseIndex) {
  const battingSide = state.half === "top" ? "away" : "home";
  if (side !== battingSide) return null;
  if (!substitutionEligibility(state, side).allowed) return null;
  const runner = state.bases[baseIndex];
  if (!runner) return null;
  const team = state[side];
  const index = team.lineup.findIndex((player) => player.id === runner.id);
  if (index < 0) return null;
  const sub = availableBench(state, side).find((card) => card.id === benchId);
  if (!sub) return null;
  if (!pinchSubKeepsDefense(state, side, benchId, runner.id) && !walkoffSpot(state, side)) return null;
  const { entering, outgoing } = applyLineupSub(state, side, index, sub);
  state.bases[baseIndex] = {
    id: entering.id,
    name: entering.name,
    speed: Number(entering.speed) || 0,
    responsiblePitcherId: runner.responsiblePitcherId ?? null,
    responsiblePitcherFresh: runner.responsiblePitcherFresh ?? null
  };
  // A green light already spent on this base is spent: the fresh legs do not
  // mint a second steal attempt in the same at-bat.
  if ((state.stealAttemptsThisPA ?? []).includes(outgoing.id)) {
    state.stealAttemptsThisPA.push(entering.id);
  }
  return substitutionEvent(state, side, "pinch-runner", entering, outgoing, { base: baseLabel(baseIndex) });
}

// A bench man takes the field for a defender, while this side pitches. His
// box-score line is seeded on entry — a glove man who never bats would
// otherwise play the whole ninth and appear nowhere.
export function defensiveSub(state, side, benchId, targetPlayerId) {
  const fieldingSide = state.half === "top" ? "home" : "away";
  if (side !== fieldingSide) return null;
  if (!substitutionEligibility(state, side).allowed) return null;
  const team = state[side];
  const index = team.lineup.findIndex((player) => player.id === targetPlayerId);
  if (index < 0) return null;
  const sub = availableBench(state, side).find((card) => card.id === benchId);
  if (!sub) return null;
  // The nine that results must cover the field on its own — shuffles
  // allowed, forfeits not. The realignment seats everyone afterwards, so a
  // corner-capable center fielder slides over when the new man takes center.
  if (!defensiveSubFits(state, side, benchId, targetPlayerId)) return null;
  const { entering, outgoing } = applyLineupSub(state, side, index, sub);
  ensureHitterLine(state, entering, side);
  applyDefenseAssignment(team.lineup, coverageAssignment(team.lineup));
  return substitutionEvent(state, side, "defensive-sub", entering, outgoing, {
    slot: entering.assignedPosition ?? entering.position
  });
}

// How many innings this side still has to take the field — the horizon a
// pinch-hitter's glove is priced over. The home side fields tops, so in the
// bottom of the ninth its answer is zero and a bat swings free.
function inningsLeftToField(state, side) {
  const horizon = Math.max(state.inning, 9);
  if (side === "home") return Math.max(0, horizon - state.inning + (state.half === "top" ? 1 : 0));
  return Math.max(0, horizon - state.inning + 1);
}

// The CPU skipper's trip to the bench for ONE side: run the decision rules
// (substitutions.js) and execute the first move that clears its bar. At most
// one substitution per call — callers loop by calling again. bias widens or
// narrows every bar (an NPC temperament; see ai.js subBias).
export function autoSubstituteFor(state, side, bias = 1) {
  if (!substitutionEligibility(state, side).allowed) return null;
  const battingSide = state.half === "top" ? "away" : "home";
  const leverage = stateLeverage(state);
  const bench = availableBench(state, side);
  if (side === battingSide) {
    const fieldingSide = side === "away" ? "home" : "away";
    const runtime = state.pitching[fieldingSide];
    const pitcher = state[fieldingSide].pitchers[runtime.pitcherIndex];
    const team = state[side];
    const dueBatter = team.lineup[state.lineupIndex[side] % team.lineup.length];
    // The CPU never strands its own defense: every candidate is checked
    // against the coverage the club would still have (bench cover counted).
    const keepsDefense = (card, outgoingId) => pinchSubKeepsDefense(state, side, card.id, outgoingId);
    const hit = pinchHitDecision({
      bench: bench.filter((card) => keepsDefense(card, dueBatter.id)),
      dueBatter,
      pitcher,
      fatigue: pitcherFatigue(runtime, pitcher),
      leverage,
      inning: state.inning,
      inningsLeftToField: inningsLeftToField(state, side),
      bias
    });
    if (hit) return pinchHit(state, side, hit.sub.id);
    const run = pinchRunDecision({
      bases: state.bases,
      bench,
      diff: battingEdge(state),
      leverage,
      inning: state.inning,
      bias,
      canCover: keepsDefense
    });
    if (run) return pinchRun(state, side, run.sub.id, run.baseIndex);
    return null;
  }
  const other = side === "away" ? "home" : "away";
  const glove = defensiveSubDecision({
    lineup: state[side].lineup,
    bench,
    lead: state.score[side] - state.score[other],
    inning: state.inning,
    bias,
    canCover: (card, targetId) => defensiveSubFits(state, side, card.id, targetId)
  });
  if (glove) return defensiveSub(state, side, glove.sub.id, glove.targetId);
  return null;
}

// Auto play's bench manager, mirroring how steals pre-empt the plate
// appearance in playGameEvent: the fielding side protects its lead first,
// then the batting side goes to its bench. Silent for every team that
// carries no bench — the batch sim, tournaments, and classic saves.
export function autoSubstitute(state) {
  const battingSide = state.half === "top" ? "away" : "home";
  const fieldingSide = battingSide === "away" ? "home" : "away";
  return autoSubstituteFor(state, fieldingSide) ?? autoSubstituteFor(state, battingSide);
}

// Snapshot of the current pitcher for an interactive layer: who is on the
// mound, how deep into their outing they are, and the live fatigue penalty.
export function pitcherStatus(state, side) {
  const pitcher = currentPitcher(state, side);
  const runtime = state.pitching[side];
  return {
    pitcher,
    outsRecorded: runtime.outsRecorded,
    plannedOuts: pitcher.plannedOuts,
    battersFaced: runtime.battersFaced ?? 0,
    // The card's printed tank (IP x 4) — IP 1 always reads /4.
    tiredAt: pitcherIpBatters(pitcher),
    fatiguePenalty: pitcherFatigue(runtime, pitcher),
    hasReliefAvailable: runtime.pitcherIndex < state[side].pitchers.length - 1
  };
}

// The skipper the simulator runs on. He goes to the pen when the pen holds a
// better arm than the one he has — see reliefDecision, which is the whole rule.
// This is the same call the adventure's NPC makes (bent by his temperament, see
// AI_PROFILES.pullMargin) and the same one the autopilot makes for the player's
// own pen — one rule, three places.
//
// It replaced "pull at fatigue 2", which was blind in both directions: it left a
// batting-practice starter in because he was not tired yet, and it took a tired
// ace out and handed the ball to a man two runs an inning worse. Tired is a
// reason to be WORSE. It was never the reason to leave.
//
// How hard the balanced skipper has to be beaten before he moves is not a
// number any more — it slides with the outs left to get (see pullMargin). What a
// skipper has instead is a TEMPERAMENT, in control points, added to that bar:
// positive rides his starter, negative is a quick hook. The balanced one has
// none.
export const AUTO_PULL_BIAS = 0;

// A starter's hard floor: twelve outs — four full innings — in the book before
// any skipper's arm goes up. It sits ABOVE the whole relief calculus on purpose.
// The math rates a pen arm at his fresh number, which is the right number for the
// batter in front of him and the wrong one for the game behind it: a great short
// reliever reads as a big upgrade in the first, then throws six innings he was
// never built for. The gap he shows fresh is real for four batters and a lie for
// the rest, and no threshold inside the calculus untangles "the reliever is great"
// from "the starter is bad." So the floor answers it from outside: the man you
// named to start gets his four innings, and only then does the skipper get to
// think. Same rule in a batch sim, an adventure game, and the autopilot, because
// every one of them comes through autoRelieve.
export const STARTER_MIN_OUTS = 12;

// The outs still to be recorded in a regulation game. What is left to cover is
// what decides whether the pen can afford to be spent now.
//
// The floor of 3 is a lie the rule knows about: past the ninth this reads "one
// inning left" forever, however long the game actually runs. That is why the
// sliding bar keeps a floor of its own — see MARGIN_LATE.
function outsRemainingToPitch(state) {
  const recorded = (state.inning - 1) * 3 + state.outs;
  return Math.max(3, 27 - recorded);
}

// Go to the pen if the pen is better. Returns the new pitcher, or null. Exported
// so the NPC skipper and the autopilot run the identical decision.
export function autoRelieve(state, side, bias = AUTO_PULL_BIAS) {
  const runtime = state.pitching[side];
  const team = state[side];
  if (runtime.pitcherIndex >= team.pitchers.length - 1) return null;
  const onMound = team.pitchers[runtime.pitcherIndex];
  // The starter's four-inning floor: while the man on the mound is the one who
  // started (index 0) and an SP, he stays until he has twelve outs, whatever the
  // pen holds. A reliever who inherited the game carries no such floor.
  if (runtime.pitcherIndex === 0 && onMound?.role === "SP" && (runtime.outsRecorded ?? 0) < STARTER_MIN_OUTS) {
    return null;
  }
  const decision = reliefDecision({
    current: onMound,
    currentFatigue: pitcherFatigue(runtime, onMound),
    bullpen: team.pitchers.slice(runtime.pitcherIndex + 1),
    batters: lineupProfile(state[side === "home" ? "away" : "home"].lineup),
    outsRemaining: outsRemainingToPitch(state),
    bias,
    leverage: stateLeverage(state)
  });
  if (!decision.pull) return null;
  // Bring in THAT arm — the best one out there — not merely the next man along
  // the bench. changePitcher pulls him to the front and leaves the arms he
  // jumped available for later.
  return changePitcher(state, side, runtime.pitcherIndex + 1 + decision.index);
}

function currentPitcher(state, side) {
  const runtime = state.pitching[side];
  const team = state[side];
  // Manual mode: the arm stays in (and tires) until changePitcher is called.
  // "both" puts every mound under manual control (the adventure's NPC skipper
  // makes its own calls); a single side string covers just that side.
  if (state.manualPitchingFor !== side && state.manualPitchingFor !== "both") {
    autoRelieve(state, side);
  }
  return team.pitchers[runtime.pitcherIndex] ?? team.pitchers[team.pitchers.length - 1];
}

function buildPitchingPlan(pitchers) {
  if (!pitchers.length) return [];
  const [starter, ...bullpen] = pitchers.map((player) => ({ ...player }));
  const sortedBullpen = bullpen.sort((a, b) => a.control - b.control || (a.ip ?? 0) - (b.ip ?? 0));
  const bullpenOuts = sortedBullpen.reduce((sum, pitcher) => sum + pitcherIpOuts(pitcher), 0);
  const starterTargetOuts = Math.max(0, 27 - bullpenOuts);
  return [
    { ...starter, plannedOuts: starterTargetOuts },
    ...sortedBullpen.map((pitcher) => ({ ...pitcher, plannedOuts: pitcherIpOuts(pitcher) }))
  ];
}

// Fatigue runs on batters faced alone: every IP of stamina covers four
// batters, so an IP 6 starter handles 24 batters at full strength and tires
// on the 25th, sinking another point every four batters after that. Runs
// allowed are a box-score fact, not a fatigue input.
const BATTERS_PER_IP = 4;

function pitcherFatigue(runtime, pitcher) {
  const limit = pitcherIpBatters(pitcher);
  const faced = runtime.battersFaced ?? 0;
  if (faced < limit) return 0;
  return Math.floor((faced - limit) / BATTERS_PER_IP) + 1;
}

function pitcherIpBatters(pitcher) {
  const ip = Number(pitcher?.ip ?? 0);
  if (!Number.isFinite(ip)) return 0;
  return Math.max(0, Math.round(ip * BATTERS_PER_IP));
}

function pitcherIpOuts(pitcher) {
  const ip = Number(pitcher?.ip ?? 0);
  if (!Number.isFinite(ip)) return 0;
  return Math.max(0, Math.round(ip * 3));
}

function applyResult(state, result, batter, battingSide, pitchingSide, rng, pitcher) {
  switch (result) {
    case RESULTS.PU:
    case RESULTS.SO:
      state.outs += 1;
      return 0;
    case RESULTS.FB:
      return applyFlyout(state, batter, battingSide, pitchingSide, rng);
    case RESULTS.GB:
      return applyGroundout(state, batter, battingSide, pitchingSide, rng);
    case RESULTS.BB:
      return applyWalk(state, batter, battingSide, pitchingSide, pitcher);
    case RESULTS.SINGLE:
      return applySingle(state, batter, battingSide, pitchingSide, rng, pitcher);
    case RESULTS.SINGLE_PLUS:
      return applySingle(state, batter, battingSide, pitchingSide, rng, pitcher, true);
    case RESULTS.DOUBLE:
      return applyDouble(state, batter, battingSide, pitchingSide, rng, pitcher);
    case RESULTS.TRIPLE:
      return applyTriple(state, batter, battingSide, pitchingSide, pitcher);
    case RESULTS.HR:
      return applyHomer(state, batter, battingSide, pitchingSide, pitcher);
    default:
      throw new Error(`Unknown result ${result}`);
  }
}

export function applyFlyout(state, batter, battingSide, pitchingSide, rng) {
  const outsBefore = state.outs;
  let runs = 0;
  state.outs += 1;

  if (state.deferAdvancesFor === battingSide && state.outs < 3) {
    const candidates = tagUpCandidates(state, pitchingSide, state.outs);
    // A tag-up nobody can throw out is not a question either — see the hit path.
    // But it IS still a tag-up: if every man is going for free the play must fall
    // through and actually send him, not swallow the question and leave him
    // standing on the bag he was already on.
    const free = freeAdvanceCount(candidates);
    if (candidates.length && free < candidates.length) {
      state.pendingAdvance = { kind: "tagup", battingSide, pitchingSide, outsBefore, candidates, batter, autoSend: free };
      state.lastPlayDetails = {
        kind: "flyout",
        outsBefore,
        tagUpAttempts: [],
        thrownAttempt: null
      };
      return runs;
    }
    if (!candidates.length) {
      state.lastPlayDetails = {
        kind: "flyout",
        outsBefore,
        tagUpAttempts: [],
        thrownAttempt: null
      };
      return runs;
    }
    // Everybody is free: fall through to the autopilot, which sends anyone whose
    // chance clears the bar — and a certainty clears every bar.
  }

  const tagUpAttempts = chooseTagUpAttempts(state, pitchingSide, state.outs);

  if (tagUpAttempts.length && state.outs < 3) {
    const wpBeforeTag = winProbabilityHome(state);
    const attemptResult = resolveAdvanceAttempts(state, tagUpAttempts, battingSide, pitchingSide, rng);
    runs += attemptResult.runs;
    // A sacrifice fly is two men's doing as much as a hit is: he hit it deep
    // enough, and the man on third had to go. Half each.
    splitAutoAdvanceCredit(state, battingSide, batter, tagUpAttempts[0].runner, wpBeforeTag);
    state.lastPlayDetails = {
      kind: "flyout",
      outsBefore,
      tagUpAttempts: attemptResult.attempts,
      thrownAttempt: attemptResult.thrownAttempt,
      baserunningWpa: baserunningSwing(state, battingSide, wpBeforeTag)
    };
  } else {
    state.lastPlayDetails = {
      kind: "flyout",
      outsBefore,
      tagUpAttempts: [],
      thrownAttempt: null
    };
  }

  return runs;
}

export function applyGroundout(state, batter, battingSide, pitchingSide, rng) {
  const [first, second, third] = state.bases;
  const outsBefore = state.outs;
  let runs = 0;
  let doublePlayAttempt = null;
  state.bases = [null, null, null];

  if (first) {
    state.outs += 1;
    if (state.outs < 3) {
      const fielding = totalInfieldFielding(state[pitchingSide]);
      const target = speedTarget(batter);
      // The throw is worth rolling only when the die could land on either side of
      // the target. A batter beaten on even his kindest roll (a 1) is out every
      // time; one safe on even his harshest (a 20) is safe every time. Either way
      // the die is a formality — turn two, or leave him on, without rolling it.
      const alwaysOut = 1 + fielding > target;
      const alwaysSafe = 20 + fielding <= target;
      const settled = alwaysOut || alwaysSafe;
      const roll = settled ? null : rollD20(state, rng);
      const total = settled ? null : roll + fielding;
      const batterOut = settled ? alwaysOut : total > target;
      doublePlayAttempt = {
        roll,
        fielding,
        total,
        target,
        batterOut
      };
      if (batterOut) state.outs += 1;
      if (!batterOut && state.outs < 3) state.bases[0] = runnerFor(batter);
    }
  } else {
    state.outs += 1;
  }

  if (state.outs < 3) {
    if (third) runs += scoreRunner(state, battingSide, pitchingSide, third);
    if (second) state.bases[2] = second;
  }

  state.lastPlayDetails = {
    kind: "groundout",
    outsBefore,
    firstBaseRunnerOut: Boolean(first),
    batterOut: !first || Boolean(doublePlayAttempt?.batterOut),
    doublePlayAttempt
  };
  return runs;
}

export function applyWalk(state, batter, battingSide, pitchingSide = null, pitcher = null) {
  let runs = 0;
  const [first, second, third] = state.bases;
  if (first && second && third) {
    runs += scoreRunner(state, battingSide, pitchingSide, third, pitcher);
  }
  if (first && second) state.bases[2] = second;
  if (first) state.bases[1] = first;
  state.bases[0] = runnerFor(batter, pitcher);
  return runs;
}

export function applySingle(state, batter, battingSide, pitchingSide = null, rng = null, pitcher = null, extraBase = false) {
  const outsBefore = state.outs;
  let runs = 0;
  const [first, second, third] = state.bases;
  if (third) runs += scoreRunner(state, battingSide, pitchingSide, third, pitcher);
  state.bases[2] = second;
  state.bases[1] = first;
  state.bases[0] = runnerFor(batter, pitcher);
  runs += resolveHitExtraBaseAttempts({
    state,
    batter,
    battingSide,
    pitchingSide,
    rng,
    outsBefore,
    candidates: [
      second ? { runner: second, fromIndex: 2, toIndex: 3 } : null,
      first ? { runner: first, fromIndex: 1, toIndex: 2 } : null
    ]
  });
  // 1B+: the real cards' auto-advance — the batter takes second uncontested, no
  // roll, no decision, PROVIDED second is open.
  //
  // Open WHEN is the whole question, and the answer is at the END of the play,
  // because the play is what opens the base. The man who was on first is
  // standing on second the moment the ball lands, so asking before the throw is
  // settled says "occupied" and pins the batter to first — even when that runner
  // then goes on to third, or is thrown out there, and leaves second empty
  // behind him. The extra base is taken once the dust settles, on the base as it
  // then is.
  //
  // The attempts above have already been resolved by now, so second is as it
  // will finish — UNLESS the send was handed to a manager, in which case the
  // play is still open and the batter's base has to wait for the call. Nothing
  // on a single ever moves INTO second, so a base open now stays open: only the
  // occupied case can still change, and only that case defers.
  if (extraBase) {
    if (state.pendingAdvance && state.bases[1]) state.pendingAdvance.batterTakesSecond = true;
    else takeUncontestedSecond(state);
  }
  return runs;
}

// The 1B+ trot to second, applied against the bases as they stand. A third out
// ends the half before anyone can trot anywhere, so a dead inning moves nobody.
// Hands back the man who moved, because taking that base costs him something —
// see the steal green light at the end of playPlateAppearance.
function takeUncontestedSecond(state) {
  if (!state.bases[0] || state.bases[1] || state.outs >= 3) return null;
  state.bases[1] = state.bases[0];
  state.bases[0] = null;
  return state.bases[1];
}

export function applyDouble(state, batter, battingSide, pitchingSide = null, rng = null, pitcher = null) {
  const outsBefore = state.outs;
  let runs = 0;
  const [first, second, third] = state.bases;
  if (third) runs += scoreRunner(state, battingSide, pitchingSide, third, pitcher);
  if (second) runs += scoreRunner(state, battingSide, pitchingSide, second, pitcher);
  state.bases[2] = first;
  state.bases[1] = runnerFor(batter, pitcher);
  state.bases[0] = null;
  runs += resolveHitExtraBaseAttempts({
    state,
    batter,
    battingSide,
    pitchingSide,
    rng,
    outsBefore,
    candidates: [
      first ? { runner: first, fromIndex: 2, toIndex: 3 } : null
    ]
  });
  return runs;
}

export function applyTriple(state, batter, battingSide, pitchingSide = null, pitcher = null) {
  let runs = 0;
  for (const runner of state.bases) {
    if (runner) runs += scoreRunner(state, battingSide, pitchingSide, runner, pitcher);
  }
  state.bases = [null, null, runnerFor(batter, pitcher)];
  return runs;
}

export function applyHomer(state, batter, battingSide, pitchingSide = null, pitcher = null) {
  let runs = 1;
  for (const runner of state.bases) {
    if (runner) runs += scoreRunner(state, battingSide, pitchingSide, runner, pitcher);
  }
  state.bases = [null, null, null];
  scoreRunner(state, battingSide, pitchingSide, runnerFor(batter, pitcher), pitcher);
  return runs;
}

function scoreRunner(state, battingSide, pitchingSide, runner, fallbackPitcher = null) {
  state.score[battingSide] += 1;
  creditInning(state, battingSide);
  recordRunnerStat(state, runner, "r");
  chargeRun(
    state,
    pitchingSide,
    runner?.responsiblePitcherId ?? fallbackPitcher?.id,
    runner?.responsiblePitcherFresh ?? fallbackPitcher?.freshAtReach
  );
  return 1;
}

// Runs by inning, the way a hand-operated board keeps them: one slot per frame,
// hung as the runs come in. Extras just add slots off the end. Every run in the
// game passes through scoreRunner, so this is the only place that has to count.
function creditInning(state, side) {
  const frames = state.lineScore[side];
  const index = state.inning - 1;
  while (frames.length <= index) frames.push(0);
  frames[index] += 1;
}

function recordRunnerStat(state, runner, stat) {
  if (!runner?.id) return;
  const line = ensureHitterLine(state, runner);
  line[stat] = (line[stat] ?? 0) + 1;
}

function chargeRun(state, pitchingSide, pitcherId, pitcherWasFresh = false) {
  if (!pitchingSide || !pitcherId) return;
  const pitcher = state[pitchingSide].pitchers.find((item) => item.id === pitcherId);
  if (!pitcher) return;
  const line = ensurePitcherLine(state, pitcher);
  line.r += 1;
  if (pitcherWasFresh) line.fresh.r += 1;
}

function runnerFor(player, responsiblePitcher = null) {
  return {
    id: player.id,
    name: player.name,
    speed: Number(player.speed) || 0,
    responsiblePitcherId: player.responsiblePitcherId ?? responsiblePitcher?.id ?? null,
    responsiblePitcherFresh: player.responsiblePitcherFresh ?? responsiblePitcher?.freshAtReach ?? null
  };
}

// All tag-up opportunities, lead runner first, unfiltered by the break-even —
// the interactive layer offers every legal send.
function tagUpCandidates(state, pitchingSide, outsForDecision) {
  if (outsForDecision >= 3) return [];
  const candidates = [];
  const runnerOnThird = state.bases[2];
  const runnerOnSecond = state.bases[1];
  const outfieldFielding = totalOutfieldFielding(state[pitchingSide]);

  if (runnerOnThird) {
    candidates.push(createAdvanceCandidate({
      runner: runnerOnThird,
      fromIndex: 2,
      toIndex: 3,
      outsForDecision,
      fielding: outfieldFielding,
      targetBonus: 5
    }));
  }

  if (runnerOnSecond) {
    candidates.push(createAdvanceCandidate({
      runner: runnerOnSecond,
      fromIndex: 1,
      toIndex: 2,
      outsForDecision,
      fielding: outfieldFielding,
      targetBonus: 0
    }));
  }

  return annotateAdvanceChain(state, candidates);
}

function chooseTagUpAttempts(state, pitchingSide, outsForDecision) {
  return leadPrefixAttempts(tagUpCandidates(state, pitchingSide, outsForDecision));
}

// A trailing runner can only advance if every runner ahead of him goes too —
// otherwise he'd run into an occupied base. Candidates arrive lead first, so
// take the prefix that clears its own break-even.
function leadPrefixAttempts(candidates) {
  const attempts = [];
  for (const candidate of candidates) {
    if (!shouldAttemptAdvance(candidate)) break;
    attempts.push(candidate);
  }
  return attempts;
}

function chooseStealAttempt(state, pitchingSide) {
  if (state.outs >= 3) return null;
  const [first, runnerOnSecond, runnerOnThird] = state.bases;
  // Auto play honors the same rule: one attempt per runner per at-bat.
  const runnerOnFirst = canStealThisPA(state, first) ? first : null;
  const fielding = totalCatcherFielding(state[pitchingSide]);
  const candidates = [];

  if (runnerOnSecond && !runnerOnThird && canStealThisPA(state, runnerOnSecond)) {
    candidates.push(createAdvanceCandidate({
      runner: runnerOnSecond,
      fromIndex: 1,
      toIndex: 2,
      outsForDecision: state.outs,
      fielding,
      // The throw to third is shorter: +5 to the catcher, not the runner.
      targetBonus: -5
    }));
  } else if (runnerOnFirst && !runnerOnSecond) {
    candidates.push(createAdvanceCandidate({
      runner: runnerOnFirst,
      fromIndex: 0,
      toIndex: 1,
      outsForDecision: state.outs,
      fielding,
      targetBonus: 0
    }));
  }

  return annotateAdvanceOptions(state, candidates)
    .filter((candidate) => shouldAttemptAdvance(candidate))
    .sort((a, b) => b.safeChance - a.safeChance || b.toIndex - a.toIndex)[0] ?? null;
}

function resolveStealAttempt(state, candidate, rng) {
  // Same rule as a send: a die is only worth throwing when it could land on
  // either side of the target. A runner safe on his harshest roll, or out on his
  // kindest, is settled before the throw — take the base, or the out, uncontested.
  const alwaysSafe = certainSafe(candidate);
  const alwaysOut = certainOut(candidate);
  const settled = alwaysSafe || alwaysOut;
  const roll = settled ? null : rollD20(state, rng);
  const total = settled ? null : roll + candidate.fielding;
  const safe = settled ? alwaysSafe : total <= candidate.target;
  state.bases[candidate.fromIndex] = null;

  if (safe) {
    state.bases[candidate.toIndex] = candidate.runner;
    recordRunnerStat(state, candidate.runner, "sb");
  } else {
    state.outs += 1;
    recordRunnerStat(state, candidate.runner, "cs");
  }

  return describeAdvanceAttempt(candidate, {
    roll,
    fielding: candidate.fielding,
    total,
    target: candidate.target,
    safe,
    outsAfter: state.outs
  });
}

function resolveHitExtraBaseAttempts({ state, batter, battingSide, pitchingSide, rng, outsBefore, candidates }) {
  if (!pitchingSide || !rng || state.outs >= 3) return 0;
  const fielding = totalOutfieldFielding(state[pitchingSide]);
  const twoOutBonus = outsBefore >= 2 ? 5 : 0;
  // Sorted lead runner first BEFORE the break-evens are figured: each man's
  // number assumes everyone ahead of him has gone.
  const allCandidates = annotateAdvanceChain(state, candidates
    .filter(Boolean)
    .map((candidate) => createAdvanceCandidate({
      ...candidate,
      outsForDecision: outsBefore,
      fielding,
      targetBonus: (candidate.toIndex >= 3 ? 5 : 0) + twoOutBonus
    }))
    .sort((a, b) => b.toIndex - a.toIndex));

  // Ask only when there is something to ask. If every man who could go is going
  // for free, the play resolves itself — the autopilot below sends anybody whose
  // chance clears the bar, and a certainty clears every bar. `autoSend` carries
  // the free men into the question when only SOME of them are free: those bases
  // are already taken, and the decision left is about the man behind them.
  const free = freeAdvanceCount(allCandidates);
  if (state.deferAdvancesFor === battingSide && allCandidates.length && free < allCandidates.length) {
    state.pendingAdvance = { kind: "hit", battingSide, pitchingSide, outsBefore, candidates: allCandidates, batter, autoSend: free };
    state.lastPlayDetails = {
      kind: "hit",
      outsBefore,
      extraBaseAttempts: [],
      thrownAttempt: null
    };
    return 0;
  }

  const attempts = leadPrefixAttempts(allCandidates);

  if (!attempts.length) {
    state.lastPlayDetails = {
      kind: "hit",
      outsBefore,
      extraBaseAttempts: [],
      thrownAttempt: null
    };
    return 0;
  }

  const wpBeforeAdvance = winProbabilityHome(state);
  const attemptResult = resolveAdvanceAttempts(state, attempts, battingSide, pitchingSide, rng);
  // He went and got it — half the swing is his, whether he was sent for it or
  // simply took a base nobody could defend.
  splitAutoAdvanceCredit(state, battingSide, batter, attempts[0].runner, wpBeforeAdvance);
  state.lastPlayDetails = {
    kind: "hit",
    outsBefore,
    extraBaseAttempts: attemptResult.attempts,
    thrownAttempt: attemptResult.thrownAttempt,
    baserunningWpa: baserunningSwing(state, battingSide, wpBeforeAdvance)
  };
  return attemptResult.runs;
}

function createAdvanceCandidate({ runner, fromIndex, toIndex, outsForDecision, fielding, targetBonus = 0 }) {
  const runnerSpeed = speedTarget(runner);
  const destination = destinationKey(toIndex);
  const target = runnerSpeed + targetBonus;
  const safeChance = advanceSafeChance(target, fielding);
  return {
    runner,
    fromIndex,
    toIndex,
    outsForDecision,
    fielding,
    runnerSpeed,
    targetBonus,
    target,
    safeChance,
    destination,
    // The backstop, overwritten by the situation's own break-even the moment
    // this candidate is priced against a ball game (see annotateAdvanceChain).
    // Every builder in this file does that before anyone reads it.
    decisionMinimum: advanceDecisionMinimum(outsForDecision, destination)
  };
}

function shouldAttemptAdvance(candidate) {
  return candidate.safeChance >= candidate.decisionMinimum;
}

// A die is worth throwing only when it could land on either side of the target.
// Two runners on a play take that away. `chooseThrowTarget` hands back the most
// gettable man: if even HE cannot be thrown out, nobody on the play can, the ball
// goes back to the pitcher, and no die is thrown because nothing threw it. And at
// the other end, a man so plainly beaten that even his kindest roll is out is out
// on the throw the same way every time — the die is a formality with a foregone
// answer. Either way the outcome is settled before the die leaves the hand, and a
// d20 tumbling toward a number it must hit, or cannot, is a magic trick with no
// card in it. It is only staged when the roll is the thing that decides.
function resolveAdvanceAttempts(state, candidates, battingSide, pitchingSide, rng) {
  const throwTarget = chooseThrowTarget(candidates);
  const alwaysSafe = certainSafe(throwTarget);
  const alwaysOut = certainOut(throwTarget);
  const settled = alwaysSafe || alwaysOut;
  const roll = settled ? null : rollD20(state, rng);
  const total = settled ? null : roll + throwTarget.fielding;
  const safe = settled ? alwaysSafe : total <= throwTarget.target;
  let runs = 0;

  for (const candidate of candidates) {
    state.bases[candidate.fromIndex] = null;
  }

  if (safe) {
    if (throwTarget.toIndex >= 3) {
      runs += scoreRunner(state, battingSide, pitchingSide, throwTarget.runner);
    } else {
      state.bases[throwTarget.toIndex] = throwTarget.runner;
    }
    recordRunnerStat(state, throwTarget.runner, "adv");
  } else {
    state.outs += 1;
    recordRunnerStat(state, throwTarget.runner, "advOut");
  }

  const thrownAttempt = describeAdvanceAttempt(throwTarget, {
    roll,
    fielding: throwTarget.fielding,
    total,
    target: throwTarget.target,
    safe,
    outsAfter: state.outs
  });

  const attempts = candidates.map((candidate) => {
    if (candidate === throwTarget) return thrownAttempt;

    if (candidate.toIndex >= 3) {
      runs += scoreRunner(state, battingSide, pitchingSide, candidate.runner);
    } else {
      state.bases[candidate.toIndex] = candidate.runner;
    }
    // A conceded base — the throw went to the lead man, this one was waved in
    // behind him — is an advancement all the same.
    recordRunnerStat(state, candidate.runner, "adv");

    return describeAdvanceAttempt(candidate, {
      roll: null,
      fielding: candidate.fielding,
      total: null,
      target: candidate.target,
      safe: true,
      outsAfter: state.outs
    });
  });

  return {
    attempts,
    thrownAttempt,
    runs
  };
}

function chooseThrowTarget(candidates) {
  return [...candidates].sort((a, b) => a.safeChance - b.safeChance || b.toIndex - a.toIndex)[0];
}

// The number the DEFENSE has to roll to get the out. Every fielding check in the
// game is the same shape — the runner is safe when his roll plus the gloves comes
// in AT or under the target his speed sets, and out when it goes past — so the
// out needs roll > target - fielding, and the smallest die that does it is one
// more than that.
//
// It can fall outside the die. A rocket in front of a butcher's infield needs a
// 21 and cannot be had; a plodder in front of a good one is out on a 1. Callers
// are told which, because "needs a 21" is a lie and "needs a 0" is nonsense.
export function fieldingCheckNeeds(attempt) {
  if (!attempt || typeof attempt.target !== "number" || typeof attempt.fielding !== "number") return null;
  const needed = attempt.target - attempt.fielding + 1;
  if (needed <= 1) return { needed: 1, certain: true, impossible: false };
  if (needed > 20) return { needed: 21, certain: false, impossible: true };
  return { needed, certain: false, impossible: false };
}

// An extra base is TWO men's doing — the hitter put the ball where a base could
// be had, the runner is the one who went and got it — so they split it, half
// each. resolveAdvanceDecision does this for a base the player SENT him for.
// This does it for a base taken on the autopilot: the free ones nobody can
// defend, and the NPC's and the simulator's.
//
// The difference is only in the bookkeeping. A sent runner's advance is its own
// event, credited from scratch. An automatic one happens INSIDE the plate
// appearance, and the plate appearance hands the batter the whole swing when it
// closes — so the runner's half is taken back off the batter here rather than
// added to him twice. The offense's total is untouched either way, which is why
// the zero-sum stays zero.
// The win-probability swing an auto-resolved advance (extra base on a hit, tag-up
// on a fly) is worth to the batting team — measured from just before the runners
// went. Unlike splitAutoAdvanceCredit this is a team figure: it doesn't care who
// gets the individual credit, so a batter who stretches it himself still counts.
function baserunningSwing(state, battingSide, wpBefore) {
  const wpAfter = winProbabilityHome(state);
  return battingSide === "home" ? wpAfter - wpBefore : wpBefore - wpAfter;
}

function splitAutoAdvanceCredit(state, battingSide, batter, taker, wpBefore) {
  if (!batter?.id || !taker?.id || batter.id === taker.id) return;
  const wpAfter = winProbabilityHome(state);
  const advanceWpa = battingSide === "home" ? wpAfter - wpBefore : wpBefore - wpAfter;
  if (!advanceWpa) return;
  const half = advanceWpa / 2;
  ensureHitterLine(state, { id: batter.id, name: batter.name }).wpa -= half;
  ensureHitterLine(state, { id: taker.id, name: taker.name }).wpa += half;
}

// A base he cannot be thrown out taking, and CANNOT means a hundred percent.
//
// Not "the defense would need a 21", which is a proxy for the same thing and is
// only the same thing while every number in it is a whole one. Give an outfield a
// half point of arm, or a base a half-point bonus, and the proxy still says he is
// safe while a 20 on the die guns him down — and the game would have taken the
// decision away from the player and then thrown him out with it. So the question
// is put to the odds themselves. Ninety-five percent is not certain. It is a
// gamble with good numbers, and the gamble is the player's to take.
export function certainSafe(candidate) {
  return Number(candidate?.safeChance) >= 1;
}

// The mirror of certainSafe: a base he cannot help but be thrown out taking. The
// die is kindest to the runner on its lowest face — the smaller the roll, the
// nearer the throw comes in under his target — so if even a 1 puts the throw past
// him, every face does, and the out is settled before it is thrown. Asked of the
// numbers themselves for the same reason certainSafe is: "the defense needs a 1"
// is a proxy that a half-point of arm turns into a lie.
export function certainOut(candidate) {
  const fielding = Number(candidate?.fielding);
  const target = Number(candidate?.target);
  if (!Number.isFinite(fielding) || !Number.isFinite(target)) return false;
  return 1 + fielding > target;
}

// How many of the lead runners are going for FREE. Runners are asked about lead
// first and a trailing man can only go if the man ahead of him goes, so what
// matters is the leading run of them: those bases are not a decision, and a
// question with only one answer is not a question. It should never be put.
export function freeAdvanceCount(candidates) {
  let free = 0;
  for (const candidate of candidates ?? []) {
    if (!certainSafe(candidate)) break;
    free += 1;
  }
  return free;
}

function describeAdvanceAttempt(candidate, outcome) {
  return {
    runner: candidate.runner.name,
    from: baseLabel(candidate.fromIndex),
    to: baseLabel(candidate.toIndex),
    outsForDecision: candidate.outsForDecision,
    roll: outcome.roll,
    fielding: outcome.fielding,
    total: outcome.total,
    target: outcome.target,
    runnerSpeed: candidate.runnerSpeed,
    targetBonus: candidate.targetBonus,
    destination: candidate.destination,
    decisionMinimum: candidate.decisionMinimum,
    safeChance: candidate.safeChance,
    safe: outcome.safe,
    thrown: outcome.roll !== null,
    outsAfter: outcome.outsAfter
  };
}

function totalInfieldFielding(team) {
  const infieldPositions = ["1B", "2B", "3B", "SS"];
  return infieldPositions.reduce((sum, position) => {
    const player = team.lineup.find((item) => playerDefensivePosition(item) === position);
    return sum + fieldingValue(player);
  }, 0);
}

function totalOutfieldFielding(team) {
  const outfieldPositions = ["LF", "CF", "RF"];
  return outfieldPositions.reduce((sum, position) => {
    const player = team.lineup.find((item) => playerDefensivePosition(item) === position);
    return sum + fieldingValue(player);
  }, 0);
}

// The man behind the plate — the only fielder any record cares about by name, and
// the arm the steal target is set against.
function catcherOf(team) {
  return team.lineup.find((item) => playerDefensivePosition(item) === "C" || playerDefensivePosition(item) === "CA") ?? null;
}

function totalCatcherFielding(team) {
  return fieldingValue(catcherOf(team));
}

function playerDefensivePosition(player) {
  return player?.defensivePosition ?? player?.assignedPosition ?? player?.position;
}

function fieldingValue(player) {
  const value = Number(player?.fielding ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function speedTarget(player) {
  const value = Number(player?.speed);
  if (Number.isFinite(value)) return value;
  return 0;
}

function advanceSafeChance(target, fielding) {
  const maxSafeRoll = Math.max(0, Math.min(20, target - fielding));
  return maxSafeRoll / 20;
}

function destinationKey(toIndex) {
  if (toIndex === 1) return "second";
  if (toIndex === 2) return "third";
  return "home";
}

function baseLabel(index) {
  if (index === 0) return "1B";
  if (index === 1) return "2B";
  if (index === 2) return "3B";
  return "home";
}

function advanceHalfInning(state) {
  state.outs = 0;
  state.bases = [null, null, null];
  if (state.half === "top") {
    state.half = "bottom";
  } else {
    // Per docs/rules.md, the game only ends on a lead after a COMPLETED
    // inning (or a walk-off). The flag is needed because a rolled-over
    // "top of the 11th, away up 1" state is indistinguishable from a live
    // one where the away team just took the lead and home still bats.
    if (state.inning >= 9 && state.score.home !== state.score.away) {
      state.gameOver = true;
    }
    state.half = "top";
    state.inning += 1;
  }
  // The side coming out to field has to legally HAVE a defense — pinch moves
  // may have broken it. Only if there is a next half to play: nobody
  // realigns, double-switches, or forfeits after the final out.
  if (shouldContinue(state)) {
    realignDefense(state, state.half === "top" ? "home" : "away");
  }
}

function snapshotBases(state) {
  return state.bases.map((runner) => (runner ? runner.name : null));
}

function recordStats(state, battingSide, pitchingSide, batter, pitcher, result, runs, outsOnPlay, pitcherWasFresh = false, rolls = null) {
  const hitterLine = ensureHitterLine(state, batter);
  const pitcherLine = ensurePitcherLine(state, pitcher);
  const freshLine = pitcherWasFresh ? pitcherLine.fresh : null;
  hitterLine.pa += 1;
  pitcherLine.bf += 1;
  if (freshLine) freshLine.bf += 1;
  hitterLine.rbi += runs;
  // Each man's own die, kept as a running total so the box score can average it.
  // A plate appearance throws two: the PITCH, which is the arm's, and the SWING,
  // which is the bat's. Whose CHART the swing lands on is decided by the pitch and
  // is not the batter's doing — the number on his die is his either way, and that
  // is the whole point of the column: it says whether the afternoon was the man or
  // the dice.
  if (Number.isFinite(rolls?.resultRoll)) {
    hitterLine.rolls += 1;
    hitterLine.rollTotal += rolls.resultRoll;
  }
  if (Number.isFinite(rolls?.controlRoll)) {
    pitcherLine.rolls += 1;
    pitcherLine.rollTotal += rolls.controlRoll;
  }

  if ([RESULTS.SINGLE, RESULTS.SINGLE_PLUS, RESULTS.DOUBLE, RESULTS.TRIPLE, RESULTS.HR].includes(result)) {
    hitterLine.h += 1;
    pitcherLine.h += 1;
    if (freshLine) freshLine.h += 1;
  }
  if (result === RESULTS.DOUBLE) {
    hitterLine.d += 1;
  }
  if (result === RESULTS.TRIPLE) {
    hitterLine.t += 1;
  }
  if (result === RESULTS.BB) {
    hitterLine.bb += 1;
    pitcherLine.bb += 1;
    if (freshLine) freshLine.bb += 1;
  }
  if (result === RESULTS.SO) {
    hitterLine.so += 1;
    pitcherLine.so += 1;
    if (freshLine) freshLine.so += 1;
  }
  if (result === RESULTS.HR) {
    hitterLine.hr += 1;
    pitcherLine.hr += 1;
    if (freshLine) freshLine.hr += 1;
  }
  if ([RESULTS.PU, RESULTS.SO, RESULTS.GB, RESULTS.FB].includes(result)) {
    hitterLine.ab += 1;
  } else if (result !== RESULTS.BB) {
    hitterLine.ab += 1;
  }
  if (state.lastPlayDetails?.kind === "groundout" && state.lastPlayDetails.doublePlayAttempt?.batterOut) {
    hitterLine.gidp += 1;
  }
  pitcherLine.outs += outsOnPlay;
  if (freshLine) freshLine.outs += outsOnPlay;

  state[battingSide].runs = state.score[battingSide];
  state[pitchingSide].runsAllowed = state.score[battingSide];
}

// Stat lines are keyed by side as well as card id so the same card appearing
// in both lineups keeps separate home and away lines. Deriving the side from
// state.half is safe because every stat records before the half flips (a
// pending advance decision blocks the flip until it resolves).
// A hitter line is keyed by side and id. It usually belongs to the man at the
// plate, so the side defaults to whoever is batting — but a defensive credit (a
// catcher gunning down a stealer) belongs to a man on the OTHER side, so callers
// can name the side explicitly. Either way the same key returns the same line, so
// a catcher's throw-out and his own at-bats land on one row.
function ensureHitterLine(state, hitter, side = state.half === "top" ? "away" : "home") {
  const key = `${side}:${hitter.id}`;
  if (!state.stats.hitters.has(key)) {
    state.stats.hitters.set(key, {
      id: hitter.id,
      name: hitter.name,
      side,
      team: state[side].name,
      pa: 0,
      ab: 0,
      h: 0,
      d: 0,
      t: 0,
      r: 0,
      bb: 0,
      so: 0,
      hr: 0,
      sb: 0,
      cs: 0,
      // Baserunning beyond the steal: extra bases taken (adv) and outs made
      // trying (advOut) — both charged to the runner. csCaught is the other side
      // of a steal: a runner THIS man, behind the plate, threw out.
      adv: 0,
      advOut: 0,
      csCaught: 0,
      rbi: 0,
      gidp: 0,
      wpa: 0,
      // His swing dice: how many he has thrown, and what they add up to.
      rolls: 0,
      rollTotal: 0
    });
  }
  return state.stats.hitters.get(key);
}

function ensurePitcherLine(state, pitcher) {
  const side = state.half === "top" ? "home" : "away";
  const key = `${side}:${pitcher.id}`;
  if (!state.stats.pitchers.has(key)) {
    state.stats.pitchers.set(key, {
      id: pitcher.id,
      name: pitcher.name,
      side,
      team: state[side].name,
      bf: 0,
      outs: 0,
      h: 0,
      bb: 0,
      so: 0,
      hr: 0,
      r: 0,
      wpa: 0,
      // His pitch dice, the same way (see recordStats).
      rolls: 0,
      rollTotal: 0,
      fresh: emptyPitcherTotals()
    });
  }
  return state.stats.pitchers.get(key);
}

function emptyPitcherTotals() {
  return {
    bf: 0,
    outs: 0,
    h: 0,
    bb: 0,
    so: 0,
    hr: 0,
    r: 0,
    wpa: 0
  };
}

function summarizeTeam(state, side) {
  return {
    name: state[side].name,
    runs: state.score[side],
    lineup: state[side].lineup,
    pitchers: state[side].pitchers
  };
}

// Exported for interactive layers that need a box score from a live state.
export function buildBoxScore(state) {
  return {
    away: buildTeamBoxScore(state, "away"),
    home: buildTeamBoxScore(state, "home")
  };
}

function buildTeamBoxScore(state, side) {
  return {
    team: state[side].name,
    hitters: [...state.stats.hitters.values()].filter((line) => line.side === side),
    pitchers: [...state.stats.pitchers.values()].filter((line) => line.side === side)
  };
}
