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
import { readVisits } from "./visits.js";
import { zoneCity } from "./geo.js";

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
  const index = visitIndex(store);
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
    .map((row) => withSessions(store, withPlaces(store, row), index));
}

export function readDraft(store, id) {
  const log = store.drafts;
  if (!log || !/^[a-z0-9-]{1,80}$/i.test(String(id))) return null;
  try {
    const record = withPlaces(store, JSON.parse(readFileSync(join(log.dir, `${id}.json`), "utf8")));
    return withSessions(store, record, visitIndex(store));
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
  const proxies = store.traffic?.proxies ?? {};
  return {
    ...row,
    who: (row.who ?? []).map((seat) => ({
      ...seat,
      place: geo[seat.visitor] || "",
      org: orgs[seat.visitor] || "",
      proxy: Boolean(proxies[seat.visitor])
    }))
  };
}

// ---- What the visit log knows about a draft ---------------------------------
//
// A draft record holds the teams; the visit log holds the evening around them —
// who sat down, from where, how they got to the site, and how the season came
// out when somebody simmed it. They are two halves of one story and were being
// read as two, so the halves are joined here, on the way out.
//
// It also repairs the drafts filed before seats remembered anybody: a room from
// last week has no `who` of its own, but its room-join lines are still in the
// log, and they name the same people.
//
// The whole log is scanned to build this, so it is cached — but keyed on the
// size of the day being written, not on a clock: somebody who has just simmed
// their draft and hit refresh should see the season, not a minute of the old
// answer. Only today's file is ever appended to, so its size is the whole
// question of whether the log has moved.

// Every line that belongs to a draft says so in its own way.
function draftIdsForLine(line) {
  const data = line.data ?? {};
  const ids = [];
  if (data.roomId) ids.push(draftId({ roomId: data.roomId }));
  if (data.draftId) ids.push(String(data.draftId));
  // A local draft names itself by the key its page minted; the id it was filed
  // under is that key hashed with the device, which the line itself carries.
  if (data.draftKey && line.device) ids.push(draftId({ device: line.device, key: data.draftKey }));
  return ids;
}

function seatFromLine(line, manager, host) {
  return {
    manager: manager ?? "",
    host: Boolean(host),
    at: line.t,
    visitor: line.visitor,
    device: line.device,
    browser: line.browser,
    os: line.os,
    mobile: Boolean(line.mobile),
    lang: line.lang ?? "",
    edge: line.edge ?? "",
    place: line.place ?? "",
    org: line.org ?? "",
    proxy: Boolean(line.proxy)
  };
}

// What a browser said about itself when it opened. The time zone is the part
// worth keeping: it is a location the machine reports about itself, so it holds
// up where the IP does not — through a VPN, a relay, or a carrier gateway that
// puts a player in Vancouver because the exit node is.
function helloFacts(line) {
  const data = line.data ?? {};
  const zone = zoneCity(data.tz);
  if (!zone && !data.tz) return null;
  return {
    zone,
    tz: String(data.tz ?? "").slice(0, 60),
    langs: (Array.isArray(data.languages) ? data.languages : []).slice(0, 3).map((item) => String(item).slice(0, 12))
  };
}

// The season somebody ran on these teams, best record first. The standings are
// the client's own summary of the batch, so they are read defensively.
function simFromLine(line) {
  const data = line.data ?? {};
  const standings = (Array.isArray(data.standings) ? data.standings : [])
    .map((row) => ({ team: String(row?.team ?? ""), winPct: Number(row?.winPct) || 0 }))
    .sort((a, b) => b.winPct - a.winPct);
  if (!standings.length) return null;
  return { at: line.t, runs: Number(data.runs) || 0, standings };
}

function logStamp(store, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  try {
    return `${day}:${statSync(join(store.visits.dir, `${day}.jsonl`)).size}`;
  } catch {
    return `${day}:0`;
  }
}

function visitIndex(store, now = Date.now()) {
  const log = store.drafts;
  if (!log || !store.visits) return new Map();
  const stamp = logStamp(store, now);
  if (log.index?.stamp === stamp) return log.index.byDraft;
  const byDraft = new Map();
  const entry = (id) => {
    if (!byDraft.has(id)) byDraft.set(id, { seats: [], sims: [] });
    return byDraft.get(id);
  };
  // What each device last said about itself, so a seat can carry its own clock
  // and language rather than only what its address was taken for.
  const hellos = new Map();
  // Every place a device has ever been placed at, and the clock it was keeping
  // at the time. A phone changes address all day and most of those addresses
  // resolve to nothing; the evening it was on the home wifi resolved to a city,
  // and that is a fact about the phone, not about that one address.
  const devicePlaces = new Map();
  // 90 days is the whole visit log; a draft older than that keeps whatever it
  // was filed with and gains nothing here, which is the honest answer.
  // Newest first, so the first hello seen for a device is its latest.
  const zonesByVisitor = new Map();
  for (const line of readVisits(store, { days: 90 })) {
    if (line.kind === "hello" && line.device && !hellos.has(line.device)) {
      const facts = helloFacts(line);
      if (facts) hellos.set(line.device, facts);
    }
    // The clock an address was seen keeping, so a place borrowed from another
    // session can be checked against the clock of the session borrowing it.
    if (line.kind === "hello" && line.visitor && line.data?.tz && !zonesByVisitor.has(line.visitor)) {
      zonesByVisitor.set(line.visitor, String(line.data.tz));
    }
    if (line.device && line.place) noteDevicePlace(devicePlaces, line, zonesByVisitor);
    for (const id of draftIdsForLine(line)) {
      const found = entry(id);
      if (line.kind === "sim") {
        const sim = simFromLine(line);
        if (sim) found.sims.push(sim);
      } else if (line.kind === "room-join") {
        found.seats.push(seatFromLine(line, line.data?.manager, line.data?.host));
      } else if (line.kind === "room-create" || line.kind === "draft-done" || line.kind === "local-draft-start") {
        found.seats.push(seatFromLine(line, "", false));
      }
    }
  }
  // The clock a seat kept, folded in once every line has been read.
  for (const found of byDraft.values()) {
    for (const seat of found.seats) Object.assign(seat, hellos.get(seat.device) ?? {});
  }
  log.index = { stamp, byDraft, hellos, devicePlaces };
  return byDraft;
}

function noteDevicePlace(devicePlaces, line, zonesByVisitor) {
  const seen = devicePlaces.get(line.device) ?? [];
  const tz = zonesByVisitor.get(line.visitor) ?? "";
  const held = seen.find((row) => row.place === line.place && row.tz === tz);
  if (held) {
    held.count += 1;
    held.at = held.at > line.t ? held.at : line.t;
  } else {
    seen.push({ place: line.place, org: line.org ?? "", tz, count: 1, at: line.t });
  }
  devicePlaces.set(line.device, seen);
}

// The city a device is known to sit in, for a session whose own address named
// none. A phone on a carrier is a different address every hour and most of them
// resolve to nothing, but the same phone on the home wifi resolved to a city —
// so the device is the thing that has a location, not the address.
//
// A place is disqualified only by a clock that is known and DIFFERENT, which is
// what keeps a laptop's Vancouver-relay evening from being pinned onto its
// Toronto ones. A place seen on a visit that never said hello has no clock
// recorded against it and contradicts nothing — and that is the common case,
// since the sighting that places a phone is often a single page load. A place
// whose clock matches outright is still preferred to one that is merely silent;
// after that, most-seen wins and the most recent breaks a tie.
function placeFromDevice(devicePlaces, seat) {
  const seen = devicePlaces.get(seat.device);
  if (!seen?.length) return null;
  const usable = seen.filter((row) => !row.tz || !seat.tz || row.tz === seat.tz);
  const best = usable
    .map((row) => ({ ...row, sameClock: Boolean(row.tz && seat.tz && row.tz === seat.tz) }))
    .sort((a, b) =>
      Number(b.sameClock) - Number(a.sameClock)
      || b.count - a.count
      || String(b.at).localeCompare(String(a.at)))[0];
  return best ? { place: best.place, org: best.org, fromDevice: true } : null;
}

// One line per person. A seat filed with the draft is the better record — it
// names the chair — so it goes in first and the log only fills what it left
// blank. A line that names nobody (a room made, a draft filed) is the same
// person as the named seat on that device rather than a second one.
function mergeSeats(filed, logged) {
  const seats = [];
  for (const seat of [...filed, ...logged]) {
    if (!seat.device && !seat.visitor) continue;
    const held = seats.find((held) =>
      ((held.device && held.device === seat.device) || (held.visitor && held.visitor === seat.visitor))
      && (!seat.manager || !held.manager || held.manager === seat.manager));
    if (!held) {
      seats.push({ ...seat });
      continue;
    }
    for (const [field, value] of Object.entries(seat)) {
      if (value !== "" && value != null && (held[field] === "" || held[field] == null)) held[field] = value;
    }
  }
  return seats;
}

// A draft, with the evening around it: everyone the log can tie to it, and how
// the seasons somebody ran on those teams came out.
function withSessions(store, row, index) {
  const found = index.get(row.id) ?? { seats: [], sims: [] };
  const hellos = store.drafts?.index?.hellos ?? new Map();
  const devicePlaces = store.drafts?.index?.devicePlaces ?? new Map();
  const filed = (row.who ?? []).map((seat) => ({ ...(hellos.get(seat.device) ?? {}), ...seat }));
  const sims = [...found.sims].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  // A seat whose own address named nowhere borrows what the rest of its device's
  // evenings know.
  const who = mergeSeats(filed, found.seats).map((seat) =>
    seat.place ? seat : { ...seat, ...(placeFromDevice(devicePlaces, seat) ?? {}) });
  return {
    ...row,
    who,
    // Newest first; the one at the front is the season the book reports.
    sims: sims.slice(0, 5),
    winner: sims[0]?.standings?.[0] ?? null
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
