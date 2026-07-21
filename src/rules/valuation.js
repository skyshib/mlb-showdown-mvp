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

// A starting pitcher only takes the ball once through the rotation, so the games
// he starts — and thus his whole seasonal contribution — scale with 1 / (SP
// slots): each of two starters opens half a team's games, each of four opens a
// quarter. The per-card value functions below are format-blind (they price one
// start), so an SP's worth is lifted by how OFTEN he starts. The lift is
// anchored at a full rotation (SP_SLOT_ANCHOR): at that many slots or more a
// starter is priced as-is, and a shorter rotation lifts him toward the anchor.
// Relievers work out of the pen on availability, not the rotation, so they never
// take this factor. The shape (anchor 3, floor 1, cap 2) was chosen by an A/B
// sweep of the CPU bidder: boosting SP ~1.5x at 2 slots beat the slot-blind
// bidder by ~+4 win pts, while EVER cutting SP below its base value (long
// rotations) consistently hurt — so the floor never lets it drop below 1.
const SP_SLOT_ANCHOR = 3;
const SP_SLOT_FACTOR_CAP = 2;

function spSlotFactor(startingPitchers) {
  const slots = Number(startingPitchers) || SP_SLOT_ANCHOR;
  return Math.min(SP_SLOT_FACTOR_CAP, Math.max(1, SP_SLOT_ANCHOR / slots));
}

// ---- what a computer manager believes ----
//
// One autopicker played every empty seat the same way, with a little noise on
// its weights to keep three computers from drafting in lockstep. That is not the
// same as three managers with opinions. These are opinions.
//
// `weights` bend what a card is worth to this manager. `bias` bends how he
// shops: how far he will reach for an arm, how much a scarce position moves him.
// The noise still sits on top, so two sluggers are not the same slugger.
export const CPU_PERSONALITIES = {
  balanced: {
    key: "balanced",
    name: "Balanced",
    blurb: "Takes the best card on the board and keeps the roster honest.",
    weights: { hitter: {}, pitcher: {} },
    bias: { pitcher: 1, scarcity: 1 }
  },
  slugger: {
    key: "slugger",
    name: "Slugger",
    blurb: "Buys the chart. Wants the ball to leave the yard and will not ask who is catching.",
    weights: {
      hitter: { onBase: 17, fielding: 2, speed: 0.6, chart: 1.8 },
      pitcher: {}
    },
    bias: { pitcher: 0.85, scarcity: 0.8 }
  },
  ace: {
    key: "ace",
    name: "Ace first",
    blurb: "Believes pitching wins it, and reaches for arms earlier than anyone thinks wise.",
    weights: {
      hitter: {},
      pitcher: { control: 44, ip: 12, chart: 1.35 }
    },
    bias: { pitcher: 1.7, scarcity: 1 }
  },
  purist: {
    key: "purist",
    name: "Positional purist",
    blurb: "Fields a real defence, fills the scarce spots first, and never plays a man out of position.",
    weights: {
      hitter: { onBase: 18, fielding: 15, speed: 3, chart: 0.85 },
      pitcher: {}
    },
    bias: { pitcher: 1, scarcity: 1.8 }
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

export function createValuationModel(seed, personalityKey = "balanced", startingPitchers = SP_SLOT_ANCHOR) {
  const rng = createRng(String(seed));
  const persona = cpuPersonality(personalityKey);
  const spFactor = spSlotFactor(startingPitchers);
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
    startingPitchers,
    value(player) {
      if (player?.kind !== "pitcher") return hitterValue(player, weights.hitter);
      const base = pitcherValue(player, weights.pitcher);
      // Only starters ride the rotation-size lift; relievers are format-neutral.
      return player.role === "SP" ? base * spFactor : base;
    }
  };
}

function perturbWeights(rng, base) {
  return Object.fromEntries(
    Object.entries(base).map(([key, weight]) => [key, weight * (1 - PERTURBATION + rng.next() * PERTURBATION * 2)])
  );
}

// On-base is the batter's half of the same roll control is the pitcher's half
// of: the batter's card settles the plate appearance when d20 + control does
// NOT clear his on-base. So on-base is the SHARE OF PLATE APPEARANCES DECIDED
// ON HIS OWN CHART, which makes it a multiplier on that chart, not an addition
// to it. Measured against simulated runs scored (72 bats, one per DH slot, 300
// seasons each): on-base alone 0.710, chart alone 0.769, the old additive sum
// 0.868, the bare product 0.938 — and the form below 0.966. Head to head against
// the additive model it is worth ~+15 win points on a fictional deck at full
// temperature (and ~+3 at temperature zero); on mlb-history it is exactly
// neutral, because real cards sit in a narrow on-base band with little for the
// interaction to separate.
//
// The ladder is the staff a drafted opponent actually runs out, a shade above
// the pool's mean control (3.5-4.1 across every set measured) because managers
// draft the high-control arms.
const REFERENCE_STAFF_CONTROL = [3, 4, 4, 5, 5, 6, 7];

// What a typical pitcher's chart is worth when IT is the one consulted, scored
// on the hitter's table (per slot): −1.44 fictional, −1.10 at full temperature,
// −1.41 mlb-history. The break-even line — a bat whose chart rates above it
// gains from on-base, one below it would rather the pitcher's card were read.
const REPLACEMENT_ARM_RATE = -1.35;

// Calibrated on hitter WORTH (value − worst-at-position), which is what the
// bidder actually prices, not on mean value.
const HITTER_INTERACTION_SCALE = 130;

function onBaseUsage(onBase) {
  const ob = Number(onBase) || 0;
  let total = 0;
  for (const control of REFERENCE_STAFF_CONTROL) {
    total += Math.max(0, Math.min(20, ob - control)) / 20;
  }
  return total / REFERENCE_STAFF_CONTROL.length;
}

function hitterValue(player, weights) {
  const speedComponent = Math.max(0, (Number(player.speed) || 0) - 1);
  // The on-base weight is now the persona's read on how much reaching base is
  // worth, applied as a lean on the usage curve — it must not scale the
  // replacement line, or a bat-minded archetype gets a flat bonus on every bat.
  const lean = weights.onBase / HITTER_BASE_WEIGHTS.onBase;
  const edge = chartRate(player.chart, HITTER_CHART_VALUES) * weights.chart - REPLACEMENT_ARM_RATE;
  return (
    onBaseUsage(player.onBase) * lean * edge * HITTER_INTERACTION_SCALE +
    (Number(player.fielding) || 0) * weights.fielding +
    speedComponent * weights.speed
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

function chartSlots(chart) {
  return (chart ?? []).reduce((sum, entry) => sum + chartSpan(entry), 0);
}

function chartRate(chart, values) {
  const slots = chartSlots(chart);
  return slots ? chartValue(chart, values) / slots : 0;
}
