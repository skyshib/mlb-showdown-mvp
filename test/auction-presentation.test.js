import test from "node:test";
import assert from "node:assert/strict";
import { nominatedPlayerFilter } from "../src/ui/auctionPresentation.js";

test("auction nominations filter single-position hitters to their position", () => {
  assert.deepEqual(
    nominatedPlayerFilter({ kind: "hitter", position: "SS", fielding: 2 }),
    { type: "hitter", position: "SS" }
  );
  assert.deepEqual(
    nominatedPlayerFilter({ kind: "hitter", position: "RF", fielding: 1 }),
    { type: "hitter", position: "LF/RF" }
  );
});

test("auction nominations leave multi-position players on all hitters", () => {
  assert.deepEqual(
    nominatedPlayerFilter({
      kind: "hitter",
      position: "2B",
      positions: [
        { pos: "2B", fielding: 3 },
        { pos: "SS", fielding: 2 }
      ]
    }),
    { type: "hitter", position: "all" }
  );
});

test("auction nominations filter pitchers to their role", () => {
  assert.deepEqual(
    nominatedPlayerFilter({ kind: "pitcher", role: "SP" }),
    { type: "pitcher", position: "SP" }
  );
  assert.deepEqual(
    nominatedPlayerFilter({ kind: "pitcher", role: "RP" }),
    { type: "pitcher", position: "RP" }
  );
});
