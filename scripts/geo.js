// Turning an IP into a place.
//
// This is the one thing on the server that talks to somebody else's computer, so
// it is worth being plain about what leaves the building: a visitor's IP is sent
// to the geo provider, once, the first time that visitor is seen. It is never
// written to our disk — what gets written is the place that comes back, counted
// in aggregate. The IP is a means, not a record.
//
// Three providers, tried in order until one of them names a place.
//
// They are not equally good, and the difference is a whole city. Asked about
// addresses whose real location is not in doubt — universities — ipwho.is
// answered with the nearest big city rather than the right one: Boston for MIT
// in Cambridge, San Francisco for Berkeley (twice), San Jose for Stanford. On
// the same five addresses ipinfo and freeipapi each named the right city.
//
//   1. ipinfo.io, when IPINFO_TOKEN is set. The best of them, 50k lookups a
//      month, and it wants an account, so it is the upgrade rather than the
//      default.
//   2. freeipapi.com. No account, no key, HTTPS, and as accurate as ipinfo on
//      the cases above. It also says whether the address is a proxy or VPN
//      exit, which is the single most useful thing a geo provider can say here:
//      it is exactly how a player in California reads as Vancouver.
//   3. ipwho.is. Coarse, but keyless and dependable, so it is the floor rather
//      than nothing.
//
// (ipapi.co was the obvious first choice and is not used: its keyless tier 429s
// on the first call from a datacentre address, which is exactly where this runs.)
//
// And the caveat that matters however good the provider is: this is a guess
// about an address, not about a person. On mobile it lands on the carrier's
// gateway; behind a VPN or a relay it lands on the exit node. That is why the
// browser's own time zone leads everywhere this is displayed (see zoneCity),
// and why an address that a provider calls a proxy is marked as one. It says
// roughly where people are playing. It does not say where anyone lives.
//
// Nothing here can be re-run over old visitors: the raw IP is never written
// down, and the cache is keyed by a salted hash of it. A better provider
// improves the places recorded from now on, and leaves the old ones as they
// were answered.

const LOOKUP_TIMEOUT_MS = 5000;
// The free tiers are generous per day but unfriendly to bursts, and a link doing
// numbers is exactly when a burst of new IPs arrives. One at a time, with a beat
// between, keeps a good day from tripping the limiter.
const MIN_INTERVAL_MS = 1200;

// The clock on somebody's own machine, read as a place.
//
// An IP is a guess made about a person by a third party; a browser's time zone
// is what the person's own computer says, and it survives the VPN, the relay
// and the carrier gateway that make the IP wrong. "America/Los_Angeles" is not
// an address, but it is a truthful one-word answer to "roughly where", and it
// is there for every visit — which is more than the IP can promise.
//
// Zones that name an offset rather than a place ("Etc/GMT+5", "UTC") say
// nothing about anybody and are dropped.
export function zoneCity(zone) {
  const text = String(zone ?? "").trim();
  if (!/^[A-Za-z][\w+-]*(\/[\w+-]+)+$/.test(text)) return "";
  if (/^(Etc|UTC|GMT|Universal|Zulu)\b/i.test(text)) return "";
  return text.split("/").pop().replace(/_/g, " ");
}

// Addresses nobody outside this machine could be sitting at, which are the ones
// never sent to a provider.
//
// This used to answer "private" for every IPv6 address on earth: anything that
// did not parse as four dotted numbers fell through to true. Most of a modern
// audience arrives over IPv6 — it is the default on the mobile carriers and on
// plenty of home fibre — so their lookup was never even attempted, and they
// showed up in the log as people from nowhere. The providers place an IPv6
// address perfectly well when asked.
export function isPrivateIp(ip) {
  if (!ip) return true;
  // A bracketed literal, and the ::ffff: form an IPv4 client arrives in when the
  // socket is dual-stack, both reduce to the address itself.
  const address = String(ip).trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
  if (address.includes(":")) return isPrivateIpv6(address);
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return a === 127 || a === 10 || a === 0
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 169 && b === 254);
}

// ::1 loopback, :: unspecified, fc00::/7 unique-local, fe80::/10 link-local.
// Everything else routes, so everything else is somebody.
function isPrivateIpv6(address) {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  const head = lower.split(":")[0];
  if (/^f[cd]/.test(head)) return true;
  if (/^fe[89ab]/.test(head)) return true;
  return false;
}

// The part of an IPv6 address that identifies the household rather than the
// moment. Privacy extensions rewrite the last 64 bits every day or so, which
// made one phone look like a stream of strangers and asked the provider about
// each of them; the /64 is the stable half, and it is the IPv6 equivalent of
// the single IPv4 address a whole house shares behind NAT.
export function ipIdentity(ip) {
  const address = String(ip ?? "").trim().replace(/^\[|\]$/g, "").replace(/^::ffff:/i, "");
  if (!address.includes(":")) return address;
  const groups = address.split("::");
  // A compressed address (one "::") is only truncatable when the part before it
  // already holds the four groups we want; otherwise the prefix is short enough
  // to keep whole.
  const head = groups[0].split(":").filter(Boolean);
  if (head.length >= 4) return `${head.slice(0, 4).join(":")}::/64`;
  return address.includes("::") ? address : `${address.split(":").slice(0, 4).join(":")}::/64`;
}

// "San Jose, California, US" — city first, because that is the thing being asked;
// the country last, because it is the thing that disambiguates. A place missing
// its city still counts: "Bavaria, DE" beats throwing the lookup away.
function placeName(city, region, country) {
  return [city, region, country].map((part) => (part ?? "").trim()).filter(Boolean).join(", ");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    headers: { accept: "application/json", "user-agent": "mlb-showdown-mvp" }
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

// A provider's answer, in our own words: where, whose network, and whether the
// address is somewhere a person could actually be sitting.
//
// The network is often the better answer to "who is this": a university, an
// employer, a carrier, or a cloud provider running somebody's crawler.

async function fromIpinfo(ip, token) {
  const data = await fetchJson(`https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`);
  return {
    place: placeName(data.city, data.region, data.country),
    org: String(data.org ?? "").replace(/^AS\d+\s+/, ""),
    proxy: false
  };
}

// freeipapi names the neighbourhood in brackets — "Berkeley (South Berkeley)" —
// which is more precision than an IP has earned. The city is what is kept.
async function fromFreeIpApi(ip) {
  const data = await fetchJson(`https://freeipapi.com/api/json/${encodeURIComponent(ip)}`);
  const city = String(data.cityName ?? "").replace(/\s*\(.*\)\s*$/, "");
  return {
    place: placeName(city, data.regionName, data.countryCode),
    org: String(data.asnOrganization ?? ""),
    proxy: Boolean(data.isProxy)
  };
}

async function fromIpWhoIs(ip) {
  const data = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
  // ipwho.is answers 200 even when it has nothing, and says so only in `success`.
  // Left unchecked, a failed lookup reads as a successful one and "undefined"
  // becomes the most popular city on the dashboard.
  if (!data.success) throw new Error(String(data.message ?? "lookup failed"));
  return {
    place: placeName(data.city, data.region, data.country_code),
    org: String(data.connection?.isp || data.connection?.org || ""),
    proxy: false
  };
}

// Best first. The token one is only in the chain when there is a token.
export function providerChain(token = process.env.IPINFO_TOKEN) {
  return [
    ...(token ? [(ip) => fromIpinfo(ip, token)] : []),
    fromFreeIpApi,
    fromIpWhoIs
  ];
}

// Down the chain until somebody names a place. A provider that throws, times
// out, or answers with nothing is simply the wrong provider for this address;
// the next one gets its turn. Only when all of them come up empty is the
// lookup a failure — and a failure is not cached, so the address is tried
// again the next time its owner turns up.
export async function lookupPlace(ip, chain = providerChain()) {
  if (isPrivateIp(ip)) return { place: "", org: "", proxy: false };
  const refused = [];
  for (const provider of chain) {
    const name = provider.name || "provider";
    try {
      const found = await provider(ip);
      if (found?.place) {
        note(name, "ok");
        return { place: found.place, org: found.org ?? "", proxy: Boolean(found.proxy) };
      }
      note(name, "empty");
      refused.push(`${name}: no place`);
    } catch (error) {
      note(name, error.message);
      refused.push(`${name}: ${error.message}`);
    }
  }
  // Every provider refusing is worth saying out loud. Swallowed, it looks like
  // a site whose visitors have no location — which is exactly how this went
  // unnoticed until somebody read the log and asked where everybody was. The
  // address is not logged; only what the providers said about it.
  noteGeoFailure(refused.join("; "));
  return { place: "", org: "", proxy: false };
}

// The last handful of refusals, and a count, kept in memory for whoever asks.
// Printed once a minute at most: a provider that is down is down for every
// visitor, and one line a minute says so without burying the log.
const failures = { count: 0, last: "", at: 0 };
const FAILURE_LOG_MS = 60_000;

// A tally per provider — answered, came up empty, or refused us, and with what.
// A provider that works from a laptop and not from the machine the site runs on
// is a thing that has happened here, and it is invisible without this.
const health = new Map();

function note(provider, outcome) {
  const row = health.get(provider) ?? { ok: 0, empty: 0, failed: 0, last: "" };
  if (outcome === "ok") row.ok += 1;
  else if (outcome === "empty") row.empty += 1;
  else {
    row.failed += 1;
    row.last = String(outcome).slice(0, 120);
  }
  health.set(provider, row);
}

function noteGeoFailure(reason) {
  failures.count += 1;
  failures.last = reason;
  const now = Date.now();
  if (now - failures.at < FAILURE_LOG_MS) return;
  failures.at = now;
  console.warn(`Geo lookup failed (${failures.count} so far) — ${reason}`);
}

export function geoFailures() {
  return { ...failures, providers: Object.fromEntries(health) };
}

// One at a time, spaced out, and dropped on the floor if the queue backs up —
// a location is a nice-to-have, and it must never be the reason a page is slow
// or a machine will not shut down.
export function createGeoQueue(lookup = lookupPlace, minIntervalMs = MIN_INTERVAL_MS) {
  const queue = [];
  let running = false;
  let lastCall = 0;
  // The pass currently in flight, so a machine on its way down can wait for the
  // answers it already asked for. The machine stops the moment the last person
  // leaves, which is exactly when the first-ever lookup for that person is in
  // the air — dropping it is how somebody ends up with no place at all.
  let pass = Promise.resolve();

  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      const wait = minIntervalMs - (Date.now() - lastCall);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait).unref?.());
      lastCall = Date.now();
      try {
        job.resolve(await lookup(job.ip));
      } catch {
        // A failed lookup is not cached, so the next visit from this IP tries
        // again. Caching the failure would make one bad minute permanent.
        job.resolve("");
      }
    }
    running = false;
  }

  return {
    submit(ip) {
      return new Promise((resolve) => {
        queue.push({ ip, resolve });
        pass = drain();
      });
    },
    get idle() {
      return !running && queue.length === 0;
    },
    // Settles when the queue has emptied. Callers put their own ceiling on it:
    // a location is never worth holding anything up for long.
    get drained() {
      return pass;
    }
  };
}
