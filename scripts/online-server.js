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
import {
  applyDraftAction,
  createDraft,
  currentManager,
  draftHistory,
  isAuctionDraft,
  syncAuctionTimer
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
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

export function createOnlineServer(options = {}) {
  const dataDir = options.dataDir ?? process.env.ROOMS_DIR ?? join(root, "data", "rooms");
  const store = { dataDir, rooms: loadRooms(dataDir) };

  for (const room of store.rooms.values()) scheduleRoomTimer(store, room);

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
    if (!file.endsWith(".json")) continue;
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
  const realPool = saved.realPool === "mariners" ? "mariners" : "stars";
  // Must deal exactly as createRoom did, or the replayed action log references
  // cards that are not in the revived pool.
  const pool = saved.poolMode === "real"
    ? realPool === "mariners"
      ? buildMarinersDraftPool(saved.seed)
      : buildRealDraftPool(saved.seed)
    : buildFictionalDraftPool(saved.seed);
  const draftType = saved.draftType === "auction" ? "auction" : "snake";
  const draft = createDraft(managerNames, pool, saved.rosterSize, saved.seed, {
    draftType,
    budget: saved.auctionBudget,
    timer: saved.auctionTimer
  });
  const actions = saved.actions ?? [];
  for (const entry of actions) applyDraftAction(draft, entry.action);
  return {
    id: saved.id,
    seed: saved.seed,
    rosterSize: saved.rosterSize,
    poolMode: saved.poolMode === "real" ? "real" : "random",
    realPool,
    draftType,
    auctionBudget: draft.auction?.budget ?? null,
    auctionTimer: draft.auction?.timer ?? null,
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
    draftType: room.draftType,
    auctionBudget: room.auctionBudget,
    auctionTimer: room.auctionTimer,
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

async function handleApi(store, request, response, url) {
  const segments = url.pathname.split("/").filter(Boolean);
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
  const draftType = body.draftType === "auction" ? "auction" : "snake";

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
  const draft = createDraft(managers, pool, rosterSize, seed, {
    draftType,
    budget: body.auctionBudget,
    timer: body.auctionTimer
  });
  const createdAt = Date.now();
  const actions = [];
  if (isAuctionDraft(draft)) {
    const action = { type: "start-review", at: createdAt };
    applyDraftAction(draft, action);
    actions.push({ seq: 1, action });
  }
  const room = {
    id: newRoomId(store.rooms),
    seed,
    rosterSize,
    poolMode,
    realPool,
    draftType,
    auctionBudget: draft.auction?.budget ?? null,
    auctionTimer: draft.auction?.timer ?? null,
    managerNames: managers,
    draft,
    actions,
    seats: new Map(),
    hostToken: newToken(),
    streams: new Set(),
    createdAt
  };
  store.rooms.set(room.id, room);
  persistRoom(store, room);
  scheduleRoomTimer(store, room);
  sendJson(response, 201, { roomId: room.id, hostToken: room.hostToken, ...roomSnapshot(room) });
}

async function joinRoom(store, room, request, response) {
  const body = await readJsonBody(request);
  const manager = room.draft.managers.find((item) => item.id === body.managerId);
  if (!manager) return sendJson(response, 404, { error: "Unknown manager seat" });
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
  const action = canonicalizeAction(room.draft, body.action);
  const seat = [...room.seats.values()].find((item) => item.token === body.token);
  const isHost = Boolean(seat?.isHost) || (Boolean(body.token) && body.token === room.hostToken);
  if (!seat && !isHost) return sendJson(response, 403, { error: "Join a seat before acting" });

  if (isAuctionDraft(room.draft)) syncRoomTimer(store, room, action?.at);
  const denial = denyAction(room.draft, seat, isHost, action);
  if (denial) return sendJson(response, 409, { error: denial });

  try {
    applyDraftAction(room.draft, action);
  } catch (error) {
    return sendJson(response, 409, { error: error.message });
  }

  const entry = appendRoomAction(store, room, action);
  scheduleRoomTimer(store, room);
  sendJson(response, 200, { seq: entry.seq });
}

function canonicalizeAction(draft, action) {
  if (!action || typeof action !== "object") return action;
  if (!isAuctionDraft(draft)) return { ...action };
  return { ...action, at: Date.now() };
}

function appendRoomAction(store, room, action) {
  const entry = { seq: room.actions.length + 1, action };
  room.actions.push(entry);
  persistRoom(store, room);
  broadcast(room, "action", entry);
  return entry;
}

function syncRoomTimer(store, room, now = Date.now()) {
  if (!syncAuctionTimer(room.draft, now)) return null;
  return appendRoomAction(store, room, { type: "sync-timer", at: now });
}

function scheduleRoomTimer(store, room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  const deadline = nextRoomTimerDeadline(room.draft);
  if (deadline === null) return;
  const delay = Math.max(1, deadline - Date.now());
  room.timer = setTimeout(() => {
    room.timer = null;
    syncRoomTimer(store, room, Date.now());
    scheduleRoomTimer(store, room);
  }, delay);
  room.timer.unref();
}

function nextRoomTimerDeadline(draft) {
  if (!isAuctionDraft(draft) || !draft.auction?.timer?.enabled || draft.complete) return null;
  const review = draft.auction.review;
  if (review?.completedAt === null && Number.isFinite(review.endsAt)) return review.endsAt;
  const clock = draft.auction.lot?.clock;
  if (!clock?.pending?.length) return null;
  const deadlines = clock.pending
    .map((managerId) => clock.startedAt + Math.max(0, Number(draft.auction.clockBanks[managerId]) || 0))
    .filter(Number.isFinite);
  return deadlines.length ? Math.min(...deadlines) : null;
}

// Light turn enforcement: enough to keep a friendly room orderly, not
// anti-cheat. The host token bypasses seat checks so a stalled draft can
// always be moved along.
function denyAction(draft, seat, isHost, action) {
  const type = action?.type;
  if (type === "lineup") {
    if (!isHost && action?.managerId !== seat?.managerId) return "You can only edit your own lineup";
    return null;
  }
  if (isAuctionDraft(draft)) return denyAuctionAction(draft, seat, isHost, action);
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
  return `Unknown draft action: ${type}`;
}

function denyAuctionAction(draft, seat, isHost, action) {
  const type = action?.type;
  if (type === "nominate" || type === "autopick") {
    if (draft.complete) return "The draft is already complete";
    if (!isHost && currentManager(draft).id !== seat?.managerId) return "It is not your nomination";
    return null;
  }
  if (type === "bid" || type === "pass-bid") {
    if (!isHost && action?.managerId !== seat?.managerId) return "You can only bid for your own team";
    return null;
  }
  if (type === "complete-review") {
    return isHost ? null : "Only the host can end pool review early";
  }
  if (type === "sell" || type === "cancel-lot") {
    return isHost ? null : "Only the host can resolve the current lot";
  }
  if (type === "finish" || type === "undo") {
    return isHost ? null : `Only the host can ${type === "finish" ? "auto-finish" : "undo"} the auction`;
  }
  return `Unknown auction action: ${type}`;
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
    draftType: room.draftType ?? "snake",
    auctionBudget: room.auctionBudget,
    auctionTimer: room.auctionTimer,
    managers: room.draft.managers.map((manager) => ({
      id: manager.id,
      name: manager.name,
      claimed: room.seats.has(manager.id)
    })),
    actions: room.actions,
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
