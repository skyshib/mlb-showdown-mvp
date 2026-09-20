// Who is actually playing, and from where.
//
// The host gives us no visitor analytics and no country header — only the IP it
// saw (Fly-Client-IP) and the three-letter code of the edge that took the
// connection (Fly-Region). The edge is not where the player is, but it is the
// edge nearest to them, so it reads as a coarse map: `nrt` is somebody in Japan,
// `lhr` somebody in or near Britain. That is the location signal available
// without shipping a third-party script, and it is enough to answer "is anyone
// out there, and where".
//
// What is kept is aggregates, not a log. An append-only hit log on a 1GB volume
// is a slow leak with a deadline; counters are small, and they answer the
// questions actually being asked (how many, which pages, from where, sent by
// whom). The only per-visitor thing retained is a salted hash of the IP, held
// per day so a day can report people rather than pageviews, and dropped with the
// day it belongs to. The raw IP is never written down. (The per-visit log lives
// beside this, in visits.js, behind its own token.)
import { mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createGeoQueue, isPrivateIp, zoneCity } from "./geo.js";

const TRAFFIC_FILE = "traffic.json";
// The place a visitor's IP resolved to, remembered against the same hash the day
// buckets already use — so a returning player is never looked up twice. Capped,
// and the oldest entries fall off the front (string keys keep insertion order),
// which bounds both the file and how long any one person's city is retained.
const MAX_GEO_CACHE = 5000;
// Long enough to see a season's shape, short enough that the visitor hashes for
// a day that no longer matters do not sit on the disk forever.
const RETAIN_DAYS = 90;
// A guard on the long tail, not a budget. Paths are entry points and referrers
// are other people's sites; if either is running to thousands of distinct keys
// it is somebody probing the server, and the tail is noise worth capping.
const MAX_KEYS = 200;
const WRITE_DEBOUNCE_MS = 5000;

// Anything that announces itself as a crawler. This will not catch a bot that
// lies, but the ones that lie are not the ones inflating the count — the honest
// ones are, constantly, and a pageview graph that is mostly Googlebot is worse
// than no graph.
const BOT_PATTERN = /bot|crawl|spider|slurp|fetch|monitor|preview|headless|curl|wget|python-requests|axios|okhttp/i;

export function loadTrafficFile(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  let saved = null;
  try {
    saved = JSON.parse(readFileSync(join(dataDir, TRAFFIC_FILE), "utf8"));
  } catch {
    saved = null;
  }
  return {
    // Persisted, not regenerated per boot: the hash is only a stable identity for
    // as long as the salt behind it is stable, and a fresh salt on every wake
    // would make every returning player a new person. The machine sleeps
    // whenever the last room empties, so that is most of them.
    salt: typeof saved?.salt === "string" && saved.salt.length >= 16 ? saved.salt : randomBytes(16).toString("hex"),
    totalViews: countOf(saved?.totalViews),
    days: plainCounts(saved?.days, (value) => ({
      views: countOf(value?.views),
      visitors: Array.isArray(value?.visitors) ? value.visitors.filter((id) => typeof id === "string") : []
    })),
    paths: plainCounts(saved?.paths, countOf),
    regions: plainCounts(saved?.regions, countOf),
    referrers: plainCounts(saved?.referrers, countOf),
    places: plainCounts(saved?.places, countOf),
    // Where people are by their own clock. The addresses above are a third
    // party's guess and are wrong wherever a VPN, a relay or a carrier gateway
    // sits in the way; a browser's time zone comes from the machine itself.
    zones: plainCounts(saved?.zones, countOf),
    geoCache: plainCounts(saved?.geoCache, (value) => (typeof value === "string" ? value : "")),
    // The network behind a visitor ("Comcast Cable", "UC Berkeley", "Google LLC"),
    // kept beside the place and pruned with it.
    orgs: plainCounts(saved?.orgs, (value) => (typeof value === "string" ? value : "")),
    // Addresses the provider calls a proxy or VPN exit. The place recorded for
    // one of these is where the exit node is, not where anybody is sitting, and
    // saying so is the difference between a wrong answer and a caveated one.
    proxies: plainCounts(saved?.proxies, (value) => (value ? 1 : 0))
  };
}

function countOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function plainCounts(source, coerce) {
  const out = {};
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) out[key] = coerce(value);
  }
  return out;
}

// Atomic write (tmp + rename), debounced. A pageview is not worth a disk write of
// its own, but the machine stops as soon as the last person leaves, so a write
// that is merely scheduled is a write that may never happen — `flushTraffic` is
// what the shutdown path waits on.
export function persistTraffic(store) {
  if (!store.dataDir || !store.traffic) return;
  if (store.trafficWriteTimer) return;
  store.trafficWriteTimer = setTimeout(() => {
    store.trafficWriteTimer = null;
    writeTraffic(store);
  }, WRITE_DEBOUNCE_MS);
  store.trafficWriteTimer.unref();
}

function writeTraffic(store) {
  const target = join(store.dataDir, TRAFFIC_FILE);
  const tmp = `${target}.tmp`;
  store.trafficSaveChain = (store.trafficSaveChain ?? Promise.resolve())
    .then(() => writeFile(tmp, JSON.stringify(store.traffic)))
    .then(() => rename(tmp, target))
    .catch((error) => console.error(`Failed to save traffic: ${error.message}`));
  return store.trafficSaveChain;
}

export async function flushTraffic(store) {
  if (!store.dataDir || !store.traffic) return;
  if (store.trafficWriteTimer) {
    clearTimeout(store.trafficWriteTimer);
    store.trafficWriteTimer = null;
    writeTraffic(store);
  }
  await (store.trafficSaveChain ?? Promise.resolve()).catch(() => {});
}

// Called for page loads only — never for the 3543 card fronts, the modules, or
// the fonts. A "view" here means a person opened a page, which is the thing being
// counted; counting assets would mean a card-heavy screen registering as three
// hundred visits.
export function recordView(store, request, pathname, now = new Date()) {
  const traffic = store.traffic;
  if (!traffic) return;
  // Reading the numbers must not move them. Left in, checking the stats twice a
  // day makes the stats page the most popular thing on the site.
  if (pathname === "/stats.html") return;
  const agent = String(request.headers["user-agent"] ?? "");
  if (!agent || isBotAgent(agent)) return;

  const day = now.toISOString().slice(0, 10);
  const bucket = traffic.days[day] ?? (traffic.days[day] = { views: 0, visitors: [] });
  bucket.views += 1;
  traffic.totalViews += 1;

  const ip = clientIp(request);
  const visitor = visitorId(traffic.salt, ip);
  if (visitor && !bucket.visitors.includes(visitor)) bucket.visitors.push(visitor);
  if (visitor) attributePlace(store, visitor, ip);

  bump(traffic.paths, pathname);
  const region = String(request.headers["fly-region"] ?? "").toLowerCase();
  bump(traffic.regions, /^[a-z]{3}$/.test(region) ? region : "local");
  const source = referrerHost(request.headers.referer);
  if (source) bump(traffic.referrers, source);

  prune(traffic, day);
  persistTraffic(store);
}

// A place we already know is counted on the spot. A place we don't is looked up
// off to the side — the response goes out first, always. The view is not thrown
// away while we wait: it is parked against the visitor and counted when the
// answer lands, so a page opened three times by a stranger arrives as three views
// from their city rather than one, or none.
function attributePlace(store, visitor, ip, views = 1) {
  const traffic = store.traffic;
  const known = traffic.geoCache[visitor];
  if (known !== undefined) {
    if (known && views) bump(traffic.places, known);
    if (known && traffic.orgs[visitor] === undefined) backfillOrg(store, visitor, ip);
    return;
  }
  if (process.env.GEO_LOOKUP === "off") return;
  // Checked here rather than inside the provider, so that swapping the provider
  // cannot quietly start shipping somebody's LAN address off the box. The guard
  // belongs at the door, not in the room.
  if (isPrivateIp(ip)) return;

  const waiting = (store.geoPending ??= new Map());
  if (waiting.has(visitor)) {
    waiting.set(visitor, waiting.get(visitor) + views);
    return;
  }
  waiting.set(visitor, views);

  const queue = (store.geoQueue ??= createGeoQueue(store.geoLookup, store.geoIntervalMs));
  queue.submit(ip).then((found) => {
    const pending = waiting.get(visitor) ?? 0;
    waiting.delete(visitor);
    const place = typeof found === "string" ? found : found?.place ?? "";
    if (!place) return;
    traffic.geoCache[visitor] = place;
    traffic.orgs[visitor] = typeof found === "object" ? found?.org ?? "" : "";
    if (typeof found === "object" && found?.proxy) traffic.proxies[visitor] = 1;
    for (let i = 0; i < pending; i++) bump(traffic.places, place);
    pruneGeoCache(traffic);
    persistTraffic(store);
  });
}

// A page view is not the only moment we hear from somebody, and the view's own
// lookup can fail — the provider times out, or the machine stops with the
// question still in the air. Every other thing the server logs (a seat taken, a
// draft filed, a season simmed) is another chance at the same answer, so it
// takes one. Nothing is counted here: this asks where somebody is, it does not
// claim they visited again.
export function ensurePlace(store, request) {
  const traffic = store.traffic;
  if (!traffic) return;
  const ip = clientIp(request);
  const visitor = visitorId(traffic.salt, ip);
  if (!visitor || traffic.geoCache[visitor] !== undefined) return;
  attributePlace(store, visitor, ip, 0);
}

// A browser saying what time zone it is in, counted as a place. One per page
// that says hello, which is one per page load — the same thing `places` counts,
// so the two lists are read against each other honestly.
export function noteZone(store, zone) {
  const traffic = store.traffic;
  const city = zoneCity(zone);
  if (!traffic || !city) return;
  bump(traffic.zones, city);
  persistTraffic(store);
}

// Visitors placed before networks were recorded get one more lookup, for the
// network alone. Marked "" up front so a busy returning visitor asks once.
function backfillOrg(store, visitor, ip) {
  if (process.env.GEO_LOOKUP === "off" || isPrivateIp(ip)) return;
  const traffic = store.traffic;
  traffic.orgs[visitor] = "";
  const queue = (store.geoQueue ??= createGeoQueue(store.geoLookup, store.geoIntervalMs));
  queue.submit(ip).then((found) => {
    // A failed lookup stays "" — the network is a nice-to-have, not worth a
    // lookup on every visit from somebody the provider cannot place.
    if (typeof found !== "object" || !found?.org) return;
    traffic.orgs[visitor] = found.org;
    persistTraffic(store);
  });
}

function pruneGeoCache(traffic) {
  const keys = Object.keys(traffic.geoCache);
  for (let i = 0; i < keys.length - MAX_GEO_CACHE; i++) {
    delete traffic.geoCache[keys[i]];
    delete traffic.orgs[keys[i]];
    delete traffic.proxies[keys[i]];
  }
}

function bump(counts, key) {
  if (!key) return;
  if (counts[key] === undefined && Object.keys(counts).length >= MAX_KEYS) return;
  counts[key] = (counts[key] ?? 0) + 1;
}

export function isBotAgent(agent) {
  return BOT_PATTERN.test(agent);
}

export function clientIp(request) {
  const direct = request.headers["fly-client-ip"];
  if (typeof direct === "string" && direct) return direct;
  // Only consulted when Fly's own header is absent, i.e. running locally. The
  // leftmost entry is the client as the first proxy saw it.
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return request.socket?.remoteAddress ?? "";
}

export function visitorId(salt, ip) {
  if (!ip) return "";
  // Truncated because the whole digest is not needed to tell two people apart at
  // this scale, and a shorter one is a weaker handle on somebody if the file ever
  // leaves the volume.
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

function referrerHost(referer) {
  if (typeof referer !== "string" || !referer) return "";
  try {
    const host = new URL(referer).hostname.toLowerCase();
    // A click from one page of the site to another is navigation, not a source.
    // Left in, the top referrer is always the site itself, which tells us nothing.
    if (!host || host === "localhost" || host.endsWith("fly.dev")) return "";
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function prune(traffic, today) {
  const days = Object.keys(traffic.days);
  if (days.length <= RETAIN_DAYS) return;
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETAIN_DAYS);
  const oldest = cutoff.toISOString().slice(0, 10);
  for (const day of days) {
    if (day < oldest) delete traffic.days[day];
  }
}

// The shape the /api/stats endpoint hands back, and the only place the visitor
// hashes are turned into a number instead of being passed along.
export function trafficSummary(traffic, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const days = Object.keys(traffic.days).sort();
  const recent = days.slice(-30).map((day) => ({
    day,
    views: traffic.days[day].views,
    visitors: traffic.days[day].visitors.length
  }));
  const last30 = recent.reduce((sum, entry) => sum + entry.views, 0);
  // Union across days, not a sum: somebody who played on Tuesday and again on
  // Friday is one person who came back, and summing the days would call them two.
  const uniqueVisitors = new Set();
  for (const day of days.slice(-30)) {
    for (const id of traffic.days[day].visitors) uniqueVisitors.add(id);
  }
  return {
    totalViews: traffic.totalViews,
    today: {
      views: traffic.days[today]?.views ?? 0,
      visitors: traffic.days[today]?.visitors.length ?? 0
    },
    last30Days: { views: last30, visitors: uniqueVisitors.size },
    days: recent,
    paths: topKeys(traffic.paths),
    places: topKeys(traffic.places),
    zones: topKeys(traffic.zones ?? {}),
    regions: topKeys(traffic.regions),
    referrers: topKeys(traffic.referrers)
  };
}

function topKeys(counts, limit = 25) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, views]) => ({ key, views }));
}
