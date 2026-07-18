import { createRng } from "./rng.js?v=20260716-records";
import { RESULTS, chartSpan } from "./cards.js?v=20260716-records";

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

// Calibrated to this sim's ACTUAL run values, measured by RE24 over 314k plate
// appearances (BB +0.30, 1B +0.41, 2B +0.81, 3B +1.01, HR +1.38, outs ≈ −0.29).
// Hitter values sit on a ~10.6 units-per-run scale; the notable correction from
// the old table is GB (double plays make it worse than a fly ball, not equal).
const HITTER_CHART_VALUES = {
  [RESULTS.SO]: -4,
  [RESULTS.GB]: -3,
  [RESULTS.FB]: -2,
  [RESULTS.BB]: 4,
  [RESULTS.SINGLE]: 5,
  [RESULTS.SINGLE_PLUS]: 5,
  [RESULTS.DOUBLE]: 9,
  [RESULTS.TRIPLE]: 11,
  [RESULTS.HR]: 14
};

// The out rewards (PU/SO/GB/FB) are left as a strong chart-quality signal —
// head-to-head testing showed that damping them makes the valuation discriminate
// WORSE between arms, so they stay. The correction is at the extra-base end,
// which the old table under-penalized relative to its own singles/doubles: at
// the table's scale (a single at −0.41 runs → −7), the run-value-fair HR (+1.38)
// is −24 and the triple (+1.01) is −16. The triple was previously missing
// entirely (scored 0). So an HR-prone arm is no longer flattered by its outs.
const PITCHER_CHART_VALUES = {
  [RESULTS.PU]: 8,
  [RESULTS.SO]: 10,
  [RESULTS.GB]: 8,
  [RESULTS.FB]: 6,
  [RESULTS.BB]: -5,
  [RESULTS.SINGLE]: -7,
  [RESULTS.DOUBLE]: -11,
  [RESULTS.TRIPLE]: -16,
  [RESULTS.HR]: -24
};

const PERTURBATION = 0.25;

// ---- what a computer manager believes ----
//
// One autopicker played every empty seat the same way, with a little noise on
// its weights to keep three computers from drafting in lockstep. That is not the
// same as three managers with opinions. These are opinions.
//
// `weights` bend what a card is worth to this manager. `bias` bends how he
// shops: how far he will reach for an arm, whether he cares what a card costs,
// how much a scarce position moves him. The noise still sits on top, so two
// sluggers are not the same slugger.
export const CPU_PERSONALITIES = {
  balanced: {
    key: "balanced",
    name: "Balanced",
    blurb: "Takes the best card on the board and keeps the roster honest.",
    weights: { hitter: {}, pitcher: {} },
    bias: { pitcher: 1, thrift: 0, scarcity: 1 }
  },
  slugger: {
    key: "slugger",
    name: "Slugger",
    blurb: "Buys the chart. Wants the ball to leave the yard and will not ask who is catching.",
    weights: {
      hitter: { onBase: 17, fielding: 2, speed: 0.6, chart: 1.8 },
      pitcher: {}
    },
    bias: { pitcher: 0.85, thrift: 0, scarcity: 0.8 }
  },
  ace: {
    key: "ace",
    name: "Ace first",
    blurb: "Believes pitching wins it, and reaches for arms earlier than anyone thinks wise.",
    weights: {
      hitter: {},
      pitcher: { control: 44, ip: 12, chart: 1.35 }
    },
    bias: { pitcher: 1.7, thrift: 0, scarcity: 1 }
  },
  bargain: {
    key: "bargain",
    name: "Bargain hunter",
    blurb: "Counts the points. Would rather have two good cards than one great one.",
    weights: { hitter: {}, pitcher: {} },
    bias: { pitcher: 1, thrift: 1, scarcity: 1.1 }
  },
  purist: {
    key: "purist",
    name: "Positional purist",
    blurb: "Fields a real defence, fills the scarce spots first, and never plays a man out of position.",
    weights: {
      hitter: { onBase: 18, fielding: 15, speed: 3, chart: 0.85 },
      pitcher: {}
    },
    bias: { pitcher: 1, thrift: 0, scarcity: 1.8 }
  }
};

export const CPU_PERSONALITY_KEYS = Object.keys(CPU_PERSONALITIES);

export function cpuPersonality(key) {
  return CPU_PERSONALITIES[key] ?? CPU_PERSONALITIES.balanced;
}

// The UI reveals each manager's perturbed weights after a sim; exposing the
// baseline and spread lets it show how far every preference leans.
export const VALUATION_BASE_WEIGHTS = {
  hitter: HITTER_BASE_WEIGHTS,
  pitcher: PITCHER_BASE_WEIGHTS
};
export const VALUATION_PERTURBATION = PERTURBATION;

export function createValuationModel(seed, personalityKey = "balanced") {
  const rng = createRng(String(seed));
  const persona = cpuPersonality(personalityKey);
  // The archetype states its case; the noise keeps two of the same archetype
  // from being the same manager.
  const weights = {
    hitter: perturbWeights(rng, { ...HITTER_BASE_WEIGHTS, ...persona.weights.hitter }),
    pitcher: perturbWeights(rng, { ...PITCHER_BASE_WEIGHTS, ...persona.weights.pitcher })
  };

  return {
    weights,
    persona,
    bias: persona.bias,
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
    (sum, entry) => sum + chartSpan(entry) * (values[entry.result] ?? 0),
    0
  );
}
