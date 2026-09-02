import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer } from "../scripts/online-server.js";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { buildDraftPool, deckFromIds, setUniverse, universePool } from "../src/data/universes.js";
import {
  applyDraftAction,
  createDraft,
  currentManager,
  restoreSnakeClockState,
  snakeClockState
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

test("online room lifecycle: create, join, turn enforcement, replay parity", async (t) => {
  const base = await startServer(t);

  const created = await api(base, "POST", "/api/rooms", { seed: "online-test", managers: ["Ana", "Bo"] });
  assert.equal(created.status, 201);
  const roomId = created.data.roomId;
  assert.match(roomId, /^[a-z]+-[a-z]+-[a-z]+$/, "room codes are three readable words");
  assert.doesNotMatch(roomId, /\d/, "room codes do not contain digits");
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

  // Rewinding the room is the host's alone. Bo owns the last pick and still
  // cannot take it back — only Ana, who holds the host token, can.
  const boUndoAttempt = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: boJoin.data.token,
    action: { type: "undo" }
  });
  assert.equal(boUndoAttempt.status, 409);
  assert.match(boUndoAttempt.data.error, /only the host can undo/i);

  const hostUndo = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: anaJoin.data.token,
    action: { type: "undo" }
  });
  assert.equal(hostUndo.status, 200);

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

test("online rooms carry the configured rotation size into roster construction", async (t) => {
  const base = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "online-four-starters",
    managers: ["Ana", "Bo"],
    startingPitchers: 4
  });

  assert.equal(created.status, 201);
  assert.equal(created.data.startingPitchers, 4);
  assert.equal(created.data.rosterSize, 15);

  const joined = await api(base, "POST", `/api/rooms/${created.data.roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });
  const finish = await api(base, "POST", `/api/rooms/${created.data.roomId}/actions`, {
    token: joined.data.token,
    action: { type: "finish" }
  });
  assert.equal(finish.status, 200);

  const room = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  const pool = deckFromIds(room.data.universe, room.data.seed, room.data.deck);
  const replica = createDraft(
    room.data.managers.map((manager) => manager.name),
    pool,
    room.data.rosterSize,
    room.data.seed,
    { startingPitchers: room.data.startingPitchers }
  );
  for (const entry of room.data.actions) applyDraftAction(replica, entry.action);
  assert.ok(replica.managers.every((manager) =>
    manager.roster.filter((player) => player.kind === "pitcher" && player.role === "SP").length === 4
  ));
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
  const pool = buildDraftPool(room.data.universe, room.data.seed);
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

test("online rooms draft any card set, and the client rebuilds the same deck", async (t) => {
  const base = await startServer(t);

  const unknown = await api(base, "POST", "/api/rooms", {
    seed: "real-room",
    managers: ["A", "B"],
    universe: "franchise-SPACE-JAM"
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.data.error, /Unknown card set/);

  const tooMany = await api(base, "POST", "/api/rooms", {
    seed: "real-room",
    managers: Array.from({ length: 25 }, (_, index) => `M${index + 1}`),
    universe: "classic"
  });
  assert.equal(tooMany.status, 400);
  // Either guard may fire first: the deck-depth limit or the room-size cap (24).
  assert.match(tooMany.data.error, /managers/);

  const created = await api(base, "POST", "/api/rooms", {
    seed: "real-room",
    managers: ["A", "B"],
    universe: "franchise-SEA"
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.universe, "franchise-SEA");

  const seat = await api(base, "POST", `/api/rooms/${created.data.roomId}/join`, { managerId: "team-1" });
  const pick = await api(base, "POST", `/api/rooms/${created.data.roomId}/actions`, {
    token: seat.data.token,
    action: { type: "autopick" }
  });
  assert.equal(pick.status, 200);

  // The client deals its own copy of the room's deck from the universe key
  // and the seed, then replays the log — the same cards must be there.
  const room = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  const replica = createDraft(
    ["A", "B"],
    buildDraftPool(room.data.universe, room.data.seed),
    room.data.rosterSize,
    room.data.seed
  );
  for (const entry of room.data.actions) applyDraftAction(replica, entry.action);
  assert.equal(replica.managers[0].roster.length, 1);
});

// Room 69c5c6 died exactly here. It was dealt one evening, and half an hour
// later the code that deals a board changed; its seed then dealt a deck that
// did not hold the card its log had nominated, and the room could never be
// opened again. A room's board is now its own record, not a thing recomputed
// from the seed by whatever the dealing code happens to be today.
test("a room deals the deck it recorded, not the deck its seed would deal today", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const first = await startServer(t, dataDir);
  const created = await api(first, "POST", "/api/rooms", {
    seed: "pinned-deck",
    managers: ["Ana", "Bo"],
    universe: "fictional"
  });
  assert.equal(created.status, 201);
  const roomId = created.data.roomId;
  // persistRoom writes async; give the chained write a beat to land.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));

  const file = join(dataDir, `${roomId}.json`);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.ok(saved.deck?.length, "a new room writes down the board it dealt");

  // A card this seed's deal did NOT put on this board — the stand-in for every
  // card that a future change to the deal would add to it or drop from it. The
  // room holds this card for one reason: the room's own file says it does.
  setUniverse("pinned-deck", "fictional", { priceNoise: false });
  const dealt = new Set(saved.deck);
  const stranger = universePool().find((card) => card.kind === "hitter" && !dealt.has(card.id));
  assert.ok(stranger, "the universe runs deeper than the deck");

  saved.deck = [...saved.deck, stranger.id];
  saved.actions = [{ seq: 1, action: { type: "pick", playerId: stranger.id } }];
  await writeFile(file, JSON.stringify(saved));

  // A server that re-deals from the seed cannot replay that pick: the card is
  // not on the board the seed deals, so the pick throws and the room is skipped
  // on load — dead, and unopenable, which is precisely what went wrong before.
  const second = await startServer(t, dataDir);
  const room = await api(second, "GET", `/api/rooms/${roomId}`);
  assert.equal(room.status, 200, "the room survives a deal that no longer holds its cards");
  assert.ok(room.data.deck.includes(stranger.id));

  // And the board the room hands its clients is the same board, so a client
  // rebuilds the identical draft rather than dealing one of its own.
  const replica = createDraft(
    room.data.managers.map((manager) => ({ name: manager.name, cpu: Boolean(manager.cpu) })),
    deckFromIds(room.data.universe, room.data.seed, room.data.deck),
    room.data.rosterSize,
    room.data.seed
  );
  for (const entry of room.data.actions) applyDraftAction(replica, entry.action);
  assert.deepEqual(replica.managers[0].roster.map((card) => card.id), [stranger.id]);
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

test("a host's stale targeted autopick is a no-op, never a stolen human turn", async (t) => {
  const base = await startServer(t);
  // One human host and two computer seats — the shape that auto-fired a lone
  // human's own picks: the host drives the computers off its own view of the
  // clock, a resync lands it on a turn the room already left, and an untargeted
  // autopick from there picks for whoever is really up (the human).
  const created = await api(base, "POST", "/api/rooms", {
    seed: "stale-autopick",
    managers: ["Ana", "Robo1", "Robo2"],
    cpu: ["Robo1", "Robo2"]
  });
  const roomId = created.data.roomId;
  const ana = await api(base, "POST", `/api/rooms/${roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });

  const act = (action) => api(base, "POST", `/api/rooms/${roomId}/actions`, { token: ana.data.token, action });

  // Ana (team-1) is on the clock at the first pick. A targeted autopick that
  // names a computer seat — because the host's lagging client still thinks a
  // computer is up — must not advance the draft: it is dropped as a no-op.
  const stale = await act({ type: "autopick", managerId: "team-2" });
  assert.equal(stale.status, 200);
  assert.equal(stale.data.seq, 0, "a stale targeted autopick appends no action");
  let room = await api(base, "GET", `/api/rooms/${roomId}`);
  assert.equal(room.data.actions.length, 0, "Ana's live turn was not picked for");

  // Naming the seat that IS on the clock still works — this is how a real turn
  // (Ana's own timeout, or a computer the room is genuinely waiting on) resolves.
  const live = await act({ type: "autopick", managerId: "team-1" });
  assert.equal(live.status, 200);
  assert.equal(live.data.seq, 1);

  // With Ana's pick in, team-2 (Robo1) is up. A targeted drive for it lands.
  const cpu = await act({ type: "autopick", managerId: "team-2" });
  assert.equal(cpu.status, 200);
  assert.equal(cpu.data.seq, 2);

  // An untargeted autopick keeps its old "whoever is up" meaning, unchanged —
  // team-3 (Robo2) is on the clock and gets picked for.
  const untargeted = await act({ type: "autopick" });
  assert.equal(untargeted.status, 200);
  assert.equal(untargeted.data.seq, 3);
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

test("online snake chess clocks use server timestamps and authoritative snapshots", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const base = await startServer(t, dataDir);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "snake-clock-sync",
    managers: ["Ana", "Bo"],
    snakeTimer: { bankSeconds: 60, incrementSeconds: 10 }
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.actions[0].action.type, "start-clock");
  assert.ok(Number.isFinite(created.data.actions[0].action.at));
  assert.deepEqual(created.data.snakeClock.banks, { "team-1": 60000, "team-2": 60000 });

  const ana = await api(base, "POST", `/api/rooms/${created.data.roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });
  const picked = await api(base, "POST", `/api/rooms/${created.data.roomId}/actions`, {
    token: ana.data.token,
    // A browser's wall clock is untrusted. The room must replace this value.
    action: { type: "autopick", at: 1 }
  });
  assert.equal(picked.status, 200);

  const room = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  const pickAction = room.data.actions.find((entry) => entry.action.type === "autopick").action;
  assert.ok(Number.isFinite(pickAction.at));
  assert.notEqual(pickAction.at, 1, "the server replaces the browser timestamp");

  const rebuild = () => {
    const replica = createDraft(
      room.data.managers.map((manager) => ({ name: manager.name, cpu: manager.cpu })),
      deckFromIds(room.data.universe, room.data.seed, room.data.deck, room.data.temperature),
      room.data.rosterSize,
      room.data.seed,
      {
        startingPitchers: room.data.startingPitchers,
        snakeTimer: room.data.snakeTimer
      }
    );
    for (const entry of room.data.actions) applyDraftAction(replica, entry.action);
    return replica;
  };
  const firstReplica = rebuild();
  const secondReplica = rebuild();
  assert.deepEqual(snakeClockState(firstReplica), snakeClockState(secondReplica), "replays cannot drift");
  assert.deepEqual(firstReplica.clock.banks, room.data.snakeClock.banks);
  assert.equal(firstReplica.clock.turnStartedAt, room.data.snakeClock.turnStartedAt);

  // The settled state is persisted as a recovery point, not reconstructed from
  // whatever time the restarted process happens to replay the room.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  const restarted = await startServer(t, dataDir);
  const revived = await api(restarted, "GET", `/api/rooms/${created.data.roomId}`);
  const revivedReplica = rebuild();
  restoreSnakeClockState(revivedReplica, revived.data.snakeClock);
  assert.deepEqual(snakeClockState(revivedReplica), revived.data.snakeClock);
  assert.deepEqual(revived.data.snakeClock, room.data.snakeClock);
});

test("the room server expires snake chess clocks without a browser driving them", async (t) => {
  const base = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "snake-clock-expiry",
    managers: ["Ana", "Bo"],
    snakeTimer: { bankMs: 50, incrementMs: 100 }
  });
  assert.equal(created.status, 201);
  const startedAt = created.data.actions[0].action.at;

  // Nobody joins. The room itself owns the deadline and makes the expired
  // picks, just as a timed auction continues without a host tab backstopping it.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 175));
  const room = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  const timeouts = room.data.actions.filter(
    (entry) => entry.action.type === "autopick" && entry.action.timedOut
  );
  assert.ok(timeouts.length >= 1);
  assert.equal(timeouts[0].action.managerId, "team-1");
  assert.equal(timeouts[0].action.at, startedAt + 50);
  assert.equal(room.data.snakeClock.banks["team-1"], 100, "the timeout autopick awards the increment");
});

test("pausing an online snake room freezes its authoritative chess clock", async (t) => {
  const base = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "snake-clock-pause",
    managers: ["Ana", "Bo"],
    snakeTimer: { bankMs: 200, incrementMs: 0 }
  });
  const ana = await api(base, "POST", `/api/rooms/${created.data.roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  const pause = await api(base, "POST", `/api/rooms/${created.data.roomId}/actions`, {
    token: ana.data.token,
    action: { type: "pause", at: 1 }
  });
  assert.equal(pause.status, 200);
  const paused = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  assert.ok(Number.isFinite(paused.data.snakeClock.pausedAt));
  assert.notEqual(paused.data.snakeClock.pausedAt, 1, "the room stamps the pause");
  const frozen = paused.data.snakeClock.banks["team-1"];

  // Wait longer than the original bank. A leaked wall clock would flag Ana and
  // append an autopick; a real pause leaves both the bank and log untouched.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  const stillPaused = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  assert.equal(stillPaused.data.snakeClock.banks["team-1"], frozen);
  assert.equal(
    stillPaused.data.actions.some((entry) => entry.action.timedOut),
    false
  );

  const resume = await api(base, "POST", `/api/rooms/${created.data.roomId}/actions`, {
    token: ana.data.token,
    action: { type: "resume" }
  });
  assert.equal(resume.status, 200);
  const running = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  assert.equal(running.data.snakeClock.pausedAt, null);
});

test("the host can grant a manager time, and only the host can", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const base = await startServer(t, dataDir);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "snake-clock-grant",
    managers: ["Ana", "Bo"],
    snakeTimer: { bankMs: 60000, incrementMs: 0 }
  });
  const roomId = created.data.roomId;
  const ana = await api(base, "POST", `/api/rooms/${roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });
  const bo = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" });

  // Bo is a player, not the host, and cannot write himself a bank.
  const stolen = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: bo.data.token,
    action: { type: "grant-time", managerId: "team-2", ms: 240000 }
  });
  assert.equal(stolen.status, 409);
  assert.match(stolen.data.error, /Only the host can grant time/);

  // The room is stopped first — the ordinary way a repair is made — and the
  // grant still lands, unlike every other move on a paused draft.
  await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "pause" }
  });
  const before = await api(base, "GET", `/api/rooms/${roomId}`);
  const banked = before.data.snakeClock.banks["team-2"];

  const grant = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "grant-time", managerId: "team-2", ms: 240000 }
  });
  assert.equal(grant.status, 200);
  const after = await api(base, "GET", `/api/rooms/${roomId}`);
  assert.equal(after.data.snakeClock.banks["team-2"], banked + 240000);
  assert.equal(after.data.snakeClock.banks["team-1"], before.data.snakeClock.banks["team-1"]);

  // A grant is a logged action, so every replica derives the same bank the
  // server is holding — a browser replaying the log must not disagree.
  const replica = createDraft(
    after.data.managers.map((manager) => ({ name: manager.name, cpu: manager.cpu })),
    deckFromIds(after.data.universe, after.data.seed, after.data.deck, after.data.temperature),
    after.data.rosterSize,
    after.data.seed,
    {
      startingPitchers: after.data.startingPitchers,
      snakeTimer: after.data.snakeTimer
    }
  );
  for (const entry of after.data.actions) applyDraftAction(replica, entry.action);
  assert.equal(replica.clock.banks["team-2"], after.data.snakeClock.banks["team-2"]);

  // And it survives a restart, which is the point of putting it in the log.
  // Saves are chained off the request, so give the room a beat to reach disk.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  const restarted = await startServer(t, dataDir);
  const revived = await api(restarted, "GET", `/api/rooms/${roomId}`);
  assert.equal(revived.data.snakeClock.banks["team-2"], after.data.snakeClock.banks["team-2"]);

  // A bad grant is undone by its opposite; a bank never goes into debt.
  await api(restarted, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "grant-time", managerId: "team-2", ms: -999999999 }
  });
  const floored = await api(restarted, "GET", `/api/rooms/${roomId}`);
  assert.equal(floored.data.snakeClock.banks["team-2"], 0);
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

  // Restart: sim actions in the log must not break the draft replay. The
  // server's writes are a fire-and-forget chain, so wait until the last
  // action actually lands on disk instead of trusting a fixed sleep.
  const roomFile = join(dataDir, `${roomId}.json`);
  for (let tries = 0; tries < 80; tries += 1) {
    const onDisk = await readFile(roomFile, "utf8").then((raw) => JSON.parse(raw)).catch(() => null);
    if (onDisk?.actions?.length === room.data.actions.length) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
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

test("a room hands out an invite address other machines can actually reach", async (t) => {
  const base = await startServer(t);

  const created = await api(base, "POST", "/api/rooms", {
    seed: "wifi-night",
    managers: ["Ana", "Bo"],
    universe: "classic"
  });
  assert.equal(created.status, 201);

  const room = await api(base, "GET", `/api/rooms/${created.data.roomId}`);
  for (const origin of [created.data.lanOrigin, room.data.lanOrigin]) {
    // No LAN (a lone machine, every interface internal) is a legitimate answer;
    // the client falls back to whatever address it is already on. What must
    // never happen is handing out a loopback address, which means "your own
    // machine" to every guest it is sent to.
    if (origin === null) continue;
    assert.match(origin, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/, `not an address: ${origin}`);
    assert.doesNotMatch(origin, /127\.0\.0\.1|localhost/, "the invite address must not be loopback");
  }
});

test("the host can hand back a seat somebody has lost", async (t) => {
  const base = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", { seed: "lost-seat", managers: ["Ana", "Bo"] });
  const roomId = created.data.roomId;
  const hostToken = created.data.hostToken;

  const ana = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1", hostToken });
  assert.equal(ana.status, 200);

  // Ana's browser loses its storage — cleared, or she comes back on a
  // different address, which is a different localStorage. The seat is still
  // held server-side, by a token nobody has any more.
  const stranger = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1" });
  assert.equal(stranger.status, 409, "and no passer-by may simply take it");
  assert.match(stranger.data.error, /already claimed/);

  // The host hands it back. A fresh token comes with it.
  const reseated = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1", hostToken });
  assert.equal(reseated.status, 200);
  assert.equal(reseated.data.reseated, true);
  assert.notEqual(reseated.data.token, ana.data.token, "a new key, so the lost one is dead");

  // The orphaned token no longer works.
  const withOldToken = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "autopick" }
  });
  assert.equal(withOldToken.status, 403);

  // The new one does.
  const withNewToken = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: reseated.data.token,
    action: { type: "autopick" }
  });
  assert.equal(withNewToken.status, 200);
});

test("the host can pause a snake room, and nobody picks until it resumes", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const base = await startServer(t, dataDir);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "paused-snake",
    managers: ["Ana", "Bo"],
    pickTimer: 60
  });
  const roomId = created.data.roomId;
  const ana = await api(base, "POST", `/api/rooms/${roomId}/join`, {
    managerId: "team-1",
    hostToken: created.data.hostToken
  });
  const bo = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" });

  // The whistle is the host's in a snake room too — it was an auction-only
  // button, and a guest pressing it got told the room was the wrong kind.
  const guestPause = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: bo.data.token,
    action: { type: "pause" }
  });
  assert.equal(guestPause.status, 409);
  assert.match(guestPause.data.error, /Only the host can pause/);

  const paused = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "pause", remainingMs: 42000 }
  });
  assert.equal(paused.status, 200);

  // Ana is on the clock and cannot use it: the room is holding still.
  const pickWhilePaused = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "autopick" }
  });
  assert.equal(pickWhilePaused.status, 409);
  assert.equal(pickWhilePaused.data.error, "The draft is paused");

  const twice = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "pause" }
  });
  assert.equal(twice.status, 409);
  assert.match(twice.data.error, /already paused/);

  // Setting a lineup is not a move on the draft; a break is when people tinker.
  const lineup = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: bo.data.token,
    action: { type: "lineup", managerId: "team-2", assignments: {} }
  });
  assert.equal(lineup.status, 200);

  // The pause is in the shared log, carrying what was left on the clock, so
  // every replica stops on the same second — and comes back on it.
  const snapshot = await api(base, "GET", `/api/rooms/${roomId}`);
  const replica = createDraft(
    snapshot.data.managers.map((manager) => manager.name),
    deckFromIds(snapshot.data.universe, snapshot.data.seed, snapshot.data.deck),
    snapshot.data.rosterSize,
    snapshot.data.seed
  );
  for (const entry of snapshot.data.actions) applyDraftAction(replica, entry.action);
  assert.notEqual(replica.pausedAt, null, "the replica is paused too");
  assert.equal(replica.pausedRemainingMs, 42000, "and holding the clock it stopped");

  // A room that comes back from a restart comes back paused.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  const second = await startServer(t, dataDir);
  const stillPaused = await api(second, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "autopick" }
  });
  assert.equal(stillPaused.data.error, "The draft is paused");

  const guestResume = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: bo.data.token,
    action: { type: "resume" }
  });
  assert.equal(guestResume.status, 409);

  assert.equal((await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "resume" }
  })).status, 200);

  const picked = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: ana.data.token,
    action: { type: "autopick" }
  });
  assert.equal(picked.status, 200, "the room is running again");

  const after = await api(base, "GET", `/api/rooms/${roomId}`);
  const resumed = createDraft(
    after.data.managers.map((manager) => manager.name),
    deckFromIds(after.data.universe, after.data.seed, after.data.deck),
    after.data.rosterSize,
    after.data.seed
  );
  for (const entry of after.data.actions) applyDraftAction(resumed, entry.action);
  assert.equal(resumed.pausedAt, null);
  assert.equal(resumed.pausedRemainingMs, null, "the resume hands the remainder back exactly once");
  assert.equal(resumed.managers[0].roster.length, 1);
});

// A club sum comes back nought when nobody did the thing, and MOST STEALS IN A
// GAME is read straight off it — so a manager who had never stolen a base was
// filed as a holder of the steals record. An old client with the page cached will
// go on sending those, so the gate is on this end too.
test("the record book turns away a nought where a nought is not a record", async (t) => {
  const base = await startServer(t);
  const board = async (key) => (await api(base, "GET", "/api/records")).data.records[key];

  const empty = await api(base, "POST", "/api/records", {
    name: "NIL", saveSeed: "sq-nil", mode: "budget",
    records: { "steals-game": { value: 0, day: 1, opponent: "JOJO" } }
  });
  assert.equal(empty.status, 400, "a club that never stole a base filed nothing");
  assert.equal(await board("steals-game"), undefined, "and the board stays empty behind it");

  // The LOW records are the other way round: nought hits allowed in a win is the
  // best afternoon a staff can have, and it is the mark.
  const clean = await api(base, "POST", "/api/records", {
    name: "ANA", saveSeed: "sq-ana", mode: "budget",
    records: { "hits-allowed-win": { value: 0, day: 4, opponent: "PETRA" } }
  });
  assert.equal(clean.status, 201);
  assert.equal((await board("hits-allowed-win"))[0].value, 0, "a no-hit win is a record, and its number is nought");

  // One steal is.
  await api(base, "POST", "/api/records", {
    name: "BO", saveSeed: "sq-bo", mode: "budget",
    records: { "steals-game": { value: 1, day: 2, opponent: "MABEL" } }
  });
  assert.equal((await board("steals-game"))[0].value, 1);
});

test("a resubmitted plaque amends the board without improving its ranking figure", async (t) => {
  const base = await startServer(t);
  const seed = "amend-1";
  const entry = {
    saveSeed: seed, name: "SKY", mode: "budget", universe: "classic",
    finishedAt: 1720000000000, days: 54, wins: 29, losses: 25,
    battlesWon: 12, battlesLost: 10, badges: [], rosterPoints: 5000,
    roster: [], hitters: [], pitchers: []
  };
  assert.equal((await api(base, "POST", "/api/hall-of-fame", entry)).status, 201);
  const board = async () => (await api(base, "GET", "/api/hall-of-fame")).data.entries.find((e) => e.saveSeed === seed);

  // The same campaign coming back as what it actually was: a gauntlet sweep the
  // old server filed as a budget run because it had never heard of the mode.
  const again = await api(base, "POST", "/api/hall-of-fame", {
    ...entry, mode: "gauntlet", gauntletTier: "immortal",
    gauntletCleared: 6, gauntletTotal: 6, gauntletAttempts: 11
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.amended, true, "the amendment landed");
  assert.equal((await board()).mode, "gauntlet", "and the plaque is filed where it belongs");
  assert.equal((await board()).gauntletCleared, 6);
  assert.equal((await board()).gauntletSwept, true);
  assert.equal((await board()).days, 54, "the campaign's clock is still its own");

  // A resubmission cannot claim a better clock...
  await api(base, "POST", "/api/hall-of-fame", { ...entry, mode: "gauntlet", gauntletTier: "immortal", gauntletCleared: 6, days: 1 });
  assert.equal((await board()).days, 54, "one day is not a thing you get to claim later");

  // ...nor walk a run's depth backwards.
  await api(base, "POST", "/api/hall-of-fame", { ...entry, mode: "gauntlet", gauntletTier: "immortal", gauntletCleared: 2 });
  assert.equal((await board()).gauntletCleared, 6, "a stale device cannot erase how far you got");

  // One plaque throughout.
  const all = (await api(base, "GET", "/api/hall-of-fame")).data.entries.filter((e) => e.saveSeed === seed);
  assert.equal(all.length, 1);
});

test("the boards take a gauntlet run on its own terms: its mode, its depth, its tier", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-rooms-"));
  const base = await startServer(t, dataDir);

  const run = (saveSeed, name, cleared, days) => ({
    saveSeed, name, mode: "gauntlet", universe: "classic", finishedAt: 1720000000000,
    days, wins: cleared * 2, losses: 2, battlesWon: cleared, battlesLost: 1, badges: [],
    rosterPoints: 5000, gauntletTier: "immortal", gauntletCleared: cleared,
    gauntletTotal: 6, gauntletAttempts: 3, roster: [], hitters: [], pitchers: []
  });

  const filed = await api(base, "POST", "/api/hall-of-fame", run("g-1", "WALL", 4, 40));
  assert.equal(filed.status, 201);
  const [stored] = (await api(base, "GET", "/api/hall-of-fame")).data.entries;
  assert.equal(stored.mode, "gauntlet", "a gauntlet run is not filed as a budget one");
  assert.equal(stored.gauntletCleared, 4, "and its depth survives the trip");
  assert.equal(stored.gauntletTier, "immortal");
  assert.equal(stored.gauntletSwept, false);

  // A made-up tier lands on the default; a depth past the total is clamped.
  await api(base, "POST", "/api/hall-of-fame", {
    ...run("g-liar", "LIAR", 99, 1), gauntletTier: "godlike"
  });
  const liar = (await api(base, "GET", "/api/hall-of-fame")).data.entries.find((e) => e.saveSeed === "g-liar");
  assert.equal(liar.gauntletTier, "elite", "an invented tier is not a tier");
  assert.equal(liar.gauntletCleared, 6, "and you cannot clear more clubs than there are");

  // The gauntlet board ranks on depth. A manager who lost round one in two days
  // is not ahead of one who got to the fifth club.
  await api(base, "POST", "/api/hall-of-fame", run("g-quick", "QUICK", 1, 2));
  const ranked = (await api(base, "GET", "/api/hall-of-fame")).data.entries
    .filter((entry) => entry.mode === "gauntlet")
    .map((entry) => entry.name);
  assert.equal(ranked[ranked.length - 1], "QUICK", "the shallowest run is last, whatever its clock");

  // And the record book knows the three tier boards.
  const posted = await api(base, "POST", "/api/records", {
    name: "WALL", saveSeed: "g-1", mode: "gauntlet",
    records: { "deepest-gauntlet-immortal": { value: 4, at: 1720000000000 } }
  });
  assert.equal(posted.status, 201, "a gauntlet depth is a record the server has heard of");
  const board = (await api(base, "GET", "/api/records")).data.records["deepest-gauntlet-immortal"];
  assert.equal(board[0].value, 4);
  assert.equal(board[0].name, "WALL");

  // Nobody cleared is nobody beaten.
  const nought = await api(base, "POST", "/api/records", {
    name: "NIL", saveSeed: "g-nil", mode: "gauntlet",
    records: { "deepest-gauntlet-immortal": { value: 0, at: 1720000000000 } }
  });
  assert.equal(nought.status, 400, "turning up is not a mark");
});

// A record is a number, a name, and a DAY, and the day has to survive being
// looked at. The book goes up again on every visit to the records screen, so a
// mark you already hold arrives over and over — restamping it made every standing
// record read as though it had been set this morning.
test("the record book keeps the day a mark was set, not the day it was last sent", async (t) => {
  const base = await startServer(t);

  const file = async (records, extra = {}) => api(base, "POST", "/api/records", {
    name: "ANA", saveSeed: "sq-ana", mode: "budget", records, ...extra
  });
  const board = async (key) => (await api(base, "GET", "/api/records")).data.records[key];

  // Set in April, and the client says so.
  const april = Date.UTC(2026, 3, 2);
  assert.equal((await file({ "runs-game": { value: 12, day: 7, opponent: "JOJO", at: april } })).status, 201);
  assert.equal((await board("runs-game"))[0].at, april, "the day it was set is the day that is filed");

  // The same twelve, sent up again on a later visit. Same record, same day.
  await file({ "runs-game": { value: 12, day: 7, opponent: "JOJO", at: Date.now() } });
  assert.equal((await board("runs-game"))[0].value, 12);
  assert.equal((await board("runs-game"))[0].at, april, "resending a mark you already hold does not redate it");

  // Beating it is a new record, and gets its own day.
  const may = Date.UTC(2026, 4, 9);
  await file({ "runs-game": { value: 15, day: 20, opponent: "MABEL", at: may } });
  const beaten = (await board("runs-game"))[0];
  assert.equal(beaten.value, 15);
  assert.equal(beaten.at, may, "and beating it stamps the day you beat it");

  // A day nobody could have set it on is not evidence of anything: the book
  // falls back to the day it heard about it.
  const before = Date.now();
  await api(base, "POST", "/api/records", {
    name: "BO", saveSeed: "sq-bo", mode: "budget",
    records: { "runs-game": { value: 9, day: 1, opponent: "PETRA", at: Date.now() + 86_400_000 } }
  });
  const bo = (await board("runs-game")).find((row) => row.name === "BO");
  assert.ok(bo.at >= before && bo.at <= Date.now(), "a date in the future is filed as today");
});
