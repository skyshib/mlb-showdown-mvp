import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer, flushSaves } from "../scripts/online-server.js";
import { loadTrafficFile, recordView, trafficSummary } from "../scripts/traffic.js";
import { isPrivateIp } from "../scripts/geo.js";

// Nothing in the suite is allowed to reach the network, so the geo provider is
// always a stand-in. `calls` is what the assertions are really about: a visitor
// must be looked up once, ever.
function fakeGeo(map) {
  const calls = [];
  const lookup = async (ip) => {
    calls.push(ip);
    return map[ip] ?? "";
  };
  return { lookup, calls };
}

// The queue is deliberately off the response path, so a view's place lands a tick
// or two after the view itself.
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

async function startServer(t, dataDir) {
  const roomsDir = dataDir ?? (await mkdtemp(join(tmpdir(), "showdown-traffic-")));
  const { server, store } = createOnlineServer({ dataDir: roomsDir });
  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, store, dataDir: roomsDir };
}

function visit(headers = {}) {
  return {
    method: "GET",
    headers: { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605", ...headers },
    socket: { remoteAddress: "203.0.113.9" }
  };
}

test("a page load is counted once, an asset never is", async (t) => {
  const { base, store } = await startServer(t);

  await fetch(`${base}/adventure.html`, { headers: { "user-agent": "Mozilla/5.0 Safari/605" } });
  await fetch(`${base}/package.json`, { headers: { "user-agent": "Mozilla/5.0 Safari/605" } });

  const summary = trafficSummary(store.traffic);
  assert.equal(summary.totalViews, 1, "the page counts, the JSON asset does not");
  assert.deepEqual(summary.paths, [{ key: "/adventure.html", views: 1 }]);
});

test("a returning browser gets a 304, and the 304 is still a pageview", async (t) => {
  const { base, store } = await startServer(t);
  const agent = { "user-agent": "Mozilla/5.0 Safari/605" };

  const first = await fetch(`${base}/adventure.html`, { headers: agent });
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");

  const second = await fetch(`${base}/adventure.html`, { headers: { ...agent, "If-None-Match": etag } });
  assert.equal(second.status, 304, "the entry points are revalidated, not held");

  assert.equal(trafficSummary(store.traffic).totalViews, 2, "counting only 200s would lose every repeat visit");
});

test("bots and the stats page do not move the numbers", async (t) => {
  const { store } = await startServer(t);

  recordView(store, visit({ "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }), "/index.html");
  recordView(store, visit(), "/stats.html");
  recordView(store, { method: "GET", headers: {}, socket: {} }, "/index.html");

  assert.equal(trafficSummary(store.traffic).totalViews, 0);
});

test("two people from one edge are two visitors; one person twice is one", async (t) => {
  const { store } = await startServer(t);
  const edge = { "fly-region": "NRT" };

  recordView(store, visit({ ...edge, "fly-client-ip": "198.51.100.1" }), "/index.html");
  recordView(store, visit({ ...edge, "fly-client-ip": "198.51.100.1" }), "/adventure.html");
  recordView(store, visit({ ...edge, "fly-client-ip": "198.51.100.2" }), "/index.html");

  const summary = trafficSummary(store.traffic);
  assert.equal(summary.today.views, 3);
  assert.equal(summary.today.visitors, 2, "three pageviews, two people");
  assert.deepEqual(summary.regions, [{ key: "nrt", views: 3 }], "the edge code is normalized");
});

test("a visitor who comes back on a later day is one person, not two", async (t) => {
  const { store } = await startServer(t);
  const who = visit({ "fly-client-ip": "198.51.100.7" });

  recordView(store, who, "/index.html", new Date("2026-07-10T12:00:00Z"));
  recordView(store, who, "/index.html", new Date("2026-07-12T12:00:00Z"));

  const summary = trafficSummary(store.traffic, new Date("2026-07-12T12:00:00Z"));
  assert.equal(summary.last30Days.views, 2);
  assert.equal(summary.last30Days.visitors, 1, "unioned across days, not summed");
});

test("the raw IP is never written down, and the count survives the machine sleeping", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-traffic-"));
  const first = await startServer(t, dataDir);

  recordView(first.store, visit({ "fly-client-ip": "198.51.100.4" }), "/index.html");
  recordView(first.store, visit({ "fly-client-ip": "198.51.100.4" }), "/index.html");
  await flushSaves(first.store);

  const onDisk = JSON.stringify(loadTrafficFile(dataDir));
  assert.ok(!onDisk.includes("198.51.100.4"), "only a salted hash of the IP is persisted");

  const reloaded = await startServer(t, dataDir);
  const summary = trafficSummary(reloaded.store.traffic);
  assert.equal(summary.totalViews, 2, "the counters come back with the machine");
  assert.equal(summary.today.visitors, 1, "and so does the salt, so a returning player is not a new one");
});

test("only a same-origin referrer is dropped; a real source is kept", async (t) => {
  const { store } = await startServer(t);

  recordView(store, visit({ referer: "https://mlb-showdown-mvp.fly.dev/index.html" }), "/adventure.html");
  recordView(store, visit({ referer: "https://www.reddit.com/r/mlb/comments/x" }), "/adventure.html");

  assert.deepEqual(trafficSummary(store.traffic).referrers, [{ key: "reddit.com", views: 1 }]);
});

test("a visitor's city is looked up once, then never again", async (t) => {
  const { store } = await startServer(t);
  const geo = fakeGeo({ "198.51.100.20": "San Jose, California, US" });
  store.geoLookup = geo.lookup;
  store.geoIntervalMs = 0;

  const who = visit({ "fly-client-ip": "198.51.100.20" });
  recordView(store, who, "/index.html");
  recordView(store, who, "/adventure.html");
  await settle();
  recordView(store, who, "/card-lab.html");
  await settle();

  assert.deepEqual(geo.calls, ["198.51.100.20"], "one lookup for one visitor, however many pages they open");
  assert.deepEqual(
    trafficSummary(store.traffic).places,
    [{ key: "San Jose, California, US", views: 3 }],
    "views that arrived before the lookup returned are still credited to the city"
  );
});

test("two people in different cities are counted apart", async (t) => {
  const { store } = await startServer(t);
  const geo = fakeGeo({
    "198.51.100.21": "Seattle, Washington, US",
    "198.51.100.22": "Tokyo, Tokyo, JP"
  });
  store.geoLookup = geo.lookup;
  store.geoIntervalMs = 0;

  recordView(store, visit({ "fly-client-ip": "198.51.100.21" }), "/index.html");
  recordView(store, visit({ "fly-client-ip": "198.51.100.22" }), "/index.html");
  recordView(store, visit({ "fly-client-ip": "198.51.100.21" }), "/index.html");
  await settle();

  assert.deepEqual(trafficSummary(store.traffic).places, [
    { key: "Seattle, Washington, US", views: 2 },
    { key: "Tokyo, Tokyo, JP", views: 1 }
  ]);
});

test("a failed lookup is not cached, so the next visit tries again", async (t) => {
  const { store } = await startServer(t);
  let attempts = 0;
  store.geoLookup = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("rate limited");
    return "Chicago, Illinois, US";
  };
  store.geoIntervalMs = 0;

  const who = visit({ "fly-client-ip": "198.51.100.23" });
  recordView(store, who, "/index.html");
  await settle();
  assert.deepEqual(trafficSummary(store.traffic).places, [], "a bad minute leaves no city behind");

  recordView(store, who, "/index.html");
  await settle();
  assert.equal(attempts, 2, "the failure was not remembered as an answer");
  assert.deepEqual(trafficSummary(store.traffic).places, [{ key: "Chicago, Illinois, US", views: 1 }]);
});

test("the city survives the machine sleeping, and the raw IP still never lands on disk", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-traffic-"));
  const first = await startServer(t, dataDir);
  const geo = fakeGeo({ "198.51.100.24": "Boston, Massachusetts, US" });
  first.store.geoLookup = geo.lookup;
  first.store.geoIntervalMs = 0;

  recordView(first.store, visit({ "fly-client-ip": "198.51.100.24" }), "/index.html");
  await settle();
  await flushSaves(first.store);

  const onDisk = JSON.stringify(loadTrafficFile(dataDir));
  assert.ok(onDisk.includes("Boston"), "the place is kept");
  assert.ok(!onDisk.includes("198.51.100.24"), "the IP that produced it is not");

  const second = await startServer(t, dataDir);
  second.store.geoLookup = geo.lookup;
  second.store.geoIntervalMs = 0;
  recordView(second.store, visit({ "fly-client-ip": "198.51.100.24" }), "/index.html");
  await settle();

  assert.deepEqual(geo.calls, ["198.51.100.24"], "the cache came back with the machine — no second lookup");
  assert.deepEqual(trafficSummary(second.store.traffic).places, [{ key: "Boston, Massachusetts, US", views: 2 }]);
});

test("a local address is never sent to the geo provider", async (t) => {
  const { store } = await startServer(t);
  const geo = fakeGeo({});
  store.geoLookup = geo.lookup;
  store.geoIntervalMs = 0;

  recordView(store, visit({ "fly-client-ip": "127.0.0.1" }), "/index.html");
  recordView(store, visit({ "fly-client-ip": "192.168.1.40" }), "/index.html");
  await settle();

  assert.deepEqual(geo.calls, [], "the provider is never even asked");
  assert.deepEqual(trafficSummary(store.traffic).places, []);
  for (const ip of ["127.0.0.1", "192.168.1.40", "10.0.0.5", "172.20.1.1", "::1", "169.254.1.1"]) {
    assert.ok(isPrivateIp(ip), `${ip} is private`);
  }
  assert.ok(!isPrivateIp("198.51.100.24"), "a real address is not");
});

test("stats are open by default and shut when a token is set", async (t) => {
  const { base } = await startServer(t);

  assert.equal((await fetch(`${base}/api/stats`)).status, 200);

  process.env.STATS_TOKEN = "letmein";
  t.after(() => { delete process.env.STATS_TOKEN; });

  assert.equal((await fetch(`${base}/api/stats`)).status, 401);
  assert.equal((await fetch(`${base}/api/stats?token=nope`)).status, 401);
  assert.equal((await fetch(`${base}/api/stats?token=letmein`)).status, 200);
});
