import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendIdea, faultIn, knobKey, readIdeas } from "../scripts/cpu-lab-ideas.mjs";

// BEFORE ANYTHING ELSE. appendIdea writes to a real, append-only file that
// ships in the repo, and a test that forgot to point it somewhere else once put
// its own fixture in there — a proposal nobody made, which the next run would
// have spent an hour measuring. Pointing it at a temp path at module scope
// means no case in this file can reach the real inbox even by mistake.
process.env.CPU_LAB_IDEAS = join(mkdtempSync(join(tmpdir(), "cpu-lab-ideas-")), "ideas.jsonl");

// Each case still gets its own file, and reaches it the way the CLI does.
function inbox(lines = []) {
  const file = join(mkdtempSync(join(tmpdir(), "cpu-lab-ideas-")), "ideas.jsonl");
  writeFileSync(file, lines.join("\n") + (lines.length ? "\n" : ""));
  process.env.CPU_LAB_IDEAS = file;
  return file;
}

// Back to a temp path between cases, never to the real inbox.
test.afterEach(() => { inbox(); });

// The inbox is a file any agent may write to, and the online server imports the
// queue that reads it. A bad line must cost that proposal and nothing else.
test("a line that cannot be used is reported, never thrown, and the rest survive", () => {
  inbox([
    "// a comment, which the file carries its own instructions in",
    "",
    JSON.stringify({ id: "good-one", knobs: { depthSlots: 5 }, note: "spread the leftovers wider" }),
    '{"id":"half-written","knobs":{',
    JSON.stringify({ id: "misspelled", knobs: { depthSlotz: 5 }, note: "a knob that does not exist" }),
    JSON.stringify({ id: "also-good", knobs: { depthDamp: 0.4 }, note: "bid a bench card softer still" })
  ]);
  const { ideas, rejected } = readIdeas();
  assert.deepEqual(ideas.map((idea) => idea.id), ["good-one", "also-good"]);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].reason, /not JSON/);
  assert.match(rejected[1].reason, /depthSlotz/);
  // The line number is how an agent finds its own typo in an append-only file.
  assert.equal(rejected[1].line, 5);
});

test("a missing inbox is an empty inbox", () => {
  process.env.CPU_LAB_IDEAS = join(tmpdir(), "cpu-lab-ideas-nothing-here", "ideas.jsonl");
  assert.deepEqual(readIdeas(), { ideas: [], rejected: [] });
});

// A proposal that silently became a second copy of a queued candidate would
// spend an hour re-measuring a number somebody already has.
test("a name or a knob set that is already spoken for is refused", () => {
  const taken = new Map([["id:jiggle", "a fixture"], [`knobs:${knobKey({ shareExponent: 1 })}`, "share-flat"]]);
  assert.match(faultIn({ id: "jiggle", knobs: { depthSlots: 4 }, note: "a name a fixture holds" }, taken),
    /already a fixture/);
  assert.match(faultIn({ id: "mine", knobs: { shareExponent: 1 }, note: "what share-flat already asks" }, taken),
    /already queued as "share-flat"/);
  // Order-free: the knob key is sorted, so one idea cannot hide inside another
  // by spelling its knobs backwards.
  assert.equal(knobKey({ a: 1, b: 2 }), knobKey({ b: 2, a: 1 }));
});

test("a proposal that changes nothing is refused", () => {
  assert.match(faultIn({ id: "no-op", knobs: {}, note: "an empty knob set is the null fixture" }),
    /empty/);
  // Restating a shipped value is the same thing said at more length.
  assert.match(faultIn({ id: "no-op", knobs: { depthSlots: 3 }, note: "exactly what ships today" }),
    /already the shipped value/);
});

test("a proposal has to say what it claims", () => {
  assert.match(faultIn({ id: "terse", knobs: { depthSlots: 5 }, note: "wider" }), /note must say/);
  assert.match(faultIn({ id: "Not Kebab", knobs: { depthSlots: 5 }, note: "a name with spaces in it" }),
    /kebab-case/);
  assert.match(faultIn("a bare string"), /not an object/);
});

test("what is appended is what comes back, with its provenance", () => {
  inbox();
  const outcome = appendIdea({
    id: "pen-arm-cheaper",
    knobs: { relieverDepthRate: 0.5 },
    note: "the arms behind the closer at half a starter's rate",
    room: "misty-fox-open",
    why: "seat 3 paid $182 for a 29-inning arm two lots from the end",
    by: "room-analysis agent"
  });
  assert.equal(outcome.ok, true);
  const { ideas } = readIdeas();
  assert.equal(ideas.length, 1);
  assert.deepEqual(ideas[0].params, { relieverDepthRate: 0.5 });
  assert.equal(ideas[0].room, "misty-fox-open");
  assert.equal(ideas[0].by, "room-analysis agent");
  assert.equal(ideas[0].idea, true);
  // Filed twice is refused rather than written twice.
  assert.equal(appendIdea({ id: "pen-arm-cheaper", knobs: { depthSlots: 5 }, note: "the same name again" }).ok,
    false);
  assert.equal(readIdeas().ideas.length, 1);
});

// THE ONE THAT MATTERS FOR THE LIVE SITE. scripts/online-server.js imports the
// queue, which reads this file at import. Garbage in it must not stop the
// module loading — a typo in an inbox any agent can write to cannot be allowed
// to take the site down.
test("the queue still imports when the inbox is garbage", () => {
  const file = join(mkdtempSync(join(tmpdir(), "cpu-lab-ideas-")), "ideas.jsonl");
  writeFileSync(file, "not json at all\n{\n[]\n{\"id\":\"x\"}\n\0\n");
  const out = execFileSync(process.execPath, [
    "-e",
    'import("./scripts/cpu-lab-tweaks.mjs").then((m) => '
      + 'console.log(JSON.stringify({ tweaks: m.TWEAKS.length, rejects: m.IDEA_REJECTS.length })))'
  ], { env: { ...process.env, CPU_LAB_IDEAS: file }, encoding: "utf8" });
  const read = JSON.parse(out);
  assert.ok(read.tweaks > 10, "the hand-written queue still loaded");
  assert.equal(read.rejects, 5, "every unusable line reported, none thrown");
});
