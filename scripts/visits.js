// Who, one visit at a time.
//
// traffic.js keeps counters: how many, which pages, which cities. This keeps the
// log behind them — every page load and every thing a page reports doing, as one
// JSON line in a file per day — so a question like "did that friend draft at
// lunch, and how did they get here" has an answer instead of a total.
//
// A line carries what the request itself says: when, the salted IP hash traffic.js
// already uses, a device id kept in a first-party cookie (so one phone moving
// from wifi to cellular stays one phone, and two laptops on one router stay two),
// the browser and OS read off the user agent, the language, the edge, and the
// referrer exactly as the browser sent it. Place and ISP are not written on the
// line; they are joined in from the traffic geo cache when the log is read, since
// the lookup usually lands a second after the view does. The raw IP is still
// never written down.
//
// Reading it takes VISITS_TOKEN. /api/stats is public unless STATS_TOKEN is set;
// this log names people, so it has no public mode at all.
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { clientIp, ensurePlace, isBotAgent, noteZone, visitorId } from "./traffic.js";

const VISITS_DIR = "visits";
const RETAIN_DAYS = 90;
// A day of real play is kilobytes. This is the ceiling a flood hits.
const MAX_DAY_BYTES = 20 * 1024 * 1024;
const MAX_EVENT_BYTES = 8 * 1024;
export const DEVICE_COOKIE = "sd_device";
const DEVICE_MAX_AGE_SECONDS = 400 * 86400;

export function loadVisitLog(dataDir) {
  const dir = join(dataDir, VISITS_DIR);
  mkdirSync(dir, { recursive: true });
  return { dir, day: null, bytes: 0, chain: Promise.resolve() };
}

function dayFile(log, day) {
  return join(log.dir, `${day}.jsonl`);
}

function append(store, line, now) {
  const log = store.visits;
  if (!log) return;
  const day = now.toISOString().slice(0, 10);
  if (log.day !== day) {
    log.day = day;
    try {
      log.bytes = statSync(dayFile(log, day)).size;
    } catch {
      log.bytes = 0;
    }
    pruneOldDays(log, day);
  }
  const text = `${JSON.stringify(line)}\n`;
  if (log.bytes + text.length > MAX_DAY_BYTES) return;
  log.bytes += text.length;
  const file = dayFile(log, day);
  log.chain = log.chain
    .then(() => appendFile(file, text))
    .catch((error) => console.error(`Failed to log visit: ${error.message}`));
}

function pruneOldDays(log, today) {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETAIN_DAYS);
  const oldest = cutoff.toISOString().slice(0, 10);
  for (const file of safeReaddir(log.dir)) {
    if (file.endsWith(".jsonl") && file.slice(0, 10) < oldest) {
      try {
        unlinkSync(join(log.dir, file));
      } catch {}
    }
  }
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export async function flushVisits(store) {
  await (store.visits?.chain ?? Promise.resolve()).catch(() => {});
}

function readCookie(request, name) {
  const header = request.headers.cookie;
  if (typeof header !== "string") return "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

// The id a page load should carry, and the Set-Cookie to hand back when the
// browser arrived without one. Ids are ours, so anything that doesn't look like
// one is treated as absent rather than trusted into the log.
export function deviceFor(request) {
  const existing = cookieDevice(request);
  if (existing) return { device: existing, setCookie: null };
  const device = randomBytes(8).toString("hex");
  const secure = request.headers["fly-forwarded-proto"] === "https" ? "; Secure" : "";
  return {
    device,
    setCookie: `${DEVICE_COOKIE}=${device}; Max-Age=${DEVICE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`
  };
}

// Enough to tell an iPhone in the Google app from Chrome on a Mac at a glance.
// The raw agent rides along on the line for anything this misses.
export function describeAgent(agent) {
  const ua = String(agent ?? "");
  const browser =
    /GSA\//.test(ua) ? "Google app"
    : /FBAN|FBAV|FB_IAB/.test(ua) ? "Facebook app"
    : /Instagram/.test(ua) ? "Instagram app"
    : /Snapchat/.test(ua) ? "Snapchat app"
    : /Line\//.test(ua) ? "LINE app"
    : /EdgA?\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "other";
  const os =
    /iPad/.test(ua) ? "iPadOS"
    : /iPhone|iPod/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : "other";
  const mobile = /Mobi|iPhone|Android(?!.*Tablet)/.test(ua) && !/iPad/.test(ua);
  return { browser, os, mobile };
}

function requestBasics(store, request, device, now) {
  const agent = String(request.headers["user-agent"] ?? "");
  const salt = store.traffic?.salt;
  // Anything worth logging is worth another try at placing, for a visitor the
  // geo cache has nothing on yet. Known visitors cost a map lookup.
  if (!isBotAgent(agent)) ensurePlace(store, request);
  return {
    t: now.toISOString(),
    visitor: salt ? visitorId(salt, clientIp(request)) : "",
    device,
    ...describeAgent(agent),
    bot: !agent || isBotAgent(agent),
    lang: String(request.headers["accept-language"] ?? "").slice(0, 80),
    edge: String(request.headers["fly-region"] ?? "").slice(0, 8),
    ua: agent.slice(0, 400)
  };
}

// What a request says about whoever sent it, for a record that is not a visit —
// the seat somebody took, the draft they filed. Same fields the log writes, so
// place and ISP join in from the geo cache the same way.
export function describeRequest(store, request, now = new Date()) {
  const { t, ...rest } = requestBasics(store, request, cookieDevice(request), now);
  return rest;
}

function cookieDevice(request) {
  const id = readCookie(request, DEVICE_COOKIE);
  return /^[a-f0-9]{16}$/.test(id) ? id : "";
}

// The query string is worth keeping — it carries the room a link was for — but
// not the tokens in it: this page is read at /stats.html?token=…, and a log that
// writes down the key to itself is a log that hands it to whoever reads it.
function safeQuery(query) {
  if (!query) return "";
  try {
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    for (const key of [...params.keys()]) {
      if (/token|key|secret|password/i.test(key)) params.set(key, "…");
    }
    const text = params.toString();
    return text ? `?${decodeURIComponent(text)}`.slice(0, 200) : "";
  } catch {
    return "";
  }
}

export function logPageView(store, request, { path, query, device, setCookie }, now = new Date()) {
  append(store, {
    ...requestBasics(store, request, device, now),
    kind: "view",
    path,
    query: safeQuery(query),
    newDevice: Boolean(setCookie),
    referrer: String(request.headers.referer ?? "").slice(0, 300),
    fetchSite: String(request.headers["sec-fetch-site"] ?? "")
  }, now);
}

// Something the server saw happen — a room made, a seat taken — logged against
// whoever did it.
export function logServerEvent(store, request, kind, data, now = new Date()) {
  append(store, { ...requestBasics(store, request, cookieDevice(request), now), kind, data }, now);
}

// POST /api/events — something a page reports about itself. The page is ours but
// the endpoint is public, so the shape is checked and the size is capped.
export function logClientEvent(store, request, body, now = new Date()) {
  const kind = typeof body?.kind === "string" && /^[a-z0-9-]{1,40}$/.test(body.kind) ? body.kind : "";
  if (!kind) return false;
  const data = body.data && typeof body.data === "object" ? body.data : {};
  const json = JSON.stringify(data);
  if (json.length > MAX_EVENT_BYTES) return false;
  // A page's hello carries the one location signal that is not a guess made
  // about somebody: the clock on their own machine.
  if (kind === "hello" && !isBotAgent(String(request.headers["user-agent"] ?? ""))) noteZone(store, data.tz);
  append(store, {
    ...requestBasics(store, request, cookieDevice(request), now),
    kind,
    page: typeof body.page === "string" ? body.page.slice(0, 100) : "",
    data
  }, now);
  return true;
}

// Newest first, with place and ISP joined in from the traffic geo cache.
export function readVisits(store, { days = 3, kind = "", visitor = "", device = "", humansOnly = false } = {}, now = new Date()) {
  const log = store.visits;
  if (!log) return [];
  const span = Math.max(1, Math.min(RETAIN_DAYS, Math.floor(Number(days)) || 3));
  const wanted = new Set();
  for (let i = 0; i < span; i++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - i);
    wanted.add(`${date.toISOString().slice(0, 10)}.jsonl`);
  }
  const geo = store.traffic?.geoCache ?? {};
  const orgs = store.traffic?.orgs ?? {};
  const proxies = store.traffic?.proxies ?? {};
  const lines = [];
  for (const file of safeReaddir(log.dir).filter((name) => wanted.has(name)).sort()) {
    let text = "";
    try {
      text = readFileSync(join(log.dir, file), "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split("\n")) {
      if (!raw) continue;
      let line;
      try {
        line = JSON.parse(raw);
      } catch {
        continue;
      }
      if (kind && line.kind !== kind) continue;
      if (visitor && line.visitor !== visitor) continue;
      if (device && line.device !== device) continue;
      if (humansOnly && line.bot) continue;
      lines.push({
        ...line,
        place: geo[line.visitor] || "",
        org: orgs[line.visitor] || "",
        proxy: Boolean(proxies[line.visitor])
      });
    }
  }
  return lines.reverse();
}
