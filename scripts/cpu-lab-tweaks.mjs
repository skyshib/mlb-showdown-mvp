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
//   jiggle  re-draws the per-card bid wobble from the SAME distribution off a
//           different seed. The bidder is unchanged in every respect a study
//           could care about — same floor, same width, same mean bid — and all
//           that moves is which close lots he happens to win. It is the
//           PLACEBO: whatever it reads is what this harness scores a change
//           worth nothing, and no real candidate should be believed inside it.
//
//           It was `aggressionFloor: 0.8601` until 2026-11-11, a hundredth of a
//           percent on every bid, and `check` showed why that was useless: it
//           moved 0 of 8 rosters at a4-classic and 0 of 8 on the snake, so on
//           most of the grid the placebo was simply a second null and printed
//           the null's numbers to two decimals. A placebo that does not fire
//           tells you nothing about what noise looks like.
//
//           THE SNAKE STILL HAS NO PLACEBO. Its chooser takes the highest score
//           with no random term anywhere, so there is no neutral perturbation to
//           make — nothing to re-seed. On snake cells the fixtures are `null`
//           and the positive control, and that is the honest set.
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
    note: "placebo: the same bid wobble re-drawn off a different seed — an identical "
      + "bidder in a different auction, so whatever this reads is the harness's own noise",
    fixture: true,
    params: { wobbleSalt: "placebo" }
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
    // ANSWERED 2026-11-11, four batches a dose, and the answer is denial. The
    // adoption curve decays monotonically on every wide board and ends at
    // nothing: a8 +2.80 -> -0.04 over seven doses, a6 +1.60 -> -0.09, and on
    // the narrow boards it is flat or negative throughout (a4-first -1.84,
    // a3 -0.94 at the lone adopter). Pooled over the screen cells at the far
    // dose it reads -0.08 +-0.15. A flat split wins lots cheaply while rivals
    // are still tilting toward the studs and wins nothing once they are not,
    // which is the one shape this bench exists to refuse (league-duels-
    // measure-denial). Do not deepen it again; the +2.72 that made it look
    // alive was the k=1 column, the noisiest in the table.
    settled: "denial only — the gain decays to zero as rivals adopt it",
    params: { shareExponent: 1 }
  },
  {
    id: "share-steep",
    note: "concentrate harder on the best men left",
    // ANSWERED 2026-11-11, and it is the clearest non-control result the bench
    // has: -0.63 +-0.25 at the last holdout on a8, -0.79 +-0.44 on a6, -0.33
    // +-0.28 pooled over the screen cells. Concentrating harder on the studs
    // costs real win points at a table that all does it. Taken with share-flat
    // settling at zero, the shipped 1.1 is not a number anybody needs to keep
    // re-asking about: the curve is flat to its left and downhill to its right.
    settled: "REJECTED — costs win points once the table concentrates too",
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
    // SHIPPED 2026-11-11 — the first knob this bench moved. It is kept in the
    // queue, not deleted, because its params now RESTATE the shipped value and
    // so it measures nothing; that is deliberate. The record of what it bought
    // is the point, and `--versus tuned-2026-11-10` is how to re-read it.
    //
    // WHAT IT BOUGHT, and what it did not. Far dose, pooled over 11 auction
    // cells: +0.42 +-0.12 over 912 leagues, positive in ALL ELEVEN, and +0.40
    // +-0.35 on holdout seeds that had no hand in choosing it. Inert on the
    // snake, which the fingerprint confirms — the three snake cells did not
    // move a single pick when this shipped.
    //
    // BUT ITS CURVE DECAYS LIKE share-flat's: a8 +3.25 -> +0.26, a6 +3.27 ->
    // +0.20. About 90% of the headline is DENIAL that evaporates once rivals
    // have it too. The durable part is ~0.3-0.5 win points. Anybody quoting
    // the +3.25 is quoting what it gains against copies of the OLD bidder,
    // which is the right number only for a room holding exactly one computer
    // (about 3 in 8 of the rooms that have one at all) and even then is
    // measured against computers, never against humans.
    // REVERTED 2026-11-12, one day after shipping, by the absolute read that
    // should have been taken first. `bench --versus tuned-2026-11-10` says the
    // change is worth +1.48 +-0.25 MIXED and -0.04 +-0.16 IDENTICAL: it beats a
    // table that does not have it and gains nothing against a table that does.
    // Pure denial, which is what league-duels-measure-denial says must not ship.
    //
    // THE LESSON IS ABOUT THE FAR DOSE, NOT ABOUT THIS KNOB. It shipped on
    // +0.42 at the last holdout, on the reasoning that k=N-1 is where denial has
    // run out. It has not: at k=N-1 there is still ONE untweaked chair, so the
    // tweaked chairs still beat the room's par by taking from it. Every dose is
    // a within-room reading and every within-room reading pays for denial.
    // `identical` is the only one that does not, and no dose substitutes for it.
    settled: "REVERTED — +1.48 mixed but -0.04 identical; denial, and the far dose could not see it",
    params: { poolPremiumThreshold: 0.6 }
  },
  {
    id: "pool-premium-threshold-0-5",
    note: "the top-of-deck lift starts at the 50th percentile instead of the 80th",
    // SHIPPED 2026-11-13 (tuned-2026-11-13). Came in through the ideas inbox as
    // the bracket below the 0.6 that shipped and was reverted, and is the first
    // candidate accepted by the stopping rule on the REBUILT bench: +0.73 +-0.54
    // over 48 readings in 20 of 39 rooms and five table sizes, and the better of
    // the two values tried (0.7 reads +0.41).
    //
    // SHIPPED WITHOUT THE GATE, and that is on the record on purpose. The
    // pre-ship checklist reads 3 of 5: the holdout seeds and the head-to-head
    // were never run at this value, and the head-to-head is the exact check
    // that caught the SAME KNOB at 0.6 (+1.48 mixed, -0.04 identical, reverted
    // in a day). Skylar's 2026-11-13 standard is to implement an accepted
    // candidate at once and re-measure everything else against it, so this went
    // in and the two missing checks are being taken after the fact. If the
    // head-to-head comes back flat, revert to tuned-2026-11-10 — the generation
    // is there for exactly that.
    settled: "SHIPPED tuned-2026-11-13 — +0.73 +-0.54 accepted; holdout and head-to-head still outstanding",
    params: { poolPremiumThreshold: 0.5 }
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
