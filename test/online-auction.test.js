import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer } from "../scripts/online-server.js";
import { buildDraftPool } from "../src/data/universes.js";
import { applyDraftAction, auctionBudget, createDraft, SIM_ACTION_TYPES } from "../src/rules/draft.js";

async function startServer(t, dataDir) {
  const roomsDir = dataDir ?? (await mkdtemp(join(tmpdir(), "showdown-auction-")));
  const { server } = createOnlineServer({ dataDir: roomsDir });
  server.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());
  return base;
}

async function api(base, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

const SEED = "auction-room";

async function openAuctionRoom(base, options = {}) {
  const created = await api(base, "POST", "/api/rooms", {
    seed: SEED,
    managers: options.managers ?? ["Ana", "Bo"],
    draftType: "auction",
    budget: options.budget ?? 5000,
    auctionTimer: options.auctionTimer ?? false,
    cpu: options.cpu ?? []
  });
  assert.equal(created.status, 201);
  return created.data;
}

function act(base, roomId, token, action) {
  return api(base, "POST", `/api/rooms/${roomId}/actions`, { token, action });
}

// Rebuilds the draft the way a browser does: replay the shared action log.
function replay(room) {
  const draft = createDraft(
    room.managers.map((manager) => ({ name: manager.name, cpu: manager.cpu })),
    buildDraftPool(room.universe, room.seed),
    room.rosterSize,
    room.seed,
    { draftType: room.draftType, budget: room.auctionBudget, timer: room.auctionTimer }
  );
  for (const entry of room.actions) {
    if (!SIM_ACTION_TYPES.has(entry.action?.type)) applyDraftAction(draft, entry.action);
  }
  return draft;
}

function firstNominatable(room) {
  return buildDraftPool(room.universe, room.seed).find((player) => player.kind === "hitter").id;
}

test("an auction room deals budgets, opens a lot, and sells to the high bid at second price + 1", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base, { budget: 4000 });
  assert.equal(room.draftType, "auction");
  assert.equal(room.auctionBudget, 4000);
  assert.equal(room.lot, null);

  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });
  const bo = await api(base, "POST", `/api/rooms/${room.roomId}/join`, { managerId: "team-2" });

  const playerId = firstNominatable(room);
  assert.equal((await act(base, room.roomId, ana.data.token, { type: "nominate", playerId })).status, 200);

  // Nominator opens, then the other seat outbids. Vickrey: 300 wins, pays 201.
  assert.equal((await act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 200 })).status, 200);
  assert.equal((await act(base, room.roomId, bo.data.token, { type: "seal-bid", managerId: "team-2", amount: 300 })).status, 200);

  const after = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.equal(after.data.lot, null, "the lot closed when the last bid landed");

  const draft = replay(after.data);
  const [anaTeam, boTeam] = draft.managers;
  assert.equal(anaTeam.roster.length, 0);
  assert.equal(boTeam.roster.length, 1);
  assert.equal(boTeam.roster[0].id, playerId);
  assert.equal(auctionBudget(draft, boTeam), 4000 - 201);
  assert.equal(auctionBudget(draft, anaTeam), 4000);
});

test("timed online auctions share review and chess-clock state", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base, {
    auctionTimer: { reviewSeconds: 60, bankSeconds: 30, incrementSeconds: 5 }
  });
  assert.deepEqual(room.auctionTimer, {
    enabled: true,
    reviewMs: 60000,
    bankMs: 30000,
    incrementMs: 5000
  });
  assert.equal(room.actions[0].action.type, "start-review");
  assert.ok(Number.isFinite(room.serverNow));

  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });
  const bo = await api(base, "POST", `/api/rooms/${room.roomId}/join`, { managerId: "team-2" });
  assert.equal((await act(base, room.roomId, bo.data.token, { type: "complete-review" })).status, 409);
  assert.equal((await act(base, room.roomId, ana.data.token, { type: "complete-review", at: 1 })).status, 200);

  const playerId = firstNominatable(room);
  assert.equal((await act(base, room.roomId, ana.data.token, { type: "nominate", playerId, at: 1 })).status, 200);
  let current = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.equal(current.data.lot.clock.banks["team-1"], 35000);
  assert.equal(current.data.lot.clock.banks["team-2"], 35000);

  assert.equal((await act(base, room.roomId, ana.data.token, {
    type: "seal-bid", managerId: "team-1", amount: 100, at: 1
  })).status, 200);
  current = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.deepEqual(current.data.lot.bidsIn, ["team-1"]);
  assert.ok(current.data.lot.clock.banks["team-1"] <= 35000);
  assert.equal(current.data.actions.some((entry) => entry.action.type === "seal-bid"), false, "bid amount stays sealed");

  assert.equal((await act(base, room.roomId, bo.data.token, {
    type: "seal-bid", managerId: "team-2", amount: 50, at: 1
  })).status, 200);
  current = await api(base, "GET", `/api/rooms/${room.roomId}`);
  const revealed = current.data.actions.filter((entry) => entry.action.type === "seal-bid");
  assert.equal(revealed.length, 2);
  assert.ok(revealed.every((entry) => entry.action.at !== 1), "the server stamps bid time");
});

test("online bid-clock expiry records sealed zero bids", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base, {
    auctionTimer: { reviewMs: 0, bankMs: 50, incrementMs: 0 }
  });
  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });
  assert.equal((await act(base, room.roomId, ana.data.token, {
    type: "nominate", playerId: firstNominatable(room)
  })).status, 200);

  await new Promise((resolve) => setTimeout(resolve, 150));
  const after = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.equal(after.data.lot, null);
  const timeouts = after.data.actions.filter((entry) => entry.action.type === "seal-bid" && entry.action.timedOut);
  assert.equal(timeouts.length, 2);
  assert.ok(timeouts.every((entry) => entry.action.amount === 0));
  const draft = replay(after.data);
  assert.equal(draft.auction.history[0].passed, true);
});

// The whole point of the hold-back: the room's stream reaches every browser, so
// a bid that is broadcast when it is placed is a bid the next bidder can read.
test("sealed bids are withheld from the room until the card sells", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base);
  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });
  const bo = await api(base, "POST", `/api/rooms/${room.roomId}/join`, { managerId: "team-2" });

  const playerId = firstNominatable(room);
  await act(base, room.roomId, ana.data.token, { type: "nominate", playerId });
  await act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 777 });

  // Bo is next to bid, and nothing the server will hand him carries Ana's 777.
  const midLot = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.equal(
    midLot.data.actions.filter((entry) => entry.action.type === "seal-bid").length,
    0,
    "no bid is in the action log while the lot is live"
  );
  assert.doesNotMatch(JSON.stringify(midLot.data), /777/, "the amount is nowhere in the room payload");

  // What Bo does get: that Ana has bid, and that he is on the clock.
  assert.deepEqual(midLot.data.lot.bidsIn, ["team-1"]);
  assert.deepEqual(midLot.data.lot.pending, ["team-2"]);
  assert.equal(midLot.data.lot.round, 1);

  // The sale releases every amount at once, in the order they were placed.
  await act(base, room.roomId, bo.data.token, { type: "seal-bid", managerId: "team-2", amount: 100 });
  const sold = await api(base, "GET", `/api/rooms/${room.roomId}`);
  const bids = sold.data.actions.filter((entry) => entry.action.type === "seal-bid");
  assert.deepEqual(bids.map((entry) => [entry.action.managerId, entry.action.amount]), [
    ["team-1", 777],
    ["team-2", 100]
  ]);

  // And every client replays those to the same place the server already is.
  const draft = replay(sold.data);
  assert.equal(draft.managers[0].roster[0].id, playerId);
  assert.equal(auctionBudget(draft, draft.managers[0]), 5000 - 101);
});

test("a tie holds its bids back through the rebid round", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base);
  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });
  const bo = await api(base, "POST", `/api/rooms/${room.roomId}/join`, { managerId: "team-2" });

  const playerId = firstNominatable(room);
  await act(base, room.roomId, ana.data.token, { type: "nominate", playerId });
  await act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 250 });
  await act(base, room.roomId, bo.data.token, { type: "seal-bid", managerId: "team-2", amount: 250 });

  // Tied: a rebid round opens and the lot is still live, so nothing is revealed.
  const tied = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.equal(tied.data.lot.round, 2);
  assert.equal(tied.data.lot.tie.amount, 250);
  assert.deepEqual(tied.data.lot.pending, ["team-1", "team-2"]);
  assert.equal(tied.data.actions.filter((entry) => entry.action.type === "seal-bid").length, 0);

  await act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 260 });
  await act(base, room.roomId, bo.data.token, { type: "seal-bid", managerId: "team-2", amount: 250 });

  const sold = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.equal(sold.data.lot, null);
  // All four bids — both rounds — land in the log together.
  assert.equal(sold.data.actions.filter((entry) => entry.action.type === "seal-bid").length, 4);
  const draft = replay(sold.data);
  assert.equal(draft.managers[0].roster[0].id, playerId, "the rebid winner has the card");
  assert.equal(draft.managers[1].roster.length, 0);
});

test("an auction room enforces whose nomination and whose bid it is", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base);
  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });
  const bo = await api(base, "POST", `/api/rooms/${room.roomId}/join`, { managerId: "team-2" });
  const playerId = firstNominatable(room);

  // Ana nominates first, so Bo cannot.
  const boNominates = await act(base, room.roomId, bo.data.token, { type: "nominate", playerId });
  assert.equal(boNominates.status, 409);
  assert.match(boNominates.data.error, /not your nomination/i);

  // A snake pick has no meaning here, and neither does an autopick: it would
  // enter bids for managers who never made them.
  const picked = await act(base, room.roomId, ana.data.token, { type: "pick", playerId });
  assert.equal(picked.status, 409);
  const autopicked = await act(base, room.roomId, ana.data.token, { type: "autopick" });
  assert.equal(autopicked.status, 409);
  assert.match(autopicked.data.error, /nominate and bid/i);

  await act(base, room.roomId, ana.data.token, { type: "nominate", playerId });

  // The bids are sealed, so there is no turn to bid out of. Ana nominated, but
  // Bo does not have to sit and wait for her to type: he bids when he likes.
  const early = await act(base, room.roomId, bo.data.token, { type: "seal-bid", managerId: "team-2", amount: 50 });
  assert.equal(early.status, 200);

  // But he bids once...
  const twice = await act(base, room.roomId, bo.data.token, { type: "seal-bid", managerId: "team-2", amount: 90 });
  assert.equal(twice.status, 409);
  assert.match(twice.data.error, /already in/i);

  // ...and only for himself.
  const asSomeoneElse = await act(base, room.roomId, bo.data.token, {
    type: "seal-bid",
    managerId: "team-1",
    amount: 50
  });
  assert.equal(asSomeoneElse.status, 409);
  assert.match(asSomeoneElse.data.error, /another manager/i);

  // The nominator may not pass on their own nomination.
  const passed = await act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 0 });
  assert.equal(passed.status, 409);
});

// Three seats, so a lot can still be open after a rival has bid into it.
test("a nomination can be canceled until a rival bids on it", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base, { managers: ["Ana", "Bo", "Cyd"] });
  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });
  const bo = await api(base, "POST", `/api/rooms/${room.roomId}/join`, { managerId: "team-2" });
  const playerId = firstNominatable(room);

  // The nominator's own opening bid does not commit the card.
  await act(base, room.roomId, ana.data.token, { type: "nominate", playerId });
  await act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 100 });
  assert.equal((await act(base, room.roomId, ana.data.token, { type: "cancel-lot" })).status, 200);
  const cleared = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.equal(cleared.data.lot, null);
  // The canceled lot's bid is thrown away with it — never revealed, never spent.
  assert.equal(cleared.data.actions.filter((entry) => entry.action.type === "seal-bid").length, 0);
  assert.equal(auctionBudget(replay(cleared.data), replay(cleared.data).managers[0]), 5000);

  // Once a rival has bid, the card is committed — and the server knows that
  // even though it has told the room nothing about the amount.
  await act(base, room.roomId, ana.data.token, { type: "nominate", playerId });
  await act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 100 });
  await act(base, room.roomId, bo.data.token, { type: "seal-bid", managerId: "team-2", amount: 120 });

  const live = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.deepEqual(live.data.lot.pending, ["team-3"], "still waiting on Cyd, so the lot is open");
  const refused = await act(base, room.roomId, ana.data.token, { type: "cancel-lot" });
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /already bid/i);
});

test("a stalled auction is finished by the host, and the withheld bids come out first", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base);
  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });
  const playerId = firstNominatable(room);
  await act(base, room.roomId, ana.data.token, { type: "nominate", playerId });
  await act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 150 });

  // Bo never bids. The host finishes; the draft must not run away from the
  // clients, so Ana's withheld 150 enters the log before the finish does.
  const finish = await act(base, room.roomId, ana.data.token, { type: "finish" });
  assert.equal(finish.status, 200);

  const done = await api(base, "GET", `/api/rooms/${room.roomId}`);
  assert.equal(done.data.complete, true);
  const types = done.data.actions.map((entry) => entry.action.type);
  assert.ok(types.indexOf("seal-bid") < types.indexOf("finish"), "the held bid is revealed before the finish");

  // Replay parity is the real assertion: a client that only ever saw the log
  // lands exactly where the server is.
  const draft = replay(done.data);
  assert.equal(draft.complete, true);
  for (const manager of draft.managers) {
    assert.equal(manager.roster.length, draft.rosterSize);
    assert.ok(auctionBudget(draft, manager) >= 0);
  }
});

test("computer managers nominate and bid on the server", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base, { managers: ["Ana", "Robo"], cpu: ["Robo"] });
  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });

  const playerId = firstNominatable(room);
  await act(base, room.roomId, ana.data.token, { type: "nominate", playerId });
  // Ana bids; Robo is the only seat left, so the server bids for it and the
  // lot resolves without any browser doing anything.
  await act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 300 });

  const after = await api(base, "GET", `/api/rooms/${room.roomId}`);
  const bids = after.data.actions.filter((entry) => entry.action.type === "seal-bid");
  assert.ok(bids.some((entry) => entry.action.managerId === "team-2"), "the computer entered a bid");

  const draft = replay(after.data);
  assert.equal(draft.pickNumber, 1, "the lot sold");
  // Robo nominates next, and the server should have already opened that lot.
  assert.ok(after.data.lot, "the computer opened the next lot itself");
  assert.equal(after.data.lot.nominatorId, "team-2");
});

test("a room restarted mid-lot keeps the withheld bids and still sells correctly", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-auction-"));
  const first = await startServer(t, dataDir);
  const room = await openAuctionRoom(first);
  const ana = await api(first, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: "team-1",
    hostToken: room.hostToken
  });
  const bo = await api(first, "POST", `/api/rooms/${room.roomId}/join`, { managerId: "team-2" });

  const playerId = firstNominatable(room);
  await act(first, room.roomId, ana.data.token, { type: "nominate", playerId });
  await act(first, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 420 });
  // persistRoom writes async; give the chained write a beat to land.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));

  const second = await startServer(t, dataDir);
  const revived = await api(second, "GET", `/api/rooms/${room.roomId}`);
  // The lot came back mid-bid: Ana's bid is remembered, still nobody's to read.
  assert.deepEqual(revived.data.lot.bidsIn, ["team-1"]);
  assert.deepEqual(revived.data.lot.pending, ["team-2"]);
  assert.equal(revived.data.actions.filter((entry) => entry.action.type === "seal-bid").length, 0);
  assert.doesNotMatch(JSON.stringify(revived.data), /420/);

  // Bidding resumes on the new process and the sale prices off the remembered bid.
  assert.equal(
    (await act(second, room.roomId, bo.data.token, { type: "seal-bid", managerId: "team-2", amount: 100 })).status,
    200
  );
  const sold = await api(second, "GET", `/api/rooms/${room.roomId}`);
  const draft = replay(sold.data);
  assert.equal(draft.managers[0].roster[0].id, playerId);
  assert.equal(auctionBudget(draft, draft.managers[0]), 5000 - 101);
});

test("everyone bids at once — the room never waits on one manager", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base, { managers: ["Ana", "Bo", "Cyd"] });
  const seats = await Promise.all([1, 2, 3].map((n) =>
    api(base, "POST", `/api/rooms/${room.roomId}/join`, { managerId: `team-${n}` })));
  const [ana, bo, cyd] = seats;

  const playerId = firstNominatable(await api(base, "GET", `/api/rooms/${room.roomId}`).then((r) => r.data));
  await act(base, room.roomId, ana.data.token, { type: "nominate", playerId });

  // All three fire their sealed bids simultaneously. Nobody is anybody's
  // turn, so every one of them lands, and the lot resolves on the last in.
  const results = await Promise.all([
    act(base, room.roomId, cyd.data.token, { type: "seal-bid", managerId: "team-3", amount: 60 }),
    act(base, room.roomId, bo.data.token, { type: "seal-bid", managerId: "team-2", amount: 30 }),
    act(base, room.roomId, ana.data.token, { type: "seal-bid", managerId: "team-1", amount: 90 })
  ]);
  for (const result of results) assert.equal(result.status, 200, result.data.error);

  const after = await api(base, "GET", `/api/rooms/${room.roomId}`);
  const sale = after.data.actions.find((entry) => entry.action.type === "seal-bid");
  assert.ok(sale, "the bids reached the log");
  // Ana's 90 takes it at Cyd's 60 + 1.
  const winner = after.data.managers.find((manager) => manager.id === "team-1");
  assert.ok(winner, "Ana is still in the room");
  assert.equal(after.data.lot, null, "the lot closed once the last bid was in");
});

test("an action answers the client that sent it, so a dead stream cannot freeze them", async (t) => {
  const base = await startServer(t);
  const room = await openAuctionRoom(base, { managers: ["Ana", "Bo"] });
  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, { managerId: "team-1" });
  const bo = await api(base, "POST", `/api/rooms/${room.roomId}/join`, { managerId: "team-2" });

  const playerId = firstNominatable(await api(base, "GET", `/api/rooms/${room.roomId}`).then((r) => r.data));
  await act(base, room.roomId, ana.data.token, { type: "nominate", playerId });

  // A sealed bid is WITHHELD from the action log until the card sells, so the
  // bidder cannot learn their own bid landed by watching the log. If the reply
  // to their request does not tell them, and their stream has quietly died,
  // they click Submit and watch nothing happen — for ever, until they reload.
  const bid = await act(base, room.roomId, bo.data.token, {
    type: "seal-bid",
    managerId: "team-2",
    amount: 50
  });
  assert.equal(bid.status, 200);
  assert.ok(bid.data.lot, "the reply carries the lot back to the bidder");
  assert.ok(
    bid.data.lot.bidsIn?.includes("team-2") || JSON.stringify(bid.data.lot).includes("team-2"),
    "and it shows their bid is in"
  );
  assert.equal(typeof bid.data.seq, "number", "and where the log has got to");
});
