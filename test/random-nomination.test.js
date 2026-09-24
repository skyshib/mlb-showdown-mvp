import test from "node:test";
import assert from "node:assert/strict";

import { buildDraftPool, deckEntry, deckFromIds } from "../src/data/universes.js";
import {
  DEFAULT_ROOM_STARTING_PITCHERS,
  DEFAULT_STARTING_PITCHERS,
  ROSTER_SLOTS,
  applyDraftAction,
  auctionMaxBid,
  autopick,
  canNominatePlayer,
  cpuSealedBid,
  createDraft,
  auctionLotPlayer,
  guaranteedNominationMinimums,
  isRandomNomination,
  nominationQueueRemaining,
  nextQueuedPlayer,
  poolGroup,
  randomNominationCounts,
  randomNominationQuotas,
  randomNominationShortfalls,
  managerValuation,
  minimumSnakePicks,
  roomDraftOptions,
  rosterSizeForStartingPitchers,
  standingReplacements,
  submitCpuSealedBids,
  UNLIMITED_BULLPEN,
  undoLastPick,
  validateRoster
} from "../src/rules/draft.js";

const UNIVERSE = "classic";

function roomOf(managerCount, seed = "rn-seed") {
  const managers = Array.from({ length: managerCount }, (_, index) => ({
    name: `M${index + 1}`,
    cpu: true
  }));
  const pool = buildDraftPool(UNIVERSE, seed, { nomination: "random", managerCount });
  const draft = createDraft(managers, pool, 13, seed, {
    draftType: "auction",
    nomination: "random",
    budget: 5000,
    timer: false
  });
  return { draft, pool };
}

// The quotas describe the BIDDABLE board. A classic room also deals a standing
// replacement at every slot — one more card in each group that nobody can buy —
// so the counts that check the deal have to leave them out.
function biddable(cards) {
  return cards.filter((card) => !card.replacement);
}

function countGroup(cards, group) {
  return biddable(cards).filter((card) => poolGroup(card) === group).length;
}

function countHitters(cards) {
  return biddable(cards).filter((card) => card.kind === "hitter").length;
}

test("the roster slot table is the 13-man roster, spelled out", () => {
  const total = ROSTER_SLOTS.reduce((sum, [, slots]) => sum + slots, 0);
  assert.equal(total, 13);
});

// A new room opens at four starters, because the short roster is unfair to draft
// from: with two, the first seat in a snake draft beats the last by nearly eight
// win points, and the fourth starter cuts that to two. The ENGINE fallback stays
// at two, which is a different promise — every saved room, adventure pack and
// deck quota was sized against it, and a room that recorded no rotation must
// still rebuild the roster it had.
test("a new room opens at four starters, without moving the engine's fallback", () => {
  assert.equal(DEFAULT_ROOM_STARTING_PITCHERS, 4);
  assert.equal(DEFAULT_STARTING_PITCHERS, 2);

  const pen = { bullpenSlots: "all", bullpenMin: 2 };
  assert.equal(rosterSizeForStartingPitchers(DEFAULT_ROOM_STARTING_PITCHERS, pen), 15);
  assert.equal(minimumSnakePicks(DEFAULT_ROOM_STARTING_PITCHERS, pen), 15);
  assert.equal(rosterSizeForStartingPitchers(DEFAULT_STARTING_PITCHERS, pen), 13);
});

test("three managers see twelve starters and eight of them come up", () => {
  const { draft, pool } = roomOf(3);

  // The arms deal exactly to quota: nothing else draws on them.
  assert.equal(countGroup(pool, "SP"), 12);
  assert.equal(countGroup(pool, "RP"), 12);

  // The bats can run over it. The DH slot takes any hitter, so its cards are
  // catchers and shortstops and whoever else was left — a position ends up
  // with its own quota plus however many of those it happened to supply.
  assert.ok(countGroup(pool, "C") >= 6, `only ${countGroup(pool, "C")} catchers`);
  assert.ok(countGroup(pool, "LF/RF") >= 12, `only ${countGroup(pool, "LF/RF")} corners`);
  assert.equal(countHitters(pool), 6 * 9, "nine hitters a manager, six managers' worth of board");

  const queued = draft.auction.queue.map((id) => draft.pool.find((card) => card.id === id));
  assert.equal(countGroup(queued, "SP"), 8);
  assert.ok(countGroup(queued, "C") >= 4);
  assert.ok(countGroup(queued, "LF/RF") >= 8);
  assert.equal(draft.auction.queue.length, 13 * 4);
  assert.equal(new Set(draft.auction.queue).size, draft.auction.queue.length, "a card queues once");
});

test("random nomination scales its starter board to the configured rotation", () => {
  const managerCount = 3;
  const startingPitchers = 4;
  const seed = "rn-four-starters";
  const managers = Array.from({ length: managerCount }, (_, index) => ({ name: `M${index + 1}`, cpu: true }));
  const pool = buildDraftPool(UNIVERSE, seed, { nomination: "random", managerCount, startingPitchers });
  const draft = createDraft(managers, pool, 15, seed, {
    draftType: "auction",
    nomination: "random",
    startingPitchers,
    budget: 5000,
    timer: false
  });

  assert.equal(countGroup(pool, "SP"), 24);
  const queued = draft.auction.queue.map((id) => draft.pool.find((card) => card.id === id));
  assert.equal(countGroup(queued, "SP"), 16);
  assert.deepEqual(randomNominationShortfalls(pool, managerCount, startingPitchers), []);
});

test("the visible board always outlasts a hoarder", () => {
  // One manager wins every card that comes up at a position; the leftovers on
  // the board must still finish the other n - 1 rosters, or the sweep is a lie.
  for (let managers = 2; managers <= 8; managers += 1) {
    const { hiddenPerSlot, visiblePerSlot } = randomNominationCounts(managers);
    assert.ok(
      visiblePerSlot - hiddenPerSlot >= managers - 1,
      `n=${managers}: ${visiblePerSlot} visible - ${hiddenPerSlot} hidden cannot cover ${managers - 1} others`
    );
    assert.ok(hiddenPerSlot >= Math.floor(managers * 1.4), `n=${managers}: hidden pool below the floor(1.4n) minimum`);
  }
});

test("the dealt board can supply every slot, in every card set", () => {
  // Not "enough cards printed at DH" — any bat DHs, and the dead-ball sets
  // print nobody there at all. What must hold is that the board can be dealt
  // out: give each slot its cards in turn, and nobody comes up short.
  for (const universe of ["classic", "fictional", "mlb-history", "decade-1910", "franchise-SEA"]) {
    for (const managerCount of [2, 3, 5, 8]) {
      const pool = buildDraftPool(universe, "rn-seed", { nomination: "random", managerCount });
      const shortfalls = randomNominationShortfalls(pool, managerCount);
      assert.deepEqual(
        shortfalls,
        [],
        `${universe} @ ${managerCount}: ${shortfalls.map((s) => `${s.group} ${s.dealt}/${s.quota}`).join(", ")}`
      );
    }
  }
});

test("a set with no designated hitters still deals a board", () => {
  // The 1910s never had the rule, and the fictional league prints nobody at
  // DH either. Neither is "too thin" — the ninth bat is just another bat.
  for (const universe of ["fictional", "decade-1910"]) {
    const pool = buildDraftPool(universe, "rn-seed", { nomination: "random", managerCount: 3 });
    assert.equal(pool.filter((card) => card.position === "DH").length, 0, `${universe} prints a DH?`);
    assert.deepEqual(randomNominationShortfalls(pool, 3), [], `${universe} refused a 3-manager board`);
  }
});

test("the queue nominates — no manager may", () => {
  const { draft } = roomOf(3);
  assert.ok(isRandomNomination(draft));
  const target = draft.pool.find((card) => !draft.auction.queue.includes(card.id));
  const verdict = canNominatePlayer(draft, draft.managers[0], target);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /queue nominates/);
});

test("the same seed deals the same queue", () => {
  const a = roomOf(4, "same-seed");
  const b = roomOf(4, "same-seed");
  assert.deepEqual(a.draft.auction.queue, b.draft.auction.queue);

  const c = roomOf(4, "other-seed");
  assert.notDeepEqual(a.draft.auction.queue, c.draft.auction.queue);
});

test("a manager may spend their whole budget on one card", () => {
  const { draft } = roomOf(3);
  // No reserve for open slots: the sweep fills a short roster for free.
  assert.equal(auctionMaxBid(draft, draft.managers[0]), 5000);
});

test("position countdowns show only the guaranteed nominations still to come", () => {
  const { draft } = roomOf(3, "minimum-countdown");
  const minimums = () => Object.fromEntries(
    guaranteedNominationMinimums(draft).map(({ position, minimum }) => [position, minimum])
  );

  assert.deepEqual(minimums(), {
    C: 4,
    "1B": 4,
    "2B": 4,
    "3B": 4,
    SS: 4,
    "LF/RF": 8,
    CF: 4,
    SP: 8,
    RP: 8
  });

  const thirdBasemen = draft.auction.queue
    .map((id) => draft.pool.find((card) => card.id === id))
    .filter((card) => poolGroup(card) === "3B");
  assert.ok(thirdBasemen.length >= 4);
  draft.auction.history = thirdBasemen.slice(0, 3).map((card) => ({
    playerId: card.id,
    managerId: null,
    price: 0,
    passed: true
  }));
  assert.equal(minimums()["3B"], 1, "three called third basemen leave a public floor of one");

  // The card currently on the block has already been called.
  draft.auction.lot = { playerId: thirdBasemen[3].id };
  assert.equal(minimums()["3B"], 0);

  // Future queue composition is hidden information and cannot affect the
  // public lower bound.
  const before = minimums();
  draft.auction.queue = draft.auction.queue.filter((id) => id !== thirdBasemen.at(-1).id);
  assert.deepEqual(minimums(), before);
});

test("guaranteed nomination countdowns apply only to random nomination", () => {
  const pool = buildDraftPool(UNIVERSE, "manual-minimums", { managerCount: 3 });
  const draft = createDraft(["A", "B", "C"], pool, 13, "manual-minimums", {
    draftType: "auction",
    timer: false
  });
  assert.deepEqual(guaranteedNominationMinimums(draft), []);
});

test("every manager finishes with a legal roster, however the bidding went", () => {
  for (const managerCount of [2, 3, 4, 6]) {
    const { draft } = roomOf(managerCount, `finish-${managerCount}`);
    let guard = 0;
    while (!draft.complete && guard < 5000) {
      guard += 1;
      autopick(draft);
    }

    assert.ok(draft.complete, `${managerCount} managers: draft never completed`);
    assert.equal(nominationQueueRemaining(draft), 0);
    assert.equal(nextQueuedPlayer(draft), null);

    for (const manager of draft.managers) {
      const issues = validateRoster(manager, { unlimitedRoster: true });
      assert.deepEqual(issues, [], `${managerCount} managers: ${manager.name} finished illegal — ${issues.join(", ")}`);
      assert.ok(manager.roster.length >= 13, `${manager.name} has only ${manager.roster.length} cards`);
    }

    // Every hole was filled from the standing replacements — copies of the ten
    // unbiddable 10-point cards the room dealt — and never from thin air.
    const standing = new Set(standingReplacements(draft).map((card) => card.id));
    const printed = draft.pool.filter((card) => card.replacement && card.sourceId);
    for (const card of printed) {
      assert.ok(standing.has(card.sourceId), `${card.name} is not a copy of a standing replacement`);
      assert.equal(card.points, 10, `${card.name} was handed out above the floor`);
    }
  }
});

// The room that started all this: one manager bids on every card that comes up
// and wins the lot of it, and the other n - 1 draft nothing at all. This is the
// case the board is sized for, and the board has to cover it at EVERY position
// — the queue must not quietly deepen one pile at the reserve's expense.
test("a manager who wins every single lot cannot exhaust the board", () => {
  for (const managerCount of [3, 4, 6]) {
    const { draft } = roomOf(managerCount, `hoard-${managerCount}`);
    const hog = draft.managers[0];
    let guard = 0;
    while (!draft.complete && guard < 5000) {
      guard += 1;
      applyDraftAction(draft, { type: "auto-nominate" });
      for (const manager of draft.managers) {
        applyDraftAction(draft, {
          type: "seal-bid",
          managerId: manager.id,
          amount: manager.id === hog.id ? 5 : 0
        });
      }
    }

    assert.ok(draft.complete, `${managerCount} managers: draft never completed`);
    assert.equal(hog.roster.length, draft.auction.queue.length, "the hoarder won every lot");

    for (const manager of draft.managers) {
      const issues = validateRoster(manager, { unlimitedRoster: true });
      assert.deepEqual(issues, [], `${managerCount} managers: ${manager.name} finished illegal — ${issues.join(", ")}`);
    }
    // The hoarder's rivals drafted nothing at all, so every slot they own is a
    // standing-replacement copy — which is exactly the promise: a hole always
    // costs the badged 10-point card, never more and never nothing.
    const standing = new Set(standingReplacements(draft).map((card) => card.id));
    for (const manager of draft.managers.slice(1)) {
      for (const card of manager.roster) {
        assert.ok(standing.has(card.sourceId), `${manager.name} holds ${card.name}, which the sweep did not print`);
        assert.equal(card.points, 10);
      }
    }
  }
});

// An online room deals its board once and writes it down; every client, and the
// room itself on revival, deals from THAT record rather than from the seed. So
// the record has to carry the slot each card was dealt to fill — a deck that
// came back untagged would build its queue off the cards' printed positions,
// which is the very leak the tag exists to close, in exactly the rooms that
// matter.
test("a room's written-down deck brings the slot tags back with it", () => {
  const seed = "pinned-deck";
  const pool = buildDraftPool(UNIVERSE, seed, { nomination: "random", managerCount: 4 });
  const revived = deckFromIds(UNIVERSE, seed, pool.map(deckEntry));

  assert.deepEqual(
    revived.map((card) => [card.id, card.slot]),
    pool.map((card) => [card.id, card.slot]),
    "the revived board is the dealt board, tags and all"
  );

  // And so the revived room nominates the same cards in the same order.
  const room = (cards) => createDraft(
    Array.from({ length: 4 }, (_, index) => ({ name: `M${index + 1}`, cpu: true })),
    cards,
    13,
    seed,
    { draftType: "auction", nomination: "random", budget: 5000, timer: false }
  );
  assert.deepEqual(room(revived).auction.queue, room(pool).auction.queue);
});

// The reserve the board keeps back at every slot, stated as an invariant: the
// deal puts visiblePerSlot cards in each slot, the queue may take only
// hiddenPerSlot of them, and the difference — at least n - 1 per slot — is what
// the sweep spends. A queue that read a card's POSITION instead of the slot it
// was dealt to would break this at whichever pile its DH bats came from.
test("every slot keeps n - 1 cards back from the queue, for every manager count", () => {
  for (let managers = 2; managers <= 8; managers += 1) {
    const { draft, pool } = roomOf(managers, `reserve-${managers}`);
    const queued = new Set(draft.auction.queue);
    for (const [group, slots] of ROSTER_SLOTS) {
      const dealt = pool.filter((card) => card.slot === group);
      const held = dealt.filter((card) => !queued.has(card.id));
      assert.ok(
        held.length >= (managers - 1) * slots,
        `${managers} managers: ${group} holds back only ${held.length} of ${dealt.length}, needs ${(managers - 1) * slots}`
      );
    }
  }
});

test("swept cards are free, and the cheapest thing left on the board", () => {
  const { draft } = roomOf(3, "sweep-check");
  let guard = 0;
  while (!draft.complete && guard < 5000) {
    guard += 1;
    autopick(draft);
  }

  const sold = new Set(
    draft.auction.history.filter((entry) => entry.managerId && !entry.swept).map((entry) => entry.playerId)
  );
  const swept = draft.auction.history.filter((entry) => entry.swept);
  assert.ok(swept.length > 0, "nobody needed sweeping — pick a seed where somebody comes up short");

  for (const entry of swept) {
    assert.equal(entry.price, 0);
    // The sweep only ever reaches for a card nobody bought: either one the
    // queue never called, or one the whole room passed on when it did.
    assert.equal(sold.has(entry.playerId), false, "the sweep handed out a card that had already sold");
  }
});

test("a manager can hold more than thirteen cards", () => {
  const { draft } = roomOf(3, "hoard");
  const manager = draft.managers[0];
  // Buy the whole hidden queue's worth of catchers and then some: no cap.
  for (const card of draft.pool.slice(0, 20)) {
    manager.roster.push(card);
    draft.pickedIds.add(card.id);
  }
  assert.equal(manager.roster.length, 20);
  assert.deepEqual(validateRoster(manager, { unlimitedRoster: true }).filter((issue) => issue.startsWith("too many")), []);
});

test("undo after the final lot rolls the sweep back off the rosters", () => {
  const { draft } = roomOf(3, "undo-sweep");
  let guard = 0;
  while (!draft.complete && guard < 5000) {
    guard += 1;
    autopick(draft);
  }
  assert.ok(draft.auction.history.some((entry) => entry.swept));
  const sweptIds = draft.auction.history.filter((entry) => entry.swept).map((entry) => entry.playerId);

  undoLastPick(draft);

  assert.equal(draft.complete, false);
  assert.equal(draft.auction.history.some((entry) => entry.swept), false);
  for (const playerId of sweptIds) {
    assert.equal(draft.pickedIds.has(playerId), false, "a swept card stayed on a roster after undo");
    assert.equal(
      draft.managers.some((manager) => manager.roster.some((card) => card.id === playerId)),
      false
    );
  }
});

test("an action log replays to the same draft", () => {
  const { draft, pool } = roomOf(3, "replay");
  const actions = [];
  let guard = 0;
  while (!draft.complete && guard < 5000) {
    guard += 1;
    actions.push({ type: "autopick" });
    autopick(draft);
  }

  const replay = createDraft(
    draft.managers.map((manager) => ({ name: manager.name, cpu: manager.cpu })),
    pool,
    13,
    "replay",
    { draftType: "auction", nomination: "random", budget: 5000, timer: false }
  );
  for (const action of actions) applyDraftAction(replay, action);

  assert.equal(replay.complete, true);
  assert.deepEqual(
    replay.managers.map((manager) => manager.roster.map((card) => card.id)),
    draft.managers.map((manager) => manager.roster.map((card) => card.id))
  );
  assert.deepEqual(replay.auction.budgets, draft.auction.budgets);
});

// The room that started all this in earnest: computers priced every card against
// replacements sitting on the board that the queue would never actually deal, so
// they always believed a cheaper man was coming, passed on almost everyone, and
// ended the draft rich and rostered only by the free sweep. A computer must read
// its market as the cards STILL TO COME and spend against the holes it has.
test("computers spend their budget instead of hoarding it", () => {
  const budget = 5000;
  for (const managerCount of [2, 3, 4]) {
    for (const seed of ["spend-a", "spend-b"]) {
      const { draft } = roomOf(managerCount, seed);
      let guard = 0;
      while (!draft.complete && guard < 5000) {
        guard += 1;
        autopick(draft);
      }
      assert.ok(draft.complete);
      for (const manager of draft.managers) {
        const spent = budget - draft.auction.budgets[manager.id];
        assert.ok(
          spent >= 0.4 * budget,
          `${managerCount}/${seed}: ${manager.name} spent only ${spent} of ${budget} — hoarding`
        );
        assert.ok(manager.roster.length >= 13, `${manager.name} finished short: ${manager.roster.length}`);
      }
    }
  }
});

// The whole of "bid the max on the last lot": when the last man at a bucket it
// still needs comes up, there is no replacement to fall back on and no later
// round to catch one, so a computer bids all it can.
test("the last man at a needed bucket is bid to the max", () => {
  const { draft, pool } = roomOf(2, "last-man");
  const cpu = draft.managers[0];

  // Drive the board down to a single unpicked card and put it up as the final
  // lot, with the buyer's roster still empty so the bucket is genuinely needed.
  const survivor = pool.find((card) => card.kind === "hitter");
  for (const card of pool) if (card.id !== survivor.id) draft.pickedIds.add(card.id);
  draft.auction.queue = [survivor.id];
  draft.auction.queueIndex = 0;
  draft.auction.lot = {
    playerId: survivor.id,
    nominatorId: null,
    round: 1,
    bids: {},
    pending: draft.managers.map((manager) => manager.id),
    tie: null,
    clock: null
  };

  assert.equal(auctionLotPlayer(draft).id, survivor.id);
  assert.equal(cpuSealedBid(draft, cpu), auctionMaxBid(draft, cpu));
});

// The queue's order is the room's secret. A computer reads what a human at the
// table reads — the card on the block, the lots left, each position's
// guaranteed minimum, the unpicked board — so reshuffling the cards still to
// come, or swapping them for others off the board, cannot move a single bid.
test("a computer's bid does not read the hidden queue", () => {
  const { draft } = roomOf(4, "no-peeking");
  for (let lot = 0; lot < 12; lot += 1) {
    applyDraftAction(draft, { type: "auto-nominate", at: 0 });
    submitCpuSealedBids(draft);
  }
  applyDraftAction(draft, { type: "auto-nominate", at: 0 });
  const bids = () => draft.managers.map((manager) => cpuSealedBid(draft, manager));
  const before = bids();
  assert.ok(before.some((bid) => bid > 0), "somebody bids on the lot");

  const { queue, queueIndex } = draft.auction;
  const ahead = new Set(queue.slice(queueIndex));
  const offQueue = draft.pool
    .filter((card) => !card.replacement && !draft.pickedIds.has(card.id) && !ahead.has(card.id))
    .map((card) => card.id);
  const tail = queue.slice(queueIndex + 1).reverse();
  tail.splice(0, Math.min(offQueue.length, 5), ...offQueue.slice(0, 5));
  draft.auction.queue = [...queue.slice(0, queueIndex + 1), ...tail];

  assert.deepEqual(bids(), before);
});

// Budgeting counts the holes the way the bid reads them. Nine bats with nobody
// who plays second leave second open; counting heads called the lineup full,
// budgeted the whole bankroll against the one rotation seat left, and bid
// double on a mediocre second baseman for owning a bench bat.
test("a bench bat does not hide an open position from the budget", () => {
  const seed = "open-second";
  const pool = buildDraftPool(UNIVERSE, seed, { nomination: "random", managerCount: 4 });
  const cards = pool.filter((card) => !card.replacement);
  const bats = (position) => cards.filter((card) => card.kind === "hitter" && card.position === position);
  const seconds = bats("2B").sort((a, b) => a.points - b.points);
  const target = seconds[Math.floor(seconds.length / 3)];
  const lineup = ["C", "1B", "3B", "SS", "CF", "LF/RF"].map((position) => bats(position)[0]);
  lineup.push(bats("LF/RF")[1]);
  const [dh, bench] = cards.filter((card) => card.kind === "hitter" && card.position !== "2B" && !lineup.includes(card));
  const starter = cards.find((card) => card.kind === "pitcher" && card.role === "SP");
  const relievers = cards.filter((card) => card.kind === "pitcher" && card.role !== "SP").slice(0, 2);

  const bidWith = (hitters) => {
    const draft = createDraft(
      Array.from({ length: 4 }, (_, index) => ({ name: `M${index + 1}`, cpu: true, persona: "balanced" })),
      pool, 13, seed, { draftType: "auction", nomination: "random", budget: 1000, timer: false }
    );
    const cpu = draft.managers[0];
    cpu.roster = [...hitters, starter, ...relievers].map((card) => draft.pool.find((item) => item.id === card.id));
    for (const card of cpu.roster) draft.pickedIds.add(card.id);
    draft.auction.budgets[cpu.id] = 600;
    draft.auction.lot = { playerId: target.id, nominatorId: null, round: 1, bids: {}, pending: [], tie: null, clock: null };
    return cpuSealedBid(draft, cpu);
  };

  const withoutBench = bidWith([...lineup, dh]);
  const withBench = bidWith([...lineup, dh, bench]);
  assert.ok(withoutBench > 0, "the second baseman fills a hole");
  assert.ok(withBench <= withoutBench * 1.1, `a bench bat lifted the bid from ${withoutBench} to ${withBench}`);
});

// A pen is priced by the arm it adds. The engine rides the best reliever out
// there, so a card that would become a team's best reliever is worth a premium,
// and in an uncapped pen the third through fifth relievers still take innings
// off the rotation — they are a need, not bench.
test("relievers are bid on as the pen they join", () => {
  const seed = "pen-depth";
  const pen = { bullpenSlots: "all", bullpenMin: 2 };
  const pool = buildDraftPool(UNIVERSE, seed, { nomination: "random", managerCount: 4, startingPitchers: 4, ...pen });
  const cards = pool.filter((card) => !card.replacement);
  const bats = (position) => cards.filter((card) => card.kind === "hitter" && card.position === position);
  const lineup = ["C", "1B", "2B", "3B", "SS", "CF", "LF/RF"].map((position) => bats(position)[0]);
  lineup.push(bats("LF/RF")[1]);
  lineup.push(cards.find((card) => card.kind === "hitter" && !lineup.includes(card)));
  const rotation = cards.filter((card) => card.kind === "pitcher" && card.role === "SP").slice(0, 4);
  const relievers = cards.filter((card) => card.kind === "pitcher" && card.role !== "SP")
    .sort((a, b) => b.points - a.points);
  const [ace, second] = relievers;
  const weakPen = relievers.slice(-2);

  const bid = (penSettings, owned, lot) => {
    const draft = createDraft(
      Array.from({ length: 4 }, (_, index) => ({ name: `M${index + 1}`, cpu: true, persona: "balanced" })),
      pool, 15, seed,
      { draftType: "auction", nomination: "random", startingPitchers: 4, budget: 1500, timer: false, ...penSettings }
    );
    const cpu = draft.managers[0];
    cpu.roster = [...lineup, ...rotation, ...owned].map((card) => draft.pool.find((item) => item.id === card.id));
    for (const card of cpu.roster) draft.pickedIds.add(card.id);
    draft.auction.budgets[cpu.id] = 600;
    draft.auction.lot = { playerId: lot.id, nominatorId: null, round: 1, bids: {}, pending: [], tie: null, clock: null };
    return cpuSealedBid(draft, cpu);
  };

  const uncapped = bid(pen, weakPen, ace);
  const capped = bid({ bullpenSlots: 2, bullpenMin: 2 }, weakPen, ace);
  assert.ok(uncapped > capped, `a third reliever bid ${uncapped} uncapped vs ${capped} in a two-man pen`);

  const wouldLead = bid(pen, weakPen, second);
  const behindAce = bid(pen, [ace, weakPen[0]], second);
  assert.ok(wouldLead > behindAce, `the same reliever bid ${wouldLead} to lead a pen vs ${behindAce} behind a better arm`);
});

// Pass on every catcher and the sweep hands you the standing one. If he is the
// better card — the classic set's fields 10 — then the catchers on the board are
// worth nothing, and a computer that prices them against the board's own worst
// man bids real money on cards worse than the one it gets free.
test("a card worse than the standing replacement draws no bid", () => {
  const { draft, pool } = roomOf(4, "sub-replacement");
  const cpu = draft.managers[1];
  const standing = standingReplacements(draft).find((card) => poolGroup(card) === "C");
  assert.ok(standing, "the classic board deals a standing catcher");

  const model = managerValuation(draft, cpu);
  const catchers = pool.filter((card) => !card.replacement && poolGroup(card) === "C");
  const worse = catchers.filter((card) => model.value(card) < model.value(standing));
  assert.ok(worse.length, "some catcher on this board is worse than the standing one");
  const better = catchers.filter((card) => model.value(card) > model.value(standing));
  assert.ok(better.length, "and some catcher is better");

  const bidOn = (card) => {
    draft.auction.lot = {
      playerId: card.id, nominatorId: null, round: 1, bids: {}, pending: [], tie: null, clock: null
    };
    return cpuSealedBid(draft, cpu);
  };
  for (const card of worse) assert.equal(bidOn(card), 0, `${card.name} is worse than the free card and drew a bid`);
  assert.ok(bidOn(better[0]) > 0, "a catcher better than the standing card is still worth buying");
});

// A room's rules come from the room. Server and client both rebuild a draft
// from the room record, and a browser that reads its own setup screen instead
// bids for the computers under rules the room never had — room misty-fox-open
// was drafted with an uncapped pen and priced all 202 computer bids as though
// the pen held two.
test("a room's own settings decide the draft, whoever rebuilds it", () => {
  const room = {
    draftType: "auction",
    nomination: "random",
    startingPitchers: 3,
    bullpenSlots: "all",
    bullpenMin: 2,
    auctionBudget: 1400,
    hidePoints: true
  };
  const options = roomDraftOptions(room);
  assert.equal(options.bullpenSlots, UNLIMITED_BULLPEN, "an uncapped pen stays uncapped");
  assert.equal(options.bullpenMin, 2);
  assert.equal(options.startingPitchers, 3);
  assert.equal(options.rosterSize, 14);
  assert.equal(options.budget, 1400);
  assert.equal(options.hidePoints, true);
  assert.equal(options.timer, false, "a room that names no clock has none");

  // The pen the room set is the pen the bidder budgets against.
  const pool = buildDraftPool(UNIVERSE, "pen-rules", { nomination: "random", managerCount: 4, startingPitchers: 3, bullpenSlots: "all", bullpenMin: 2 });
  const managers = Array.from({ length: 4 }, (_, index) => ({ name: `M${index + 1}`, cpu: true }));
  const uncapped = createDraft(managers, pool, options.rosterSize, "pen-rules", options);
  const capped = createDraft(managers, pool, options.rosterSize, "pen-rules", { ...options, bullpenSlots: 2 });
  assert.equal(uncapped.bullpenSlots, UNLIMITED_BULLPEN);
  assert.equal(capped.bullpenSlots, 2);

  // With two relievers aboard the capped room's pen is full and the uncapped
  // room's is not, so the same arm is worth different money in each.
  const arms = pool.filter((card) => card.kind === "pitcher" && card.role !== "SP" && !card.replacement)
    .sort((a, b) => b.points - a.points);
  const lotOn = (draft) => {
    const cpu = draft.managers[0];
    cpu.roster = arms.slice(-2).map((card) => draft.pool.find((item) => item.id === card.id));
    for (const card of cpu.roster) draft.pickedIds.add(card.id);
    draft.auction.budgets[cpu.id] = 800;
    draft.auction.lot = { playerId: arms[0].id, nominatorId: null, round: 1, bids: {}, pending: [], tie: null, clock: null };
    return cpuSealedBid(draft, cpu);
  };
  assert.notEqual(lotOn(uncapped), lotOn(capped), "the pen setting moves what a reliever is worth");
});

// A reliever's season is decided by whether he beats the rotation he works
// behind: clear it and he throws 400 innings, fall short and he throws 20. The
// printed points barely separate the two, so the board's relievers are spaced
// by the season each one's quality earns him — but only in a deck whose
// relievers can beat its rotations at all.
test("the best reliever on the board is priced far above a mediocre one", () => {
  const { draft, pool } = roomOf(4, "reliever-spread");
  const cpu = draft.managers[1];
  const model = managerValuation(draft, cpu);
  const relievers = pool.filter((card) => !card.replacement && poolGroup(card) === "RP");
  assert.ok(relievers.length >= 4, "the board deals a pen to bid on");

  const bidOn = (card) => {
    draft.auction.lot = { playerId: card.id, nominatorId: null, round: 1, bids: {}, pending: [], tie: null, clock: null };
    return cpuSealedBid(draft, cpu);
  };
  // auctionMarket ranks arms by what the engine says they allow, so the model's
  // own ordering is the one to read the board with.
  const ranked = [...relievers].sort((a, b) => model.value(b) - model.value(a));
  const best = ranked[0];
  const middling = ranked[Math.floor(ranked.length / 2)];
  const bestBid = bidOn(best);
  const middlingBid = bidOn(middling);
  assert.ok(bestBid > 0, "the best reliever is worth buying");
  assert.ok(
    bestBid >= middlingBid * 2,
    `best reliever drew ${bestBid}, middling one ${middlingBid} — the board is not spaced`
  );
});
