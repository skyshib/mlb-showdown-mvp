// THE KNOBS A DRAFTING COMPUTER TURNS.
//
// Every number here was a bare constant in draft.js, and every one of them was
// once an overnight study: the 2.5x top reliever, the 0.65x narrow-board
// starter, the near-linear budget share, the 0.7x bench damp. The constants
// stay the shipped answer — this file is their home, not a new behavior — but
// naming them does one thing a constant cannot: it lets ONE room hold two
// opinions at once.
//
// A computer manager carries `manager.tunables`. Leave it unset and he drafts
// the shipped way, reading the frozen default object with no copying and no
// merge. Set it and only HE changes, so scripts/cpu-lab.mjs can seat four
// managers on a tweak and four on the shipped bidder in the same auction,
// bidding against each other for the same cards, and read the difference off
// the standings. That is the only way to measure a valuation change honestly:
// an auction allocates by RELATIVE worth, so a table where everyone re-ranks
// the board the same way buys the same cards at different prices and shows
// nothing (see league-duels-measure-denial).
//
// Nothing in the app sets this. It is a measurement seam, and in production
// every manager reads CPU_TUNABLES.

// What ships. A knob here is a knob the lab can turn; anything absent from this
// object is rejected as a typo rather than silently ignored, because a
// misspelled tweak reads as a perfect null and a null is a believable result.
export const CPU_TUNABLE_DEFAULTS = Object.freeze({
  // ---- what a card is worth to this manager (valuation.js) ----
  // The seeded wobble on his weights, so two managers of one archetype are not
  // the same manager. Zero makes every seat of a persona think identically,
  // which is what a controlled room wants.
  perturbation: 0.25,
  // Absolute weight overrides, merged over the archetype's own: e.g.
  // { onBase: 24 }. Null leaves the model alone.
  hitterWeights: null,
  pitcherWeights: null,

  // ---- how the board's arms are re-dealt (pitcherRanking) ----
  // What a narrow-spread board's starters are worth. Frees money for bats and
  // relievers where the ace and the fourth starter are nearly the same card.
  starterDiscount: 0.65,
  starterNarrowSpread: 0.04, // full discount at or below this spread
  starterWideSpread: 0.05, // none at or above it
  // The share of a board's relievers who must beat the rotation before the
  // deck's arms get spaced by the season each one would throw.
  relieverSpacingShare: 0.3,

  // ---- what a pen is worth (auction and snake alike) ----
  relieverTopRate: 2.5, // the best arm, per point of value over the floor
  relieverDepthRate: 0.7, // every arm behind him
  // How many arms a manager PLANS to carry where the pen is uncapped. The board
  // is dealt to the shipped target either way — a half-tweaked table cannot
  // redeal the deck — so this moves what he budgets for, not what exists.
  penDepthTarget: 5,
  // Which arm the pen premium is measured from. 0 is the board's worst
  // reliever, which is what an auction leaves standing at the end of the night;
  // 1 is the first arm the room's pen seats do not reach, which is what a snake
  // manager would really fall back to.
  relieverFloorByRoom: 0,

  // ---- what he will pay (auctionWillingness) ----
  slotTiebreak: 0.05, // a card who gains his roster nothing still ranks by this much of his raw value
  urgencyPatient: 0.5, // holes-per-remaining below this: no hurry
  urgencyDesperate: 1, // holes at or above the men left to fill them: all in
  urgencyWeight: 1, // how far full desperation lifts a card's worth
  depthSlots: 3, // slots a full roster spreads its leftover budget over
  depthDamp: 0.7, // how much softer a bench card is bid
  shareExponent: 1.1, // how hard the bankroll concentrates on the best men left
  poolPremiumStrength: 0.7, // the lift on a card at the very top of the deck
  poolPremiumThreshold: 0.8, // the percentile the lift starts at
  aggressionFloor: 0.86, // the seeded per-card wobble: floor and width
  aggressionSpan: 0.28,
  // The salt on that wobble's seed. It is the one knob here that is NOT a
  // question about how to draft: it re-draws the same wobble from the same
  // distribution, so a manager carrying a salt is the shipped bidder in every
  // respect except which close lots he happens to win. That makes it the only
  // honest PLACEBO this bench can run — see `jiggle` in cpu-lab-tweaks.mjs.
  // Empty is the shipped seed.
  wobbleSalt: "",
  paceFloor: 0.75, // manual nomination: the spend-down clamp
  paceCeiling: 1.8,
  roundsFloor: 0.7, // random nomination: the same, read off the queue
  roundsCeiling: 2.2,
  roundsBudgetDivisor: 25, // what one round's spending is measured against

  // ---- what he picks (snake autopickScore) ----
  snakeNeedBonus: 80, // a card that fills a hole, flat
  snakeNeedSpan: 120, // and more as the holes crowd the turns left
  snakeBalanceBonus: 35, // an arm when the staff is short
  snakeArmLean: 140, // how far an archetype's pitcher bias moves an arm
  snakeForcedNeed: 1000, // the override that stops a roster stranding a slot
  snakeScarcityRate: 0.8, // of the dropoff to the next man at the spot
  snakeScarcityCap: 120
});

// What each knob MEANS, in one line, for a reader who is watching the bench
// rather than reading this file. cpu-lab.html prints these beside the shipped
// value and the tweaked one, so a candidate called "share-steep" can be read as
// "how hard the bankroll concentrates on the best men left: 1.1 -> 1.3" without
// anybody having to come back here and look.
export const CPU_TUNABLE_NOTES = Object.freeze({
  perturbation: "the seeded wobble on a manager's weights, so two of one archetype are not the same manager",
  hitterWeights: "what a bat's parts are worth to this manager, over the archetype's own",
  pitcherWeights: "what an arm's parts are worth to this manager, over the archetype's own",
  starterDiscount: "what a narrow-spread board's starters are worth",
  starterNarrowSpread: "the board starter spread at or below which that discount is full",
  starterWideSpread: "the board starter spread at or above which there is no discount",
  relieverSpacingShare: "the share of a board's relievers who must beat the rotation before its arms are spaced by the season each would throw",
  relieverTopRate: "what a point of value is worth in a team's best reliever, against a starter's",
  relieverDepthRate: "what a point of value is worth in every arm behind the best one",
  penDepthTarget: "how many relievers a manager plans to carry where the pen is uncapped",
  relieverFloorByRoom: "price the pen over the first arm the room's seats do not reach, rather than over the worst arm dealt",
  slotTiebreak: "what a card who upgrades nothing is still worth, as a share of his raw value",
  urgencyPatient: "holes-per-man-remaining below which he is in no hurry",
  urgencyDesperate: "holes-per-man-remaining at which he reaches for full value",
  urgencyWeight: "how far full desperation lifts a card's worth",
  depthSlots: "how many slots a full roster spreads its leftover budget over",
  depthDamp: "how much softer a card nobody's lineup needs is bid",
  shareExponent: "how hard the bankroll concentrates on the best men left",
  poolPremiumStrength: "the lift on a card at the very top of the deck",
  poolPremiumThreshold: "the deck percentile the top-of-deck lift starts at",
  aggressionFloor: "the floor of the seeded per-card bid wobble",
  aggressionSpan: "how wide that per-card bid wobble runs",
  wobbleSalt: "re-draws the same bid wobble from the same distribution: a different auction, an identical bidder",
  paceFloor: "under manual nomination, the least the spend-down may scale a bid",
  paceCeiling: "under manual nomination, the most the spend-down may scale a bid",
  roundsFloor: "under random nomination, the least the spend-down may scale a bid",
  roundsCeiling: "under random nomination, the most the spend-down may scale a bid",
  roundsBudgetDivisor: "what one round's spending is measured against",
  snakeNeedBonus: "what a card that fills a hole is worth to a snake pick, flat",
  snakeNeedSpan: "how much more that pick is worth as the holes crowd the turns left",
  snakeBalanceBonus: "the nudge toward an arm when the staff is short",
  snakeArmLean: "how far an archetype's pitcher bias moves an arm",
  snakeForcedNeed: "the override that stops a roster stranding a slot it can no longer fill",
  snakeScarcityRate: "the share of the drop to the next man at a spot that moves a pick",
  snakeScarcityCap: "the most scarcity alone may move one"
});

const KNOBS = Object.keys(CPU_TUNABLE_DEFAULTS);


// ---- GENERATIONS ------------------------------------------------------------
//
// A generation is the whole knob set written out as literal numbers and then
// never touched. The defaults above are a moving target — the point of the lab
// is to move them — so a result measured against "the defaults" stops meaning
// anything the moment they change. A generation is the fixed thing to measure
// against, and the thing to go back to.
//
// Two uses, and the second is the one that catches overfitting:
//
//   REVERT     every number the bidder shipped with on that date, in one place.
//              `node scripts/cpu-lab.mjs run --versus tuned-2026-11-10` seats the
//              frozen generation in the control chairs, so a change is measured
//              against a bidder that cannot drift under it.
//
//   DRIFT      run the lab's `null` fixture against a generation and you are
//              measuring the LIVE defaults against that generation across the
//              whole grid, on seeds that were never used to pick any of the
//              knobs in between. A pile of individually-promising tweaks that
//              reads flat or negative there was fitted to its own seeds.
//
// `fingerprint` is the digest scripts/cpu-fingerprint.mjs printed for the tree
// that shipped the generation. A knob preset can only take knob drift back: if
// the bidder's CODE changed shape, restoring these numbers does not restore the
// old behavior, and a fingerprint that no longer reproduces is how you find
// that out.
export const CPU_KNOB_GENERATIONS = Object.freeze({
  "tuned-2026-11-10": Object.freeze({
    at: "2026-11-10",
    git: "acc9aae",
    fingerprint: "c4661e913763",
    note: "the bidder as tuned by three years of paired studies — the shipped values the day the lab was built",
    knobs: Object.freeze({
      perturbation: 0.25,
      hitterWeights: null,
      pitcherWeights: null,
      starterDiscount: 0.65,
      starterNarrowSpread: 0.04,
      starterWideSpread: 0.05,
      relieverSpacingShare: 0.3,
      relieverTopRate: 2.5,
      relieverDepthRate: 0.7,
      penDepthTarget: 5,
      // Not a number this generation chose: the pen floor had no knob on
      // 2026-11-10, and 0 is the behavior it shipped with, written down.
      relieverFloorByRoom: 0,
      slotTiebreak: 0.05,
      urgencyPatient: 0.5,
      urgencyDesperate: 1,
      urgencyWeight: 1,
      depthSlots: 3,
      depthDamp: 0.7,
      shareExponent: 1.1,
      poolPremiumStrength: 0.7,
      poolPremiumThreshold: 0.8,
      aggressionFloor: 0.86,
      wobbleSalt: "",
      aggressionSpan: 0.28,
      paceFloor: 0.75,
      paceCeiling: 1.8,
      roundsFloor: 0.7,
      roundsCeiling: 2.2,
      roundsBudgetDivisor: 25,
      snakeNeedBonus: 80,
      snakeNeedSpan: 120,
      snakeBalanceBonus: 35,
      snakeArmLean: 140,
      snakeForcedNeed: 1000,
      snakeScarcityRate: 0.8,
      snakeScarcityCap: 120
    })
  }),

  // THE ABSOLUTE SCALE. Every knob the studies moved, backed out to the flat
  // answer a bidder would use if nobody had measured anything: starters at face
  // value, the bankroll split in proportion to worth, no premium on a stud, no
  // reach for a hole, every reliever worth what any other pitcher is worth, no
  // discount on a bench card. It is not a strawman bidder — it still prices
  // every card over the replacement at its spot, which is the one idea the
  // whole valuation rests on — it is that bidder WITHOUT the tuning.
  //
  // Measuring the shipped bidder against it is the only number here that does
  // not slide when the defaults move: it says how much the tuning is worth
  // altogether. If a round of changes raises every head-to-head against the
  // previous generation and this number does not move, the round bought
  // nothing.
  naive: Object.freeze({
    at: "2026-11-10",
    git: "acc9aae",
    fingerprint: null,
    note: "the tuning backed out: the absolute scale the shipped bidder is measured on",
    knobs: Object.freeze({
      starterDiscount: 1,
      // A share this high never clears the gate, so the deck's arms are never
      // spaced by the season they would throw — they keep their printed order.
      relieverSpacingShare: 1000,
      relieverTopRate: 1,
      relieverDepthRate: 1,
      slotTiebreak: 0,
      urgencyWeight: 0,
      depthDamp: 1,
      shareExponent: 1,
      poolPremiumStrength: 0,
      snakeScarcityRate: 0,
      snakeArmLean: 0
    })
  })
});

export function knobGeneration(name) {
  const found = CPU_KNOB_GENERATIONS[name];
  if (!found) {
    throw new Error(`cpuTunables: no generation "${name}". Known: ${Object.keys(CPU_KNOB_GENERATIONS).join(", ")}`);
  }
  return found;
}

// The shipped drafter. One frozen object, shared by every manager who carries no
// tweak, so the common path allocates nothing.
export const CPU_TUNABLES = Object.freeze({ ...CPU_TUNABLE_DEFAULTS, key: "" });

// A readable fingerprint of what a tweak changed. It keys the valuation-model
// cache (two managers who weigh cards differently must not share a model) and
// it labels a lab run, so it has to be stable and it has to be short.
function tunableKey(overrides) {
  return Object.keys(overrides).sort()
    .map((knob) => `${knob}=${typeof overrides[knob] === "object" && overrides[knob] !== null
      ? JSON.stringify(overrides[knob]) : overrides[knob]}`)
    .join("|");
}

// Normalize a tweak into a full, frozen knob set. Throws on a knob that does
// not exist: a typo must fail loudly rather than measure as a null.
export function cpuTunables(overrides) {
  if (!overrides) return CPU_TUNABLES;
  const given = Object.keys(overrides).filter((knob) => overrides[knob] !== undefined);
  const unknown = given.filter((knob) => knob !== "key" && !KNOBS.includes(knob));
  if (unknown.length) {
    throw new Error(`cpuTunables: no such knob — ${unknown.join(", ")}. Known knobs: ${KNOBS.join(", ")}`);
  }
  const changed = Object.fromEntries(given.filter((knob) => knob !== "key")
    .filter((knob) => JSON.stringify(overrides[knob]) !== JSON.stringify(CPU_TUNABLE_DEFAULTS[knob]))
    .map((knob) => [knob, overrides[knob]]));
  if (!Object.keys(changed).length) return CPU_TUNABLES;
  return Object.freeze({ ...CPU_TUNABLE_DEFAULTS, ...changed, key: tunableKey(changed) });
}

// What THIS manager believes. The normalized set is cached back onto him, so a
// tweak written as a plain object literal is merged once per draft rather than
// once per bid.
export function tunablesFor(manager) {
  const set = manager?.tunables;
  if (!set) return CPU_TUNABLES;
  if (typeof set.key === "string" && Object.isFrozen(set)) return set;
  const normalized = cpuTunables(set);
  manager.tunables = normalized;
  return normalized;
}
