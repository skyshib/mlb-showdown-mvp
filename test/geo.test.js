import test from "node:test";
import assert from "node:assert/strict";
import { geoFailures, ipIdentity, isPrivateIp, lookupPlace, providerChain, zoneCity } from "../scripts/geo.js";

test("the chain walks on until somebody names a place", async () => {
  const tried = [];
  const chain = [
    (ip) => { tried.push("throws"); throw new Error("429"); },
    (ip) => { tried.push("empty"); return { place: "", org: "nobody" }; },
    (ip) => { tried.push("answers"); return { place: "Berkeley, California, US", org: "UC Berkeley", proxy: true }; },
    (ip) => { tried.push("never"); return { place: "Somewhere else" }; }
  ];
  const found = await lookupPlace("198.51.100.4", chain);
  assert.deepEqual(found, { place: "Berkeley, California, US", org: "UC Berkeley", proxy: true });
  assert.deepEqual(tried, ["throws", "empty", "answers"], "and stops at the first real answer");
});

test("every provider failing is a failure, not a place", async () => {
  const found = await lookupPlace("198.51.100.4", [() => { throw new Error("down"); }, () => ({ place: "" })]);
  assert.deepEqual(found, { place: "", org: "", proxy: false });
});

test("a private address is never sent anywhere", async () => {
  let asked = false;
  const found = await lookupPlace("192.168.1.10", [() => { asked = true; return { place: "Nowhere" }; }]);
  assert.equal(asked, false);
  assert.equal(found.place, "");
});

test("the token provider is in the chain only when there is a token", () => {
  assert.equal(providerChain("").length, 2);
  assert.equal(providerChain("tok_123").length, 3);
});

test("a time zone reads as the city it is named for", () => {
  assert.equal(zoneCity("America/Los_Angeles"), "Los Angeles");
  assert.equal(zoneCity("America/Argentina/Buenos_Aires"), "Buenos Aires");
  assert.equal(zoneCity("Europe/London"), "London");
  // A zone that names an offset names no place.
  assert.equal(zoneCity("Etc/GMT+5"), "");
  assert.equal(zoneCity("UTC"), "");
  assert.equal(zoneCity(""), "");
  assert.equal(zoneCity(undefined), "");
});

test("a public IPv6 address is somebody, not a private one", () => {
  // The bug this replaces: every IPv6 visitor was treated as private and never
  // looked up, which is most of a mobile audience.
  assert.equal(isPrivateIp("2001:5a8:418d:4a00:b55e:845f:13b5:6a2b"), false);
  assert.equal(isPrivateIp("2601:646:a000:1234::5"), false);
  assert.equal(isPrivateIp("[2001:db8::1]"), false);
  assert.equal(isPrivateIp("::ffff:8.8.8.8"), false, "a dual-stack socket's IPv4 client");

  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("::"), true);
  assert.equal(isPrivateIp("fe80::1"), true, "link-local");
  assert.equal(isPrivateIp("fd00::1"), true, "unique-local");
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("192.168.1.5"), true);
  assert.equal(isPrivateIp(""), true);
});

test("an IPv6 visitor is a household, not a new stranger every day", () => {
  // Privacy extensions rewrite the low half; the /64 is what stays.
  const monday = ipIdentity("2001:5a8:418d:4a00:b55e:845f:13b5:6a2b");
  const tuesday = ipIdentity("2001:5a8:418d:4a00:1111:2222:3333:4444");
  assert.equal(monday, tuesday);
  assert.equal(monday, "2001:5a8:418d:4a00::/64");
  // A different household is still a different visitor.
  assert.notEqual(monday, ipIdentity("2001:5a8:418d:4a01:b55e:845f:13b5:6a2b"));
  // IPv4 is untouched.
  assert.equal(ipIdentity("135.180.83.205"), "135.180.83.205");
});

test("provider health says who answered and who refused", async () => {
  const chain = [
    function refuser() { throw new Error("403 from a datacentre"); },
    function answerer() { return { place: "Hayward, California, US", org: "Sonic" }; }
  ];
  await lookupPlace("198.51.100.9", chain);
  const { providers } = geoFailures();
  assert.equal(providers.refuser.failed, 1);
  assert.match(providers.refuser.last, /403/);
  assert.equal(providers.answerer.ok, 1);
});
