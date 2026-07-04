import { createRng } from "./rng.js";
import { normalizeResult, RESULTS } from "./cards.js";

const HITTER_BASE_WEIGHTS = {
  onBase: 20,
  fielding: 7,
  speed: 1.5,
  chart: 1
};

const PITCHER_BASE_WEIGHTS = {
  control: 35,
  ip: 8,
  chart: 1
};

const HITTER_CHART_VALUES = {
  [RESULTS.SO]: -4,
  [RESULTS.GB]: -2,
  [RESULTS.FB]: -2,
  [RESULTS.BB]: 4,
  [RESULTS.SINGLE]: 5,
  [RESULTS.DOUBLE]: 9,
  [RESULTS.TRIPLE]: 11,
  [RESULTS.HR]: 14
};

const PITCHER_CHART_VALUES = {
  [RESULTS.PU]: 8,
  [RESULTS.SO]: 10,
  [RESULTS.GB]: 8,
  [RESULTS.FB]: 6,
  [RESULTS.BB]: -5,
  [RESULTS.SINGLE]: -7,
  [RESULTS.DOUBLE]: -11,
  [RESULTS.HR]: -16
};

const PERTURBATION = 0.25;

export function createValuationModel(seed) {
  const rng = createRng(String(seed));
  const weights = {
    hitter: perturbWeights(rng, HITTER_BASE_WEIGHTS),
    pitcher: perturbWeights(rng, PITCHER_BASE_WEIGHTS)
  };

  return {
    weights,
    value(player) {
      return player?.kind === "pitcher" ? pitcherValue(player, weights.pitcher) : hitterValue(player, weights.hitter);
    }
  };
}

function perturbWeights(rng, base) {
  return Object.fromEntries(
    Object.entries(base).map(([key, weight]) => [key, weight * (1 - PERTURBATION + rng.next() * PERTURBATION * 2)])
  );
}

function hitterValue(player, weights) {
  const speedComponent = Math.max(0, (Number(player.speed) || 0) - 1);
  return (
    (Number(player.onBase) || 0) * weights.onBase +
    (Number(player.fielding) || 0) * weights.fielding +
    speedComponent * weights.speed +
    chartValue(player.chart, HITTER_CHART_VALUES) * weights.chart
  );
}

// Mirrors the workload curve in playerGeneration's pitcherPoints: control and
// chart quality reach every batter faced, so they are worth full price at the
// 6-IP starter baseline and half for a 1-IP reliever.
function ipWorkloadWeight(ip) {
  return ((Number(ip) || 0) + 4) / 10;
}

function pitcherValue(player, weights) {
  const ip = Number(player.ip) || 0;
  const quality =
    (Number(player.control) || 0) * weights.control +
    chartValue(player.chart, PITCHER_CHART_VALUES) * weights.chart;
  return quality * ipWorkloadWeight(ip) + ip * weights.ip;
}

function chartValue(chart, values) {
  return (chart ?? []).reduce(
    (sum, entry) => sum + (entry.to - entry.from + 1) * (values[normalizeResult(entry.result)] ?? 0),
    0
  );
}
