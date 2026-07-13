import test from "node:test";
import assert from "node:assert/strict";
import {
  AUCTION_DEFAULT_BUDGET,
  AUCTION_DEFAULT_CLOCK_BANK_SECONDS,
  AUCTION_DEFAULT_CLOCK_INCREMENT_SECONDS,
  AUCTION_DEFAULT_REVIEW_SECONDS,
  AUCTION_MIN_BID,
  applyDraftAction,
  assignStaffSlots,
  auctionBidTimeRemainingMs,
  auctionBudget,
  auctionLotPlayer,
  auctionMaxBid,
  auctionReviewComplete,
  auctionReviewRemainingMs,
  auctionTimerEnabled,
  autopick,
  benchPlayers,
  buildTeam,
  canNominatePlayer,
  canPlaceSealedBid,
  cancelLot,
  completeAuctionReview,
  cpuSealedBid,
  createDraft,
  currentManager,
  draftHistory,
  isAuctionDraft,
  isAuctionPaused,
  nominateBestTarget,
  nominatePlayer,
  normalizeAuctionBudget,
  normalizeAuctionTimerConfig,
  pauseAuction,
  pickPlayer,
  placeSealedBid,
  resumeAuction,
  sealedBidder,
  startAuctionReview,
  submitCpuSealedBids,
  syncAuctionTimer,
  undoLastPick,
  upcomingNominators,
  validateRoster,
  managerValuation
} from "../src/rules/draft.js";

const hitter = {
  id: "h-test",
  kind: "hitter",
  name: "Test Hitter",
  position: "1B",
  onBase: 10,
  speed: 12,
  fielding: 2,
  chart: [
    { from: 1, to: 10, result: "1B" },
    { from: 11, to: 20, result: "HR" }
  ]
};

const pitcher = {
  id: "p-test",
  kind: "pitcher",
  name: "Test Pitcher",
  role: "SP",
  control: 4,
  ip: 6,
  chart: [
    { from: 1, to: 12, result: "SO" },
    { from: 13, to: 20, result: "BB" }
  ]
};

const positions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

function makeHitter(overrides = {}) {
  return { ...hitter, ...overrides };
}

function makePitcher(overrides = {}) {
  return { ...pitcher, ...overrides };
}

function makeDraftPool(prefix = "pool", hitterCount = 24, pitcherCount = 8) {
  const hitters = Array.from({ length: hitterCount }, (_, index) => makeHitter({
    id: `${prefix}-h-${index}`,
    name: `${prefix} Hitter ${index}`,
    position: positions[index % positions.length],
    points: 250 - index
  }));
  const pitchers = Array.from({ length: pitcherCount }, (_, index) => makePitcher({
    id: `${prefix}-p-${index}`,
    name: `${prefix} Pitcher ${index}`,
    role: index % 2 === 0 ? "SP" : "RP",
    ip: index % 2 === 0 ? 6 : 1,
    points: 180 - index
  }));
  return [...hitters, ...pitchers];
}

function makeAuctionDraft(managers = ["Alpha", "Beta"], pool = makeDraftPool(), options = {}) {
  return createDraft(managers, pool, 13, "auction-test", { draftType: "auction", timer: false, ...options });
}

test("default timed auction reviews the pool and spends a chess clock on sealed bids", () => {
  const draft = createDraft(["Alpha", "Beta"], makeDraftPool(), 13, "timed-sealed", { draftType: "auction" });
  const [alpha, beta] = draft.managers;
  assert.equal(draft.auction.timer.reviewMs, AUCTION_DEFAULT_REVIEW_SECONDS * 1000);
  assert.equal(draft.auction.clockBanks[beta.id], AUCTION_DEFAULT_CLOCK_BANK_SECONDS * 1000);

  startAuctionReview(draft, 1000);
  assert.equal(auctionReviewRemainingMs(draft, 1000), AUCTION_DEFAULT_REVIEW_SECONDS * 1000);
  assert.equal(canNominatePlayer(draft, alpha, draft.pool[0], 1000).ok, false);
  completeAuctionReview(draft, 2000);
  nominatePlayer(draft, draft.pool[0].id, 3000);

  const incremented = (AUCTION_DEFAULT_CLOCK_BANK_SECONDS + AUCTION_DEFAULT_CLOCK_INCREMENT_SECONDS) * 1000;
  assert.equal(auctionBidTimeRemainingMs(draft, beta, 5000), incremented - 2000);
  placeSealedBid(draft, beta.id, 50, 8000);
  assert.equal(draft.auction.clockBanks[beta.id], incremented - 5000);
});

test("a pause stops every clock and nobody can act until it lifts", () => {
  const draft = createDraft(["Alpha", "Beta"], makeDraftPool(), 13, "paused", {
    draftType: "auction",
    timer: { reviewSeconds: 0, bankSeconds: 60, incrementSeconds: 0 }
  });
  const [alpha, beta] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id, 1000);

  // Ten seconds into the lot the room stops. Beta is charged those ten seconds
  // and not a millisecond more, however long the break runs.
  pauseAuction(draft, 11000);
  assert.equal(isAuctionPaused(draft), true);
  assert.equal(auctionBidTimeRemainingMs(draft, beta, 11000), 50000);
  assert.equal(auctionBidTimeRemainingMs(draft, beta, 500000), 50000, "a paused clock does not run");
  assert.equal(syncAuctionTimer(draft, 500000), false, "nobody times out during a pause");
  assert.equal(canPlaceSealedBid(draft, beta, 50, 500000).ok, false);
  assert.equal(canPlaceSealedBid(draft, beta, 50, 500000).reason, "the draft is paused");

  // And it picks up exactly where it stopped, with the whole break forgiven.
  resumeAuction(draft, 500000);
  assert.equal(isAuctionPaused(draft), false);
  assert.equal(auctionBidTimeRemainingMs(draft, beta, 500000), 50000);
  assert.equal(auctionBidTimeRemainingMs(draft, beta, 510000), 40000);
  assert.equal(canPlaceSealedBid(draft, beta, 50, 510000).ok, true);
  placeSealedBid(draft, alpha.id, 60, 510000);
  placeSealedBid(draft, beta.id, 50, 510000);
  assert.equal(draft.managers[0].roster.length, 1, "the lot sells once the room is running again");
});

test("a pause freezes the review clock instead of running it out", () => {
  const draft = createDraft(["Alpha", "Beta"], makeDraftPool(), 13, "paused-review", {
    draftType: "auction",
    timer: { reviewSeconds: 600, bankSeconds: 60, incrementSeconds: 0 }
  });
  const [alpha] = draft.managers;
  startAuctionReview(draft, 1000);
  pauseAuction(draft, 61000);

  assert.equal(auctionReviewRemainingMs(draft, 61000), 540000);
  assert.equal(auctionReviewRemainingMs(draft, 10 ** 9), 540000, "the review does not tick down while paused");
  assert.equal(auctionReviewComplete(draft, 10 ** 9), false, "and it cannot run out while paused");
  assert.equal(canNominatePlayer(draft, alpha, draft.pool[0], 10 ** 9).reason, "the draft is paused");

  resumeAuction(draft, 10 ** 9);
  assert.equal(auctionReviewRemainingMs(draft, 10 ** 9), 540000);
  assert.equal(auctionReviewComplete(draft, 10 ** 9 + 540001), true);
});

test("pause and resume replay through the action log like any other move", () => {
  const build = () => createDraft(["Alpha", "Beta"], makeDraftPool(), 13, "paused-replay", {
    draftType: "auction",
    timer: { reviewSeconds: 0, bankSeconds: 60, incrementSeconds: 0 }
  });
  const actions = [
    { type: "nominate", playerId: makeDraftPool()[0].id, at: 1000 },
    { type: "pause", at: 11000 },
    { type: "resume", at: 500000 },
    { type: "seal-bid", managerId: "team-1", amount: 60, at: 510000 },
    { type: "seal-bid", managerId: "team-2", amount: 50, at: 510000 }
  ];
  const replayed = build();
  for (const action of actions) applyDraftAction(replayed, action);

  assert.equal(isAuctionPaused(replayed), false);
  assert.equal(replayed.managers[0].roster.length, 1);
  // The eight-minute break cost the bidders nothing. Beta's 60-second bank is
  // down only the 10 seconds before the pause and the 10 after the resume — the
  // clock charges for thinking, not for waiting.
  assert.equal(replayed.auction.clockBanks[replayed.managers[1].id], 40000);
});

test("timed-out sealed bidders submit zero without revealing other bids", () => {
  const draft = createDraft(["Alpha", "Beta"], makeDraftPool(), 13, "timed-timeout", {
    draftType: "auction",
    timer: { reviewSeconds: 0, bankSeconds: 2, incrementSeconds: 1 }
  });
  nominatePlayer(draft, draft.pool[0].id, 1000);
  placeSealedBid(draft, "team-1", 100, 1500);
  assert.equal(syncAuctionTimer(draft, 4000), true);
  assert.equal(draft.auction.lot, null);
  assert.equal(draft.auction.history[0].bids["team-2"], 0);
  assert.equal(draft.auction.history[0].managerId, "team-1");
});

test("auction draft starts with full budgets and the first manager nominating", () => {
  const draft = makeAuctionDraft();
  assert.equal(isAuctionDraft(draft), true);
  assert.equal(draft.auction.budget, AUCTION_DEFAULT_BUDGET);
  for (const manager of draft.managers) {
    assert.equal(auctionBudget(draft, manager), AUCTION_DEFAULT_BUDGET);
  }
  assert.equal(currentManager(draft).name, "Alpha");
  assert.equal(draft.auction.lot, null);

  const snake = createDraft(["Alpha", "Beta"], makeDraftPool(), 13, "snake-test");
  assert.equal(isAuctionDraft(snake), false);
  assert.equal(snake.auction, undefined);
});

test("normalizeAuctionBudget rounds to the raise step and floors at min bids", () => {
  assert.equal(normalizeAuctionBudget(998), 1000);
  assert.equal(normalizeAuctionBudget(10, 13), 13 * AUCTION_MIN_BID);
  assert.equal(normalizeAuctionBudget(undefined), AUCTION_DEFAULT_BUDGET);
});

test("createDraft accepts { name, cpu } descriptors and flags cpu managers", () => {
  const draft = makeAuctionDraft([{ name: "Alpha", cpu: false }, { name: "Robo", cpu: true }]);
  assert.equal(draft.managers[0].cpu, false);
  assert.equal(draft.managers[1].cpu, true);
  assert.equal(draft.managers[1].name, "Robo");
});

test("nomination opens a sealed lot with bids pending in seat order from the nominator", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
  const [alpha, beta] = draft.managers;
  const target = draft.pool[0];

  const wrongTurn = canNominatePlayer(draft, beta, target);
  assert.equal(wrongTurn.ok, false);
  assert.match(wrongTurn.reason, /nominates next/);

  nominatePlayer(draft, target.id);
  const lot = draft.auction.lot;
  assert.equal(lot.round, 1);
  assert.deepEqual(lot.pending, ["team-1", "team-2", "team-3"]);
  assert.equal(auctionLotPlayer(draft).id, target.id);
  assert.equal(sealedBidder(draft).id, alpha.id);

  const blocked = canNominatePlayer(draft, alpha, draft.pool[1]);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /current lot/);
  assert.throws(() => nominatePlayer(draft, draft.pool[1].id));
});

test("the nominator must open at the minimum, and everyone else may pass", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
  const [alpha, beta] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id);

  assert.equal(canPlaceSealedBid(draft, alpha, 0).ok, false);
  assert.match(canPlaceSealedBid(draft, alpha, 0).reason, /nominator opens/);
  assert.equal(canPlaceSealedBid(draft, alpha, AUCTION_MIN_BID - 1).ok, false);
  assert.equal(canPlaceSealedBid(draft, beta, 0).ok, true, "anyone but the nominator may pass");
});

test("sealed bids go in in any order — nobody waits their turn", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
  const [alpha, beta, gamma] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id);

  // Alpha nominated, so seat order would have had Alpha bid first. Gamma does
  // not have to wait for him: the bids are hidden until the card sells, so
  // there is nothing to wait for.
  assert.equal(canPlaceSealedBid(draft, gamma, 50).ok, true);
  placeSealedBid(draft, gamma.id, 50);
  assert.equal(canPlaceSealedBid(draft, gamma, 60).ok, false, "and nobody bids twice");
  assert.match(canPlaceSealedBid(draft, gamma, 60).reason, /already in/);

  assert.equal(canPlaceSealedBid(draft, beta, 0).ok, true);
  placeSealedBid(draft, beta.id, 0);

  // The last bid in resolves the lot, whoever it belongs to.
  const sale = placeSealedBid(draft, alpha.id, 80);
  assert.equal(sale.sold, true);
  assert.equal(sale.manager.id, alpha.id);
  assert.equal(sale.price, 51);
});

test("a tie is broken by seat, not by who typed first", () => {
  // Two managers tie, rebid, and tie again: the coin flip decides. Run the
  // identical bids with the entry order reversed in BOTH rounds — the same
  // manager has to win, or the flip is really a race to the submit button.
  const winnerFor = (order) => {
    const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
    const [alpha, beta, gamma] = draft.managers;
    const pair = order === "ab" ? [alpha, beta] : [beta, alpha];
    nominatePlayer(draft, draft.pool[0].id);

    placeSealedBid(draft, gamma.id, 0);
    placeSealedBid(draft, pair[0].id, 100);
    const tie = placeSealedBid(draft, pair[1].id, 100);
    assert.equal(tie.sold, false, "a tied top bid forces a rebid");

    placeSealedBid(draft, pair[0].id, 100);
    const sale = placeSealedBid(draft, pair[1].id, 100);
    assert.equal(sale.sold, true);
    return sale.manager.id;
  };
  assert.equal(winnerFor("ab"), winnerFor("ba"));
});

test("the high bid wins at the second-highest bid plus one", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
  const [alpha, beta, gamma] = draft.managers;
  const target = draft.pool[0];
  nominatePlayer(draft, target.id);

  placeSealedBid(draft, alpha.id, 105);
  placeSealedBid(draft, beta.id, 150);
  const sale = placeSealedBid(draft, gamma.id, 0);

  assert.equal(sale.sold, true);
  assert.equal(sale.manager.id, beta.id);
  assert.equal(sale.price, 106);
  assert.equal(auctionBudget(draft, beta), AUCTION_DEFAULT_BUDGET - 106);
  assert.equal(beta.roster.length, 1);
  assert.equal(draft.pickNumber, 1);
  assert.equal(draft.auction.lot, null);
  assert.equal(currentManager(draft).id, beta.id);

  const history = draftHistory(draft);
  assert.equal(history.length, 1);
  assert.equal(history[0].price, 106);
  assert.equal(history[0].manager.id, beta.id);
  assert.equal(history[0].player.id, target.id);
  assert.deepEqual(draft.auction.history[0].bids, { "team-1": 105, "team-2": 150, "team-3": 0 });
});

test("a lone bid sells at the minimum bid", () => {
  const draft = makeAuctionDraft();
  const [alpha] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id);
  placeSealedBid(draft, alpha.id, 400);
  const sale = placeSealedBid(draft, draft.managers[1].id, 0);
  assert.equal(sale.sold, true);
  assert.equal(sale.manager.id, alpha.id);
  assert.equal(sale.price, AUCTION_MIN_BID);
});

test("bids are capped so every open slot keeps the minimum bid", () => {
  const draft = makeAuctionDraft();
  const [alpha] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id);
  const expectedMax = AUCTION_DEFAULT_BUDGET - (draft.rosterSize - 1) * AUCTION_MIN_BID;
  assert.equal(auctionMaxBid(draft, alpha), expectedMax);
  assert.equal(canPlaceSealedBid(draft, alpha, expectedMax + 1).ok, false);
  assert.throws(() => placeSealedBid(draft, alpha.id, expectedMax + 1), /max bid/);
  placeSealedBid(draft, alpha.id, expectedMax);
});

test("a tied top bid forces a sealed rebid among the tied managers", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
  const [alpha, beta, gamma] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id);

  placeSealedBid(draft, alpha.id, 100);
  placeSealedBid(draft, beta.id, 100);
  const tie = placeSealedBid(draft, gamma.id, 80);

  assert.equal(tie.sold, false);
  assert.deepEqual(tie.tie, { amount: 100, managerIds: [alpha.id, beta.id] });
  const lot = draft.auction.lot;
  assert.equal(lot.round, 2);
  assert.deepEqual(lot.pending, [alpha.id, beta.id]);

  // Rebids can't pass and can't go below the tied amount.
  assert.equal(canPlaceSealedBid(draft, alpha, 0).ok, false);
  assert.equal(canPlaceSealedBid(draft, alpha, 99).ok, false);

  placeSealedBid(draft, alpha.id, 130);
  const sale = placeSealedBid(draft, beta.id, 110);
  assert.equal(sale.sold, true);
  assert.equal(sale.manager.id, alpha.id);
  assert.equal(sale.price, 111);
});

test("a second tie resolves with a seeded random winner at the tied price", () => {
  const run = () => {
    const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
    nominatePlayer(draft, draft.pool[0].id);
    placeSealedBid(draft, "team-1", 100);
    placeSealedBid(draft, "team-2", 100);
    placeSealedBid(draft, "team-3", 0);
    placeSealedBid(draft, "team-1", 120);
    return placeSealedBid(draft, "team-2", 120);
  };
  const first = run();
  const second = run();
  assert.equal(first.sold, true);
  assert.equal(first.price, 120);
  assert.ok(["team-1", "team-2"].includes(first.manager.id));
  // Deterministic: the same draft state resolves the coin flip the same way.
  assert.equal(first.manager.id, second.manager.id);
});

test("roster legality keeps ineligible managers out of the bid order", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta"], makeDraftPool());
  const [alpha, beta] = draft.managers;
  const starters = draft.pool.filter((player) => player.kind === "pitcher" && player.role === "SP");

  // Alpha wins two starters (the nomination rotates to Beta in between),
  // filling Alpha's SP slots.
  nominatePlayer(draft, starters[0].id);
  placeSealedBid(draft, alpha.id, 50);
  placeSealedBid(draft, beta.id, 0);
  nominatePlayer(draft, starters[1].id);
  placeSealedBid(draft, beta.id, AUCTION_MIN_BID);
  placeSealedBid(draft, alpha.id, 50);
  assert.equal(alpha.roster.length, 2);

  // Alpha nominates next but can't take a third starter.
  const thirdStarter = canNominatePlayer(draft, alpha, starters[2]);
  assert.equal(thirdStarter.ok, false);
  assert.match(thirdStarter.reason, /starter slots/);

  const hitterTarget = draft.pool.find((player) => player.kind === "hitter");
  nominatePlayer(draft, hitterTarget.id);
  placeSealedBid(draft, alpha.id, 10);
  placeSealedBid(draft, beta.id, 0);

  // Beta nominates a third starter: Alpha can't bid, so only Beta is pending.
  nominatePlayer(draft, starters[2].id);
  assert.deepEqual(draft.auction.lot.pending, [beta.id]);
});

test("cancel works until another human bids; undo unwinds one step", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta"], makeDraftPool());
  const [alpha, beta] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id);
  placeSealedBid(draft, alpha.id, 40);
  assert.notEqual(cancelLot(draft), null);
  assert.equal(draft.auction.lot, null);

  nominatePlayer(draft, draft.pool[0].id);
  placeSealedBid(draft, alpha.id, 40);
  placeSealedBid(draft, beta.id, 0);
  // The lot resolved on Beta's pass, so there is nothing to cancel...
  assert.equal(cancelLot(draft), null);
  // ...but undo refunds the sale.
  const undone = undoLastPick(draft);
  assert.equal(undone.manager.id, alpha.id);
  assert.equal(auctionBudget(draft, alpha), AUCTION_DEFAULT_BUDGET);
  assert.equal(draft.pickNumber, 0);
});

test("a human bid from a non-nominator blocks cancel; undo clears the open lot", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
  nominatePlayer(draft, draft.pool[0].id);
  placeSealedBid(draft, "team-1", 40);
  placeSealedBid(draft, "team-2", 60);
  assert.equal(cancelLot(draft), null);
  assert.notEqual(draft.auction.lot, null);

  const undone = undoLastPick(draft);
  assert.equal(undone.canceledLot, true);
  assert.equal(draft.auction.lot, null);
  assert.equal(draft.pickNumber, 0);
});

test("undoing a sale refunds the winner and restores the nominator", () => {
  const draft = makeAuctionDraft();
  const [alpha, beta] = draft.managers;
  const target = draft.pool[0];
  nominatePlayer(draft, target.id);
  placeSealedBid(draft, alpha.id, 10);
  placeSealedBid(draft, beta.id, 25);
  assert.equal(currentManager(draft).id, beta.id);

  const undone = undoLastPick(draft);
  assert.equal(undone.manager.id, beta.id);
  assert.equal(undone.player.id, target.id);
  assert.equal(auctionBudget(draft, beta), AUCTION_DEFAULT_BUDGET);
  assert.equal(beta.roster.length, 0);
  assert.equal(draft.pickNumber, 0);
  assert.equal(draft.pickedIds.has(target.id), false);
  assert.equal(currentManager(draft).id, alpha.id);
});

test("computer managers bid instantly when their turn comes up", () => {
  const draft = makeAuctionDraft(
    [{ name: "Alpha", cpu: false }, { name: "Robo", cpu: true }, { name: "Bot", cpu: true }],
    makeDraftPool("trio", 32, 16)
  );
  const [alpha] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id);

  // Alpha is the nominator, so nothing happens until the human bids.
  assert.equal(submitCpuSealedBids(draft), null);
  assert.equal(sealedBidder(draft).id, alpha.id);

  // A computer answers the moment it is asked. What it answers is its own
  // business: a bid, or nothing at all — passing on a card it can replace for
  // the minimum is a move, not a failure to move. What it must never do is bid
  // more than it has.
  const robo = draft.managers[1];
  const roboBid = cpuSealedBid(draft, robo);
  assert.ok(roboBid === 0 || roboBid >= AUCTION_MIN_BID, "a bid is a real bid, or it is a pass");
  assert.ok(roboBid <= auctionMaxBid(draft, robo), "and never more than it can pay");

  placeSealedBid(draft, alpha.id, 10);
  const result = submitCpuSealedBids(draft);
  // Both computers answered, which resolved the lot.
  assert.equal(result.sold, true);
  assert.equal(draft.auction.lot, null);
  assert.equal(draft.pickNumber, 1);
});

test("upcomingNominators rotates through the managers", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
  const names = upcomingNominators(draft, 4).map((manager) => manager.name);
  assert.deepEqual(names, ["Alpha", "Beta", "Gamma", "Alpha"]);
});

test("pickPlayer refuses to run inside an auction draft", () => {
  const draft = makeAuctionDraft();
  assert.throws(() => pickPlayer(draft, draft.pool[0].id), /selling lots/);
});

test("nominateBestTarget opens a lot for the current nominator", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
  const lot = nominateBestTarget(draft);
  assert.notEqual(lot, null);
  assert.equal(lot.nominatorId, "team-1");
  assert.equal(draft.auction.lot, lot);
});

test("auto-run resolves one lot and auto-finish builds legal rosters within budget", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));

  autopick(draft);
  assert.equal(draft.pickNumber, 1);
  assert.equal(draft.auction.history.length, 1);
  const firstSale = draft.auction.history[0];
  assert.ok(firstSale.price >= AUCTION_MIN_BID);

  let guard = draft.managers.length * draft.rosterSize + 5;
  while (!draft.complete && guard > 0) {
    guard -= 1;
    autopick(draft);
  }
  assert.equal(draft.complete, true);
  assert.equal(draft.auction.history.length, draft.managers.length * draft.rosterSize);

  for (const manager of draft.managers) {
    assert.equal(manager.roster.length, draft.rosterSize);
    assert.deepEqual(validateRoster(manager), []);
    const spent = draft.auction.history
      .filter((entry) => entry.managerId === manager.id)
      .reduce((sum, entry) => sum + entry.price, 0);
    assert.equal(auctionBudget(draft, manager), draft.auction.budget - spent);
    assert.ok(auctionBudget(draft, manager) >= 0);
  }
});

test("a draft rebuilt without a clock replays a log recorded without one", () => {
  // An auction is timed unless it says otherwise — that is the house rule.
  assert.equal(normalizeAuctionTimerConfig(undefined).enabled, true);
  // ...and `false` is how a draft opts out.
  for (const off of [false, { enabled: false }]) {
    assert.equal(normalizeAuctionTimerConfig(off).enabled, false);
  }

  // Which makes the default a trap for anyone REBUILDING a draft: a room that
  // never had a clock, rebuilt with the timer left undefined, opens a review
  // period it never had — and then cannot replay its own action log, because
  // the nomination that was legal when it was recorded now throws "Review
  // period is still open". That is what hung an online room on "Connecting to
  // room…". reviveRoom and rebuildOnlineDraft both pass `?? false` for this.
  const pool = makeDraftPool("replay", 32, 16);
  const room = { draftType: "auction", nomination: "random" };
  const log = [{ type: "auto-nominate" }];

  const timed = createDraft(["Alpha", "Beta"], pool, 13, "replay", room);
  assert.throws(
    () => log.forEach((action) => applyDraftAction(timed, action)),
    /Review period is still open/,
    "a clock invented on rebuild bricks the log"
  );

  const untimed = createDraft(["Alpha", "Beta"], pool, 13, "replay", { ...room, timer: false });
  log.forEach((action) => applyDraftAction(untimed, action));
  assert.ok(untimed.auction.lot, "the log replayed, and the card it recorded is on the block");
});

test("a manager picks which of their cards take the field", () => {
  // An unlimited roster can buy a dozen arms. WHICH two relievers pitch was
  // decided by roster order — the two you happened to buy first — and the
  // manager had no say and could not even see the rest.
  const pool = makeDraftPool("bench", 40, 24);
  const draft = makeAuctionDraft(["Alpha"], pool, { nomination: "random", unlimitedRoster: true });
  const [alpha] = draft.managers;
  alpha.roster = [
    ...pool.filter((card) => card.kind === "hitter").slice(0, 11),
    ...pool.filter((card) => card.role === "SP").slice(0, 4),
    ...pool.filter((card) => card.role === "RP").slice(0, 4)
  ];

  // Untouched, the staff fills in roster order and the rest is a bench.
  const [sp1, sp2, sp3] = pool.filter((card) => card.role === "SP");
  const [rp1, , rp3] = pool.filter((card) => card.role === "RP");
  assert.deepEqual(
    assignStaffSlots(alpha.roster).map((slot) => slot.player.id),
    [sp1.id, sp2.id, rp1.id, pool.filter((c) => c.role === "RP")[1].id]
  );
  const bench = benchPlayers(alpha);
  assert.ok(bench.length > 0, "the cards that are not in the thirteen are a bench");
  assert.ok(bench.some((card) => card.id === sp3.id), "the third starter is on it");

  // Now the manager chooses. The staff he picked is the staff that pitches.
  alpha.staffAssignments = { SP1: sp3.id, SP2: sp1.id, RP1: rp3.id, RP2: rp1.id };
  const team = buildTeam(alpha);
  assert.deepEqual(team.starters.map((p) => p.id), [sp3.id, sp1.id], "his starters, not the first two he bought");
  assert.deepEqual(team.bullpen.map((p) => p.id), [rp3.id, rp1.id], "his bullpen too");
  assert.ok(!benchPlayers(alpha).some((card) => card.id === sp3.id), "and the man he started is off the bench");

  // A closer cannot be handed the ball to start.
  const chosen = assignStaffSlots(alpha.roster, { SP1: rp3.id });
  assert.notEqual(chosen[0].player.id, rp3.id, "a reliever does not fill a starter's slot");
});

test("the batting order a manager sets is the order they bat in", () => {
  const pool = makeDraftPool("order", 40, 24);
  const draft = makeAuctionDraft(["Alpha"], pool);
  const [alpha] = draft.managers;
  alpha.roster = [
    ...pool.filter((card) => card.kind === "hitter").slice(0, 9),
    ...pool.filter((card) => card.role === "SP").slice(0, 2),
    ...pool.filter((card) => card.role === "RP").slice(0, 2)
  ];

  // Untouched, they bat in the order the lineup slots are listed: the catcher
  // leads off, which nobody has ever wanted.
  const byDefault = buildTeam(alpha).lineup.map((player) => player.id);
  assert.equal(byDefault.length, 9);

  // Bat the last man first and everybody else shuffles down behind him.
  const chosen = [byDefault.at(-1), ...byDefault.slice(0, -1)];
  applyDraftAction(draft, { type: "batting-order", managerId: alpha.id, order: chosen });
  assert.deepEqual(buildTeam(alpha).lineup.map((player) => player.id), chosen);

  // A stale order survives a roster change: anyone it does not name bats last
  // rather than falling out of the lineup.
  alpha.battingOrder = [byDefault[4]];
  const after = buildTeam(alpha).lineup.map((player) => player.id);
  assert.equal(after[0], byDefault[4], "the one man named leads off");
  assert.equal(after.length, 9, "and nobody is lost");
});

// ---- How a computer decides what to pay -------------------------------------
//
// The old bidder priced a card against the AVERAGE card of its kind, so the
// worst catcher on the board still drew a bid proportional to what he was. But
// the worst catcher is worth nothing: let him go and you get another catcher,
// and all you lose is the difference between them. That difference is the whole
// value of a card, and it is what these tests are about.

// The stock test pool clones ONE card, so every catcher on it is the same
// catcher. That is a fine board for testing the machinery of an auction and a
// useless one for testing what a card is worth: if the men at a spot are
// identical, the worst of them IS the best of them, every card is replacement
// level, and passing on all of them is the right answer. A graded board is what
// the question needs.
function makeGradedPool(prefix = "graded", depth = 5) {
  const cards = [];
  for (const [index, position] of positions.entries()) {
    for (let rank = 0; rank < depth; rank += 1) {
      cards.push(makeHitter({
        id: `${prefix}-h-${index}-${rank}`,
        name: `${prefix} ${position} ${rank}`,
        position,
        onBase: Math.max(4, 14 - rank),
        speed: Math.max(6, 18 - rank),
        fielding: Math.max(0, 5 - rank),
        points: 400 - rank * 20
      }));
    }
  }
  for (let index = 0; index < depth * 8; index += 1) {
    const rank = index % depth;
    cards.push(makePitcher({
      id: `${prefix}-p-${index}`,
      name: `${prefix} P ${index}`,
      role: index % 2 === 0 ? "SP" : "RP",
      ip: index % 2 === 0 ? 6 : 1,
      control: Math.max(1, 7 - rank),
      points: 300 - rank * 15
    }));
  }
  return cards;
}

test("a computer passes on the worst man at a spot, because it can still have the next one", () => {
  // A fresh room per lot: a nomination cannot simply be swapped out from under
  // a live auction, and a draft with no card on the block bids zero for reasons
  // that have nothing to do with what the card is worth.
  const room = () => makeAuctionDraft(
    [{ name: "Alpha", cpu: true }, { name: "Beta", cpu: true }, { name: "Gamma", cpu: true }],
    makeGradedPool("replacement")
  );
  const sample = room();
  const model = managerValuation(sample, sample.managers[0]);
  const catchers = sample.pool
    .filter((player) => player.kind === "hitter" && player.position === "C")
    .sort((a, b) => model.value(b) - model.value(a));
  assert.ok(catchers.length >= 3, "the board has catchers to choose between");
  const best = catchers[0];
  const worst = catchers[catchers.length - 1];
  assert.ok(model.value(best) > model.value(worst), "and they are not all the same catcher");

  const onWorst = room();
  nominatePlayer(onWorst, worst.id);
  const bidWorst = cpuSealedBid(onWorst, onWorst.managers[1]);

  const onBest = room();
  nominatePlayer(onBest, best.id);
  const bidBest = cpuSealedBid(onBest, onBest.managers[1]);

  assert.equal(bidWorst, 0, "the worst catcher on the board is not worth money — take the next one for nothing");
  assert.ok(bidBest >= AUCTION_MIN_BID, "the best one is worth money");
  assert.ok(bidBest > bidWorst, "and worth more than the man you can replace for free");
});

test("the last man at a spot you need is worth paying for, however ordinary he is", () => {
  const draft = makeAuctionDraft(
    [{ name: "Alpha", cpu: true }, { name: "Beta", cpu: true }],
    makeGradedPool("scarcity")
  );
  const [, beta] = draft.managers;
  const model = managerValuation(draft, beta);
  const catchers = draft.pool
    .filter((player) => player.kind === "hitter" && player.position === "C")
    .sort((a, b) => model.value(b) - model.value(a));
  assert.ok(catchers.length >= 3);

  // The WORST catcher on the board goes up, with better ones still to come.
  const worst = catchers[catchers.length - 1];
  nominatePlayer(draft, worst.id);
  const withFallback = cpuSealedBid(draft, beta);
  assert.equal(withFallback, 0, "with better catchers still to come, this one is worth nothing");

  // The same card, the same lot, the same manager — and now every other catcher
  // in the room has been bought out from under him while he was thinking. He has
  // no fallback left. The card has not changed; what it is WORTH has, because
  // what it is worth was never about the card. It was about the next one.
  for (const catcher of catchers) {
    if (catcher.id !== worst.id) draft.pickedIds.add(catcher.id);
  }
  const noFallback = cpuSealedBid(draft, beta);
  assert.ok(noFallback >= AUCTION_MIN_BID, "the last catcher in the room is not something you pass on");
  assert.ok(noFallback > withFallback, "and he is worth more than he was when he was replaceable");
});

test("nine managers on the same board do not arrive at the same number", () => {
  const managers = Array.from({ length: 9 }, (unused, index) => ({ name: `Bot${index}`, cpu: true }));
  const draft = makeAuctionDraft(managers, makeGradedPool("spread", 14));
  const model = managerValuation(draft, draft.managers[0]);
  // Put a card worth having on the block — one everybody wants is the one that
  // used to produce nine identical bids.
  const prize = [...draft.pool].sort((a, b) => model.value(b) - model.value(a))[0];
  nominatePlayer(draft, prize.id);

  const bids = draft.managers.slice(1).map((manager) => cpuSealedBid(draft, manager)).filter((bid) => bid > 0);
  assert.ok(bids.length >= 3, "several managers want him");
  const unique = new Set(bids);
  assert.ok(unique.size > 1, "and they do not all bid the same");
  const spread = (Math.max(...bids) - Math.min(...bids)) / Math.max(...bids);
  assert.ok(spread > 0.1, `the room should disagree by more than a rounding error, got ${(spread * 100).toFixed(0)}%`);
});

test("no computer ever bids money it has not got", () => {
  const managers = Array.from({ length: 4 }, (unused, index) => ({ name: `Bot${index}`, cpu: true }));
  const draft = makeAuctionDraft(managers, makeGradedPool("solvency", 8));
  let guard = 0;
  while (!draft.complete && guard < 200) {
    guard += 1;
    if (!nominateBestTarget(draft)) break;
    for (const manager of draft.managers) {
      const bid = cpuSealedBid(draft, manager);
      assert.ok(bid <= auctionMaxBid(draft, manager), `${manager.name} bid more than it can pay`);
      assert.ok(bid >= 0);
    }
    autopick(draft);
  }
  for (const manager of draft.managers) {
    assert.ok(auctionBudget(draft, manager) >= 0, `${manager.name} went overdrawn`);
    assert.equal(validateRoster(manager).length, 0, `${manager.name} ended up with an illegal roster`);
  }
});
