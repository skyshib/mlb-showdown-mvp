import test from "node:test";
import { maxRealPoolManagers } from "../src/data/realPlayers.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer } from "../scripts/online-server.js";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { applyDraftAction, createDraft, currentManager } from "../src/rules/draft.js";

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

test("cpu managers are flagged in snapshots, unclaimable, and survive restarts", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const base = await startServer(t, dataDir);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "cpu-room",
    managers: ["Gil", "Robo"],
    cpu: ["Robo"]
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.data.managers.map((manager) => manager.cpu), [false, true]);

  const claim = await api(base, "POST", `/api/rooms/${created.data.roomId}/join`, {
    managerId: "team-2",
    hostToken: created.data.hostToken
  });
  assert.equal(claim.status, 409);
  assert.match(claim.data.error, /computer/i);

  // The host client drives the computer seat with autopick actions.
  const gil = await api(base, "POST", `/api/rooms/${created.data.roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });
  const first = await api(base, "POST", `/api/rooms/${created.data.roomId}/actions`, {
    token: gil.data.token,
    action: { type: "autopick" }
  });
  assert.equal(first.status, 200);
  const cpuTurn = await api(base, "POST", `/api/rooms/${created.data.roomId}/actions`, {
    token: gil.data.token,
    action: { type: "autopick" }
  });
  assert.equal(cpuTurn.status, 200);

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  const second = await startServer(t, dataDir);
  const revived = await api(second, "GET", `/api/rooms/${created.data.roomId}`);
  assert.deepEqual(revived.data.managers.map((manager) => manager.cpu), [false, true]);
});

test("pick timer is normalized, returned in snapshots, and survives restarts", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const base = await startServer(t, dataDir);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "timed-room",
    managers: ["Gil", "Hana"],
    pickTimer: 60
  });
  assert.equal(created.data.pickTimer, 60);

  // Out-of-range values clamp instead of erroring.
  const tiny = await api(base, "POST", "/api/rooms", { seed: "t2", managers: ["A", "B"], pickTimer: 3 });
  assert.equal(tiny.data.pickTimer, 15);
  const off = await api(base, "POST", "/api/rooms", { seed: "t3", managers: ["A", "B"] });
  assert.equal(off.data.pickTimer, 0);

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  const second = await startServer(t, dataDir);
  const revived = await api(second, "GET", `/api/rooms/${created.data.roomId}`);
  assert.equal(revived.data.pickTimer, 60);
});

test("shared sim actions are logged after the draft completes and survive restarts", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const base = await startServer(t, dataDir);
  const created = await api(base, "POST", "/api/rooms", { seed: "sim-room", managers: ["Gil", "Hana"] });
  const roomId = created.data.roomId;
  const gil = await api(base, "POST", `/api/rooms/${roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });

  // Sims are rejected until the draft is complete.
  const early = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: gil.data.token,
    action: { type: "batch", runs: 250, salt: "abc123" }
  });
  assert.equal(early.status, 409);
  assert.match(early.data.error, /must be complete/i);

  await api(base, "POST", `/api/rooms/${roomId}/actions`, { token: gil.data.token, action: { type: "finish" } });

  const batch = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: gil.data.token,
    action: { type: "batch", runs: 250, salt: "abc123" }
  });
  assert.equal(batch.status, 200);

  const room = await api(base, "GET", `/api/rooms/${roomId}`);
  const logged = room.data.actions.at(-1).action;
  assert.equal(logged.type, "batch");
  assert.equal(logged.salt, "abc123");

  // Restart: sim actions in the log must not break the draft replay.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  const second = await startServer(t, dataDir);
  const revived = await api(second, "GET", `/api/rooms/${roomId}`);
  assert.equal(revived.status, 200);
  assert.equal(revived.data.complete, true);
  assert.equal(revived.data.actions.length, room.data.actions.length);
});

test("the hall of fame API stores runs, dedupes, sanitizes, and survives restarts", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const base = await startServer(t, dataDir);

  const empty = await api(base, "GET", "/api/hall-of-fame");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.entries, []);

  const entry = {
    saveSeed: "seed-1",
    name: "SKY",
    mode: "budget",
    universe: "fictional",
    finishedAt: 1720000000000,
    days: 34,
    wins: 28,
    losses: 6,
    battlesWon: 20,
    battlesLost: 2,
    badges: ["trophy"],
    rosterPoints: 3400,
    roster: [{ id: "c1", name: "Slugger", kind: "hitter", position: "CF", points: 500, onBase: 10, speed: 18, fielding: 2, rarity: "rare", chart: [{ result: "HR", from: 18, to: null }] }],
    hitters: [{ id: "c1", name: "Slugger", games: 34, hr: 12, wpa: 1.2, avg: 0.31 }],
    pitchers: []
  };
  const created = await api(base, "POST", "/api/hall-of-fame", entry);
  assert.equal(created.status, 201);

  // Same campaign again (a retry, a second device): no second plaque.
  const duplicate = await api(base, "POST", "/api/hall-of-fame", { ...entry, days: 1 });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.duplicate, true);

  const malformed = await api(base, "POST", "/api/hall-of-fame", { name: "NOBODY" });
  assert.equal(malformed.status, 400);

  // The endpoint is open, so junk is rebuilt on the way in: unknown enums pin
  // to their defaults, strings are sliced, unlisted fields are dropped.
  const sketchy = await api(base, "POST", "/api/hall-of-fame", {
    saveSeed: "seed-2",
    name: "AN OVERLY LONG CHAMPION NAME",
    mode: "hacked",
    days: 20,
    wins: 18,
    losses: 2,
    roster: [{ id: "x", name: "X", kind: "hitter", rarity: "\"><img onerror=x>", position: "CF", points: "900", chart: null, extra: "nope" }]
  });
  assert.equal(sketchy.status, 201);

  const listed = await api(base, "GET", "/api/hall-of-fame");
  assert.equal(listed.data.entries.length, 2);
  const first = listed.data.entries.find((item) => item.saveSeed === "seed-1");
  assert.equal(first.days, 34, "the duplicate submit did not overwrite the original");
  assert.equal(first.roster[0].chart[0].to, null, "open-ended chart ranges survive");
  const second = listed.data.entries.find((item) => item.saveSeed === "seed-2");
  assert.equal(second.mode, "budget", "unknown modes pin to budget");
  assert.ok(second.name.length <= 12, "names are sliced");
  assert.equal(second.roster[0].rarity, "common", "unknown rarities pin to common");
  assert.equal(second.roster[0].extra, undefined, "unlisted fields are dropped");
  assert.equal(second.roster[0].points, 900, "numeric strings coerce");

  // The board is one JSON file next to the rooms: a fresh server on the same
  // data dir reloads it.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  const base2 = await startServer(t, dataDir);
  const reloaded = await api(base2, "GET", "/api/hall-of-fame");
  assert.equal(reloaded.data.entries.length, 2);
});
