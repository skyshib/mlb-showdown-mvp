import test from "node:test";
import assert from "node:assert/strict";
import {
  AUCTION_DEFAULT_BUDGET,
  AUCTION_MIN_BID,
  AUCTION_MIN_RAISE,
  auctionBudget,
  auctionLotPlayer,
  auctionMaxBid,
  autopick,
  canBid,
  canNominatePlayer,
  cancelLot,
  createDraft,
  currentManager,
  draftHistory,
  isAuctionDraft,
  nominatePlayer,
  normalizeAuctionBudget,
  pickPlayer,
  placeBid,
  sellLot,
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
  return createDraft(managers, pool, 13, "auction-test", { draftType: "auction", ...options });
}

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

test("nomination opens the lot at the minimum bid held by the nominator", () => {
  const draft = makeAuctionDraft();
  const [alpha, beta] = draft.managers;
  const target = draft.pool[0];

  const wrongTurn = canNominatePlayer(draft, beta, target);
  assert.equal(wrongTurn.ok, false);
  assert.match(wrongTurn.reason, /nominates next/);

  nominatePlayer(draft, target.id);
  assert.equal(draft.auction.lot.bid, AUCTION_MIN_BID);
  assert.equal(draft.auction.lot.bidderId, alpha.id);
  assert.equal(auctionLotPlayer(draft).id, target.id);

  const blocked = canNominatePlayer(draft, alpha, draft.pool[1]);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /current lot/);
  assert.throws(() => nominatePlayer(draft, draft.pool[1].id));
});

test("bids must raise by the step, stay under the max bid, and the high bidder holds", () => {
  const draft = makeAuctionDraft();
  const [alpha, beta] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id);

  assert.throws(() => placeBid(draft, beta.id, AUCTION_MIN_BID + AUCTION_MIN_RAISE - 1));
  placeBid(draft, beta.id, AUCTION_MIN_BID + AUCTION_MIN_RAISE);
  assert.equal(draft.auction.lot.bid, 10);
  assert.equal(draft.auction.lot.bidderId, beta.id);
  assert.throws(() => placeBid(draft, beta.id, 20), /already the high bidder/);

  const expectedMax = AUCTION_DEFAULT_BUDGET - (draft.rosterSize - 1) * AUCTION_MIN_BID;
  assert.equal(auctionMaxBid(draft, alpha), expectedMax);
  assert.equal(canBid(draft, alpha, expectedMax + AUCTION_MIN_RAISE).ok, false);
  placeBid(draft, alpha.id, expectedMax);
  assert.equal(draft.auction.lot.bidderId, alpha.id);
});

test("selling deducts the price, records history, and rotates the nomination", () => {
  const draft = makeAuctionDraft();
  const [alpha, beta] = draft.managers;
  const target = draft.pool[0];
  nominatePlayer(draft, target.id);
  placeBid(draft, beta.id, 10);
  placeBid(draft, alpha.id, 15);
  const sale = sellLot(draft);

  assert.equal(sale.manager.id, alpha.id);
  assert.equal(sale.price, 15);
  assert.equal(auctionBudget(draft, alpha), AUCTION_DEFAULT_BUDGET - 15);
  assert.equal(alpha.roster.length, 1);
  assert.equal(draft.pickNumber, 1);
  assert.equal(draft.auction.lot, null);
  assert.equal(currentManager(draft).id, beta.id);

  const history = draftHistory(draft);
  assert.equal(history.length, 1);
  assert.equal(history[0].price, 15);
  assert.equal(history[0].manager.id, alpha.id);
  assert.equal(history[0].player.id, target.id);
});

test("roster legality blocks nominations and bids that break minimums", () => {
  const draft = makeAuctionDraft();
  const [alpha, beta] = draft.managers;
  const starters = draft.pool.filter((player) => player.kind === "pitcher" && player.role === "SP");

  nominatePlayer(draft, starters[0].id);
  sellLot(draft);
  nominatePlayer(draft, starters[1].id);
  placeBid(draft, alpha.id, 10);
  sellLot(draft);
  assert.equal(alpha.roster.length, 2);

  const thirdStarter = canNominatePlayer(draft, alpha, starters[2]);
  assert.equal(thirdStarter.ok, false);
  assert.match(thirdStarter.reason, /starter slots/);

  const hitterTarget = draft.pool.find((player) => player.kind === "hitter");
  nominatePlayer(draft, hitterTarget.id);
  sellLot(draft);

  nominatePlayer(draft, starters[2].id);
  const blockedBid = canBid(draft, alpha, 10);
  assert.equal(blockedBid.ok, false);
  assert.match(blockedBid.reason, /starter slots/);
});

test("cancel only works on an untouched nomination; undo unwinds one step", () => {
  const draft = makeAuctionDraft();
  const [alpha, beta] = draft.managers;
  nominatePlayer(draft, draft.pool[0].id);
  placeBid(draft, beta.id, 10);
  assert.equal(cancelLot(draft), null);
  assert.notEqual(draft.auction.lot, null);

  const undone = undoLastPick(draft);
  assert.equal(undone.canceledLot, true);
  assert.equal(draft.auction.lot, null);
  assert.equal(draft.pickNumber, 0);

  nominatePlayer(draft, draft.pool[0].id);
  assert.notEqual(cancelLot(draft), null);
  assert.equal(draft.auction.lot, null);
});

test("undoing a sale refunds the winner and restores the nominator", () => {
  const draft = makeAuctionDraft();
  const [alpha, beta] = draft.managers;
  const target = draft.pool[0];
  nominatePlayer(draft, target.id);
  placeBid(draft, beta.id, 10);
  sellLot(draft);
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

test("upcomingNominators rotates through the managers", () => {
  const draft = makeAuctionDraft(["Alpha", "Beta", "Gamma"], makeDraftPool("trio", 32, 16));
  const names = upcomingNominators(draft, 4).map((manager) => manager.name);
  assert.deepEqual(names, ["Alpha", "Beta", "Gamma", "Alpha"]);
});

test("pickPlayer refuses to run inside an auction draft", () => {
  const draft = makeAuctionDraft();
  assert.throws(() => pickPlayer(draft, draft.pool[0].id), /selling lots/);
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
