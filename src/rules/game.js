import { RESULTS, resolveChart } from "./cards.js";
import { createRng } from "./rng.js";
import { winExpectancy } from "../data/winExpectancy.js";

const ADVANCE_DECISION_MATRIX = {
  0: { second: 0.9, third: 0.85, home: 0.75 },
  1: { second: 0.8, third: 0.75, home: 0.65 },
  2: { second: 0.7, third: 0.65, home: 0.55 }
};

// Probability that the home team wins from the given state, looked up in
// MLB history (Retrosheet 1903-2025 via Greg Stoll's dataset — see
// src/data/winExpectancy.js). Terminal states resolve exactly; live states
// read the table from the batting team's perspective.
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

export function simulateGame(awayTeam, homeTeam, seed = "showdown") {
  const rng = createRng(seed);
  const state = createInitialState(awayTeam, homeTeam);
  const events = [];

  while (shouldContinue(state)) {
    const event = playGameEvent(state, rng);
    events.push(event);
  }

  return {
    seed,
    away: summarizeTeam(state, "away"),
    home: summarizeTeam(state, "home"),
    winner: state.score.away > state.score.home ? state.away.name : state.home.name,
    boxScore: buildBoxScore(state),
    events,
    innings: state.inning,
    topSwing: state.topSwing
  };
}

export function playGameEvent(state, rng) {
  return playStealAttempt(state, rng) ?? playPlateAppearance(state, rng);
}

export function playPlateAppearance(state, rng) {
  const battingSide = state.half === "top" ? "away" : "home";
  const pitchingSide = battingSide === "away" ? "home" : "away";
  const battingTeam = state[battingSide];
  const pitchingTeam = state[pitchingSide];
  const batter = battingTeam.lineup[state.lineupIndex[battingSide] % battingTeam.lineup.length];
  const pitcher = currentPitcher(state, pitchingSide);
  const fatiguePenalty = pitcherFatigue(state.pitching[pitchingSide], pitcher);

  const before = snapshotBases(state);
  const outsBefore = state.outs;
  const scoreBefore = { ...state.score };
  const wpBefore = winProbabilityHome(state);
  const controlRoll = rng.d20();
  const effectiveControl = pitcher.control - fatiguePenalty;
  const controlTotal = controlRoll + effectiveControl;
  const chartOwner = controlTotal > batter.onBase ? "pitcher" : "hitter";
  const resultRoll = rng.d20();
  const result = resolveChart(chartOwner === "pitcher" ? pitcher.chart : batter.chart, resultRoll);
  state.lastPlayDetails = null;
  const runs = applyResult(state, result, batter, battingSide, pitchingSide, rng, pitcher);
  if (state.pendingAdvance) state.pendingAdvance.batter = { id: batter.id, name: batter.name };

  const outsOnPlay = Math.max(0, state.outs - outsBefore);
  recordStats(state, battingSide, pitchingSide, batter, pitcher, result, runs, outsOnPlay);
  battingTeam.plateAppearances += 1;
  state.lineupIndex[battingSide] += 1;
  state.pitching[pitchingSide].outsRecorded += outsOnPlay;
  state.pitching[pitchingSide].battersFaced += 1;

  const wpAfter = winProbabilityHome(state);
  const battingWpa = battingSide === "home" ? wpAfter - wpBefore : wpBefore - wpAfter;
  ensureHitterLine(state, batter).wpa += battingWpa;
  ensurePitcherLine(state, pitcher).wpa -= battingWpa;
  trackTopSwing(state, batter, battingWpa, result);

  const event = {
    inning: state.inning,
    half: state.half,
    battingTeam: battingTeam.name,
    pitchingTeam: pitchingTeam.name,
    batter: batter.name,
    pitcher: pitcher.name,
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
// decision matrix, so an interactive layer can offer (and force) attempts the
// auto-runner would decline. Auto play never calls this.
export function stealCandidates(state) {
  if (state.outs >= 3 || state.pendingAdvance) return [];
  const pitchingSide = state.half === "top" ? "home" : "away";
  const [runnerOnFirst, runnerOnSecond, runnerOnThird] = state.bases;
  const fielding = totalCatcherFielding(state[pitchingSide]);
  const candidates = [];

  if (runnerOnSecond && !runnerOnThird) {
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
  if (runnerOnFirst && !runnerOnSecond) {
    candidates.push(createAdvanceCandidate({
      runner: runnerOnFirst,
      fromIndex: 0,
      toIndex: 1,
      outsForDecision: state.outs,
      fielding,
      targetBonus: 0
    }));
  }

  return candidates;
}

// Force a steal attempt for the runner on the given base index, regardless of
// the auto-play decision matrix. Returns the steal event, or null when that
// runner has no open base ahead.
export function attemptSteal(state, fromIndex, rng) {
  const candidate = stealCandidates(state).find((item) => item.fromIndex === fromIndex);
  if (!candidate) return null;
  return performStealAttempt(state, candidate, rng);
}

function performStealAttempt(state, stealAttempt, rng) {
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
    pitcher: pitcher.name,
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
      stealAttempt: attemptResult
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

// The chance the current batter gets a bunt down cleanly, for display before
// the player commits. Mirrors the roll in attemptBunt.
export function buntSuccessChance(state) {
  if (!canBunt(state)) return 0;
  const battingSide = state.half === "top" ? "away" : "home";
  const pitchingSide = battingSide === "away" ? "home" : "away";
  const battingTeam = state[battingSide];
  const batter = battingTeam.lineup[state.lineupIndex[battingSide] % battingTeam.lineup.length];
  const target = 16 + Math.floor(speedTarget(batter) / 4);
  const penalty = Math.floor(totalInfieldFielding(state[pitchingSide]) / 4);
  return Math.max(0, Math.min(20, target - penalty)) / 20;
}

// A sacrifice bunt as a full plate appearance. Clean bunt: batter out, every
// runner moves up (never from third — canBunt disallows the squeeze).
// Bobbled: fielder's choice, the lead runner is cut down and the batter
// reaches. Auto play never bunts.
export function attemptBunt(state, rng) {
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

  const roll = rng.d20();
  const fielding = totalInfieldFielding(state[pitchingSide]);
  const total = roll + Math.floor(fielding / 4);
  const target = 16 + Math.floor(speedTarget(batter) / 4);
  const clean = total <= target;
  // canBunt guarantees third is empty — no squeeze plays.
  const [first, second] = state.bases;
  const runs = 0;
  let leadOut = null;

  state.outs += 1;
  if (clean) {
    state.bases = [null, first ?? null, second ?? null];
  } else {
    const lead = second ?? first;
    leadOut = { runner: lead.name, at: second ? "3B" : "2B" };
    const keptFirst = first && first !== lead ? first : null;
    // Batter takes first; the survivor advances only where the force pushes.
    state.bases = [runnerFor(batter, pitcher), keptFirst, null];
  }

  const result = clean ? "SAC" : "FC";
  state.lastPlayDetails = {
    kind: "bunt",
    outsBefore,
    clean,
    roll,
    fielding,
    total,
    target,
    leadOut
  };

  const hitterLine = ensureHitterLine(state, batter);
  const pitcherLine = ensurePitcherLine(state, pitcher);
  hitterLine.pa += 1;
  hitterLine.rbi += runs;
  if (!clean) hitterLine.ab += 1;
  pitcherLine.bf += 1;
  const outsOnPlay = state.outs - outsBefore;
  pitcherLine.outs += outsOnPlay;
  battingTeam.plateAppearances += 1;
  state.lineupIndex[battingSide] += 1;
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
    pitcher: pitcher.name,
    controlRoll: null,
    pitcherControl: pitcher.control,
    effectiveControl: pitcher.control,
    fatiguePenalty: 0,
    controlTotal: null,
    onBase: batter.onBase,
    chartOwner: "bunt",
    resultRoll: roll,
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
  pitcherLine.bf += 1;
  pitcherLine.bb += 1;
  battingTeam.plateAppearances += 1;
  state.lineupIndex[battingSide] += 1;
  state.pitching[pitchingSide].battersFaced += 1;
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
    pitcher: pitcher.name,
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
  const chosen = sendCount === "auto"
    ? leadPrefixAttempts(candidates)
    : candidates.slice(0, Math.max(0, Math.min(sendCount, candidates.length)));
  if (!chosen.length) return null;

  const before = snapshotBases(state);
  const outsBefore = state.outs;
  const scoreBefore = { ...state.score };
  const wpBefore = winProbabilityHome(state);
  const pitcher = currentPitcher(state, pitchingSide);
  const lead = chosen[0].runner;

  const attemptResult = resolveAdvanceAttempts(state, chosen, battingSide, pitchingSide, rng);
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
  ensureHitterLine(state, { id: lead.id, name: lead.name }).wpa += battingWpa;
  ensurePitcherLine(state, pitcher).wpa -= battingWpa;
  trackTopSwing(state, lead, battingWpa, attemptResult.thrownAttempt?.safe === false ? "ADV-OUT" : "ADV");

  state.lastPlayDetails = {
    kind: kind === "tagup" ? "tagup" : "advance",
    outsBefore,
    attempts: attemptResult.attempts,
    thrownAttempt: attemptResult.thrownAttempt
  };

  const event = {
    type: "advance",
    inning: state.inning,
    half: state.half,
    battingTeam: state[battingSide].name,
    pitchingTeam: state[pitchingSide].name,
    batter: batter?.name ?? lead.name,
    pitcher: pitcher.name,
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

export function createInitialState(awayTeam, homeTeam) {
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
    lastPlayDetails: null,
    topSwing: null,
    walkoff: false,
    // Interactive-layer flags. Auto play leaves both null: pitching plans run
    // themselves and extra-base advances resolve by the decision matrix.
    manualPitchingFor: null,
    deferAdvancesFor: null,
    pendingAdvance: null
  };
}

function createRuntimeTeam(team) {
  return {
    ...team,
    plateAppearances: 0,
    lineup: team.lineup.map((player) => ({ ...player })),
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
    tiredAt: fatigueBatterLimit(pitcher),
    fatiguePenalty: pitcherFatigue(runtime, pitcher),
    hasReliefAvailable: runtime.pitcherIndex < state[side].pitchers.length - 1
  };
}

function currentPitcher(state, side) {
  const runtime = state.pitching[side];
  const team = state[side];
  // Manual mode: the arm stays in (and tires) until changePitcher is called.
  // "both" puts every mound under manual control (the adventure's NPC skipper
  // makes its own calls); a single side string covers just that side.
  if (state.manualPitchingFor !== side && state.manualPitchingFor !== "both") {
    while (runtime.pitcherIndex < team.pitchers.length - 1) {
      const pitcher = team.pitchers[runtime.pitcherIndex];
      if (runtime.outsRecorded < pitcher.plannedOuts) break;
      runtime.pitcherIndex += 1;
      runtime.outsRecorded = 0;
      runtime.battersFaced = 0;
    }
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
    { ...starter, chargedRuns: 0, plannedOuts: starterTargetOuts },
    ...sortedBullpen.map((pitcher) => ({ ...pitcher, chargedRuns: 0, plannedOuts: pitcherIpOuts(pitcher) }))
  ];
}

// Fatigue runs on batters faced: every IP of stamina covers four batters, so
// an IP 6 starter handles 24 batters at full strength and tires on the 25th,
// sinking another point every four batters after that. Charged runs shave a
// "workload inning" (four batters) off the tank per three runs.
const BATTERS_PER_IP = 4;

function pitcherFatigue(runtime, pitcher) {
  const limit = fatigueBatterLimit(pitcher);
  const faced = runtime.battersFaced ?? 0;
  if (faced < limit) return 0;
  return Math.floor((faced - limit) / BATTERS_PER_IP) + 1;
}

function fatigueBatterLimit(pitcher) {
  const runPenalty = Math.floor(Number(pitcher?.chargedRuns ?? 0) / 3) * BATTERS_PER_IP;
  return Math.max(0, pitcherIpBatters(pitcher) - runPenalty);
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
      return applyFlyout(state, battingSide, pitchingSide, rng);
    case RESULTS.GB:
      return applyGroundout(state, batter, battingSide, pitchingSide, rng);
    case RESULTS.BB:
      return applyWalk(state, batter, battingSide, pitchingSide, pitcher);
    case RESULTS.SINGLE:
      return applySingle(state, batter, battingSide, pitchingSide, rng, pitcher);
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

export function applyFlyout(state, battingSide, pitchingSide, rng) {
  const outsBefore = state.outs;
  let runs = 0;
  state.outs += 1;

  if (state.deferAdvancesFor === battingSide && state.outs < 3) {
    const candidates = tagUpCandidates(state, pitchingSide, state.outs);
    if (candidates.length) {
      state.pendingAdvance = { kind: "tagup", battingSide, pitchingSide, outsBefore, candidates };
    }
    state.lastPlayDetails = {
      kind: "flyout",
      outsBefore,
      tagUpAttempts: [],
      thrownAttempt: null
    };
    return runs;
  }

  const tagUpAttempts = chooseTagUpAttempts(state, pitchingSide, state.outs);

  if (tagUpAttempts.length && state.outs < 3) {
    const attemptResult = resolveAdvanceAttempts(state, tagUpAttempts, battingSide, pitchingSide, rng);
    runs += attemptResult.runs;
    state.lastPlayDetails = {
      kind: "flyout",
      outsBefore,
      tagUpAttempts: attemptResult.attempts,
      thrownAttempt: attemptResult.thrownAttempt
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
      const roll = rng.d20();
      const fielding = totalInfieldFielding(state[pitchingSide]);
      const total = roll + fielding;
      const target = speedTarget(batter);
      const batterOut = total > target;
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

export function applySingle(state, batter, battingSide, pitchingSide = null, rng = null, pitcher = null) {
  const outsBefore = state.outs;
  let runs = 0;
  const [first, second, third] = state.bases;
  if (third) runs += scoreRunner(state, battingSide, pitchingSide, third, pitcher);
  state.bases[2] = second;
  state.bases[1] = first;
  state.bases[0] = runnerFor(batter, pitcher);
  runs += resolveHitExtraBaseAttempts({
    state,
    battingSide,
    pitchingSide,
    rng,
    outsBefore,
    candidates: [
      second ? { runner: second, fromIndex: 2, toIndex: 3 } : null,
      first ? { runner: first, fromIndex: 1, toIndex: 2 } : null
    ]
  });
  return runs;
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
  recordRunnerStat(state, runner, "r");
  chargeRun(state, pitchingSide, runner?.responsiblePitcherId ?? fallbackPitcher?.id);
  return 1;
}

function recordRunnerStat(state, runner, stat) {
  if (!runner?.id) return;
  const line = ensureHitterLine(state, runner);
  line[stat] = (line[stat] ?? 0) + 1;
}

function chargeRun(state, pitchingSide, pitcherId) {
  if (!pitchingSide || !pitcherId) return;
  const pitcher = state[pitchingSide].pitchers.find((item) => item.id === pitcherId);
  if (!pitcher) return;
  pitcher.chargedRuns = Number(pitcher.chargedRuns ?? 0) + 1;
  ensurePitcherLine(state, pitcher).r += 1;
}

function runnerFor(player, responsiblePitcher = null) {
  return {
    id: player.id,
    name: player.name,
    speed: Number(player.speed) || 0,
    responsiblePitcherId: player.responsiblePitcherId ?? responsiblePitcher?.id ?? null
  };
}

// All tag-up opportunities, lead runner first, unfiltered by the decision
// matrix — the interactive layer offers every legal send.
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

  return candidates;
}

function chooseTagUpAttempts(state, pitchingSide, outsForDecision) {
  return leadPrefixAttempts(tagUpCandidates(state, pitchingSide, outsForDecision));
}

// A trailing runner can only advance if every runner ahead of him goes too —
// otherwise he'd run into an occupied base. Candidates arrive lead first, so
// take the prefix that clears the decision matrix.
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
  const [runnerOnFirst, runnerOnSecond, runnerOnThird] = state.bases;
  const fielding = totalCatcherFielding(state[pitchingSide]);
  const candidates = [];

  if (runnerOnSecond && !runnerOnThird) {
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

  return candidates
    .filter((candidate) => shouldAttemptAdvance(candidate))
    .sort((a, b) => b.safeChance - a.safeChance || b.toIndex - a.toIndex)[0] ?? null;
}

function resolveStealAttempt(state, candidate, rng) {
  const roll = rng.d20();
  const total = roll + candidate.fielding;
  const safe = total <= candidate.target;
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

function resolveHitExtraBaseAttempts({ state, battingSide, pitchingSide, rng, outsBefore, candidates }) {
  if (!pitchingSide || !rng || state.outs >= 3) return 0;
  const fielding = totalOutfieldFielding(state[pitchingSide]);
  const twoOutBonus = outsBefore >= 2 ? 5 : 0;
  const allCandidates = candidates
    .filter(Boolean)
    .map((candidate) => createAdvanceCandidate({
      ...candidate,
      outsForDecision: outsBefore,
      fielding,
      targetBonus: (candidate.toIndex >= 3 ? 5 : 0) + twoOutBonus
    }))
    .sort((a, b) => b.toIndex - a.toIndex);

  if (state.deferAdvancesFor === battingSide && allCandidates.length) {
    state.pendingAdvance = { kind: "hit", battingSide, pitchingSide, outsBefore, candidates: allCandidates };
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

  const attemptResult = resolveAdvanceAttempts(state, attempts, battingSide, pitchingSide, rng);
  state.lastPlayDetails = {
    kind: "hit",
    outsBefore,
    extraBaseAttempts: attemptResult.attempts,
    thrownAttempt: attemptResult.thrownAttempt
  };
  return attemptResult.runs;
}

function createAdvanceCandidate({ runner, fromIndex, toIndex, outsForDecision, fielding, targetBonus = 0 }) {
  const target = speedTarget(runner) + targetBonus;
  const safeChance = advanceSafeChance(target, fielding);
  return {
    runner,
    fromIndex,
    toIndex,
    outsForDecision,
    fielding,
    target,
    safeChance,
    destination: destinationKey(toIndex)
  };
}

function shouldAttemptAdvance(candidate) {
  const minimum = ADVANCE_DECISION_MATRIX[candidate.outsForDecision]?.[candidate.destination] ?? 1;
  return candidate.safeChance >= minimum;
}

function resolveAdvanceAttempts(state, candidates, battingSide, pitchingSide, rng) {
  const throwTarget = chooseThrowTarget(candidates);
  const roll = rng.d20();
  const total = roll + throwTarget.fielding;
  const safe = total <= throwTarget.target;
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
  } else {
    state.outs += 1;
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

function totalCatcherFielding(team) {
  const player = team.lineup.find((item) => playerDefensivePosition(item) === "C" || playerDefensivePosition(item) === "CA");
  return fieldingValue(player);
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
}

function snapshotBases(state) {
  return state.bases.map((runner) => (runner ? runner.name : null));
}

function recordStats(state, battingSide, pitchingSide, batter, pitcher, result, runs, outsOnPlay) {
  const hitterLine = ensureHitterLine(state, batter);
  const pitcherLine = ensurePitcherLine(state, pitcher);
  hitterLine.pa += 1;
  pitcherLine.bf += 1;
  hitterLine.rbi += runs;

  if ([RESULTS.SINGLE, RESULTS.DOUBLE, RESULTS.TRIPLE, RESULTS.HR].includes(result)) {
    hitterLine.h += 1;
    pitcherLine.h += 1;
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
  }
  if (result === RESULTS.SO) {
    hitterLine.so += 1;
    pitcherLine.so += 1;
  }
  if (result === RESULTS.HR) {
    hitterLine.hr += 1;
    pitcherLine.hr += 1;
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

  state[battingSide].runs = state.score[battingSide];
  state[pitchingSide].runsAllowed = state.score[battingSide];
}

// Stat lines are keyed by side as well as card id so the same card appearing
// in both lineups keeps separate home and away lines. Deriving the side from
// state.half is safe because every stat records before the half flips (a
// pending advance decision blocks the flip until it resolves).
function ensureHitterLine(state, hitter) {
  const side = state.half === "top" ? "away" : "home";
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
      rbi: 0,
      gidp: 0,
      wpa: 0
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
      wpa: 0
    });
  }
  return state.stats.pitchers.get(key);
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
