// THE SHIPPED BIDDER DOES NOT MOVE BY ACCIDENT.
//
// scripts/cpu-lab-ideas.jsonl invites other agents to propose tweaks, and a
// proposal worth measuring sometimes needs a knob that does not exist yet — so
// an agent adds one to cpuTunables.js and a branch to draft.js that reads it.
// That is the intended workflow (relieverFloorByRoom arrived exactly that way).
// It is also, written down plainly, an agent editing the drafter that every
// room on the live site runs.
//
// The deal is that such a knob ships DORMANT: at its default value the bidder
// must do, card for card and dollar for dollar, what it did before. Nobody can
// confirm that by reading a diff, and a sweep cannot confirm it either — the
// noise floor of a win% study is wider than most real effects, so "it looks the
// same" is exactly what a broken dormant knob also looks like.
//
// So: drive nine fixed rooms with the shipped defaults, hash every bid and
// every pick, and compare against a committed golden. A knob that is not really
// dormant fails here, in two seconds of reading, instead of in a month of
// drafts. The golden covers both draft types, both nomination rules, both
// pricing rules, capped and uncapped pens, three board sizes and three card
// sets, because a knob can be dead on one path and live on another.
//
// WHEN THIS FAILS AND THE CHANGE IS DELIBERATE — you meant to move the bidder —
// the fix is to re-record it IN THE SAME COMMIT as the behavior change, so the
// hashes move in a diff a reviewer can see:
//
//   node scripts/cpu-fingerprint.mjs --seeds 1 | grep -v "^cpu fingerprint" \
//     > test/fixtures/cpu-fingerprint.txt
//
// If you cannot say which cells should have moved and why, that is the test
// doing its job.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN = join(ROOT, "test", "fixtures", "cpu-fingerprint.txt");

test("the shipped bidder still bids and picks exactly what the golden says", () => {
  const got = execFileSync("node", [join(ROOT, "scripts", "cpu-fingerprint.mjs"), "--seeds", "1"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24 })
    .split("\n").filter((line) => line && !line.startsWith("cpu fingerprint")).join("\n");
  const want = readFileSync(GOLDEN, "utf8").split("\n").filter(Boolean).join("\n");

  const rows = (text) => new Map(text.trim().split("\n")
    .map((line) => line.trim().split(/\s+/)).map(([cell, hash]) => [cell, hash]));
  const [gotRows, wantRows] = [rows(got), rows(want)];
  const moved = [...wantRows].filter(([cell, hash]) => gotRows.get(cell) !== hash).map(([cell]) => cell);

  assert.deepEqual(moved, [], moved.length === wantRows.size - 1
    ? "every cell moved — this is a change to the drafter itself, not a dormant knob"
    : `the drafter changed in: ${moved.filter((c) => c !== "ALL").join(", ")}. `
      + "If that was deliberate, re-record test/fixtures/cpu-fingerprint.txt in this commit "
      + "(see the header of this file). If it was not, a knob meant to be dormant is live "
      + "at its default value.");
});
