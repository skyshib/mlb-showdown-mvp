export const WPA_CALIBRATION_VERSION = 1;
export const WPA_CALIBRATION_PRIOR_STRENGTH = 50;

// Mutable, batch-local observations. This object never enters saved state;
// finalizeWinExpectancyCalibration turns it into a small JSON-safe lookup.
export function createWinExpectancyCalibration() {
  return {
    games: 0,
    events: 0,
    homeWins: 0,
    runs: 0,
    states: new Map(),
    baseOut: new Map()
  };
}

// Learn two related quantities from a finished game:
//   * eventual home-win probability for the full game state (WPA)
//   * runs remaining in the current half for the base/out state (RE)
export function observeCalibrationGame(calibration, game) {
  if (!calibration || !game) return calibration;
  const events = game.events ?? [];
  const homeWon = game.winner === game.home?.name ? 1 : 0;
  const finalHalfScores = new Map();

  calibration.games += 1;
  calibration.events += events.length;
  calibration.homeWins += homeWon;
  calibration.runs += (game.away?.runs ?? 0) + (game.home?.runs ?? 0);

  for (const event of events) {
    const battingSide = event.half === "bottom" ? "home" : "away";
    finalHalfScores.set(halfKey(event), event.scoreAfter?.[battingSide] ?? 0);
  }

  for (const event of events) {
    const state = eventStateBefore(event);
    const key = winExpectancyStateKey(state);
    const row = calibration.states.get(key) ?? {
      visits: 0,
      homeWins: 0,
      baseline: finiteProbability(event.wpBefore, 0.5)
    };
    row.visits += 1;
    row.homeWins += homeWon;
    calibration.states.set(key, row);

    const battingSide = event.half === "bottom" ? "home" : "away";
    const finalScore = finalHalfScores.get(halfKey(event)) ?? event.scoreAfter?.[battingSide] ?? 0;
    const runsRemaining = finalScore - (event.scoreBefore?.[battingSide] ?? 0);
    const baseOutKey = `${normalizedOuts(event.outsBefore)}|${baseMask(event.basesBefore)}`;
    const baseOut = calibration.baseOut.get(baseOutKey) ?? { visits: 0, runs: 0 };
    baseOut.visits += 1;
    baseOut.runs += runsRemaining;
    calibration.baseOut.set(baseOutKey, baseOut);
  }
  return calibration;
}

export function finalizeWinExpectancyCalibration(calibration, options = {}) {
  const priorStrength = positiveNumber(
    options.priorStrength,
    WPA_CALIBRATION_PRIOR_STRENGTH
  );
  const states = {};
  for (const [key, row] of calibration?.states ?? []) {
    states[key] = (
      row.homeWins + priorStrength * row.baseline
    ) / (row.visits + priorStrength);
  }
  const runExpectancy = {};
  for (const [key, row] of calibration?.baseOut ?? []) {
    runExpectancy[key] = {
      runs: row.visits ? row.runs / row.visits : 0,
      visits: row.visits
    };
  }
  const games = calibration?.games ?? 0;
  return {
    version: WPA_CALIBRATION_VERSION,
    priorStrength,
    games,
    events: calibration?.events ?? 0,
    observedStates: Object.keys(states).length,
    runsPerGame: games ? calibration.runs / games : 0,
    homeWinRate: games ? calibration.homeWins / games : 0,
    states,
    runExpectancy
  };
}

export function calibratedWinProbability(model, state, fallback) {
  if (model?.version !== WPA_CALIBRATION_VERSION || !model.states) return fallback;
  const value = model.states[winExpectancyStateKey(state)];
  return Number.isFinite(value) ? value : fallback;
}

export function winExpectancyStateKey(state) {
  const scoreDiff = Number.isFinite(state?.diff)
    ? state.diff
    : (state?.score?.home ?? 0) - (state?.score?.away ?? 0);
  return [
    normalizedInning(state?.inning),
    state?.half === "bottom" ? "bottom" : "top",
    normalizedOuts(state?.outs),
    Number.isFinite(state?.baseMask) ? state.baseMask : baseMask(state?.bases),
    Math.max(-10, Math.min(10, Math.round(scoreDiff)))
  ].join("|");
}

export function baseOutRunExpectancy(model, outs, bases) {
  const row = model?.runExpectancy?.[`${normalizedOuts(outs)}|${baseMask(bases)}`];
  return Number.isFinite(row?.runs) ? row.runs : null;
}

function eventStateBefore(event) {
  return {
    inning: event.inning,
    half: event.half,
    outs: event.outsBefore,
    bases: event.basesBefore,
    score: event.scoreBefore
  };
}

function halfKey(event) {
  return `${event.inning}|${event.half}`;
}

function normalizedInning(value) {
  return Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
}

function normalizedOuts(value) {
  return Math.max(0, Math.min(2, Math.round(Number(value) || 0)));
}

function baseMask(bases) {
  return (bases?.[0] ? 1 : 0) + (bases?.[1] ? 2 : 0) + (bases?.[2] ? 4 : 0);
}

function finiteProbability(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
