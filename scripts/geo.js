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

export function isPrivateIp(ip) {
  if (!ip) return true;
  const address = ip.replace(/^::ffff:/, "");
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return a === 127 || a === 10 || a === 0
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 169 && b === 254);
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
  for (const provider of chain) {
    try {
      const found = await provider(ip);
      if (found?.place) return { place: found.place, org: found.org ?? "", proxy: Boolean(found.proxy) };
    } catch {
      // Try the next one.
    }
  }
  return { place: "", org: "", proxy: false };
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
