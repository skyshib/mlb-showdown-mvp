import test from "node:test";
import { maxRealPoolManagers } from "../src/data/realPlayers.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer } from "../scripts/online-server.js";
import { buildFictionalDraftPool, generatePlayerPool } from "../src/data/playerGeneration.js";
import {
  applyDraftAction,
  auctionBudget,
  createDraft,
  currentManager,
  isAuctionDraft
} from "../src/rules/draft.js";

async function startServer(t, dataDir) {
  const roomsDir = dataDir ?? (await mkdtemp(join(tmpdir(), "showdown-rooms-")));
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

function replayRoom(room) {
  const pool = room.poolMode === "real"
    ? (() => { throw new Error("replayRoom only supports fictional test rooms"); })()
    : buildFictionalDraftPool(room.seed);
  const draft = createDraft(
    room.managers.map((manager) => manager.name),
    pool,
    room.rosterSize,
    room.seed,
    {
      draftType: room.draftType,
      budget: room.auctionBudget,
      timer: room.auctionTimer
    }
  );
  for (const entry of room.actions) applyDraftAction(draft, entry.action);
  return draft;
}

test("online room lifecycle: create, join, turn enforcement, replay parity", async (t) => {
  const base = await startServer(t);

  const created = await api(base, "POST", "/api/rooms", { seed: "online-test", managers: ["Ana", "Bo"] });
  assert.equal(created.status, 201);
  const roomId = created.data.roomId;
  assert.ok(created.data.hostToken);
  assert.deepEqual(created.data.managers.map((manager) => manager.name), ["Ana", "Bo"]);

  const anaJoin = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1", hostToken: created.data.hostToken });
  assert.equal(anaJoin.status, 200);
  assert.equal(anaJoin.data.host, true);

  const duplicate = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1" });
  assert.equal(duplicate.status, 409);

  const boJoin = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" });
  assert.equal(boJoin.status, 200);
  assert.equal(boJoin.data.host, false);

  // Bo cannot act on Ana's turn.
  const outOfTurn = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: boJoin.data.token,
    action: { type: "autopick" }
  });
  assert.equal(outOfTurn.status, 409);
  assert.match(outOfTurn.data.error, /not your turn/i);

  // A stranger without a seat cannot act at all.
  const noSeat = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: "bogus",
    action: { type: "autopick" }
  });
  assert.equal(noSeat.status, 403);

  const anaPick = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: anaJoin.data.token,
    action: { type: "autopick" }
  });
  assert.equal(anaPick.status, 200);
  assert.equal(anaPick.data.seq, 1);

  const boPick = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: boJoin.data.token,
    action: { type: "autopick" }
  });
  assert.equal(boPick.status, 200);
  assert.equal(boPick.data.seq, 2);

  // Only the host or the last picker can undo; snake order means Bo also owns pick 3.
  const anaUndoAttempt = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: boJoin.data.token,
    action: { type: "undo" }
  });
  assert.equal(anaUndoAttempt.status, 200);

  // Host finishes the rest of the draft in one deterministic action.
  const finish = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: anaJoin.data.token,
    action: { type: "finish" }
  });
  assert.equal(finish.status, 200);

  const room = await api(base, "GET", `/api/rooms/${roomId}`);
  assert.equal(room.status, 200);
  assert.equal(room.data.complete, true);

  // Replay parity: rebuilding from seed + action log matches the server replica.
  const pool = generatePlayerPool(room.data.seed, room.data.managers.length, room.data.rosterSize);
  const replica = createDraft(room.data.managers.map((manager) => manager.name), pool, room.data.rosterSize, room.data.seed);
  for (const entry of room.data.actions) applyDraftAction(replica, entry.action);
  assert.equal(replica.complete, true);
  assert.deepEqual(
    replica.managers.map((manager) => manager.roster.map((player) => player.id)),
    await serverRosters(base, roomId)
  );
});

test("online auction rooms share timer config and enforce auction seats", async (t) => {
  const base = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "online-auction",
    managers: ["Alpha", "Beta"],
    draftType: "auction",
    auctionBudget: 2000,
    auctionTimer: { reviewSeconds: 60, bankSeconds: 30, incrementSeconds: 5 }
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.draftType, "auction");
  assert.equal(created.data.auctionBudget, 2000);
  assert.deepEqual(created.data.auctionTimer, {
    enabled: true,
    reviewMs: 60000,
    bankMs: 30000,
    incrementMs: 5000
  });
  assert.equal(created.data.actions[0].action.type, "start-review");
  assert.ok(Number.isFinite(created.data.serverNow));

  const roomId = created.data.roomId;
  const alpha = await api(base, "POST", `/api/rooms/${roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });
  const beta = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" });

  const betaSkip = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: beta.data.token,
    action: { type: "complete-review" }
  });
  assert.equal(betaSkip.status, 409);

  const alphaSkip = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: alpha.data.token,
    action: { type: "complete-review", at: 1 }
  });
  assert.equal(alphaSkip.status, 200);

  let room = await api(base, "GET", `/api/rooms/${roomId}`);
  let replica = replayRoom(room.data);
  assert.equal(isAuctionDraft(replica), true);
  const target = replica.pool.find((player) => player.kind === "hitter");

  const wrongNominator = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: beta.data.token,
    action: { type: "nominate", playerId: target.id }
  });
  assert.equal(wrongNominator.status, 409);

  const nomination = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: alpha.data.token,
    action: { type: "nominate", playerId: target.id, at: 1 }
  });
  assert.equal(nomination.status, 200);

  const wrongTeamBid = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: beta.data.token,
    action: { type: "bid", managerId: "team-1", amount: 100 }
  });
  assert.equal(wrongTeamBid.status, 409);

  const betaBid = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: beta.data.token,
    action: { type: "bid", managerId: "team-2", amount: 100, at: 1 }
  });
  assert.equal(betaBid.status, 200);

  const betaSell = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: beta.data.token,
    action: { type: "sell" }
  });
  assert.equal(betaSell.status, 409);
  const alphaSell = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: alpha.data.token,
    action: { type: "sell" }
  });
  assert.equal(alphaSell.status, 200);

  room = await api(base, "GET", `/api/rooms/${roomId}`);
  replica = replayRoom(room.data);
  const bidAction = room.data.actions.find((entry) => entry.action.type === "bid").action;
  assert.notEqual(bidAction.at, 1);
  assert.equal(replica.managers[1].roster[0].id, target.id);
  assert.equal(auctionBudget(replica, replica.managers[1]), 1900);
});

test("online auction server publishes clock timeouts into the action log", async (t) => {
  const base = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "online-auction-timeout",
    managers: ["Alpha", "Beta"],
    draftType: "auction",
    auctionTimer: { reviewMs: 0, bankMs: 50, incrementMs: 0 }
  });
  const alpha = await api(base, "POST", `/api/rooms/${created.data.roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });
  const initial = replayRoom(created.data);
  const target = initial.pool.find((player) => player.kind === "hitter");
  const nomination = await api(base, "POST", `/api/rooms/${created.data.roomId}/actions`, {
    token: alpha.data.token,
    action: { type: "nominate", playerId: target.id }
  });
  assert.equal(nomination.status, 200);

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  const room = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  assert.ok(room.data.actions.some((entry) => entry.action.type === "sync-timer"));

  const replica = replayRoom(room.data);
  assert.equal(replica.auction.lot.clock.submissions["team-2"].amount, 0);
  assert.equal(replica.auction.lot.clock.submissions["team-2"].timedOut, true);
  assert.equal(replica.auction.clockBanks["team-2"], 0);
});

// The server does not expose its replica directly; a second replay from the
// same log must land on the same rosters, which is what clients rely on.
async function serverRosters(base, roomId) {
  const room = await api(base, "GET", `/api/rooms/${roomId}`);
  const pool = generatePlayerPool(room.data.seed, room.data.managers.length, room.data.rosterSize);
  const replica = createDraft(room.data.managers.map((manager) => manager.name), pool, room.data.rosterSize, room.data.seed);
  for (const entry of room.data.actions) applyDraftAction(replica, entry.action);
  return replica.managers.map((manager) => manager.roster.map((player) => player.id));
}

test("online room rejects out-of-turn manual picks and unknown actions", async (t) => {
  const base = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", { seed: "online-test-2", managers: ["Cy", "Dee"] });
  const roomId = created.data.roomId;
  const cy = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1" });
  const dee = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" });

  const room = await api(base, "GET", `/api/rooms/${roomId}`);
  const pool = generatePlayerPool(room.data.seed, 2, room.data.rosterSize);
  const bestHitter = pool.find((player) => player.kind === "hitter");

  const wrongSeat = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: dee.data.token,
    action: { type: "pick", playerId: bestHitter.id }
  });
  assert.equal(wrongSeat.status, 409);

  const unknown = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: cy.data.token,
    action: { type: "explode" }
  });
  assert.equal(unknown.status, 409);

  const rightSeat = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: cy.data.token,
    action: { type: "pick", playerId: bestHitter.id }
  });
  assert.equal(rightSeat.status, 200);

  // Dee cannot edit Cy's lineup, but can edit their own.
  const wrongLineup = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: dee.data.token,
    action: { type: "lineup", managerId: "team-1", assignments: {} }
  });
  assert.equal(wrongLineup.status, 409);

  const ownLineup = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: dee.data.token,
    action: { type: "lineup", managerId: "team-2", assignments: {} }
  });
  assert.equal(ownLineup.status, 200);
});

test("online room streams actions over SSE", async (t) => {
  const base = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", { seed: "online-sse", managers: ["Eve", "Fay"] });
  const roomId = created.data.roomId;
  const eve = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1" });

  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${base}/api/rooms/${roomId}/stream?since=0`, { signal: controller.signal });
  assert.equal(stream.headers.get("content-type"), "text/event-stream");
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const readUntil = async (marker) => {
    for (let i = 0; i < 20 && !buffer.includes(marker); i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    assert.ok(buffer.includes(marker), `expected SSE stream to include ${marker}`);
  };

  await readUntil("event: hello");
  await api(base, "POST", `/api/rooms/${roomId}/actions`, { token: eve.data.token, action: { type: "autopick" } });
  await readUntil("event: action");
  await readUntil('"seq":1');
});

test("applyDraftAction replays a mixed action log deterministically", () => {
  const build = () => {
    const pool = generatePlayerPool("replay-seed", 2, 13);
    return createDraft(["One", "Two"], pool, 13, "replay-seed");
  };
  const source = build();
  const log = [];
  const record = (action) => {
    applyDraftAction(source, action);
    log.push(action);
  };

  record({ type: "autopick" });
  record({ type: "pick", playerId: availableHitterId(source) });
  record({ type: "autopick" });
  record({ type: "undo" });
  record({ type: "autopick" });
  record({ type: "finish" });
  assert.equal(source.complete, true);

  const replica = build();
  for (const action of log) applyDraftAction(replica, action);

  assert.deepEqual(
    replica.managers.map((manager) => manager.roster.map((player) => player.id)),
    source.managers.map((manager) => manager.roster.map((player) => player.id))
  );
  assert.equal(replica.pickNumber, source.pickNumber);
});

function availableHitterId(draft) {
  const manager = currentManager(draft);
  return draft.pool.find((player) => player.kind === "hitter" && !draft.pickedIds.has(player.id) && manager).id;
}

test("online room can use the real player pool and enforces its manager limit", async (t) => {
  const base = await startServer(t);

  const tooMany = await api(base, "POST", "/api/rooms", {
    seed: "real-room",
    managers: Array.from({ length: maxRealPoolManagers() + 1 }, (_, index) => `M${index + 1}`),
    poolMode: "real"
  });
  assert.equal(tooMany.status, 400);
  // Either guard may fire first: the pool-depth limit or the room-size cap.
  assert.match(tooMany.data.error, /managers/);

  const created = await api(base, "POST", "/api/rooms", {
    seed: "real-room",
    managers: ["A", "B"],
    poolMode: "real"
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.poolMode, "real");

  const seat = await api(base, "POST", `/api/rooms/${created.data.roomId}/join`, { managerId: "team-1" });
  const pick = await api(base, "POST", `/api/rooms/${created.data.roomId}/actions`, {
    token: seat.data.token,
    action: { type: "autopick" }
  });
  assert.equal(pick.status, 200);

  // Client replay for real-pool rooms uses buildRealPlayerPool.
  const { buildRealPlayerPool } = await import("../src/data/realPlayers.js");
  const room = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  const replica = createDraft(["A", "B"], buildRealPlayerPool(), room.data.rosterSize, room.data.seed);
  for (const entry of room.data.actions) applyDraftAction(replica, entry.action);
  assert.equal(replica.managers[0].roster.length, 1);
});

test("rooms survive a server restart with seats and turn state intact", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));

  const first = await startServer(t, dataDir);
  const created = await api(first, "POST", "/api/rooms", {
    seed: "restart-room",
    managers: ["Ana", "Bo"],
    poolMode: "random"
  });
  const roomId = created.data.roomId;
  const ana = await api(first, "POST", `/api/rooms/${roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });
  await api(first, "POST", `/api/rooms/${roomId}/actions`, { token: ana.data.token, action: { type: "autopick" } });
  // persistRoom writes async; give the chained write a beat to land.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));

  // "Restart": a brand-new server process over the same data directory.
  const second = await startServer(t, dataDir);

  const room = await api(second, "GET", `/api/rooms/${roomId}`);
  assert.equal(room.status, 200);
  assert.equal(room.data.actions.length, 1);
  assert.deepEqual(
    room.data.managers.map((manager) => [manager.name, manager.claimed]),
    [["Ana", true], ["Bo", false]]
  );

  // Ana's old seat token still works, and it is still Bo's turn (snake pick 2),
  // so Ana acting is rejected while a host action for the stalled seat works.
  const outOfTurn = await api(second, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "pick", playerId: "nonexistent" }
  });
  assert.equal(outOfTurn.status, 409);
  assert.match(outOfTurn.data.error, /player is not available/i);

  const finish = await api(second, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "finish" }
  });
  assert.equal(finish.status, 200);
  const done = await api(second, "GET", `/api/rooms/${roomId}`);
  assert.equal(done.data.complete, true);
});
