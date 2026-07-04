import { RESULTS, resolveChart } from "./cards.js";
import { createRng } from "./rng.js";

const ADVANCE_DECISION_MATRIX = {
  0: { second: 0.9, third: 0.85, home: 0.75 },
  1: { second: 0.8, third: 0.75, home: 0.65 },
  2: { second: 0.7, third: 0.65, home: 0.55 }
};

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
    innings: state.inning
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
  const controlRoll = rng.d20();
  const effectiveControl = pitcher.control - fatiguePenalty;
  const controlTotal = controlRoll + effectiveControl;
  const chartOwner = controlTotal > batter.onBase ? "pitcher" : "hitter";
  const resultRoll = rng.d20();
  const result = resolveChart(chartOwner === "pitcher" ? pitcher.chart : batter.chart, resultRoll);
  state.lastPlayDetails = null;
  const runs = applyResult(state, result, batter, battingSide, pitchingSide, rng, pitcher);

  const outsOnPlay = Math.max(0, state.outs - outsBefore);
  recordStats(state, battingSide, pitchingSide, batter, pitcher, result, runs, outsOnPlay);
  battingTeam.plateAppearances += 1;
  state.lineupIndex[battingSide] += 1;
  state.pitching[pitchingSide].outsRecorded += outsOnPlay;

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
    playDetails: state.lastPlayDetails
  };

  if (state.half === "bottom" && state.inning >= 9 && state.score.home > state.score.away) {
    state.walkoff = true;
    return event;
  }

  if (state.outs >= 3) {
    advanceHalfInning(state);
  }

  return event;
}

export function playStealAttempt(state, rng) {
  const battingSide = state.half === "top" ? "away" : "home";
  const pitchingSide = battingSide === "away" ? "home" : "away";
  const battingTeam = state[battingSide];
  const pitchingTeam = state[pitchingSide];
  const batter = battingTeam.lineup[state.lineupIndex[battingSide] % battingTeam.lineup.length];
  const pitcher = currentPitcher(state, pitchingSide);
  const before = snapshotBases(state);
  const outsBefore = state.outs;
  const scoreBefore = { ...state.score };
  const stealAttempt = chooseStealAttempt(state, pitchingSide);

  if (!stealAttempt) return null;

  const attemptResult = resolveStealAttempt(state, stealAttempt, rng);
  if (!attemptResult.safe) {
    state.pitching[pitchingSide].outsRecorded += 1;
    ensurePitcherLine(state, pitcher).outs += 1;
  }
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
      away: { pitcherIndex: 0, outsRecorded: 0 },
      home: { pitcherIndex: 0, outsRecorded: 0 }
    },
    stats: {
      hitters: new Map(),
      pitchers: new Map()
    },
    lastPlayDetails: null,
    walkoff: false
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
  if (state.half === "top" && state.inning > 9 && state.score.away !== state.score.home) return false;
  if (state.half === "bottom" && state.inning >= 9 && state.score.home > state.score.away) return false;
  return true;
}

function currentPitcher(state, side) {
  const runtime = state.pitching[side];
  const team = state[side];
  while (runtime.pitcherIndex < team.pitchers.length - 1) {
    const pitcher = team.pitchers[runtime.pitcherIndex];
    if (runtime.outsRecorded < pitcher.plannedOuts) break;
    runtime.pitcherIndex += 1;
    runtime.outsRecorded = 0;
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

function pitcherFatigue(runtime, pitcher) {
  const ipOuts = fatigueIpOuts(pitcher);
  if (runtime.outsRecorded < ipOuts) return 0;
  return Math.floor((runtime.outsRecorded - ipOuts) / 3) + 1;
}

function pitcherIpOuts(pitcher) {
  const ip = Number(pitcher?.ip ?? 0);
  if (!Number.isFinite(ip)) return 0;
  return Math.max(0, Math.round(ip * 3));
}

function fatigueIpOuts(pitcher) {
  const ipPenaltyOuts = Math.floor(Number(pitcher?.chargedRuns ?? 0) / 3) * 3;
  return Math.max(0, pitcherIpOuts(pitcher) - ipPenaltyOuts);
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

function chooseTagUpAttempts(state, pitchingSide, outsForDecision) {
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

  return candidates
    .filter((candidate) => shouldAttemptAdvance(candidate))
    .sort((a, b) => b.safeChance - a.safeChance || b.toIndex - a.toIndex);
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
      targetBonus: 5
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
  const attempts = candidates
    .filter(Boolean)
    .map((candidate) => createAdvanceCandidate({
      ...candidate,
      outsForDecision: outsBefore,
      fielding,
      targetBonus: (candidate.toIndex >= 3 ? 5 : 0) + twoOutBonus
    }))
    .filter((candidate) => shouldAttemptAdvance(candidate));

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
  pitcherLine.outs += outsOnPlay;

  state[battingSide].runs = state.score[battingSide];
  state[pitchingSide].runsAllowed = state.score[battingSide];
}

function ensureHitterLine(state, hitter) {
  if (!state.stats.hitters.has(hitter.id)) {
    state.stats.hitters.set(hitter.id, {
      id: hitter.id,
      name: hitter.name,
      team: null,
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
      rbi: 0
    });
  }
  return state.stats.hitters.get(hitter.id);
}

function ensurePitcherLine(state, pitcher) {
  if (!state.stats.pitchers.has(pitcher.id)) {
    state.stats.pitchers.set(pitcher.id, {
      id: pitcher.id,
      name: pitcher.name,
      team: null,
      bf: 0,
      outs: 0,
      h: 0,
      bb: 0,
      so: 0,
      hr: 0,
      r: 0
    });
  }
  return state.stats.pitchers.get(pitcher.id);
}

function summarizeTeam(state, side) {
  return {
    name: state[side].name,
    runs: state.score[side],
    lineup: state[side].lineup,
    pitchers: state[side].pitchers
  };
}

function buildBoxScore(state) {
  return {
    away: buildTeamBoxScore(state, "away"),
    home: buildTeamBoxScore(state, "home")
  };
}

function buildTeamBoxScore(state, side) {
  const hitterIds = new Set(state[side].lineup.map((player) => player.id));
  const pitcherIds = new Set(state[side].pitchers.map((player) => player.id));
  return {
    team: state[side].name,
    hitters: [...state.stats.hitters.values()].filter((line) => hitterIds.has(line.id)),
    pitchers: [...state.stats.pitchers.values()].filter((line) => pitcherIds.has(line.id))
  };
}
