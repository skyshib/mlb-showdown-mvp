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
  starterDiscount: 0.8,
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
  // 0.8 -> 0.6 on 2026-11-11 and PUT BACK on 2026-11-12: +1.48 +-0.25 against a
  // table still on 0.8 but -0.04 +-0.16 head to head, which is denial and
  // nothing else — see the tuned-2026-11-11 generation below. 0.5 on
  // 2026-11-13 on the REBUILT bench (seat-paired, 39 real-shaped rooms): the
  // average boost is +0.73 +-0.54 over 48 readings in 20 rooms and five table
  // sizes, and the rule accepted it. THE HEAD TO HEAD IS STILL UNMEASURED AT
  // THIS VALUE — the check that caught 0.6 has not been run on 0.5. Shipped
  // under Skylar's 2026-11-13 standard of implementing an accepted candidate
  // at once and re-measuring the rest against it.
  poolPremiumThreshold: 0.5, // the percentile the lift starts at
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
  // 120 -> 0 on 2026-11-13. The span scaled a snake pick's need bonus by holes
  // OF THAT TYPE over turns left, which at turn one of a 15-man room paid a bat
  // 9/15*120 = 72 against a starter's 32 — a 2.25x tilt to bats on exactly the
  // turns when the top of the starter board is still there, and it went quiet
  // once it was gone. It was counting HOLES, not SUPPLY: these rooms deal 94
  // bats and 41 starters, and a 4-seat room seats 38% of the bats and 39% of
  // the starters, so the two are equally scarce on the board. Accepted on the
  // seat-paired bench at +0.38 +-0.27 over 33 readings in 18 rooms and three
  // table sizes, 100% of the posterior above zero. snakeNeedBonus (the flat
  // term) stays: it is provably dead weight — zeroing it moves 0 of 180 turns,
  // because forcedNeed holds the roster shape and every legal candidate
  // collects the same 80 — so there is nothing to gain by touching it.
  snakeNeedSpan: 0, // and more as the holes crowd the turns left
  // 35 -> 60 on 2026-11-13, the parity value. A bat who fills a missing lineup
  // spot was paid hitterPositionBonus 60 while the same structural fact in the
  // staff paid 35, so before any opinion about any card entered, the board
  // handed a bat 212 and a starter 147 — and the only thing that ever overturned
  // it was the ace persona's armLean. 60 is parity with the hitter bonus rather
  // than a fishing dose, and the ladder confirms it is the targeted one:
  // replayed over 180 computer turns, 60 moves 26 and 20 of them buy a STARTER,
  // where 140 moves 77 but 47 buy a RELIEVER because the bonus is role-blind
  // and the pen is the cheaper staff hole. Accepted at +0.33 +-0.25 over 28
  // readings in 17 rooms and three table sizes, ON TOP OF the two positions
  // already held.
  // ...and 60 -> 70 the same day, by the bracket the accept queued. 60 was
  // PARITY with hitterPositionBonus, which was a principled place to look and
  // turned out not to be the optimum: 70 reads +0.33 +-0.24 against a table on
  // 60 (99% above zero) while 50 reads -0.16 against the same table, so the knob
  // wants to go UP past parity rather than sit on it. The staff hole is worth
  // MORE than the lineup hole it was matched to, which is a claim about the
  // board — a lineup hole can be filled from a deep pool of bats and a rotation
  // hole cannot. 65 and 75 are queued to narrow it.
  snakeBalanceBonus: 70, // an arm when the staff is short
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
  "tuned-2026-11-13e": Object.freeze({
    seq: 7,
    at: "2026-11-13",
    git: "9a73f3b",
    fingerprint: "6c42f3fa1750",
    // Crowned automatically by the bench the moment the stopping rule accepted
    // it. The reading is in the candidate's `settled` line in
    // scripts/cpu-lab-tweaks.mjs; WHY the knob wants to be here is not something
    // the bench can write, and belongs in the commit that follows.
    note: "starterDiscount 0.8 — crowned by the bench on starter-discount-soft",
    knobs: Object.freeze({
      perturbation: 0.25,
      hitterWeights: null,
      pitcherWeights: null,
      starterDiscount: 0.8,
      starterNarrowSpread: 0.04,
      starterWideSpread: 0.05,
      relieverSpacingShare: 0.3,
      relieverTopRate: 2.5,
      relieverDepthRate: 0.7,
      penDepthTarget: 5,
      relieverFloorByRoom: 0,
      slotTiebreak: 0.05,
      urgencyPatient: 0.5,
      urgencyDesperate: 1,
      urgencyWeight: 1,
      depthSlots: 3,
      depthDamp: 0.7,
      shareExponent: 1.1,
      poolPremiumStrength: 0.7,
      poolPremiumThreshold: 0.5,
      aggressionFloor: 0.86,
      aggressionSpan: 0.28,
      wobbleSalt: "",
      paceFloor: 0.75,
      paceCeiling: 1.8,
      roundsFloor: 0.7,
      roundsCeiling: 2.2,
      roundsBudgetDivisor: 25,
      snakeNeedBonus: 80,
      snakeNeedSpan: 0,
      snakeBalanceBonus: 70,
      snakeArmLean: 140,
      snakeForcedNeed: 1000,
      snakeScarcityRate: 0.8,
      snakeScarcityCap: 120
    })
  }),
  "tuned-2026-11-11": Object.freeze({
    // Where this sits in the lineage. EXPLICIT, because `at` is a date and four
    // generations were crowned on 2026-11-13 — nothing derivable orders them.
    seq: 2,
    at: "2026-11-11",
    git: "ef55c02",
    fingerprint: "a99689d3874c",
    // SHIPPED 2026-11-11, REVERTED 2026-11-12. Kept because it happened and
    // because the next person to think 0.6 looks good should find the answer
    // here rather than measuring it again: it is worth +1.48 +-0.25 against a
    // table that does not have it and -0.04 +-0.16 against a table that does.
    // The live defaults no longer match this generation; tuned-2026-11-10 is
    // what ships, and the two differ only in this knob.
    reverted: "2026-11-12 — pure denial: +1.48 mixed, -0.04 identical",
    note: "the top-of-deck lift widened to the 60th percentile — shipped for a day, then reverted",
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
      relieverFloorByRoom: 0,
      slotTiebreak: 0.05,
      urgencyPatient: 0.5,
      urgencyDesperate: 1,
      urgencyWeight: 1,
      depthSlots: 3,
      depthDamp: 0.7,
      shareExponent: 1.1,
      poolPremiumStrength: 0.7,
      poolPremiumThreshold: 0.6,
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
  "tuned-2026-11-13d": Object.freeze({
    // Where this sits in the lineage. EXPLICIT, because `at` is a date and four
    // generations were crowned on 2026-11-13 — nothing derivable orders them.
    seq: 6,
    at: "2026-11-13",
    git: "dca76ff",
    fingerprint: "eadc1fe008f3",
    // THE FOURTH SHIP OF THE DAY, and the first won by a BRACKET rather than by
    // a proposal: accepting snakeBalanceBonus=60 queued 50 and 70 automatically,
    // 70 won and 50 lost, so the knob went past the parity value it had just
    // been crowned at. That is the bracket doing its job — 60 was the first
    // number anybody tried, and it was not the best one.
    //
    // Still no head to head on any of the four positions. See tuned-2026-11-13.
    note: "three positions, with the staff bonus past parity at 70",
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
      relieverFloorByRoom: 0,
      slotTiebreak: 0.05,
      urgencyPatient: 0.5,
      urgencyDesperate: 1,
      urgencyWeight: 1,
      depthSlots: 3,
      depthDamp: 0.7,
      shareExponent: 1.1,
      poolPremiumStrength: 0.7,
      poolPremiumThreshold: 0.5,
      aggressionFloor: 0.86,
      wobbleSalt: "",
      aggressionSpan: 0.28,
      paceFloor: 0.75,
      paceCeiling: 1.8,
      roundsFloor: 0.7,
      roundsCeiling: 2.2,
      roundsBudgetDivisor: 25,
      snakeNeedBonus: 80,
      snakeNeedSpan: 0,
      snakeBalanceBonus: 70,
      snakeArmLean: 140,
      snakeForcedNeed: 1000,
      snakeScarcityRate: 0.8,
      snakeScarcityCap: 120
    })
  }),
  "tuned-2026-11-13c": Object.freeze({
    // Where this sits in the lineage. EXPLICIT, because `at` is a date and four
    // generations were crowned on 2026-11-13 — nothing derivable orders them.
    seq: 5,
    at: "2026-11-13",
    git: "9e9782b",
    fingerprint: "cef65dcfdc89",
    // THE THIRD SHIP OF THE DAY and three positions deep. Each was accepted
    // against the generation before it — the threshold against
    // tuned-2026-11-10, the need span against tuned-2026-11-13, the balance
    // bonus against tuned-2026-11-13b — so the stack is measured at every step
    // and no two of them rest on trust about each other.
    //
    // The same gap as its two predecessors: no holdout seeds and NO HEAD TO
    // HEAD at any of these values. Every position here was won on within-room
    // adoption curves, which is the reading that pays for denial. If the stack
    // turns out not to beat a table without it, tuned-2026-11-10 is the revert
    // for all three at once.
    note: "three positions: the 50th-percentile lift, no snake need span, and the staff bonus at parity — superseded the same day by tuned-2026-11-13d",
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
      relieverFloorByRoom: 0,
      slotTiebreak: 0.05,
      urgencyPatient: 0.5,
      urgencyDesperate: 1,
      urgencyWeight: 1,
      depthSlots: 3,
      depthDamp: 0.7,
      shareExponent: 1.1,
      poolPremiumStrength: 0.7,
      poolPremiumThreshold: 0.5,
      aggressionFloor: 0.86,
      wobbleSalt: "",
      aggressionSpan: 0.28,
      paceFloor: 0.75,
      paceCeiling: 1.8,
      roundsFloor: 0.7,
      roundsCeiling: 2.2,
      roundsBudgetDivisor: 25,
      snakeNeedBonus: 80,
      snakeNeedSpan: 0,
      snakeBalanceBonus: 60,
      snakeArmLean: 140,
      snakeForcedNeed: 1000,
      snakeScarcityRate: 0.8,
      snakeScarcityCap: 120
    })
  }),
  "tuned-2026-11-13b": Object.freeze({
    // Where this sits in the lineage. EXPLICIT, because `at` is a date and four
    // generations were crowned on 2026-11-13 — nothing derivable orders them.
    seq: 4,
    at: "2026-11-13",
    git: "b142255",
    fingerprint: "461e01104bef",
    // THE SECOND SHIP OF THE DAY, and the throne as it stands: the top-of-deck
    // lift at the 50th percentile AND the snake need span switched off. Both
    // went in the moment the stopping rule accepted them, under Skylar's
    // 2026-11-13 standard, and the record was re-based each time.
    //
    // need-span-flat was accepted AGAINST tuned-2026-11-13 — that is, on top of
    // the 0.5 threshold rather than instead of it — so this generation is the
    // two of them together and neither reading has to be taken on trust about
    // the other. Its head to head is NOT measured; see tuned-2026-11-13.
    note: "the 50th-percentile top-of-deck lift, plus the snake need span switched off — superseded the same day by tuned-2026-11-13c",
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
      relieverFloorByRoom: 0,
      slotTiebreak: 0.05,
      urgencyPatient: 0.5,
      urgencyDesperate: 1,
      urgencyWeight: 1,
      depthSlots: 3,
      depthDamp: 0.7,
      shareExponent: 1.1,
      poolPremiumStrength: 0.7,
      poolPremiumThreshold: 0.5,
      aggressionFloor: 0.86,
      wobbleSalt: "",
      aggressionSpan: 0.28,
      paceFloor: 0.75,
      paceCeiling: 1.8,
      roundsFloor: 0.7,
      roundsCeiling: 2.2,
      roundsBudgetDivisor: 25,
      snakeNeedBonus: 80,
      snakeNeedSpan: 0,
      snakeBalanceBonus: 35,
      snakeArmLean: 140,
      snakeForcedNeed: 1000,
      snakeScarcityRate: 0.8,
      snakeScarcityCap: 120
    })
  }),
  "tuned-2026-11-13": Object.freeze({
    // Where this sits in the lineage. EXPLICIT, because `at` is a date and four
    // generations were crowned on 2026-11-13 — nothing derivable orders them.
    seq: 3,
    at: "2026-11-13",
    git: "dc58920",
    fingerprint: "f68e04c38f3d",
    // WHAT SHIPS TODAY. The only knob that moved since tuned-2026-11-10 is the
    // top-of-deck threshold, now 0.5 — accepted by the stopping rule on the
    // rebuilt seat-paired bench at +0.73 +-0.54 over 48 readings. It ships
    // WITHOUT the head-to-head gate, which is the one check that caught the
    // same knob at 0.6; if a table of 0.5 bidders turns out not to beat a table
    // without, this is the generation to revert to tuned-2026-11-10.
    note: "the top-of-deck lift widened to the 50th percentile — superseded the same day by tuned-2026-11-13b",
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
      relieverFloorByRoom: 0,
      slotTiebreak: 0.05,
      urgencyPatient: 0.5,
      urgencyDesperate: 1,
      urgencyWeight: 1,
      depthSlots: 3,
      depthDamp: 0.7,
      shareExponent: 1.1,
      poolPremiumStrength: 0.7,
      poolPremiumThreshold: 0.5,
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
  "tuned-2026-11-10": Object.freeze({
    // Where this sits in the lineage. EXPLICIT, because `at` is a date and four
    // generations were crowned on 2026-11-13 — nothing derivable orders them.
    seq: 1,
    at: "2026-11-10",
    git: "acc9aae",
    fingerprint: "c4661e913763",
    note: "the bidder as tuned by three years of paired studies — the shipped values the day the lab was built; what tuned-2026-11-13 reverts to",
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

// WHICH BIDDER THE CONTROL CHAIRS ARE. Every lab measurement seats the control
// half on the live defaults, so "versus defaults" names a DIFFERENT bidder after
// any knob ships — and pooling a reading taken against the old one with a
// reading taken against the new one silently averages two experiments. This is
// not hypothetical: poolPremiumThreshold shipped on 2026-11-11 and every row
// banked before it compared candidates against a 0.8 bidder.
//
// A digest of the defaults is the right key for that, where the git hash is
// not: the hash moves on every commit, including the hundreds that do not touch
// a knob, and would shatter the record into useless slivers. This moves exactly
// when the bidder's shipped opinions move.
export function baselineKey() {
  const body = Object.keys(CPU_TUNABLE_DEFAULTS).sort()
    .map((knob) => `${knob}=${JSON.stringify(CPU_TUNABLE_DEFAULTS[knob])}`).join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const digest = hash.toString(16).padStart(8, "0");
  // Name it after the generation that matches, when one does — a row saying
  // `tuned-2026-11-11` is readable in a way `3f2a9c01` is not. The test in
  // test/cpu-tunables.test.js guarantees some generation always matches.
  const named = Object.entries(CPU_KNOB_GENERATIONS).find(([, generation]) =>
    Object.keys(CPU_TUNABLE_DEFAULTS).every((knob) =>
      JSON.stringify(generation.knobs[knob]) === JSON.stringify(CPU_TUNABLE_DEFAULTS[knob])));
  return named ? named[0] : digest;
}

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
