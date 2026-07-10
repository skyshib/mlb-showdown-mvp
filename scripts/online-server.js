#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFictionalDraftPool } from "../src/data/playerGeneration.js";
import { buildRealDraftPool, maxRealPoolManagers } from "../src/data/realPlayers.js";
import { buildMarinersDraftPool } from "../src/data/marinersPlayers.js";
import { applyDraftAction, createDraft, currentManager, draftHistory, normalizePickTimerSeconds, SIM_ACTION_TYPES } from "../src/rules/draft.js";

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
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

export function createOnlineServer(options = {}) {
  const dataDir = options.dataDir ?? process.env.ROOMS_DIR ?? join(root, "data", "rooms");
  const store = { dataDir, rooms: loadRooms(dataDir), hallOfFame: loadHallOfFameFile(dataDir) };

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
      for (const stream of room.streams) stream.write(": ping\n\n");
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return { server, rooms: store.rooms, dataDir };
}

// Rooms are persisted as one JSON file each: metadata, seats, and the action
// log. The draft itself is not stored — it is rebuilt on load by replaying the
// log through the same deterministic rules the clients use.
function loadRooms(dataDir) {
  const rooms = new Map();
  mkdirSync(dataDir, { recursive: true });
  for (const file of readdirSync(dataDir)) {
    if (!file.endsWith(".json") || file === HOF_FILE) continue;
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

function reviveRoom(saved) {
  const managerNames = saved.managerNames ?? [];
  const cpuNames = Array.isArray(saved.cpuNames) ? saved.cpuNames : [];
  const realPool = saved.realPool === "mariners" ? "mariners" : "stars";
  // Must deal exactly as createRoom did, or the replayed action log references
  // cards that are not in the revived pool.
  const pool = saved.poolMode === "real"
    ? realPool === "mariners"
      ? buildMarinersDraftPool(saved.seed)
      : buildRealDraftPool(saved.seed)
    : buildFictionalDraftPool(saved.seed);
  const draft = createDraft(
    managerNames.map((name) => ({ name, cpu: cpuNames.includes(name) })),
    pool,
    saved.rosterSize,
    saved.seed
  );
  const actions = saved.actions ?? [];
  for (const entry of actions) {
    if (!SIM_ACTION_TYPES.has(entry.action?.type)) applyDraftAction(draft, entry.action);
  }
  return {
    id: saved.id,
    seed: saved.seed,
    rosterSize: saved.rosterSize,
    poolMode: saved.poolMode === "real" ? "real" : "random",
    realPool,
    pickTimer: normalizePickTimerSeconds(saved.pickTimer),
    cpuNames,
    managerNames,
    draft,
    actions,
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
    poolMode: room.poolMode,
    realPool: room.realPool,
    pickTimer: room.pickTimer,
    cpuNames: room.cpuNames ?? [],
    managerNames: room.managerNames,
    hostToken: room.hostToken,
    seats: Object.fromEntries(room.seats),
    actions: room.actions,
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
  // /api/rooms | /api/rooms/:id | /api/rooms/:id/(join|actions|stream)
  if (segments[1] !== "rooms") return sendJson(response, 404, { error: "Unknown API route" });
  const roomId = segments[2];
  const subroute = segments[3];

  if (!roomId && request.method === "POST") return createRoom(store, request, response);

  const room = store.rooms.get(roomId);
  if (!room) return sendJson(response, 404, { error: `Room "${roomId ?? ""}" not found` });

  if (!subroute && request.method === "GET") return sendJson(response, 200, roomSnapshot(room));
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
  const poolMode = body.poolMode === "real" ? "real" : "random";
  const realPool = body.realPool === "mariners" ? "mariners" : "stars";
  const pickTimer = normalizePickTimerSeconds(body.pickTimer);
  const cpuNames = Array.isArray(body.cpu)
    ? body.cpu.map((name) => String(name)).filter((name) => managers.includes(name))
    : [];

  // Every pool flavor deals a seeded slice of a deep set; the deal is
  // deterministic in the seed so clients rebuild the identical deck.
  const pool = poolMode === "real"
    ? realPool === "mariners" ? buildMarinersDraftPool(seed) : buildRealDraftPool(seed)
    : buildFictionalDraftPool(seed);
  const managerLimit = maxRealPoolManagers(pool);
  if (managers.length > managerLimit) {
    const poolLabel = poolMode === "real"
      ? realPool === "mariners" ? "all-era Mariners" : "real player"
      : "fictional";
    return sendJson(response, 400, {
      error: `The ${poolLabel} pool deals position depth for up to ${managerLimit} managers`
    });
  }
  const draft = createDraft(managers.map((name) => ({ name, cpu: cpuNames.includes(name) })), pool, rosterSize, seed);
  const room = {
    id: newRoomId(store.rooms),
    seed,
    rosterSize,
    poolMode,
    realPool,
    pickTimer,
    cpuNames,
    managerNames: managers,
    draft,
    actions: [],
    seats: new Map(),
    hostToken: newToken(),
    streams: new Set(),
    createdAt: Date.now()
  };
  store.rooms.set(room.id, room);
  persistRoom(store, room);
  sendJson(response, 201, { roomId: room.id, hostToken: room.hostToken, ...roomSnapshot(room) });
}

async function joinRoom(store, room, request, response) {
  const body = await readJsonBody(request);
  const manager = room.draft.managers.find((item) => item.id === body.managerId);
  if (!manager) return sendJson(response, 404, { error: "Unknown manager seat" });
  if (manager.cpu) return sendJson(response, 409, { error: `${manager.name} is a computer manager` });
  const existing = room.seats.get(manager.id);
  if (existing) return sendJson(response, 409, { error: `${manager.name} is already claimed` });
  const isHost = Boolean(body.hostToken) && body.hostToken === room.hostToken;
  const seat = { managerId: manager.id, token: newToken(), isHost };
  room.seats.set(manager.id, seat);
  persistRoom(store, room);
  broadcast(room, "seats", { seats: claimedSeats(room) });
  sendJson(response, 200, { token: seat.token, managerId: manager.id, host: isHost });
}

async function postAction(store, room, request, response) {
  const body = await readJsonBody(request);
  const action = body.action;
  const seat = [...room.seats.values()].find((item) => item.token === body.token);
  const isHost = Boolean(seat?.isHost) || (Boolean(body.token) && body.token === room.hostToken);
  if (!seat && !isHost) return sendJson(response, 403, { error: "Join a seat before acting" });

  const denial = denyAction(room.draft, seat, isHost, action);
  if (denial) return sendJson(response, 409, { error: denial });

  try {
    if (!SIM_ACTION_TYPES.has(action?.type)) applyDraftAction(room.draft, action);
  } catch (error) {
    return sendJson(response, 409, { error: error.message });
  }

  const entry = { seq: room.actions.length + 1, action };
  room.actions.push(entry);
  persistRoom(store, room);
  broadcast(room, "action", entry);
  sendJson(response, 200, { seq: entry.seq });
}

// Light turn enforcement: enough to keep a friendly room orderly, not
// anti-cheat. The host token bypasses seat checks so a stalled draft can
// always be moved along.
function denyAction(draft, seat, isHost, action) {
  const type = action?.type;
  if (type === "pick" || type === "autopick") {
    if (draft.complete) return "The draft is already complete";
    if (!isHost && currentManager(draft).id !== seat?.managerId) return "It is not your turn";
    return null;
  }
  if (type === "finish") {
    if (draft.complete) return "The draft is already complete";
    if (!isHost) return "Only the host can auto-finish the draft";
    return null;
  }
  if (type === "undo") {
    if (draft.pickNumber <= 0) return "There is nothing to undo";
    const lastPick = draftHistory(draft).at(-1);
    if (!isHost && lastPick?.manager.id !== seat?.managerId) return "Only the host or the last picker can undo";
    return null;
  }
  if (type === "lineup") {
    if (!isHost && action?.managerId !== seat?.managerId) return "You can only edit your own lineup";
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
  room.streams.add(response);
  request.on("close", () => room.streams.delete(response));
}

function broadcast(room, event, payload) {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const stream of room.streams) stream.write(message);
}

function roomSnapshot(room) {
  return {
    roomId: room.id,
    seed: room.seed,
    rosterSize: room.rosterSize,
    poolMode: room.poolMode,
    realPool: room.realPool ?? "stars",
    pickTimer: room.pickTimer ?? 0,
    managers: room.draft.managers.map((manager) => ({
      id: manager.id,
      name: manager.name,
      cpu: Boolean(manager.cpu),
      claimed: room.seats.has(manager.id)
    })),
    actions: room.actions,
    complete: room.draft.complete
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
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store"
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
  const { server, dataDir } = createOnlineServer();
  server.listen(port, () => {
    console.log(`Online rooms at http://127.0.0.1:${port}/index.html`);
    console.log(`Rooms persist in ${dataDir} and survive restarts.`);
    console.log("Share your LAN address (e.g. http://<your-ip>:" + port + "/index.html) with other players.");
  });
}
