import test from "node:test";
import assert from "node:assert/strict";
import {
  loadOnlineDraftRankings,
  moveRankedIds,
  normalizeDraftRankings,
  nudgeRankedIds,
  saveOnlineDraftRankings
} from "../src/ui/draftRankings.js";

test("draft rankings normalize into private manager and position lists", () => {
  assert.deepEqual(normalizeDraftRankings({
    managerA: {
      "hitter:C": ["a", "b", "a", null],
      "pitcher:SP": "not a list"
    },
    managerB: null
  }), {
    managerA: {
      "hitter:C": ["a", "b"]
    }
  });
});

test("ranked players can be dragged before or after another player", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(moveRankedIds(ids, "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveRankedIds(ids, "a", "c", { after: true }), ["b", "c", "a", "d"]);
  assert.deepEqual(ids, ["a", "b", "c", "d"], "the saved source list is not mutated");
});

test("ranking arrow controls nudge a player without crossing the ends", () => {
  assert.deepEqual(nudgeRankedIds(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(nudgeRankedIds(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(nudgeRankedIds(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
});

test("online rankings persist privately by room and manager seat", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const rankings = {
    managerA: {
      "hitter:C": ["a", "b"],
      "pitcher:SP": ["p1", "p2"]
    },
    managerB: {
      "hitter:C": ["secret"]
    }
  };

  assert.equal(saveOnlineDraftRankings(storage, "blue-sky", "managerA", rankings), true);
  assert.deepEqual(loadOnlineDraftRankings(storage, "blue-sky", "managerA"), {
    managerA: rankings.managerA
  });
  assert.deepEqual(loadOnlineDraftRankings(storage, "blue-sky", "managerB"), {});
  assert.deepEqual(loadOnlineDraftRankings(storage, "other-room", "managerA"), {});

  assert.equal(saveOnlineDraftRankings(storage, "blue-sky", "managerA", {}), true);
  assert.deepEqual(loadOnlineDraftRankings(storage, "blue-sky", "managerA"), {});
});

test("online ranking storage ignores malformed and unavailable browser data", () => {
  const brokenStorage = {
    getItem: () => "{not json",
    setItem: () => {
      throw new Error("storage disabled");
    }
  };

  assert.deepEqual(loadOnlineDraftRankings(brokenStorage, "blue-sky", "managerA"), {});
  assert.equal(saveOnlineDraftRankings(brokenStorage, "blue-sky", "managerA", {
    managerA: { "hitter:C": ["a"] }
  }), false);
  assert.deepEqual(loadOnlineDraftRankings(null, "blue-sky", "managerA"), {});
});
