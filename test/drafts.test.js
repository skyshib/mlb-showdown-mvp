import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer } from "../scripts/online-server.js";
import { draftRecord } from "../src/rules/draftRecord.js";
import { buildDraftPool } from "../src/data/universes.js";
import { applyDraftAction, createDraft } from "../src/rules/draft.js";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function startServer(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-drafts-"));
  const { server, store } = createOnlineServer({ dataDir });
  store.geoLookup = async (ip) => (ip === "198.51.100.30" ? { place: "Seattle, Washington, US", org: "Comcast Cable" } : "");
  store.geoIntervalMs = 0;
  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());
  process.env.VISITS_TOKEN = "sesame";
  t.after(() => { delete process.env.VISITS_TOKEN; });
  return { base: `http://127.0.0.1:${server.address().port}`, store, dataDir };
}

async function api(base, method, path, body, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function settle() {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
}

function finishedLocalDraft() {
  const pool = buildDraftPool("fictional", "book-test", { managerCount: 2, startingPitchers: 2 });
  const draft = createDraft([{ name: "Skylar" }, { name: "Hal", cpu: true }], pool, undefined, "book-test", {
    startingPitchers: 2,
    bullpenSlots: 2,
    bullpenMin: 2
  });
  applyDraftAction(draft, { type: "finish" });
  assert.equal(draft.complete, true);
  return draft;
}

test("a finished draft reads as settings, rosters, and what each card cost", () => {
  const draft = finishedLocalDraft();
  const record = draftRecord(draft, { source: "local", universe: "fictional" });

  assert.equal(record.source, "local");
  assert.equal(record.universe, "fictional");
  assert.equal(record.seed, "book-test");
  assert.equal(record.draftType, "snake");
  assert.equal(record.complete, true);
  assert.equal(record.managers.length, 2);

  const [skylar, hal] = record.managers;
  assert.equal(skylar.name, "Skylar");
  assert.equal(skylar.cpu, false);
  assert.equal(hal.cpu, true);
  assert.ok(hal.persona, "a computer manager files the opinion it drafted with");
  assert.equal(skylar.roster.length, draft.rosterSize);
  assert.equal(skylar.points, skylar.roster.reduce((sum, card) => sum + card.pts, 0));

  const first = skylar.roster[0];
  assert.equal(first.pick, 1, "the roster keeps the order it was filled in");
  assert.equal(first.round, 1);
  assert.ok(first.name && first.pos && first.kind);
  assert.equal(typeof first.pts, "number");
});

test("an auction record carries the price of every card and what was left", () => {
  const pool = buildDraftPool("fictional", "auction-book", { managerCount: 2, startingPitchers: 2 });
  const draft = createDraft([{ name: "Ana" }, { name: "Bo" }], pool, undefined, "auction-book", {
    draftType: "auction",
    startingPitchers: 2,
    bullpenSlots: 2,
    bullpenMin: 2
  });
  applyDraftAction(draft, { type: "start-review" });
  applyDraftAction(draft, { type: "complete-review" });
  applyDraftAction(draft, { type: "finish" });
  const record = draftRecord(draft, { source: "online" });

  assert.equal(record.draftType, "auction");
  assert.ok(record.budget > 0);
  for (const manager of record.managers) {
    assert.equal(manager.spent, manager.roster.reduce((sum, card) => sum + (card.price ?? 0), 0));
    assert.ok(manager.left >= 0);
    assert.ok(manager.spent + manager.left <= record.budget);
  }
});

test("a browser files its own local draft, and the book names where it came from", async (t) => {
  const { base } = await startServer(t);
  const device = "0123456789abcdef";
  const headers = { cookie: `sd_device=${device}`, "user-agent": CHROME, "x-forwarded-for": "198.51.100.30" };
  const record = draftRecord(finishedLocalDraft(), { source: "local", universe: "fictional" });
  // A page load is what teaches the geo cache who this address is; the filing
  // joins to what it already knows, exactly as the visit log does.
  await fetch(`${base}/index.html`, { headers });
  await settle();

  const filed = await api(base, "POST", "/api/drafts", { key: "aa11bb22", ...record }, headers);
  assert.equal(filed.status, 201);
  assert.match(filed.data.id, /^local-[a-f0-9]{16}$/);
  // Filing the same draft again rewrites it rather than filling the book with copies.
  await api(base, "POST", "/api/drafts", { key: "aa11bb22", ...record }, headers);
  await settle();

  const listed = await api(base, "GET", "/api/drafts?token=sesame");
  assert.equal(listed.status, 200);
  assert.equal(listed.data.drafts.length, 1);
  const [summary] = listed.data.drafts;
  assert.equal(summary.id, filed.data.id);
  assert.equal(summary.source, "local");
  assert.deepEqual(summary.managers.map((manager) => manager.name), ["Skylar", "Hal"]);
  assert.equal(summary.managers[0].cards, record.managers[0].roster.length);
  assert.equal(summary.who[0].place, "Seattle, Washington, US");
  assert.equal(summary.who[0].org, "Comcast Cable");
  assert.equal(summary.who[0].browser, "Chrome");
  assert.equal(summary.who[0].device, device);

  const full = await api(base, "GET", `/api/drafts/${filed.data.id}?token=sesame`);
  assert.equal(full.status, 200);
  assert.equal(full.data.draft.managers[0].roster.length, record.managers[0].roster.length);
  assert.equal(full.data.draft.managers[0].roster[0].name, record.managers[0].roster[0].name);

  // And the visit log tells the same story, so a session reads through to the end.
  const log = await api(base, "GET", "/api/visits?token=sesame&kind=draft-done");
  assert.equal(log.data.visits[0].data.draftId, filed.data.id);
  assert.deepEqual(log.data.visits[0].data.managers, ["Skylar", "Hal"]);
  assert.deepEqual(log.data.visits[0].data.cpu, ["Hal"]);
});

test("the book is private, and junk never reaches it", async (t) => {
  const { base } = await startServer(t);
  assert.equal((await api(base, "GET", "/api/drafts")).status, 401);
  assert.equal((await api(base, "GET", "/api/drafts?token=nope")).status, 401);

  assert.equal((await api(base, "POST", "/api/drafts", { key: "abc" })).status, 400, "a draft with no managers is not a draft");
  assert.equal(
    (await api(base, "POST", "/api/drafts", { managers: [{ name: "Ana", roster: [] }] })).status,
    400,
    "a filed draft needs a key"
  );

  // Everything in a filed record is rebuilt rather than trusted.
  const filed = await api(base, "POST", "/api/drafts", {
    key: "ffff",
    seed: "x".repeat(500),
    draftType: "pillage",
    rosterSize: 9e9,
    managers: [{
      name: "<script>", cpu: "yes", points: "lots",
      roster: [{ id: "h-1", name: "Card", pos: "CF", kind: "wizard", pts: "12", price: 4.7 }]
    }]
  }, { cookie: "sd_device=0123456789abcdef" });
  assert.equal(filed.status, 201);
  await settle();

  const { data } = await api(base, "GET", `/api/drafts/${filed.data.id}?token=sesame`);
  assert.equal(data.draft.seed.length, 60);
  assert.equal(data.draft.draftType, "snake");
  assert.equal(data.draft.rosterSize, 200);
  assert.equal(data.draft.managers[0].cpu, true);
  assert.equal(data.draft.managers[0].points, 0);
  assert.equal(data.draft.managers[0].roster[0].kind, "hitter");
  assert.equal(data.draft.managers[0].roster[0].pts, 12);
  assert.equal(data.draft.managers[0].roster[0].price, 5);
});

test("a room files its draft the moment it fills, with the seats that played it", async (t) => {
  const { base, dataDir } = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "room-book", managers: ["Ana", "Bo"], startingPitchers: 2, bullpenSlots: 2
  });
  assert.equal(created.status, 201);
  const roomId = created.data.roomId;

  const anaHeaders = { cookie: "sd_device=aaaaaaaaaaaaaaaa", "user-agent": CHROME, "x-forwarded-for": "198.51.100.30" };
  await fetch(`${base}/index.html`, { headers: anaHeaders });
  await settle();
  await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1", hostToken: created.data.hostToken }, anaHeaders);
  const bo = await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" },
    { cookie: "sd_device=bbbbbbbbbbbbbbbb", "user-agent": CHROME });
  assert.equal(bo.status, 200);

  const finish = await api(base, "POST", `/api/rooms/${roomId}/actions`, {
    token: created.data.hostToken,
    action: { type: "finish" }
  });
  assert.equal(finish.status, 200);
  await settle();

  const listed = await api(base, "GET", "/api/drafts?token=sesame");
  assert.equal(listed.data.drafts.length, 1);
  const [summary] = listed.data.drafts;
  assert.equal(summary.id, `room-${roomId}`);
  assert.equal(summary.source, "online");
  assert.equal(summary.roomId, roomId);
  assert.deepEqual(summary.who.map((seat) => seat.manager).sort(), ["Ana", "Bo"]);
  assert.equal(summary.who.find((seat) => seat.manager === "Ana").place, "Seattle, Washington, US");
  assert.equal(summary.who.find((seat) => seat.manager === "Ana").host, true);

  const full = await api(base, "GET", `/api/drafts/${summary.id}?token=sesame`);
  assert.equal(full.data.draft.managers.length, 2);
  assert.ok(full.data.draft.managers[0].roster.length > 0);
  assert.equal(full.data.draft.complete, true);

  // One record per room, however many times it is finished.
  const files = await readdir(join(dataDir, "drafts"));
  assert.deepEqual(files, [`room-${roomId}.json`]);
  // And it is stamped with the night the draft ended, not with whenever the
  // machine that holds it last came up.
  assert.ok(Math.abs(Date.parse(summary.at) - Date.now()) < 60000);
});

test("the book cannot be flooded off its own shelf", async (t) => {
  const { base } = await startServer(t);
  const record = draftRecord(finishedLocalDraft(), { source: "local", universe: "fictional" });
  const statuses = [];
  for (let i = 0; i < 15; i++) {
    const filed = await api(base, "POST", "/api/drafts", { key: `flood-${i}`, ...record },
      { cookie: "sd_device=0123456789abcdef" });
    statuses.push(filed.status);
  }
  assert.equal(statuses.filter((status) => status === 201).length, 12);
  assert.equal(statuses.filter((status) => status === 429).length, 3);
});

test("a room finished before the book existed is filed when the server comes up", async (t) => {
  const { base, dataDir } = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "old-room", managers: ["Ana", "Bo"], startingPitchers: 2, bullpenSlots: 2
  });
  const roomId = created.data.roomId;
  await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1", hostToken: created.data.hostToken });
  await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" });
  await api(base, "POST", `/api/rooms/${roomId}/actions`, { token: created.data.hostToken, action: { type: "finish" } });
  await settle();

  // The book is emptied, the room file left alone: a volume that carries rooms
  // from before any of this was written.
  await rm(join(dataDir, "drafts"), { recursive: true, force: true });

  const { server } = createOnlineServer({ dataDir });
  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());
  await settle();

  const files = await readdir(join(dataDir, "drafts"));
  assert.deepEqual(files, [`room-${roomId}.json`]);
});

test("a restart leaves a room's filed draft alone, date and all", async (t) => {
  const { base, dataDir } = await startServer(t);
  const created = await api(base, "POST", "/api/rooms", {
    seed: "kept-room", managers: ["Ana", "Bo"], startingPitchers: 2, bullpenSlots: 2
  });
  const roomId = created.data.roomId;
  await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-1", hostToken: created.data.hostToken });
  await api(base, "POST", `/api/rooms/${roomId}/join`, { managerId: "team-2" });
  await api(base, "POST", `/api/rooms/${roomId}/actions`, { token: created.data.hostToken, action: { type: "finish" } });
  await settle();

  // The record as it would look months later, written on the night it happened.
  const path = join(dataDir, "drafts", `room-${roomId}.json`);
  const filed = { ...JSON.parse(await readFile(path, "utf8")), at: "2026-01-02T03:04:05.000Z" };
  await writeFile(path, JSON.stringify(filed));

  const { server } = createOnlineServer({ dataDir });
  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());
  await settle();

  const reread = JSON.parse(await readFile(path, "utf8"));
  assert.equal(reread.at, "2026-01-02T03:04:05.000Z", "booting does not restamp a draft already in the book");
  assert.deepEqual(reread, filed);
});
