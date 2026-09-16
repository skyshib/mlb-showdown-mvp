import test from "node:test";
import assert from "node:assert/strict";
import { groupSessions, namesIn } from "../src/ui/sessions.js";

// The log arrives newest first, which is the order the panel receives it in, so
// every fixture here is built that way too.
const DEVICE = "aaaaaaaaaaaaaaaa";

function line(minutes, kind, extra = {}) {
  const base = Date.parse("2026-09-16T12:00:00.000Z");
  return {
    t: new Date(base + minutes * 60000).toISOString(),
    device: DEVICE,
    visitor: "v1",
    kind,
    ...extra
  };
}

// Newest first, as /api/visits hands them over.
const log = (...lines) => [...lines].reverse();

test("a quiet stretch does not split a visit", () => {
  // The bug this grouping replaced: drafting logs nothing between the deal and
  // the sim, so an hour of picks used to read as an hour of absence.
  const sessions = groupSessions(log(
    line(0, "view", { path: "/" }),
    line(0, "hello"),
    line(1, "local-draft-start", { data: { managers: ["Larson"], draftType: "snake" } }),
    line(69, "sim", { data: { runs: 100000 } }),
    line(72, "bye", { data: { seconds: 72 * 60 } })
  ));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].lines.length, 5);
  assert.equal(sessions[0].seconds, 72 * 60);
});

test("each page load is its own session", () => {
  const sessions = groupSessions(log(
    line(0, "view", { path: "/" }),
    line(1, "bye", { data: { seconds: 60 } }),
    line(2, "view", { path: "/" }),
    line(3, "bye", { data: { seconds: 60 } })
  ));
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((s) => s.lines.length), [2, 2]);
});

test("a lost goodbye does not swallow the next visit", () => {
  // Roughly a third of pagehide beacons never arrive, so an unclosed session is
  // the normal case, not an edge one. The next "view" has to end it.
  const sessions = groupSessions(log(
    line(0, "view", { path: "/" }),
    line(1, "sim", { data: { runs: 100000 } }),
    line(2000, "view", { path: "/" }),
    line(2001, "sim", { data: { runs: 100000 } })
  ));
  assert.equal(sessions.length, 2);
  assert.equal(sessions.every((s) => s.seconds === undefined), true);
  assert.deepEqual(sessions.map((s) => s.lines.length), [2, 2]);
});

test("a goodbye arriving after the next page opened still closes its own", () => {
  // A pagehide beacon can land after the following load's server-side view: the
  // duration it reports is what says which session it belongs to.
  const sessions = groupSessions(log(
    line(0, "view", { path: "/" }),
    line(50, "sim", { data: { runs: 100000 } }),
    line(60, "view", { path: "/" }),
    line(61, "bye", { data: { seconds: 61 * 60 } }),
    line(70, "sim", { data: { runs: 100000 } }),
    line(75, "bye", { data: { seconds: 15 * 60 } })
  ));
  assert.equal(sessions.length, 2);
  const [newer, older] = sessions;
  // The 61-minute goodbye belongs to the page opened at 0, not the one at 60.
  assert.equal(older.startedAt, Date.parse("2026-09-16T12:00:00.000Z"));
  assert.equal(older.seconds, 61 * 60);
  assert.equal(newer.seconds, 15 * 60);
  // And nothing was dropped or duplicated on the way.
  assert.equal(newer.lines.length + older.lines.length, 6);
});

test("two devices never share a session", () => {
  const other = groupSessions(log(
    line(0, "view", { path: "/" }),
    { ...line(1, "view", { path: "/" }), device: "bbbbbbbbbbbbbbbb" },
    line(2, "sim", { data: { runs: 100000 } })
  ));
  assert.equal(other.length, 2);
  assert.deepEqual(other.map((s) => s.key).sort(), ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
});

test("a browser that refused the cookie falls back to the visitor hash", () => {
  const sessions = groupSessions(log({ ...line(0, "room-create", { data: { managers: ["Skylar"] } }), device: "" }));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].key, "ip:v1");
});

test("sessions read newest first and their beats oldest first", () => {
  const sessions = groupSessions(log(
    line(0, "view", { path: "/" }),
    line(1, "sim", { data: { runs: 100000 } }),
    line(2, "bye", { data: { seconds: 120 } }),
    line(10, "view", { path: "/" }),
    line(11, "sim", { data: { runs: 100000 } })
  ));
  assert.equal(sessions[0].startedAt > sessions[1].startedAt, true);
  for (const session of sessions) {
    const times = session.lines.map((l) => Date.parse(l.t));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  }
});

test("a line with no page load of its own still lands somewhere", () => {
  // The window being shown can start mid-visit, leaving the "view" out of reach.
  const sessions = groupSessions(log(
    line(0, "sim", { data: { runs: 100000 } }),
    line(1, "bye", { data: { seconds: 9000 } })
  ));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].lines.length, 2);
});

test("the names on a session are the humans who played, not the computers", () => {
  const sessions = groupSessions(log(
    line(0, "view", { path: "/" }),
    line(1, "local-draft-start", {
      data: { managers: ["Skylar", "Kasey", "Iron Mike"], cpu: ["Iron Mike"], draftType: "snake" }
    }),
    line(2, "room-join", { data: { manager: "Scott" } })
  ));
  assert.deepEqual([...sessions[0].names], ["Skylar", "Kasey", "Scott"]);
});

test("namesIn reads each kind of line it knows", () => {
  assert.deepEqual(namesIn({ kind: "sim", data: { humans: ["Larson"], cpu: [] } }), ["Larson"]);
  assert.deepEqual(namesIn({ kind: "room-create", data: { managers: ["Skylar", "Bot"], cpu: ["Bot"] } }), ["Skylar"]);
  assert.deepEqual(namesIn({ kind: "adventure-start", data: { name: "Kellan" } }), ["Kellan"]);
  assert.deepEqual(namesIn({ kind: "view", path: "/" }), []);
  assert.deepEqual(namesIn({ kind: "hello" }), []);
});
