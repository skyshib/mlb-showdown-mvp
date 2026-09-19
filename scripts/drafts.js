// The draft book: every finished draft this site has seen, kept.
//
// Rooms are already persisted as an action log, but a room file is a machine's
// record — it needs the code that replays it to say anything, and it is deleted
// when the room is. This is the human one: one JSON file per finished draft,
// holding the settings, every roster, and who was in the chair, so a draft can
// still be read long after its room is gone. Local drafts, which never touch
// the room server at all, file their own through POST /api/drafts.
//
// Reading it takes VISITS_TOKEN, the same key as the visit log: it names people
// and says where they were, so like that log it has no public mode.
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const DRAFTS_DIR = "drafts";
const RETAIN_DAYS = 365;
// A record is a few kilobytes and a busy day is a handful of drafts, so the
// ceiling is a flood stop rather than a budget.
const MAX_DRAFTS = 1000;
const MAX_MANAGERS = 24;
const MAX_ROSTER = 60;

export function loadDraftArchive(dataDir) {
  const dir = join(dataDir, DRAFTS_DIR);
  mkdirSync(dir, { recursive: true });
  // Listing reads every file; summaries are cached against the file's mtime so
  // a page refresh re-reads only what changed.
  return { dir, chain: Promise.resolve(), summaries: new Map(), filings: new Map() };
}

// Filing is open to anyone with a browser, and the book has a ceiling: left
// unguarded, one script could push every real draft off the end of it in an
// afternoon. Nobody plays a dozen drafts an hour, so that is where the door
// shuts — in memory, per address, and forgotten on restart.
const FILINGS_PER_HOUR = 12;

export function allowFiling(store, visitor, now = Date.now()) {
  const filings = store.drafts?.filings;
  if (!filings) return true;
  const recent = (filings.get(visitor) ?? []).filter((at) => now - at < 3600_000);
  if (recent.length >= FILINGS_PER_HOUR) {
    filings.set(visitor, recent);
    return false;
  }
  recent.push(now);
  filings.set(visitor, recent);
  // Whoever has gone quiet for an hour is nobody we need to remember.
  if (filings.size > 500) {
    for (const [key, times] of filings) {
      if (!times.some((at) => now - at < 3600_000)) filings.delete(key);
    }
  }
  return true;
}

export async function flushDrafts(store) {
  await (store.drafts?.chain ?? Promise.resolve()).catch(() => {});
}

// An id nobody else can land on. A room's draft is filed under the room, so
// finishing it twice (an undo, another sweep) rewrites one record rather than
// piling up. A local draft has no room, so it is filed under the device that
// played it plus whatever key that device made up for the draft — hashed
// together, so one browser cannot choose an id that overwrites another's.
export function draftId({ roomId = "", device = "", key = "" }) {
  if (roomId) return `room-${String(roomId).replace(/[^a-z0-9-]/gi, "").slice(0, 60)}`;
  const hash = createHash("sha1").update(`${device}:${key}`).digest("hex").slice(0, 16);
  return `local-${hash}`;
}

// Atomic write (tmp + rename) chained across the archive so saves never
// interleave, the same discipline the rooms are saved with.
export function saveDraft(store, id, record) {
  const log = store.drafts;
  if (!log) return;
  const target = join(log.dir, `${id}.json`);
  const payload = JSON.stringify({ ...record, id });
  log.summaries.delete(target);
  log.chain = log.chain
    .then(() => writeFile(`${target}.tmp`, payload))
    .then(() => rename(`${target}.tmp`, target))
    .then(() => prune(log))
    .catch((error) => console.error(`Failed to file draft ${id}: ${error.message}`));
}

function prune(log) {
  const cutoff = Date.now() - RETAIN_DAYS * 86400 * 1000;
  const files = [];
  for (const name of safeReaddir(log.dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(log.dir, name);
    try {
      files.push({ path, at: statSync(path).mtimeMs });
    } catch {}
  }
  files.sort((a, b) => b.at - a.at);
  for (const [index, file] of files.entries()) {
    if (index < MAX_DRAFTS && file.at >= cutoff) continue;
    try {
      unlinkSync(file.path);
      log.summaries.delete(file.path);
    } catch {}
  }
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// Newest first, one line per draft: enough to choose which one to open, without
// carrying every roster in the country back to the browser.
export function listDrafts(store, { limit = 100 } = {}) {
  const log = store.drafts;
  if (!log) return [];
  const rows = [];
  for (const name of safeReaddir(log.dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(log.dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    const cached = log.summaries.get(path);
    if (cached?.mtimeMs === stat.mtimeMs) {
      rows.push(cached.summary);
      continue;
    }
    let record;
    try {
      record = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    const summary = summarize(record);
    log.summaries.set(path, { mtimeMs: stat.mtimeMs, summary });
    rows.push(summary);
  }
  return rows
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, Math.max(1, Math.min(MAX_DRAFTS, Math.floor(Number(limit)) || 100)))
    .map((row) => withPlaces(store, row));
}

export function readDraft(store, id) {
  const log = store.drafts;
  if (!log || !/^[a-z0-9-]{1,80}$/i.test(String(id))) return null;
  try {
    return withPlaces(store, JSON.parse(readFileSync(join(log.dir, `${id}.json`), "utf8")));
  } catch {
    return null;
  }
}

// The card counts, not the cards.
function summarize(record) {
  return {
    id: record.id,
    at: record.at,
    source: record.source,
    roomId: record.roomId ?? null,
    universe: record.universe ?? null,
    seed: record.seed,
    draftType: record.draftType,
    nomination: record.nomination ?? null,
    rosterSize: record.rosterSize,
    startingPitchers: record.startingPitchers,
    budget: record.budget ?? null,
    complete: Boolean(record.complete),
    page: record.page ?? "",
    managers: (record.managers ?? []).map((manager) => ({
      name: manager.name,
      cpu: Boolean(manager.cpu),
      persona: manager.persona ?? null,
      points: manager.points ?? 0,
      spent: manager.spent ?? null,
      cards: (manager.roster ?? []).length
    })),
    who: record.who ?? []
  };
}

// Place and ISP are joined in at read time from the traffic geo cache, exactly
// as the visit log does it: the lookup usually lands a second after the visit,
// and the raw address is never written down either way.
function withPlaces(store, row) {
  const geo = store.traffic?.geoCache ?? {};
  const orgs = store.traffic?.orgs ?? {};
  return {
    ...row,
    who: (row.who ?? []).map((seat) => ({
      ...seat,
      place: geo[seat.visitor] || "",
      org: orgs[seat.visitor] || ""
    }))
  };
}

// ---- The public door --------------------------------------------------------
// A local draft is filed by the browser that played it, so every field arrives
// from somewhere we do not control and is rebuilt here rather than trusted:
// strings sliced, numbers clamped, lists capped, and anything unrecognised
// dropped. Same discipline as the hall of fame.

function text(value, max = 80) {
  return String(value ?? "").slice(0, max);
}

function number(value, max = 1e7) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(-max, Math.min(max, Math.round(parsed))) : 0;
}

function card(entry) {
  const clean = {
    id: text(entry?.id, 60),
    name: text(entry?.name, 80),
    pos: text(entry?.pos, 20),
    kind: entry?.kind === "pitcher" ? "pitcher" : entry?.kind === "coach" ? "coach" : "hitter",
    pts: number(entry?.pts, 100000)
  };
  if (entry?.pick != null) clean.pick = number(entry.pick, 10000);
  if (entry?.round != null) clean.round = number(entry.round, 1000);
  if (entry?.price != null) clean.price = number(entry.price, 1e6);
  if (entry?.replacement) clean.replacement = true;
  return clean;
}

function manager(entry) {
  const clean = {
    id: text(entry?.id, 40),
    name: text(entry?.name, 60),
    cpu: Boolean(entry?.cpu),
    persona: entry?.persona ? text(entry.persona, 40) : null,
    points: number(entry?.points, 1e6),
    roster: (Array.isArray(entry?.roster) ? entry.roster : []).slice(0, MAX_ROSTER).map(card)
  };
  if (entry?.spent != null) clean.spent = number(entry.spent, 1e6);
  if (entry?.left != null) clean.left = number(entry.left, 1e6);
  return clean;
}

export function sanitizeDraftRecord(body) {
  const managers = Array.isArray(body?.managers) ? body.managers.slice(0, MAX_MANAGERS).map(manager) : [];
  if (!managers.length) return null;
  return {
    at: new Date().toISOString(),
    seed: text(body?.seed, 60),
    universe: body?.universe ? text(body.universe, 40) : null,
    draftType: body?.draftType === "auction" ? "auction" : "snake",
    nomination: body?.nomination === "random" ? "random" : "manual",
    rosterSize: number(body?.rosterSize, 200),
    startingPitchers: number(body?.startingPitchers, 20),
    bullpenSlots: body?.bullpenSlots == null ? null : number(body.bullpenSlots, 30),
    bullpenMin: body?.bullpenMin == null ? null : number(body.bullpenMin, 30),
    hidePoints: Boolean(body?.hidePoints),
    coaches: Boolean(body?.coaches),
    budget: body?.budget == null ? null : number(body.budget, 1e7),
    picks: number(body?.picks, 10000),
    complete: Boolean(body?.complete),
    page: text(body?.page, 100),
    managers
  };
}
