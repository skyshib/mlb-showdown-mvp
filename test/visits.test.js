import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOnlineServer, flushSaves } from "../scripts/online-server.js";
import { describeAgent } from "../scripts/visits.js";

const IPHONE_GOOGLE_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0 Mobile/15E148 Safari/604.1";

async function startServer(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "showdown-visits-"));
  const { server, store } = createOnlineServer({ dataDir });
  store.geoLookup = async (ip) => (ip === "198.51.100.30" ? { place: "Berkeley, California, US", org: "Comcast Cable" } : "");
  store.geoIntervalMs = 0;
  server.listen(0);
  await once(server, "listening");
  t.after(() => server.close());
  process.env.VISITS_TOKEN = "sesame";
  t.after(() => { delete process.env.VISITS_TOKEN; });
  return { base: `http://127.0.0.1:${server.address().port}`, store, dataDir };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

async function visits(base, query = "") {
  const response = await fetch(`${base}/api/visits?token=sesame${query}`);
  assert.equal(response.status, 200);
  return (await response.json()).visits;
}

test("a page load is logged with a device cookie that the next load reuses", async (t) => {
  const { base } = await startServer(t);
  const headers = { "user-agent": IPHONE_GOOGLE_APP, "x-forwarded-for": "198.51.100.30", referer: "https://www.google.com/" };

  const first = await fetch(`${base}/index.html?room=abc`, { headers });
  const cookie = first.headers.get("set-cookie");
  assert.match(cookie, /^sd_device=[a-f0-9]{16};/);
  const device = cookie.split(";")[0].split("=")[1];

  const second = await fetch(`${base}/adventure.html`, { headers: { ...headers, cookie: `sd_device=${device}` } });
  assert.equal(second.headers.get("set-cookie"), null, "a known device is not handed a new id");
  await settle();

  const [latest, earliest] = await visits(base);
  assert.equal(earliest.path, "/index.html");
  assert.equal(earliest.query, "?room=abc");
  assert.equal(earliest.referrer, "https://www.google.com/");
  assert.equal(earliest.newDevice, true);
  assert.equal(latest.newDevice, false);
  assert.equal(latest.device, device);
  assert.equal(earliest.device, device);
  assert.equal(latest.browser, "Google app");
  assert.equal(latest.os, "iOS");
  assert.equal(latest.place, "Berkeley, California, US");
  assert.equal(latest.org, "Comcast Cable");
});

test("a page's own events land in the log with the device that sent them", async (t) => {
  const { base } = await startServer(t);
  const device = "0123456789abcdef";
  const response = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `sd_device=${device}`, "user-agent": "Mozilla/5.0 (Macintosh) Safari/605" },
    body: JSON.stringify({ kind: "local-draft-start", page: "/index.html", data: { managers: ["Kellan", "CPU1"] } })
  });
  assert.equal(response.status, 204);
  // Junk is swallowed, not logged.
  await fetch(`${base}/api/events`, { method: "POST", body: JSON.stringify({ kind: "Not A Kind!" }) });
  await fetch(`${base}/api/events`, { method: "POST", body: "not json" });

  const logged = await visits(base, "&kind=local-draft-start");
  assert.equal(logged.length, 1);
  assert.equal(logged[0].device, device);
  assert.deepEqual(logged[0].data.managers, ["Kellan", "CPU1"]);
  assert.equal((await visits(base)).length, 1, "the malformed events left nothing behind");
});

test("the visit log has no public mode, and the raw IP never reaches it", async (t) => {
  const { base, store, dataDir } = await startServer(t);
  await fetch(`${base}/index.html`, { headers: { "user-agent": "Googlebot/2.1", "x-forwarded-for": "198.51.100.30" } });
  await flushSaves(store);

  assert.equal((await fetch(`${base}/api/visits`)).status, 401);
  assert.equal((await fetch(`${base}/api/visits?token=nope`)).status, 401);
  delete process.env.VISITS_TOKEN;
  assert.equal((await fetch(`${base}/api/visits?token=`)).status, 401, "unset means closed, not open");
  process.env.VISITS_TOKEN = "sesame";

  const [bot] = await visits(base);
  assert.equal(bot.bot, true, "crawlers are logged, and marked");
  assert.equal((await visits(base, "&humans=1")).length, 0);

  const files = await readdir(join(dataDir, "visits"));
  const text = await readFile(join(dataDir, "visits", files[0]), "utf8");
  assert.ok(!text.includes("198.51.100.30"));
});

test("user agents read as browser and OS", () => {
  assert.deepEqual(describeAgent(IPHONE_GOOGLE_APP), { browser: "Google app", os: "iOS", mobile: true });
  assert.deepEqual(
    describeAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"),
    { browser: "Chrome", os: "macOS", mobile: false }
  );
  assert.deepEqual(
    describeAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36"),
    { browser: "Chrome", os: "Android", mobile: true }
  );
});
