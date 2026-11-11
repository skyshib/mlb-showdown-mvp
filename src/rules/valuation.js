import { createRng } from "./rng.js?v=20260716-records";
import { RESULTS, chartSpan } from "./cards.js?v=20260716-records";
import { isCoach } from "./coaches.js?v=20260910-coaches";

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

// PU AND SO ARE THE SAME OUT. applyResult in game.js runs them through one
// branch — `case RESULTS.PU: case RESULTS.SO: state.outs += 1; return 0` — with
// no advancement, no double play and no sacrifice; the only thing that tells
// them apart is that SO also ticks a box-score line. So they must carry the same
// chart value, and a popup scoring 8 against a strikeout's 10 was simply an
// error. They are both 10.
//
// The out rewards (PU/SO/GB/FB) are left as a strong chart-quality signal —
// head-to-head testing showed that damping them makes the valuation discriminate
// WORSE between arms, so they stay. The correction is at the extra-base end,
// which the old table under-penalized relative to its own singles/doubles: at
// the table's scale (a single at −0.41 runs → −7), the run-value-fair HR (+1.38)
// is −24 and the triple (+1.01) is −16. The triple was previously missing
// entirely (scored 0). So an HR-prone arm is no longer flattered by its outs.
const PITCHER_CHART_VALUES = {
  [RESULTS.PU]: 10,
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
// take this factor. Short rotations lift toward SP_SLOT_ANCHOR (cap 2): ~1.5x
// at 2 slots beats the slot-blind bidder by ~+6 win pts. Rotations longer than
// SP_SLOT_DISCOUNT_ANCHOR discount by the same 1/slots logic, so a five-man
// starter is 0.8x. Without it the computers sank 36% of a 5-SP budget into the
// rotation (29% at 4 slots, 25% at 2-3). Measured on the league-paired
// valuation-ab against its null, 1000 leagues a cell, 0.8x at 5 slots won
// +0.5 to +1.9 win pts on every deck, table size and persona tried. Deeper cuts
// hurt (0.75x at 4 slots −2.2, 0.4x at 5 slots −2.1), and so did lifting a
// 3-man starter past 1 on mlb-history (−1.3), so 3-4 slots stay at 1.
const SP_SLOT_ANCHOR = 3;
const SP_SLOT_DISCOUNT_ANCHOR = 4;
const SP_SLOT_FACTOR_CAP = 2;

export function spSlotFactor(startingPitchers) {
  const slots = Number(startingPitchers) || SP_SLOT_ANCHOR;
  const discount = Math.min(1, SP_SLOT_DISCOUNT_ANCHOR / slots);
  return Math.min(SP_SLOT_FACTOR_CAP, Math.max(discount, SP_SLOT_ANCHOR / slots));
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
      // The chart weight was 1.8, and on the SNAKE that cost this archetype
      // about five win points absolutely — not the field effect
      // persona-winrate-is-field-dependent found in the auction, but a real
      // worse roster. Hitter value is a PRODUCT of on-base and chart (see
      // hitterValue below), so a chart multiplier does not merely tilt a
      // preference: it double-counts power the model has already priced, and
      // the ranking it hands the autopicker is wrong rather than opinionated.
      // Seat-paired absolute, one seat on the variant against its own balanced
      // counterpart, perturbation 0, nulls 49.93/50.11/49.98 — classic 5 seats
      // (8 boards), classic 6 seats (6), fictional 5 seats (6):
      //   1.8  44.79 / 44.36 / 44.18
      //   1.2  47.95 / 47.35 / 48.93
      //   1.0  48.97 / 49.32 / 51.97
      // and the ladder is monotone on the classic 5-seat cell (1.6 −4.8,
      // 1.4 −3.9, 1.2 −2.0, 1.0 −1.0 against the null). 1.5 is the setting
      // Skylar chose: it buys back less than a point of the five, and it is
      // deliberate — the archetype's LOOK rides on this weight, and the
      // cheaper leans below do not carry it on their own. The other three are
      // honest preferences and stay: at any chart weight this manager still
      // fields the worst defence in the room (12-13 glove points against
      // balanced's 17-18), which is the half of the identity that costs little.
      hitter: { onBase: 17, fielding: 2, speed: 0.6, chart: 1.5 },
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
      // A coach is worth his sticker, on the same scale the bats and arms come
      // out at — a late pick, never a star. The computer's real question about
      // a coach is not this number but what a pick spent on him costs (see
      // bestAutopickTarget in draft.js).
      if (isCoach(player)) return Number(player.points) || 0;
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

// ---- what a glove is worth, by where he stands ----------------------------
//
// A flat rate per fielding point said a catcher's tenth point was worth his
// first, and that a point at short was worth a point in left. The WPA-per-162
// sweep (every unit's fielding total moved up and down across every chance the
// sim threw, runners re-deciding at each level) says otherwise, and says it the
// same way in all five clubs measured:
//
//   CATCHER is steep below what clubs field and almost FLAT above it. Dropping
//     ten points off a fielded +6 costs ~14.6 wins a season; adding ten gains
//     ~1.4. The glove you must have is enormously valuable and the glove past
//     it is nearly free.
//   INFIELD bends the same way, less sharply: ~0.63 wins a point below, ~0.31
//     above.
//   OUTFIELD is LINEAR over the whole range, ~0.95 wins a point either way, and
//     is the only unit that keeps paying above what clubs field.
//
// The charts move a UNIT total (the catcher is one man; the infield sums four
// gloves, the outfield three), so a card's own points sit on that curve on top
// of whatever his teammates already provide. With teammates at their positions'
// usual ratings, the bend lands at the card's OWN position's usual rating —
// which is what FIELDING_REFERENCE holds.
//
// The curve fitted to all three is ONE smooth family, never a kink:
//
//     unit(x) = rate * bend * (1 - e^(-x / bend))
//
// unit(0) = 0, unit'(x) = rate * e^(-x/bend), which is positive and strictly
// falling — so the concavity never stops and there is no corner anywhere to
// land on. A missing `bend` is the bend -> infinity case, which is exactly a
// straight line, so the outfield is the same curve rather than a special rule.
// Fitted against the measured points at 0.32 WPA rms for the catcher and 0.12
// for the infield.
//
// Rates are in EFFECTIVE RATING POINTS per unit point, so weights.fielding stays
// the master dial a persona leans on, and they are rescaled to hold the deck's
// TOTAL glove value where the flat rate had it: this redistributes fielding by
// position rather than re-weighting fielding against on-base and chart.
const FIELDING_GROUP = {
  C: "catcher",
  "1B": "infield", "2B": "infield", "3B": "infield", SS: "infield",
  LF: "outfield", RF: "outfield", "LF/RF": "outfield", CF: "outfield",
  DH: null
};
const FIELDING_CURVE = {
  catcher: { rate: 2.3189, bend: 5.46 },
  infield: { rate: 0.9583, bend: 15.33 },
  outfield: { rate: 1.1434 }
};
// What the REST of a man's unit typically puts on the field. His own points sit
// on the unit curve ON TOP of that, which is the whole reason a catcher's glove
// bends so much harder than a shortstop's: the catcher IS his unit and starts at
// zero, where the curve is steepest, while an infielder's three team-mates have
// already carried the unit up into the flat part before he arrives.
const FIELDING_UNIT_BASE = {
  C: 0, "1B": 6.55, "2B": 4.18, "3B": 5.55, SS: 5.0,
  LF: 0, RF: 0, "LF/RF": 0, CF: 0, DH: 0
};

// Where the card actually stands, when the caller knows it (the seated readings
// in draft.js pass the slot), else the position printed on the card.
function fieldingSlotOf(player) {
  const slot = player?.fieldingSlot;
  if (slot && FIELDING_GROUP[slot] !== undefined) return slot;
  const printed = Array.isArray(player?.position) ? player.position.join("/") : player?.position;
  return typeof printed === "string" ? printed : "";
}

function fieldingShape(player) {
  const rating = Number(player?.fielding) || 0;
  const slot = fieldingSlotOf(player);
  const group = FIELDING_GROUP[slot];
  // A bat at a spot with no group (the DH, or a position this set does not
  // know) is carrying no glove worth pricing.
  if (!group) return 0;
  const curve = FIELDING_CURVE[group];
  // No bend is the straight line the outfield asked for -- the M -> infinity
  // case of the same curve, not a different rule.
  if (!curve.bend) return curve.rate * rating;
  const base = FIELDING_UNIT_BASE[slot] ?? 0;
  const unit = (x) => curve.rate * curve.bend * (1 - Math.exp(-x / curve.bend));
  return unit(base + rating) - unit(base);
}

// ---- what legs are worth --------------------------------------------------
//
// Speed pays twice, and the two halves have different shapes. Taking the extra
// base on a hit is available to everyone and scales smoothly, so it stays
// linear. STEALING does not: the sim prices a steal at (speed − the catcher's
// fielding) / 20, and a runner only gets the green light once that clears the
// break-even, so against an ordinary catcher nothing below about Speed A ever
// runs at all. That makes the top of the range worth far more than the middle —
// the gap from 18 to 28 is three times the gap from 8 to 18, where a flat rate
// called them equal.
//
// The curve is CONVEX EVERYWHERE, not straight-then-bent:
//
//     legs(s) = rate * max(0, s - 1) + lift * (e^((s - knee)/bend) - e^((1 - knee)/bend))
//
// max(0, s-1) is convex and the exponential is strictly convex, so the slope
// rises at EVERY speed — there is no flat stretch below the knee and no corner
// at it. The bend is tuned so the low range is effectively straight (the slope
// runs 0.98 at speed 8, 0.99 at 12, 1.05 at 16) and the climb is all in the top
// (1.13 at 18, 1.74 at 22, 4.77 at 26). The knee sits at SPEED_A_MINIMUM, the
// line the engine itself draws (and what the first base coach's green light
// keys on). The subtracted lift(1) keeps a speed-1 card at zero.
//
// Rates are in effective speed points so weights.speed stays the persona's
// dial, and they hold the deck's total speed value where the flat rate had it,
// so this buys the elite runner his premium out of the middle of the range
// rather than adding weight to legs overall.
const SPEED_STEAL_KNEE = 18;
const SPEED_STEAL_BEND = 2.5;
const SPEED_LEGS_RATE = 0.9779;
const SPEED_STEAL_LIFT = 0.38611;

function speedShape(player) {
  const speed = Number(player?.speed) || 0;
  const lift = (s) => Math.exp((s - SPEED_STEAL_KNEE) / SPEED_STEAL_BEND);
  return Math.max(0, speed - 1) * SPEED_LEGS_RATE
    + SPEED_STEAL_LIFT * (lift(speed) - lift(1));
}

function onBaseUsage(onBase) {
  const ob = Number(onBase) || 0;
  let total = 0;
  for (const control of REFERENCE_STAFF_CONTROL) {
    total += Math.max(0, Math.min(20, ob - control)) / 20;
  }
  return total / REFERENCE_STAFF_CONTROL.length;
}

function hitterValue(player, weights) {
  // The on-base weight is now the persona's read on how much reaching base is
  // worth, applied as a lean on the usage curve — it must not scale the
  // replacement line, or a bat-minded archetype gets a flat bonus on every bat.
  const lean = weights.onBase / HITTER_BASE_WEIGHTS.onBase;
  const edge = chartRate(player.chart, HITTER_CHART_VALUES) * weights.chart - REPLACEMENT_ARM_RATE;
  return (
    onBaseUsage(player.onBase) * lean * edge * HITTER_INTERACTION_SCALE +
    fieldingShape(player) * weights.fielding +
    speedShape(player) * weights.speed
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
