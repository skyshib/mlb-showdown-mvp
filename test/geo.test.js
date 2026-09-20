import test from "node:test";
import assert from "node:assert/strict";
import { lookupPlace, providerChain, zoneCity } from "../scripts/geo.js";

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
