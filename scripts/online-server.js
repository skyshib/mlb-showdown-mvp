#!/usr/bin/env node
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFictionalDraftPool } from "../src/data/playerGeneration.js";
import { buildRealDraftPool } from "../src/data/realPlayers.js";
import { buildMarinersDraftPool } from "../src/data/marinersPlayers.js";
import { buildDraftPool, deckEntry, deckFromIds, universeConfig } from "../src/data/universes.js";
import {
  applyDraftAction,
  auctionReviewComplete,
  auctionTimerEnabled,
  normalizeSnakeTimerConfig,
  snakeClockEnabled,
  canCancelLot,
  cpuSealedBid,
  createDraft,
  currentManager,
  isAuctionDraft,
  isAuctionPaused,
  auctionStepGuard,
  isPendingBidder,
  isRandomNomination,
  maxPoolManagers,
  nominateBestTarget,
  randomNominationShortfalls,
  normalizeAuctionBudget,
  normalizeAuctionTimerConfig,
  normalizePickTimerSeconds,
  sealedBidder,
  timedOutAuctionBidderIds,
  SIM_ACTION_TYPES
} from "../src/rules/draft.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_BODY_BYTES = 64 * 1024;
const HEARTBEAT_MS = 20000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  // The card fronts are all jpg — 3543 of them, the bulk of everything served —
  // and the card face draws in its own fonts. Missing from this table they went
  // out as application/octet-stream, which a browser will sniff its way through
  // for an <img> but which no cache along the way can be expected to.
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

export function createOnlineServer(options = {}) {
  const dataDir = options.dataDir ?? process.env.ROOMS_DIR ?? join(root, "data", "rooms");
  const store = {
    dataDir,
    rooms: loadRooms(dataDir),
    hallOfFame: loadHallOfFameFile(dataDir),
    records: loadRecordsFile(dataDir)
  };
  for (const room of store.rooms.values()) {
    scheduleRoomTimer(store, room);
    if (room.unpinnedDeck) {
      room.unpinnedDeck = false;
      persistRoom(store, room);
    }
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        await handleApi(store, request, response, url);
      } else {
        await serveStatic(request, response, url);
      }
    } catch (error) {
      if (!response.headersSent) sendJson(response, 500, { error: error.message });
      else response.end();
    }
  });

  const heartbeat = setInterval(() => {
    for (const room of store.rooms.values()) {
      // A named event, not an SSE comment. A comment keeps the socket warm but
      // EventSource fires nothing for it, so a client cannot tell a live stream
      // from one that died quietly — and a client whose stream has died stops
      // seeing the room without ever being told. This is the pulse it listens for.
      for (const stream of room.streams) stream.write("event: ping\ndata: {}\n\n");
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return { server, rooms: store.rooms, dataDir, store };
}

// Every room writes through a promise chained on the room itself, so the tail of
// each chain is every save already queued for it. Waiting on those tails waits
// for the disk to catch up with the log.
//
// This matters because the machine now stops whenever the last person leaves the
// room, which is often. An action is broadcast to the clients the moment it is
// applied and written to disk just after, and a machine killed between the two
// comes back as a room that has forgotten a pick its clients still remember.
export async function flushSaves(store) {
  await Promise.allSettled([
    ...[...store.rooms.values()].map((room) => room.saveChain ?? Promise.resolve()),
    store.hofSaveChain ?? Promise.resolve()
  ]);
}

// Rooms are persisted as one JSON file each: metadata, seats, and the action
// log. The draft itself is not stored — it is rebuilt on load by replaying the
// log through the same deterministic rules the clients use.
function loadRooms(dataDir) {
  const rooms = new Map();
  mkdirSync(dataDir, { recursive: true });
  for (const file of readdirSync(dataDir)) {
    // Every .json on the volume is a room, except the two that aren't: the hall
    // of fame and the record book share the disk with them.
    if (!file.endsWith(".json") || file === HOF_FILE || file === RECORDS_FILE) continue;
    try {
      const saved = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
      const room = reviveRoom(saved);
      rooms.set(room.id, room);
    } catch (error) {
      console.error(`Skipping room file ${file}: ${error.message}`);
    }
  }
  if (rooms.size) console.log(`Restored ${rooms.size} room${rooms.size === 1 ? "" : "s"} from ${dataDir}`);
  return rooms;
}

// The deck a room drafts from. Rooms opened before the card sets became
// universes stored a poolMode/realPool pair instead of a universe key, and
// their decks came from the old hand-built pools — so they still deal from
// those. A saved room MUST deal exactly as it did the day it was created, or
// its replayed action log references cards the revived deck doesn't hold.
function roomPool(room) {
  if (!room.universe) {
    return room.poolMode === "real"
      ? room.realPool === "mariners"
        ? buildMarinersDraftPool(room.seed)
        : buildRealDraftPool(room.seed)
      : buildFictionalDraftPool(room.seed);
  }
  // A room that wrote down its deck deals from THAT deck, never from the seed
  // again. Re-dealing trusts the deal to be the same tomorrow as it was the
  // night the room opened, and it isn't: the deal is code, and code changes.
  if (room.deck?.length) return deckFromIds(room.universe, room.seed, room.deck);
  return buildDraftPool(room.universe, room.seed, {
    nomination: room.nomination,
    managerCount: room.managerCount
  });
}

function reviveRoom(saved) {
  const managerNames = saved.managerNames ?? [];
  const cpuNames = Array.isArray(saved.cpuNames) ? saved.cpuNames : [];
  const universe = universeConfig(saved.universe)?.key ?? null;
  const realPool = saved.realPool === "mariners" ? "mariners" : "stars";
  const draftType = saved.draftType === "auction" ? "auction" : "snake";
  const nomination = draftType === "auction" && saved.nomination === "random" ? "random" : "manual";
  const savedDeck = Array.isArray(saved.deck) && saved.deck.length ? saved.deck : null;
  const pool = roomPool({
    universe,
    seed: saved.seed,
    poolMode: saved.poolMode,
    realPool,
    nomination,
    managerCount: managerNames.length,
    deck: savedDeck
  });
  const auctionBudget = draftType === "auction"
    ? normalizeAuctionBudget(saved.auctionBudget, saved.rosterSize)
    : null;
  const draft = createDraft(
    managerNames.map((name) => ({ name, cpu: cpuNames.includes(name) })),
    pool,
    saved.rosterSize,
    saved.seed,
    { draftType, nomination, budget: auctionBudget, timer: saved.auctionTimer ?? false, snakeTimer: saved.snakeTimer ?? false }
  );
  const actions = saved.actions ?? [];
  for (const entry of actions) {
    if (!SIM_ACTION_TYPES.has(entry.action?.type)) applyDraftAction(draft, entry.action);
  }
  // Bids for a lot that had not sold yet never made it into the action log (see
  // recordSealedBid), so they are saved separately and replayed after it.
  const pendingBids = Array.isArray(saved.pendingBids) ? saved.pendingBids : [];
  for (const action of pendingBids) applyDraftAction(draft, action);
  return {
    id: saved.id,
    seed: saved.seed,
    rosterSize: saved.rosterSize,
    universe,
    // A room saved before decks were written down pins the one it just revived
    // with: that board is the best record of itself that survives, and pinning
    // it now means the next change to the deal cannot orphan this room too.
    deck: universe ? savedDeck ?? pool.map(deckEntry) : null,
    unpinnedDeck: Boolean(universe) && !savedDeck,
    poolMode: saved.poolMode === "real" ? "real" : "random",
    realPool,
    pickTimer: normalizePickTimerSeconds(saved.pickTimer),
    snakeTimer: draft.clock?.timer ?? null,
    draftType,
    nomination,
    auctionBudget,
    auctionTimer: draft.auction?.timer ?? null,
    cpuNames,
    managerNames,
    draft,
    actions,
    pendingBids,
    seats: new Map(Object.entries(saved.seats ?? {})),
    hostToken: saved.hostToken,
    streams: new Set(),
    createdAt: saved.createdAt ?? Date.now()
  };
}

// Atomic write (tmp + rename) chained per room so saves never interleave.
function persistRoom(store, room) {
  if (!store.dataDir) return;
  const payload = JSON.stringify({
    id: room.id,
    seed: room.seed,
    rosterSize: room.rosterSize,
    universe: room.universe,
    deck: room.deck ?? null,
    poolMode: room.poolMode,
    realPool: room.realPool,
    pickTimer: room.pickTimer,
    snakeTimer: room.snakeTimer ?? null,
    draftType: room.draftType,
    nomination: room.nomination ?? "manual",
    auctionBudget: room.auctionBudget,
    auctionTimer: room.auctionTimer,
    cpuNames: room.cpuNames ?? [],
    managerNames: room.managerNames,
    hostToken: room.hostToken,
    seats: Object.fromEntries(room.seats),
    actions: room.actions,
    pendingBids: room.pendingBids ?? [],
    createdAt: room.createdAt
  });
  const target = join(store.dataDir, `${room.id}.json`);
  const tmp = `${target}.tmp`;
  room.saveChain = (room.saveChain ?? Promise.resolve())
    .then(() => writeFile(tmp, payload))
    .then(() => rename(tmp, target))
    .catch((error) => console.error(`Failed to save room ${room.id}: ${error.message}`));
}

// ---- Hall of fame -----------------------------------------------------------
//
// The shared leaderboard of completed adventure runs, one JSON file alongside
// the rooms, capped to the best runs per rule set. The submit endpoint is
// open, so every entry is rebuilt field-by-field on the way in: strings are
// sliced, numbers are clamped, and enums are pinned to their known values —
// nothing lands in the file (or later in another player's DOM) that was not
// typed here.

const HOF_FILE = "hall-of-fame.json";
const HOF_MAX_PER_MODE = 100;
const HOF_RARITIES = new Set(["common", "uncommon", "rare", "legend"]);
// Every stat key the client's season lines render, hitters and pitchers both.
const HOF_STAT_KEYS = [
  "games", "pa", "ab", "h", "d", "t", "hr", "bb", "so", "r", "rbi", "sb", "cs", "gidp", "wpa",
  "avg", "obp", "slg", "ops", "bf", "outs", "runsPerNine", "strikeoutsPerNine"
];

function loadHallOfFameFile(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  try {
    const entries = JSON.parse(readFileSync(join(dataDir, HOF_FILE), "utf8"));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

// Atomic write (tmp + rename) chained like the rooms, so saves never interleave.
function persistHallOfFame(store) {
  if (!store.dataDir) return;
  const target = join(store.dataDir, HOF_FILE);
  const tmp = `${target}.tmp`;
  store.hofSaveChain = (store.hofSaveChain ?? Promise.resolve())
    .then(() => writeFile(tmp, JSON.stringify(store.hallOfFame)))
    .then(() => rename(tmp, target))
    .catch((error) => console.error(`Failed to save the hall of fame: ${error.message}`));
}

function hofNumber(value, max = 1e9) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-max, Math.min(max, number));
}

function hofString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

// Chart rows keep the shape formatRange expects; an Infinity `to` arrives as
// null through JSON and stays null (formatRange reads that as open-ended).
function sanitizeChart(chart) {
  if (!Array.isArray(chart)) return [];
  return chart.slice(0, 40).map((row) => ({
    result: hofString(row?.result, 3),
    from: hofNumber(row?.from, 100),
    to: Number.isFinite(Number(row?.to)) && row?.to !== null ? hofNumber(row.to, 100) : null
  }));
}

function sanitizeCard(card) {
  if (!card || typeof card !== "object") return null;
  const clean = {
    id: hofString(card.id, 60),
    name: hofString(card.name, 40),
    kind: card.kind === "pitcher" ? "pitcher" : "hitter",
    points: hofNumber(card.points, 9999),
    rarity: HOF_RARITIES.has(card.rarity) ? card.rarity : "common",
    foil: Boolean(card.foil),
    real: Boolean(card.real),
    setTag: hofString(card.setTag, 20),
    chart: sanitizeChart(card.chart)
  };
  if (clean.kind === "pitcher") {
    clean.role = hofString(card.role, 8);
    clean.control = hofNumber(card.control, 99);
    clean.ip = hofNumber(card.ip, 99);
    clean.throws = hofString(card.throws, 2);
  } else {
    clean.position = hofString(card.position, 8);
    clean.onBase = hofNumber(card.onBase, 99);
    clean.speed = hofNumber(card.speed, 99);
    clean.fielding = hofNumber(card.fielding, 99);
  }
  if (card.mlbam != null) clean.mlbam = hofNumber(card.mlbam, 1e7);
  return clean;
}

function sanitizeStatLine(line) {
  if (!line || typeof line !== "object") return null;
  const clean = { id: hofString(line.id, 60), name: hofString(line.name, 40) };
  for (const key of HOF_STAT_KEYS) {
    if (line[key] !== undefined) clean[key] = hofNumber(line[key], 1e7);
  }
  return clean;
}

function sanitizeHofEntry(body) {
  if (!body || typeof body !== "object") return null;
  const saveSeed = hofString(body.saveSeed, 60);
  const name = hofString(body.name, 12);
  const days = hofNumber(body.days, 1e6);
  if (!saveSeed || !name || days <= 0) return null;
  return {
    saveSeed,
    name,
    mode: body.mode === "uncapped" ? "uncapped" : "budget",
    universe: hofString(body.universe, 40) || "fictional",
    finishedAt: hofNumber(body.finishedAt, 4102444800000) || Date.now(),
    days,
    wins: hofNumber(body.wins, 1e6),
    losses: hofNumber(body.losses, 1e6),
    battlesWon: hofNumber(body.battlesWon, 1e6),
    battlesLost: hofNumber(body.battlesLost, 1e6),
    badges: Array.isArray(body.badges) ? body.badges.slice(0, 10).map((badge) => hofString(badge, 20)) : [],
    rosterPoints: hofNumber(body.rosterPoints, 1e6),
    roster: Array.isArray(body.roster) ? body.roster.slice(0, 30).map(sanitizeCard).filter(Boolean) : [],
    hitters: Array.isArray(body.hitters) ? body.hitters.slice(0, 30).map(sanitizeStatLine).filter(Boolean) : [],
    pitchers: Array.isArray(body.pitchers) ? body.pitchers.slice(0, 30).map(sanitizeStatLine).filter(Boolean) : []
  };
}

// The board stays a leaderboard, not an archive: per rule set, only the
// fastest HOF_MAX_PER_MODE runs survive a trim.
function trimHallOfFame(entries) {
  const byMode = new Map();
  for (const entry of entries) {
    const list = byMode.get(entry.mode) ?? [];
    list.push(entry);
    byMode.set(entry.mode, list);
  }
  const kept = [];
  for (const list of byMode.values()) {
    list.sort((a, b) => a.days - b.days || a.losses - b.losses || a.finishedAt - b.finishedAt);
    kept.push(...list.slice(0, HOF_MAX_PER_MODE));
  }
  return kept;
}

// ---- The record book --------------------------------------------------------
//
// The hall of fame ranks finished RUNS. This ranks single feats, across every
// manager who has ever played: the most runs anybody has scored in a game, the
// longest anybody has strung hits together. Same discipline as the hall — one
// file on the volume, written atomically, sanitized on the way in and trimmed so
// it stays a leaderboard rather than an archive.
//
// The keys and their directions live on the SERVER as well as the client,
// because a client is a thing a stranger can rewrite. An unknown key is dropped
// rather than stored; a record that is better when lower is sorted that way here,
// not wherever the submitter says.
const RECORDS_FILE = "records.json";
const RECORDS_MAX_PER_KEY = 25;
const RECORD_DIRECTIONS = {
  "runs-game": "max",
  "margin-game": "max",
  "homers-game": "max",
  "strikeouts-game": "max",
  "hits-allowed-win": "min",
  "hit-streak": "max",
  "win-streak": "max",
  "fastest-title": "min"
};

function loadRecordsFile(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  try {
    const book = JSON.parse(readFileSync(join(dataDir, RECORDS_FILE), "utf8"));
    return book && typeof book === "object" && !Array.isArray(book) ? book : {};
  } catch {
    return {};
  }
}

function persistRecords(store) {
  if (!store.dataDir) return;
  const target = join(store.dataDir, RECORDS_FILE);
  const tmp = `${target}.tmp`;
  store.recordsSaveChain = (store.recordsSaveChain ?? Promise.resolve())
    .then(() => writeFile(tmp, JSON.stringify(store.records)))
    .then(() => rename(tmp, target))
    .catch((error) => console.error(`Failed to save the record book: ${error.message}`));
}

// One line per campaign per record: a manager who breaks his own mark replaces
// it rather than filling the board with every step on the way up.
function fileRecord(store, key, row) {
  const direction = RECORD_DIRECTIONS[key];
  if (!direction) return;
  const list = (store.records[key] ?? []).filter((existing) => existing.saveSeed !== row.saveSeed);
  const previous = (store.records[key] ?? []).find((existing) => existing.saveSeed === row.saveSeed);
  // Keep whichever of the two is actually better — a resubmission of an older,
  // worse number must not erase a standing record.
  const best = !previous ? row
    : direction === "max" ? (row.value >= previous.value ? row : previous)
      : (row.value <= previous.value ? row : previous);
  list.push(best);
  list.sort((a, b) => (direction === "max" ? b.value - a.value : a.value - b.value) || a.at - b.at);
  store.records[key] = list.slice(0, RECORDS_MAX_PER_KEY);
}

async function postRecords(store, request, response) {
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") return sendJson(response, 400, { error: "Malformed records" });
  const saveSeed = hofString(body.saveSeed, 60);
  const name = hofString(body.name, 12);
  const submitted = body.records;
  if (!saveSeed || !name || !submitted || typeof submitted !== "object") {
    return sendJson(response, 400, { error: "Malformed records" });
  }
  const mode = body.mode === "uncapped" ? "uncapped" : "budget";
  let filed = 0;
  for (const [key, entry] of Object.entries(submitted)) {
    if (!RECORD_DIRECTIONS[key] || !entry || typeof entry !== "object") continue;
    const value = hofNumber(entry.value, 1e6);
    if (!Number.isFinite(value) || value < 0) continue;
    fileRecord(store, key, {
      value,
      name,
      saveSeed,
      mode,
      day: hofNumber(entry.day, 1e6),
      opponent: hofString(entry.opponent, 40),
      at: Date.now()
    });
    filed += 1;
  }
  if (!filed) return sendJson(response, 400, { error: "No known records submitted" });
  persistRecords(store);
  sendJson(response, 201, { ok: true, filed });
}

async function postHallOfFameEntry(store, request, response) {
  const body = await readJsonBody(request);
  const entry = sanitizeHofEntry(body);
  if (!entry) return sendJson(response, 400, { error: "Malformed hall of fame entry" });
  // One plaque per campaign: a resubmitted run (retry, second device) is a no-op.
  if (store.hallOfFame.some((existing) => existing.saveSeed === entry.saveSeed)) {
    return sendJson(response, 200, { ok: true, duplicate: true });
  }
  store.hallOfFame = trimHallOfFame([...store.hallOfFame, entry]);
  persistHallOfFame(store);
  sendJson(response, 201, { ok: true });
}

async function handleApi(store, request, response, url) {
  const segments = url.pathname.split("/").filter(Boolean);
  // /api/hall-of-fame — the shared leaderboard of finished adventure runs.
  if (segments[1] === "hall-of-fame" && !segments[2]) {
    if (request.method === "GET") return sendJson(response, 200, { entries: store.hallOfFame });
    if (request.method === "POST") return postHallOfFameEntry(store, request, response);
    return sendJson(response, 404, { error: "Unknown API route" });
  }
  // /api/records — the league's record book: single feats, every manager.
  if (segments[1] === "records" && !segments[2]) {
    if (request.method === "GET") return sendJson(response, 200, { records: store.records });
    if (request.method === "POST") return postRecords(store, request, response);
    return sendJson(response, 404, { error: "Unknown API route" });
  }
  // /api/rooms | /api/rooms/:id | /api/rooms/:id/(join|actions|stream)
  if (segments[1] !== "rooms") return sendJson(response, 404, { error: "Unknown API route" });
  const roomId = segments[2];
  const subroute = segments[3];

  if (!roomId && request.method === "POST") return createRoom(store, request, response);

  const room = store.rooms.get(roomId);
  if (!room) return sendJson(response, 404, { error: `Room "${roomId ?? ""}" not found` });

  if (!subroute && request.method === "GET") return sendJson(response, 200, roomSnapshot(room, request.socket.localPort));
  if (subroute === "join" && request.method === "POST") return joinRoom(store, room, request, response);
  if (subroute === "actions" && request.method === "POST") return postAction(store, room, request, response);
  if (subroute === "stream" && request.method === "GET") return openStream(room, request, response, url);
  return sendJson(response, 404, { error: "Unknown API route" });
}

async function createRoom(store, request, response) {
  const body = await readJsonBody(request);
  const managers = Array.isArray(body.managers)
    ? body.managers.map((name) => String(name).trim()).filter(Boolean)
    : [];
  if (managers.length < 2) return sendJson(response, 400, { error: "At least two managers are required" });
  if (managers.length > 8) return sendJson(response, 400, { error: "At most eight managers are supported" });
  const seed = String(body.seed ?? "").trim() || "showdown";
  const rosterSize = 13;
  // No card set named is the fictional league, as it always was; a card set
  // named that we don't have is a mistake worth saying out loud.
  const universe = body.universe == null ? "fictional" : universeConfig(body.universe)?.key;
  if (!universe) return sendJson(response, 400, { error: `Unknown card set "${body.universe}"` });
  const pickTimer = normalizePickTimerSeconds(body.pickTimer);
  const draftType = body.draftType === "auction" ? "auction" : "snake";
  const nomination = draftType === "auction" && body.nomination === "random" ? "random" : "manual";
  const auctionBudget = draftType === "auction" ? normalizeAuctionBudget(body.budget, rosterSize) : null;
  const auctionTimer = draftType === "auction" ? normalizeAuctionTimerConfig(body.auctionTimer) : null;
  const snakeTimer = draftType === "auction" ? null : normalizeSnakeTimerConfig(body.snakeTimer);
  const cpuNames = Array.isArray(body.cpu)
    ? body.cpu.map((name) => String(name)).filter((name) => managers.includes(name))
    : [];

  // Every universe deals a seeded deck out of a deep card set; the deal is
  // deterministic in the seed so clients rebuild the identical deck. A
  // random-nomination board is dealt to the size of the ROOM, so how many
  // managers it seats is not a question — whether the set is deep enough to
  // deal it is.
  const pool = buildDraftPool(universe, seed, { nomination, managerCount: managers.length });
  if (nomination === "random") {
    const shortfalls = randomNominationShortfalls(pool, managers.length);
    if (shortfalls.length) {
      const spots = shortfalls.map((short) => `${short.group} (${short.dealt} of ${short.quota})`).join(", ");
      return sendJson(response, 400, {
        error: `The ${universeConfig(universe).name} set is too thin to deal a ${managers.length}-manager random-nomination board: ${spots}`
      });
    }
  } else {
    const managerLimit = maxPoolManagers(pool);
    if (managers.length > managerLimit) {
      return sendJson(response, 400, {
        error: `The ${universeConfig(universe).name} deck deals position depth for up to ${managerLimit} managers`
      });
    }
  }
  const draft = createDraft(
    managers.map((name) => ({ name, cpu: cpuNames.includes(name) })),
    pool,
    rosterSize,
    seed,
    { draftType, nomination, budget: auctionBudget, timer: auctionTimer, snakeTimer }
  );
  const createdAt = Date.now();
  const actions = [];
  if (isAuctionDraft(draft)) {
    const action = { type: "start-review", at: createdAt };
    applyDraftAction(draft, action);
    actions.push({ seq: 1, action });
  } else if (snakeClockEnabled(draft)) {
    // The gun, recorded like any other action: every client that replays this
    // room starts its clocks at the instant the room opened, not at the instant
    // it happened to load.
    const action = { type: "start-clock", at: createdAt };
    applyDraftAction(draft, action);
    actions.push({ seq: 1, action });
  }
  const room = {
    id: newRoomId(store.rooms),
    seed,
    rosterSize,
    universe,
    // The board this room dealt, written down on the night it dealt it —
    // each card with the roster slot it was dealt to fill.
    deck: pool.map(deckEntry),
    pickTimer,
    snakeTimer: draft.clock?.timer ?? null,
    draftType,
    nomination,
    auctionBudget,
    auctionTimer: draft.auction?.timer ?? null,
    cpuNames,
    managerNames: managers,
    draft,
    actions,
    pendingBids: [],
    seats: new Map(),
    hostToken: newToken(),
    streams: new Set(),
    createdAt
  };
  store.rooms.set(room.id, room);
  // A computer first nominator opens the block before anyone arrives.
  runCpuAuction(store, room);
  persistRoom(store, room);
  scheduleRoomTimer(store, room);
  sendJson(response, 201, { roomId: room.id, hostToken: room.hostToken, ...roomSnapshot(room, request.socket.localPort) });
}

async function joinRoom(store, room, request, response) {
  const body = await readJsonBody(request);
  const manager = room.draft.managers.find((item) => item.id === body.managerId);
  if (!manager) return sendJson(response, 404, { error: "Unknown manager seat" });
  if (manager.cpu) return sendJson(response, 409, { error: `${manager.name} is a computer manager` });
  const isHost = Boolean(body.hostToken) && body.hostToken === room.hostToken;
  const existing = room.seats.get(manager.id);
  // A seat is held by a token in one browser's storage, and storage is a
  // fragile place to keep the only key to your own team: clear it, or come
  // back on a different address (localStorage is per-origin — 127.0.0.1 and
  // 192.168.1.x are different cupboards), and the room says your seat is taken
  // by you, for ever. Whoever holds the host token can hand it back. Reseating
  // mints a fresh token, so the orphaned one stops working.
  // Somebody is sitting there right now — leave them alone. But a seat whose
  // holder is gone belongs to whoever comes to sit in it: the token that held
  // it lived in one browser's storage, and storage is lost all the time.
  if (existing && !isHost && seatIsLive(room, manager.id)) {
    return sendJson(response, 409, { error: `${manager.name} is already claimed` });
  }
  // Claiming counts as sitting down. Otherwise there is a gap between taking a
  // seat and opening the stream in which the seat looks empty and the next
  // person through the door can take it out from under you.
  const seat = { managerId: manager.id, token: newToken(), isHost, lastSeenAt: Date.now() };
  room.seats.set(manager.id, seat);
  persistRoom(store, room);
  broadcast(room, "seats", { seats: claimedSeats(room), live: liveSeats(room) });
  sendJson(response, 200, { token: seat.token, managerId: manager.id, host: isHost, reseated: Boolean(existing) });
}

async function postAction(store, room, request, response) {
  const body = await readJsonBody(request);
  const action = canonicalizeAction(room.draft, body.action);
  const seat = [...room.seats.values()].find((item) => item.token === body.token);
  const isHost = Boolean(seat?.isHost) || (Boolean(body.token) && body.token === room.hostToken);
  if (!seat && !isHost) return sendJson(response, 403, { error: "Join a seat before acting" });

  syncRoomAuctionTimer(store, room, action?.at);
  runCpuAuction(store, room);
  const denial = denyAction(room.draft, seat, isHost, action);
  if (denial) return sendJson(response, 409, { error: denial });

  // Finishing auto-bids the rest of the draft from the current lot, so every
  // replica has to be looking at the same lot first: release anything withheld
  // before the draft runs away from the clients.
  if (action?.type === "finish") flushSealedBids(store, room);

  try {
    if (!SIM_ACTION_TYPES.has(action?.type)) applyDraftAction(room.draft, action);
  } catch (error) {
    return sendJson(response, 409, { error: error.message });
  }

  if (action.type === "seal-bid") {
    recordSealedBid(store, room, action);
  } else {
    // Throwing the lot away throws its withheld bids away with it: the room
    // never saw them, so no replica ever has to unwind them.
    if (action.type === "cancel-lot" || action.type === "undo") room.pendingBids = [];
    appendAction(store, room, action);
  }
  runCpuAuction(store, room);
  broadcastLot(room);
  scheduleRoomTimer(store, room);
  // Hand the result straight back to whoever acted. They will hear it again on
  // the stream, but a bidder whose stream has quietly died would otherwise
  // click Submit and watch nothing happen — the bid lands, the room moves on,
  // and only they cannot see it. The answer to an action should not have to
  // travel back by a different road than the one the request came in on.
  sendJson(response, 200, { seq: room.actions.length, lot: lotView(room) });
}

function canonicalizeAction(draft, action) {
  if (!action || typeof action !== "object") return action;
  if (!isAuctionDraft(draft)) return { ...action };
  const canonical = { ...action, at: Date.now() };
  if (canonical.type === "seal-bid") canonical.timedOut = false;
  return canonical;
}

function appendAction(store, room, action) {
  const entry = { seq: room.actions.length + 1, action };
  room.actions.push(entry);
  persistRoom(store, room);
  broadcast(room, "action", entry);
  return entry;
}

// A sealed bid is withheld from the room until the lot resolves. The server
// applies it to its own draft and tells everyone only *that* it landed; the
// amounts join the action log the moment the card sells, in the order they were
// placed, so every client replays to the identical draft. Broadcasting each bid
// as it arrived would hand it straight to the next bidder — the SSE stream goes
// to every browser, so "sealed" would only hold until someone opened devtools.
function recordSealedBid(store, room, action) {
  room.pendingBids.push(action);
  if (room.draft.auction.lot) {
    // Still bidding, or a tie forced a rebid round. Reveal nothing yet.
    persistRoom(store, room);
    return;
  }
  flushSealedBids(store, room);
}

function flushSealedBids(store, room) {
  if (!room.pendingBids?.length) return;
  const revealed = room.pendingBids;
  room.pendingBids = [];
  for (const bid of revealed) appendAction(store, room, bid);
}

function syncRoomAuctionTimer(store, room, now = Date.now()) {
  const draft = room.draft;
  if (!isAuctionDraft(draft) || !auctionTimerEnabled(draft)) return false;
  // Nothing runs out while the room is paused, so nothing needs catching up.
  if (isAuctionPaused(draft)) return false;
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  let changed = false;
  const review = draft.auction.review;
  if (review?.completedAt === null && review.startedAt !== null && timestamp >= review.endsAt) {
    const action = { type: "complete-review", at: review.endsAt };
    applyDraftAction(draft, action);
    appendAction(store, room, action);
    changed = true;
  }
  let guard = draft.managers.length * 3 + 3;
  while (draft.auction.lot && guard > 0) {
    guard -= 1;
    const expired = timedOutAuctionBidderIds(draft, timestamp);
    if (!expired.length) break;
    const action = { type: "seal-bid", managerId: expired[0], amount: 0, timedOut: true, at: timestamp };
    applyDraftAction(draft, action);
    recordSealedBid(store, room, action);
    changed = true;
  }
  return changed;
}

function scheduleRoomTimer(store, room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  const deadline = nextRoomTimerDeadline(room.draft);
  if (deadline === null) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    syncRoomAuctionTimer(store, room, Date.now());
    runCpuAuction(store, room);
    broadcastLot(room);
    scheduleRoomTimer(store, room);
  }, Math.max(1, deadline - Date.now()));
  room.timer.unref();
}

function nextRoomTimerDeadline(draft) {
  if (!isAuctionDraft(draft) || !auctionTimerEnabled(draft) || draft.complete) return null;
  if (isAuctionPaused(draft)) return null;
  const review = draft.auction.review;
  if (review?.completedAt === null && Number.isFinite(review.endsAt)) return review.endsAt;
  const lot = draft.auction.lot;
  if (!lot?.clock || !lot.pending?.length) return null;
  const deadlines = lot.pending
    .map((managerId) => lot.clock.startedAt + Math.max(0, Number(draft.auction.clockBanks[managerId]) || 0))
    .filter(Number.isFinite);
  return deadlines.length ? Math.min(...deadlines) : null;
}

// Computer managers act on the server, not through the host's browser like they
// do in a snake room: only the server can see the sealed lot, so only the server
// can bid into it. A room of computers also finishes with nobody watching.
function runCpuAuction(store, room) {
  const draft = room.draft;
  if (!isAuctionDraft(draft)) return;
  // A pause stops the computer managers too, or the room would come back from
  // its break to find three lots already sold.
  if (isAuctionPaused(draft)) return;
  if (!auctionReviewComplete(draft, Date.now())) return;
  const queued = isRandomNomination(draft);
  let guard = auctionStepGuard(draft);
  while (!draft.complete && guard > 0) {
    guard -= 1;
    if (draft.auction.lot) {
      const bidder = sealedBidder(draft);
      if (!bidder?.cpu) return;
      const action = { type: "seal-bid", managerId: bidder.id, amount: cpuSealedBid(draft, bidder), at: Date.now() };
      applyDraftAction(draft, action);
      recordSealedBid(store, room, action);
      continue;
    }
    // Nobody owns the next card in a random-nomination room, so the server
    // always turns it over: the queue never waits on a manager to act.
    if (queued) {
      const action = { type: "auto-nominate", at: Date.now() };
      applyDraftAction(draft, action);
      appendAction(store, room, action);
      continue;
    }
    if (!currentManager(draft).cpu) return;
    const at = Date.now();
    const lot = nominateBestTarget(draft, at);
    appendAction(store, room, { type: "nominate", playerId: lot.playerId, at });
  }
}

// The public half of a live lot: who has bid, never how much.
function lotView(room) {
  const lot = isAuctionDraft(room.draft) ? room.draft.auction.lot : null;
  if (!lot) return null;
  return {
    playerId: lot.playerId,
    nominatorId: lot.nominatorId,
    round: lot.round,
    tie: lot.tie,
    pending: [...lot.pending],
    bidsIn: Object.keys(lot.bids),
    clock: lot.clock
      ? {
          startedAt: lot.clock.startedAt,
          timedOut: [...lot.clock.timedOut],
          banks: { ...room.draft.auction.clockBanks }
        }
      : null
  };
}

function broadcastLot(room) {
  if (!isAuctionDraft(room.draft)) return;
  broadcast(room, "lot", { lot: lotView(room) });
}

// Light turn enforcement: enough to keep a friendly room orderly, not
// anti-cheat. The host token bypasses seat checks so a stalled draft can
// always be moved along.
function denyAction(draft, seat, isHost, action) {
  const type = action?.type;
  if (type === "pause" || type === "resume") {
    if (!isAuctionDraft(draft)) return "This room is not an auction draft";
    if (!isHost) return `Only the host can ${type} the draft`;
    if (draft.complete) return "The draft is already complete";
    if (type === "pause" && isAuctionPaused(draft)) return "The draft is already paused";
    if (type === "resume" && !isAuctionPaused(draft)) return "The draft is not paused";
    return null;
  }
  // A paused room is a room holding still: the clocks are stopped, so no move
  // that would spend one may land. Setting a lineup is not a move on the draft,
  // and stays open — a break is exactly when people tinker with their team.
  if (isAuctionPaused(draft) && type !== "lineup" && type !== "staff" && !SIM_ACTION_TYPES.has(type)) {
    return "The draft is paused";
  }
  if (type === "pick" || type === "autopick") {
    if (draft.complete) return "The draft is already complete";
    // An autopick resolves a whole lot, entering bids for managers who never
    // made them. Only a deliberate host finish may do that; a room's auto
    // button uses auto-nominate.
    if (isAuctionDraft(draft)) return "Auction rooms nominate and bid instead of auto-picking";
    if (!isHost && currentManager(draft).id !== seat?.managerId) return "It is not your turn";
    return null;
  }
  if (type === "auto-nominate") {
    if (draft.complete) return "The draft is already complete";
    if (!isAuctionDraft(draft)) return "This room is not an auction draft";
    if (!auctionReviewComplete(draft, action.at)) return "Pool review is still open";
    if (draft.auction.lot) return "A card is already on the block";
    // Under random nomination the next card belongs to nobody, so anyone in the
    // room may turn it over — there is no turn to take out of anyone's hands.
    if (isRandomNomination(draft)) return null;
    if (!isHost && currentManager(draft).id !== seat?.managerId) return "It is not your nomination";
    return null;
  }
  if (type === "finish") {
    if (draft.complete) return "The draft is already complete";
    if (!isHost) return "Only the host can auto-finish the draft";
    if (isAuctionDraft(draft) && !auctionReviewComplete(draft, action.at)) return "Pool review is still open";
    return null;
  }
  if (type === "nominate") {
    if (draft.complete) return "The draft is already complete";
    if (!isAuctionDraft(draft)) return "This room is not an auction draft";
    if (!auctionReviewComplete(draft, action.at)) return "Pool review is still open";
    if (isRandomNomination(draft)) return "The queue nominates in this room";
    if (draft.auction.lot) return "A card is already on the block";
    if (!isHost && currentManager(draft).id !== seat?.managerId) return "It is not your nomination";
    return null;
  }
  if (type === "seal-bid") {
    if (!isAuctionDraft(draft)) return "This room is not an auction draft";
    if (!draft.auction.lot) return "No card is on the block";
    // Bids are sealed, so there is no turn to bid out of: anyone the lot is
    // still owed a bid from may enter it, whenever they get to it. What is
    // still forbidden is bidding twice, and bidding as somebody else — the
    // host excepted, who may enter for a seat that has stalled.
    if (!isPendingBidder(draft, action.managerId)) {
      return action.managerId in draft.auction.lot.bids
        ? "That bid is already in"
        : "That manager is not bidding on this card";
    }
    if (!isHost && action.managerId !== seat?.managerId) return "You cannot bid for another manager";
    return null;
  }
  if (type === "complete-review") {
    if (!isAuctionDraft(draft)) return "This room is not an auction draft";
    if (!isHost) return "Only the host can end pool review early";
    return null;
  }
  if (type === "cancel-lot") {
    if (!isAuctionDraft(draft) || !draft.auction.lot) return "No card is on the block";
    if (isRandomNomination(draft)) return "Nobody nominated this card, so there is nothing to cancel";
    if (!isHost && draft.auction.lot.nominatorId !== seat?.managerId) {
      return "Only the host or the nominator can cancel";
    }
    if (!canCancelLot(draft)) return "A manager has already bid on this card";
    return null;
  }
  // Rewinding the draft is the host's call and nobody else's. A manager who
  // could take back their own pick could take it back after seeing what came
  // next, so the room's history is the one thing no seat may edit from the
  // inside — it takes the host to move it.
  if (type === "undo") {
    if (!isHost) return "Only the host can undo";
    // An open lot is itself undoable, before any card has been sold — unless
    // the queue dealt it, in which case there is no nomination to take back.
    if (isAuctionDraft(draft) && draft.auction.lot) {
      if (isRandomNomination(draft)) return "Finish the card on the block first";
      return null;
    }
    if (draft.pickNumber <= 0) return "There is nothing to undo";
    return null;
  }
  if (type === "lineup" || type === "staff" || type === "batting-order") {
    // Your team is yours. Nobody else moves your bats around, and you do not
    // move theirs.
    if (!isHost && action?.managerId !== seat?.managerId) {
      const what = type === "staff" ? "staff" : type === "batting-order" ? "batting order" : "lineup";
      return `You can only edit your own ${what}`;
    }
    return null;
  }
  if (SIM_ACTION_TYPES.has(type)) {
    if (!draft.complete) return "The draft must be complete before simulating";
    return null;
  }
  return `Unknown draft action: ${type}`;
}

function openStream(room, request, response, url) {
  const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });
  response.write(`event: hello\ndata: ${JSON.stringify({ seq: room.actions.length })}\n\n`);
  for (const entry of room.actions.slice(since)) {
    response.write(`event: action\ndata: ${JSON.stringify(entry)}\n\n`);
  }
  // The in-flight lot is not in the action log, so a reconnecting client would
  // otherwise render a lot that nobody has bid on.
  if (isAuctionDraft(room.draft)) {
    response.write(`event: lot\ndata: ${JSON.stringify({ lot: lotView(room) })}\n\n`);
  }
  // The stream is how the server knows somebody is actually sitting in a seat.
  // A seat with no stream is a seat nobody is in — which is exactly the state a
  // player lands in when their browser loses the token, and exactly when the
  // seat should be reclaimable.
  const seat = seatForToken(room, url.searchParams.get("token"));
  if (seat) {
    response.seatManagerId = seat.managerId;
    seat.lastSeenAt = Date.now();
  }
  room.streams.add(response);
  request.on("close", () => {
    if (seat) seat.lastSeenAt = Date.now();
    room.streams.delete(response);
    broadcast(room, "seats", { seats: claimedSeats(room), live: liveSeats(room) });
  });
  broadcast(room, "seats", { seats: claimedSeats(room), live: liveSeats(room) });
}

function seatForToken(room, token) {
  if (!token) return null;
  return [...room.seats.values()].find((seat) => seat.token === token) ?? null;
}

// Somebody is holding this seat open right now. A dropped connection is
// forgiven for a moment — streams die and come back all the time — so a seat
// only falls vacant once nobody has been in it for a while.
const SEAT_GRACE_MS = 30000;

function seatIsLive(room, managerId) {
  for (const stream of room.streams) {
    if (stream.seatManagerId === managerId) return true;
  }
  const seat = room.seats.get(managerId);
  if (!seat?.lastSeenAt) return false;
  return Date.now() - seat.lastSeenAt < SEAT_GRACE_MS;
}

function liveSeats(room) {
  return [...room.seats.keys()].filter((managerId) => seatIsLive(room, managerId));
}

function broadcast(room, event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const stream of room.streams) stream.write(message);
}

// The address the OTHER machines on this wifi can reach us at. The host is
// usually browsing 127.0.0.1 — that is what the startup line prints — and an
// invite link built from that points every guest at their own laptop, where
// nothing is listening. So the room tells the client where it really lives,
// and the client hands that out instead. Null when there is no LAN (a lone
// machine, or every interface internal), and then the client falls back to
// whatever address it is already using.
function lanOrigin(port) {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return `http://${address.address}:${port}`;
    }
  }
  return null;
}

function roomSnapshot(room, port = null) {
  return {
    lanOrigin: port ? lanOrigin(port) : null,
    roomId: room.id,
    seed: room.seed,
    rosterSize: room.rosterSize,
    universe: room.universe ?? null,
    // The room deals its board to every client. Left to re-deal from the seed a
    // client runs whatever deal ITS copy of the code knows, which is not always
    // the deal the room was opened with.
    deck: room.deck ?? null,
    poolMode: room.poolMode,
    realPool: room.realPool ?? "stars",
    pickTimer: room.pickTimer ?? 0,
    snakeTimer: room.snakeTimer ?? null,
    draftType: room.draftType ?? "snake",
    nomination: room.nomination ?? "manual",
    auctionBudget: room.auctionBudget ?? null,
    auctionTimer: room.auctionTimer ?? null,
    managers: room.draft.managers.map((manager) => ({
      id: manager.id,
      name: manager.name,
      cpu: Boolean(manager.cpu),
      claimed: room.seats.has(manager.id),
      // Claimed is not the same as occupied: a seat whose holder lost their
      // token is still claimed, and is exactly the one that needs taking back.
      live: seatIsLive(room, manager.id)
    })),
    actions: room.actions,
    lot: lotView(room),
    complete: room.draft.complete,
    serverNow: Date.now()
  };
}

function claimedSeats(room) {
  return [...room.seats.keys()];
}

function newRoomId(rooms) {
  for (;;) {
    const id = randomBytes(4).toString("hex").slice(0, 6);
    if (!rooms.has(id)) return id;
  }
}

function newToken() {
  return randomBytes(16).toString("hex");
}

function readJsonBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolvePromise(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        rejectPromise(new Error("Invalid JSON body"));
      }
    });
    request.on("error", rejectPromise);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

// The card art is most of what this server ever sends: 86MB across 3500 files,
// none of which change from one deploy to the next. It used to go out under
// `no-store`, which re-sent every byte of every card every time somebody opened
// the page — and once the server is renting its bandwidth, that is the part of
// the bill that grows with play.
//
// So the art and the fonts are held for a day, and the app itself is revalidated
// instead of held: the entry points carry a ?v= but the modules they import do
// not, so a cached module would outlive the deploy that replaced it. Revalidating
// costs a round trip and returns 304 with no body, which is the whole saving
// anyway — the bytes are what cost money, not the request.
const HELD_ASSETS = /^\/(assets|vendor)\//;
const ASSET_MAX_AGE_SECONDS = 86400;

async function serveStatic(request, response, url) {
  try {
    const pathname = decodeURIComponent(url.pathname);
    const filePath = normalize(join(root, pathname));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Forbidden");
      return;
    }
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, "index.html") : filePath;
    const targetInfo = info.isDirectory() ? await stat(target) : info;
    const cacheControl = HELD_ASSETS.test(pathname)
      ? `public, max-age=${ASSET_MAX_AGE_SECONDS}`
      : "no-cache";
    // Size and mtime, which a rebuilt image restamps — so shipping a new module
    // invalidates it on its own, without anyone having to remember to bump a query.
    const etag = `W/"${targetInfo.size.toString(16)}-${Math.floor(targetInfo.mtimeMs).toString(16)}"`;
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, { ETag: etag, "Cache-Control": cacheControl });
      response.end();
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": cacheControl,
      ETag: etag
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const port = Number(process.env.PORT ?? process.argv[2] ?? 8790);
  const { server, dataDir, store } = createOnlineServer();

  // The host stops this machine when the room empties out and starts it again
  // when somebody knocks, so this is a normal night's sleep, not a crash: stop
  // taking new connections, hang up on the streams so the browsers know to
  // reconnect rather than sit there waiting, and let the disk catch up before
  // the process goes. Closing a stream is friendlier than being cut off — an
  // EventSource that gets a clean end reconnects immediately, and the knock is
  // what wakes the machine back up.
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    for (const room of store.rooms.values()) {
      for (const stream of room.streams) stream.end();
    }
    await flushSaves(store);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.listen(port, () => {
    const lan = lanOrigin(port);
    // Lead with the address that works for everybody. The loopback one only
    // ever works on this machine, and a link built from it is the classic way
    // to invite four friends to a draft that none of them can reach.
    if (lan) console.log(`Play here, and share this with the room: ${lan}/index.html`);
    else console.log("No network address found — nobody else can reach this machine right now.");
    console.log(`This machine only:                     http://127.0.0.1:${port}/index.html`);
    console.log(`Rooms persist in ${dataDir} and survive restarts.`);
  });
}
