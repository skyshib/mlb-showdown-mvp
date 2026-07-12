import test from "node:test";
import assert from "node:assert/strict";
import {
  AUCTION_DEFAULT_BUDGET,
  AUCTION_DEFAULT_CLOCK_BANK_SECONDS,
  AUCTION_DEFAULT_CLOCK_INCREMENT_SECONDS,
  AUCTION_DEFAULT_REVIEW_SECONDS,
  AUCTION_MIN_BID,
  auctionBudget,
  auctionBidTimeRemainingMs,
  auctionLotPlayer,
  auctionMaxBid,
  auctionReviewRemainingMs,
  autopick,
  canNominatePlayer,
  canPlaceSealedBid,
  completeAuctionReview,
  cancelLot,
  cpuSealedBid,
  createDraft,
  currentManager,
  draftHistory,
  isAuctionDraft,
  nominateBestTarget,
  nominatePlayer,
  normalizeAuctionBudget,
  pickPlayer,
  placeSealedBid,
  sealedBidder,
  startAuctionReview,
  syncAuctionTimer,
  submitCpuSealedBids,
  undoLastPick,
  upcomingNominators,
  validateRoster
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

  const robo = draft.managers[1];
  const roboBid = cpuSealedBid(draft, robo);
  assert.ok(roboBid >= AUCTION_MIN_BID);
  assert.ok(roboBid <= auctionMaxBid(draft, robo));

  placeSealedBid(draft, alpha.id, 10);
  const result = submitCpuSealedBids(draft);
  // Both computers bid, which resolved the lot.
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
