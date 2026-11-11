// THE QUEUE. Every candidate the lab is to put through the wringer.
//
// A tweak is a name, a note saying what it claims, and a set of knobs out of
// src/rules/cpuTunables.js. The lab seats half a table on it and the other half
// on the shipped bidder, in the same auction, across a grid of board sizes, and
// writes down what happened. Add entries freely — a run skips any (tweak, cell)
// pair it has already measured, so queueing ten more and re-running only costs
// the ten.
//
// Knobs that do not exist throw. That is deliberate: a misspelled knob reads as
// a perfect null, and a null is a believable result.
//
// TWO ENTRIES ARE FIXTURES, NOT CANDIDATES, and both earn their keep:
//
//   null    changes nothing. Both sides of the table are the shipped bidder, so
//           the rooms are bit-identical and the MIXED column must print 0.00
//           exactly — anything else is state leaking between rooms (the
//           valuation cache, usually), not a result. Its IDENTICAL column is
//           not zero and is not meant to be: there each roster plays a copy of
//           itself, so what it prints is the SIMULATOR's own noise at the games
//           count you chose, and no number in that column from any candidate
//           means anything until it clears it.
//
//   jiggle  moves every bid by a hundredth of a percent, which cannot make a
//           roster better but does reshuffle who wins a close lot. It is the
//           PLACEBO: whatever it reads is what this harness scores a change
//           worth nothing, and no real candidate should be believed inside it.
//
// Keep both at the top of every run. The lab does it for you unless told not
// to.

import { knobKey, readIdeas } from "./cpu-lab-ideas.mjs";

const QUEUED = [
  {
    id: "null",
    note: "the shipped bidder on both sides — must read exactly 0.00",
    fixture: true,
    params: {}
  },
  {
    id: "jiggle",
    note: "placebo: every bid moved 0.01%, reshuffles close lots and nothing else",
    fixture: true,
    params: { aggressionFloor: 0.8601 }
  },
  {
    id: "no-starter-discount",
    note: "positive control: pay full price for a narrow board's starters, which a "
      + "paired study says costs +1.5 to +6.4 win points — so this must read clearly NEGATIVE",
    fixture: true,
    params: { starterDiscount: 1 }
  },

  // ---- candidates ---------------------------------------------------------
  // Each of these restates a number that was calibrated under an older bidder,
  // on a narrower grid, or against a harness that could not see denial. They
  // are starting questions, not beliefs.
  {
    id: "share-flat",
    note: "split the bankroll by worth exactly, with no tilt toward the studs",
    params: { shareExponent: 1 }
  },
  {
    id: "share-steep",
    note: "concentrate harder on the best men left",
    params: { shareExponent: 1.3 }
  },
  {
    id: "starter-discount-soft",
    note: "pay 0.8x for a narrow board's starters instead of 0.65x",
    params: { starterDiscount: 0.8 }
  },
  {
    id: "starter-discount-hard",
    note: "pay 0.5x — free even more money for bats and arms out of the pen",
    params: { starterDiscount: 0.5 }
  },
  {
    id: "closer-cooler",
    note: "the best reliever at 2.0x a starter's point rather than 2.5x",
    params: { relieverTopRate: 2 }
  },
  {
    id: "pen-depth-dearer",
    note: "the arms behind the closer at 1.0x instead of 0.7x",
    params: { relieverDepthRate: 1 }
  },
  {
    id: "urgency-earlier",
    note: "start reaching for a hole at a third of the men left, not half",
    params: { urgencyPatient: 0.33 }
  },
  {
    id: "urgency-harder",
    note: "a desperate manager pays 2.5x a card's worth, not 2x",
    params: { urgencyWeight: 1.5 }
  },
  {
    id: "stud-premium-up",
    note: "reach further for the top decile of the whole deck",
    params: { poolPremiumStrength: 1 }
  },
  {
    id: "bench-cheaper",
    note: "bid a bench card at half its worth instead of 0.7",
    params: { depthDamp: 0.5 }
  },
  {
    id: "pace-looser",
    note: "let a flush manager carry a bigger share into one lot",
    params: { roundsCeiling: 3 }
  },
  {
    id: "snake-scarcity-up",
    note: "snake only: let a position cliff move a pick twice as far",
    params: { snakeScarcityCap: 240 }
  },

  // ---- second wave, 2026-11-11 --------------------------------------------
  // The first wave restated numbers that had already been studied once. These
  // are the knobs NOTHING has ever measured — each one is a magic number that
  // was picked to make some other study work and has sat there since — plus one
  // bracket on the only candidate so far that looks alive.
  {
    id: "share-flatter",
    note: "past flat: spread the bankroll AGAINST the studs, the direction share-flat points",
    params: { shareExponent: 0.9 }
  },
  {
    id: "starter-band-gentle",
    note: "the starter discount fades out over 0.02-0.08 of board spread instead of 0.04-0.05 — "
      + "every real card set lands in 0.019-0.045, so today's band is a cliff, not a fade",
    params: { starterNarrowSpread: 0.02, starterWideSpread: 0.08 }
  },
  {
    id: "pen-depth-shallow",
    note: "plan on three relievers where the pen is uncapped, not five",
    params: { penDepthTarget: 3 }
  },
  {
    id: "depth-spread-wide",
    note: "a full roster spreads its leftover money over five slots instead of three",
    params: { depthSlots: 5 }
  },
  {
    id: "slot-tiebreak-up",
    // Withdrawn once: `check` found it inert in all eleven cells of the old
    // grid. The branch fires only on a snake pick that upgrades NOTHING, and no
    // pick in a 15-man snake room ever does. s4-long (20 picks) was added to
    // reach it — if this still reads inert there, the branch is dead code.
    note: "a card who upgrades nothing is still worth 15% of his raw value, not 5% — "
      + "only reachable late in a long snake draft",
    params: { slotTiebreak: 0.15 }
  },
  {
    id: "stud-premium-broader",
    note: "the top-of-deck lift starts at the 60th percentile rather than the 80th, "
      + "at the same strength where it peaks",
    params: { poolPremiumThreshold: 0.6 }
  },
  {
    id: "rounds-divisor-tight",
    note: "judge a round's spending against a smaller slice of the bankroll, so the "
      + "spend-down reacts sooner",
    params: { roundsBudgetDivisor: 18 }
  },
  {
    id: "wobble-off",
    note: "no seeded per-card bid wobble at all — bid the number, every time. Both knobs "
      + "move together so the average bid is unchanged and only its variance goes",
    params: { aggressionFloor: 1, aggressionSpan: 0 }
  },
  {
    id: "snake-scarcity-sharper",
    note: "snake only: a position cliff moves a pick by the WHOLE drop to the next man, not 0.8 of it",
    params: { snakeScarcityRate: 1 }
  }
];

// ---- the ideas inbox --------------------------------------------------------
// Everything above was written here by hand. scripts/cpu-lab-ideas.jsonl is the
// other way in: an append-only file any agent can add a proposal to, read at
// import so an idea is a candidate from the next command onward with no step in
// between. A line that cannot be used never throws — it comes back as a reject,
// because the online server imports this module and an inbox any agent can
// write to must not be able to take the site down.
const taken = new Map();
for (const tweak of QUEUED) {
  taken.set(`id:${tweak.id}`, tweak.fixture ? "a fixture" : "a queued candidate");
  if (Object.keys(tweak.params).length) taken.set(`knobs:${knobKey(tweak.params)}`, tweak.id);
}
const inbox = readIdeas(taken);

export const TWEAKS = [...QUEUED, ...inbox.ideas];

// Proposals that could not be used, with the reason. Printed by `cpu-lab.mjs
// list` and served to the page: an agent's typo has to be visible somewhere or
// it is simply lost.
export const IDEA_REJECTS = inbox.rejected;

export function tweakById(id) {
  const found = TWEAKS.find((tweak) => tweak.id === id);
  if (!found) throw new Error(`cpu-lab: no tweak "${id}". Known: ${TWEAKS.map((t) => t.id).join(", ")}`);
  return found;
}
