import assert from "node:assert/strict";
import test from "node:test";
import {
  CPU_KNOB_GENERATIONS,
  CPU_TUNABLES,
  CPU_TUNABLE_DEFAULTS,
  CPU_TUNABLE_NOTES,
  cpuTunables,
  knobGeneration,
  tunablesFor
} from "../src/rules/cpuTunables.js";
import {
  autopick,
  completeAuctionReview,
  createDraft,
  cpuSealedBid,
  managerValuation,
  nominateBestTarget,
  repairDraftRosters,
  sealedBidder
} from "../src/rules/draft.js";
import { buildDraftPool } from "../src/data/universes.js";

// A knob that does not exist must throw rather than be ignored: a misspelled
// tweak otherwise measures as a perfect null, and a null is a believable
// result.
test("an unknown knob is rejected", () => {
  assert.throws(() => cpuTunables({ shareExponnet: 1.3 }), /no such knob/);
  assert.throws(() => cpuTunables({ relieverTopRate: 2, nope: 1 }), /nope/);
});

test("a manager with no tweak reads the shipped knobs, with no copy made", () => {
  assert.equal(tunablesFor({}), CPU_TUNABLES);
  assert.equal(tunablesFor({ tunables: null }), CPU_TUNABLES);
  assert.equal(tunablesFor(undefined), CPU_TUNABLES);
  // A tweak that restates a shipped value is not a tweak.
  assert.equal(cpuTunables({ shareExponent: CPU_TUNABLE_DEFAULTS.shareExponent }), CPU_TUNABLES);
  assert.equal(CPU_TUNABLES.key, "");
});

// THE REVERT GUARANTEE. Whatever the defaults are, some frozen generation holds
// exactly those numbers, so there is always a named thing to measure a change
// against and always a named thing to go back to. Change a shipped knob and this
// fails until you record the new generation beside the old one — which is the
// point: the old numbers must not be edited away, they are the revert path.
test("the live defaults are frozen as a generation", () => {
  const live = Object.fromEntries(Object.keys(CPU_TUNABLE_DEFAULTS)
    .map((knob) => [knob, CPU_TUNABLE_DEFAULTS[knob]]));
  const matches = Object.entries(CPU_KNOB_GENERATIONS)
    .filter(([, generation]) => Object.keys(live)
      .every((knob) => JSON.stringify(generation.knobs[knob]) === JSON.stringify(live[knob])));
  assert.ok(matches.length,
    "no generation in CPU_KNOB_GENERATIONS matches the live defaults — add one (keep the old entries)");
  // Every generation must be a knob set the bidder will accept.
  for (const name of Object.keys(CPU_KNOB_GENERATIONS)) {
    assert.doesNotThrow(() => cpuTunables(knobGeneration(name).knobs), `generation ${name}`);
  }
  assert.throws(() => knobGeneration("nope"), /no generation/);
});

// cpu-lab.html prints these beside the shipped value and the tweaked one, so a
// reader watching a run never has to come back to the source to find out what a
// knob is. A missing one leaves a bare number on the page — which is a reason to
// fail a test, not a reason to throw on import and take the site with it.
test("every knob says in one line what it does", () => {
  for (const knob of Object.keys(CPU_TUNABLE_DEFAULTS)) {
    const note = CPU_TUNABLE_NOTES[knob];
    assert.ok(note && note.length > 12, `${knob} has no usable note in CPU_TUNABLE_NOTES`);
    // Several of these were written as a pair and read as nonsense alone.
    assert.ok(!/^(and |the same,)/i.test(note), `${knob}'s note only makes sense after another one: "${note}"`);
  }
  for (const knob of Object.keys(CPU_TUNABLE_NOTES)) {
    assert.ok(knob in CPU_TUNABLE_DEFAULTS, `CPU_TUNABLE_NOTES has a note for ${knob}, which is not a knob`);
  }
});

test("a tweak fills in every other knob and names itself", () => {
  const tune = cpuTunables({ relieverTopRate: 2 });
  assert.equal(tune.relieverTopRate, 2);
  assert.equal(tune.relieverDepthRate, CPU_TUNABLE_DEFAULTS.relieverDepthRate);
  assert.equal(tune.key, "relieverTopRate=2");
  // The key is order-free, so two spellings of one tweak share a valuation model.
  assert.equal(cpuTunables({ shareExponent: 1.3, depthDamp: 0.5 }).key,
    cpuTunables({ depthDamp: 0.5, shareExponent: 1.3 }).key);
});

test("a manager's tweak is normalized once and cached back onto him", () => {
  const manager = { tunables: { depthSlots: 4 } };
  const first = tunablesFor(manager);
  assert.equal(first.depthSlots, 4);
  assert.equal(tunablesFor(manager), first);
  assert.equal(manager.tunables, first);
});

// The knobs have to key the valuation-model cache. Two rooms off one seed is
// the lab's standing comparison, and they share that module-level cache: without
// the key the second room would read the first one's opinions and the whole
// measurement would be of nothing.
test("two managers who weigh cards differently get different models", () => {
  const pool = buildDraftPool("classic", "tunable-models", {
    nomination: "random", managerCount: 2, startingPitchers: 4
  });
  const draft = createDraft(
    [{ name: "A", cpu: true }, { name: "B", cpu: true }], pool, 15, "tunable-models",
    { draftType: "auction", nomination: "random", startingPitchers: 4, budget: 1500, timer: false }
  );
  for (const manager of draft.managers) manager.persona = "balanced";
  const shipped = managerValuation(draft, draft.managers[0]);
  draft.managers[0].tunables = { hitterWeights: { onBase: 40 } };
  const tweaked = managerValuation(draft, draft.managers[0]);
  assert.notEqual(shipped, tweaked);
  assert.ok(tweaked.weights.hitter.onBase > shipped.weights.hitter.onBase * 1.5);
  // Perturbation off makes two seats of one archetype think identically.
  draft.managers[0].tunables = { perturbation: 0 };
  draft.managers[1].tunables = { perturbation: 0 };
  const flatA = managerValuation(draft, draft.managers[0]);
  const flatB = managerValuation(draft, draft.managers[1]);
  assert.deepEqual(flatA.weights, flatB.weights);
});

function auctionRoom(seed, options = {}) {
  const pen = { bullpenSlots: "all", bullpenMin: 2 };
  const pool = buildDraftPool("classic", seed, {
    nomination: "random", managerCount: 4, startingPitchers: 4, ...pen
  });
  const draft = createDraft(
    Array.from({ length: 4 }, (unused, seat) => ({ name: `T${seat}`, cpu: true })),
    pool, 15, seed,
    { draftType: "auction", nomination: "random", startingPitchers: 4, budget: 1500, timer: false, ...pen }
  );
  draft.managers.forEach((manager, seat) => {
    manager.persona = "balanced";
    if (options.tunables) manager.tunables = options.tunables(seat);
  });
  completeAuctionReview?.(draft, 0);
  return draft;
}

// The seam the lab measures through: ONE room, two opinions, and the bid that
// comes out has to depend on which chair it came from.
test("half a table can bid on different knobs in the same room", () => {
  const bidsWith = (tunables) => {
    const draft = auctionRoom("tunable-bids", { tunables });
    nominateBestTarget(draft, 0);
    return draft.managers.map((manager) => cpuSealedBid(draft, manager));
  };
  const shipped = bidsWith(null);
  // Seats 0 and 2 concentrate their bankroll harder; seats 1 and 3 are
  // untouched and must bid what they bid before, to the dollar.
  const mixed = bidsWith((seat) => (seat % 2 === 0 ? { shareExponent: 2.4 } : null));
  assert.ok(mixed.every((bid) => Number.isFinite(bid) && bid >= 0));
  assert.notEqual(mixed[0], shipped[0]);
  assert.notEqual(mixed[2], shipped[2]);
  assert.equal(mixed[1], shipped[1]);
  assert.equal(mixed[3], shipped[3]);
});

test("a room with no tweaks drafts the same way twice", () => {
  const run = () => {
    const draft = auctionRoom("tunable-replay");
    let guard = 20000;
    while (!draft.complete && guard-- > 0) autopick(draft, 0);
    repairDraftRosters(draft);
    return draft.managers.map((manager) => manager.roster.map((card) => card.id).join(" "));
  };
  assert.deepEqual(run(), run());
});

test("a knob that is turned reaches the draft it is turned in", () => {
  const rosters = (tunables) => {
    const draft = auctionRoom("tunable-reach", { tunables: () => tunables });
    let guard = 20000;
    while (!draft.complete && guard-- > 0) autopick(draft, 0);
    repairDraftRosters(draft);
    return draft.managers.map((manager) => manager.roster.map((card) => card.id).join(" ")).join("|");
  };
  const shipped = rosters(null);
  // Paying 30% more for every reliever buys a different room.
  assert.notEqual(rosters({ relieverTopRate: 3.25 }), shipped);
  // And so does weighing on-base twice as heavily.
  assert.notEqual(rosters({ hitterWeights: { onBase: 40 } }), shipped);
});

test("the bidder still answers when every knob is pushed to an edge", () => {
  const extreme = {
    shareExponent: 3,
    depthDamp: 0,
    depthSlots: 1,
    urgencyPatient: 0,
    urgencyDesperate: 0.01,
    urgencyWeight: 5,
    relieverTopRate: 0,
    relieverDepthRate: 0,
    penDepthTarget: 1,
    poolPremiumStrength: 0,
    poolPremiumThreshold: 0,
    starterDiscount: 0.01,
    aggressionSpan: 0,
    roundsCeiling: 1,
    roundsFloor: 1,
    perturbation: 0
  };
  const draft = auctionRoom("tunable-extreme", { tunables: () => extreme });
  let guard = 20000;
  while (!draft.complete && guard-- > 0) autopick(draft, 0);
  assert.equal(draft.complete, true);
  repairDraftRosters(draft);
  for (const manager of draft.managers) {
    assert.ok(manager.roster.length >= 15, `${manager.name} drafted ${manager.roster.length}`);
    const spent = (draft.auction.history ?? [])
      .filter((lot) => lot.managerId === manager.id)
      .reduce((sum, lot) => sum + lot.price, 0);
    assert.ok(spent <= draft.auction.budget, `${manager.name} spent ${spent} of ${draft.auction.budget}`);
  }
  assert.equal(sealedBidder(draft), null);
});
