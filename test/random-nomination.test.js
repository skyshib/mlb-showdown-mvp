import test from "node:test";
import assert from "node:assert/strict";

import { buildDraftPool } from "../src/data/universes.js";
import {
  ROSTER_SLOTS,
  applyDraftAction,
  auctionMaxBid,
  autopick,
  canNominatePlayer,
  createDraft,
  isRandomNomination,
  nominationQueueRemaining,
  nextQueuedPlayer,
  poolGroup,
  randomNominationCounts,
  randomNominationQuotas,
  randomNominationShortfalls,
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
    budget: 5000
  });
  return { draft, pool };
}

function countGroup(cards, group) {
  return cards.filter((card) => poolGroup(card) === group).length;
}

function countHitters(cards) {
  return cards.filter((card) => card.kind === "hitter").length;
}

test("the roster slot table is the 13-man roster, spelled out", () => {
  const total = ROSTER_SLOTS.reduce((sum, [, slots]) => sum + slots, 0);
  assert.equal(total, 13);
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

    // Nobody was handed an invented player: the board covered the sweep.
    const invented = draft.pool.filter((card) => String(card.id).startsWith("emergency-"));
    assert.deepEqual(invented, [], `${managerCount} managers: the sweep had to invent ${invented.length} players`);
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
    { draftType: "auction", nomination: "random", budget: 5000 }
  );
  for (const action of actions) applyDraftAction(replay, action);

  assert.equal(replay.complete, true);
  assert.deepEqual(
    replay.managers.map((manager) => manager.roster.map((card) => card.id)),
    draft.managers.map((manager) => manager.roster.map((card) => card.id))
  );
  assert.deepEqual(replay.auction.budgets, draft.auction.budgets);
});
