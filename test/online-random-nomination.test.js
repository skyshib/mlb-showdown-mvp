import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer } from "../scripts/online-server.js";
import { buildDraftPool } from "../src/data/universes.js";
import {
  applyDraftAction,
  createDraft,
  SIM_ACTION_TYPES,
  validateRoster
} from "../src/rules/draft.js";

async function startServer(t, dataDir) {
  const roomsDir = dataDir ?? (await mkdtemp(join(tmpdir(), "showdown-random-nom-")));
  const { server } = createOnlineServer({ dataDir: roomsDir });
  server.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());
  return { base, roomsDir };
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

const SEED = "random-nomination-room";

// Rooms save asynchronously, so a fresh server started the instant the first one
// answers can read a half-written action log. Wait for the file to catch up.
async function settled(roomsDir, roomId, actionCount) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const saved = JSON.parse(await readFile(join(roomsDir, `${roomId}.json`), "utf8"));
    if (saved.actions.length >= actionCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the room never finished saving");
}

async function openRoom(base, options = {}) {
  const created = await api(base, "POST", "/api/rooms", {
    seed: SEED,
    managers: options.managers ?? ["Ana", "Bo", "Cy"],
    universe: "classic",
    draftType: "auction",
    nomination: "random",
    budget: options.budget ?? 5000,
    cpu: options.cpu ?? []
  });
  return created;
}

// Rebuilds the draft the way a browser does: deal the same board off the seed,
// then replay the shared action log.
function replay(room) {
  const draft = createDraft(
    room.managers.map((manager) => ({ name: manager.name, cpu: manager.cpu })),
    buildDraftPool(room.universe, room.seed, {
      nomination: room.nomination,
      managerCount: room.managers.length
    }),
    room.rosterSize,
    room.seed,
    { draftType: room.draftType, nomination: room.nomination, budget: room.auctionBudget }
  );
  for (const entry of room.actions) {
    if (!SIM_ACTION_TYPES.has(entry.action?.type)) applyDraftAction(draft, entry.action);
  }
  return draft;
}

test("a random-nomination room opens with a card already on the block", async (t) => {
  const { base } = await startServer(t);
  const created = await openRoom(base);
  assert.equal(created.status, 201);

  const room = created.data;
  assert.equal(room.nomination, "random");
  // Nobody nominated it — the queue dealt it before anyone even joined.
  assert.ok(room.lot, "no card on the block");
  assert.equal(room.lot.nominatorId, null);

  const draft = replay(room);
  assert.equal(draft.auction.lot.playerId, room.lot.playerId);
});

test("no manager may nominate, and the card on the block cannot be cancelled", async (t) => {
  const { base } = await startServer(t);
  const room = (await openRoom(base)).data;
  const ana = await api(base, "POST", `/api/rooms/${room.roomId}/join`, {
    managerId: room.managers[0].id,
    name: "Ana"
  });
  const token = ana.data.token;
  const pool = buildDraftPool(room.universe, room.seed, {
    nomination: room.nomination,
    managerCount: room.managers.length
  });

  const nominate = await api(base, "POST", `/api/rooms/${room.roomId}/actions`, {
    token,
    action: { type: "nominate", playerId: pool[0].id }
  });
  assert.equal(nominate.status, 409);
  assert.match(nominate.data.error, /queue nominates/);

  const cancel = await api(base, "POST", `/api/rooms/${room.roomId}/actions`, {
    token,
    action: { type: "cancel-lot" }
  });
  assert.equal(cancel.status, 409);
  assert.match(cancel.data.error, /nothing to cancel/);
});

test("a room of computers drafts itself out and everybody ends up legal", async (t) => {
  const { base } = await startServer(t);
  const managers = ["Ana", "Bo", "Cy"];
  const created = await openRoom(base, { managers, cpu: managers });
  assert.equal(created.status, 201);

  const room = (await api(base, "GET", `/api/rooms/${created.data.roomId}`)).data;
  const draft = replay(room);

  assert.equal(draft.complete, true, "the computer room never finished");
  for (const manager of draft.managers) {
    const issues = validateRoster(manager, { unlimitedRoster: true });
    assert.deepEqual(issues, [], `${manager.name} finished illegal — ${issues.join(", ")}`);
  }
  // The board was deep enough that nobody had to be handed an invented player.
  const invented = draft.pool.filter((card) => String(card.id).startsWith("emergency-"));
  assert.deepEqual(invented, []);
});

test("a restarted server revives the room to the same rosters", async (t) => {
  const first = await startServer(t);
  const managers = ["Ana", "Bo", "Cy"];
  const created = await openRoom(first.base, { managers, cpu: managers });
  const roomId = created.data.roomId;
  const saved = (await api(first.base, "GET", `/api/rooms/${roomId}`)).data;
  const before = replay(saved);
  await settled(first.roomsDir, roomId, saved.actions.length);

  // Same rooms directory, fresh server: the room is rebuilt by replaying its log.
  const second = await startServer(t, first.roomsDir);
  const after = replay((await api(second.base, "GET", `/api/rooms/${roomId}`)).data);

  assert.equal(after.complete, before.complete);
  assert.deepEqual(
    after.managers.map((manager) => manager.roster.map((card) => card.id)),
    before.managers.map((manager) => manager.roster.map((card) => card.id))
  );
  assert.deepEqual(after.auction.budgets, before.auction.budgets);
});

test("a card set too thin to deal the board is refused at setup", async (t) => {
  const { base } = await startServer(t);
  // The thinnest franchise in the game does not own eight managers' worth of infield.
  const created = await api(base, "POST", "/api/rooms", {
    seed: SEED,
    managers: ["A", "B", "C", "D", "E", "F", "G", "H"],
    universe: "franchise-ARI",
    draftType: "auction",
    nomination: "random",
    budget: 5000
  });
  assert.equal(created.status, 400);
  assert.match(created.data.error, /too thin to deal/);
});
