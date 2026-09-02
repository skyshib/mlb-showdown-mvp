import test from "node:test";
import assert from "node:assert/strict";
import {
  insertTierBreak,
  loadOnlineDraftNotes,
  loadOnlineDraftRankings,
  moveRankedAboveBreak,
  moveRankedIds,
  moveRankedWithTiers,
  normalizeDraftNotes,
  normalizeDraftRankings,
  normalizeTierBreaks,
  nudgeRankedIds,
  nudgeRankedWithTiers,
  rankAtWithTiers,
  rankIdAt,
  removeRankedId,
  removeRankedWithTiers,
  removeTierBreak,
  loadOnlineRankingMode,
  saveOnlineRankingMode,
  saveOnlineDraftNotes,
  saveOnlineDraftRankings,
  tierOfRank
} from "../src/ui/draftRankings.js";

test("draft rankings normalize into private manager and position boards", () => {
  assert.deepEqual(normalizeDraftRankings({
    managerA: {
      "hitter:C": ["a", "b", "a", null],
      "hitter:1B": [],
      "pitcher:SP": "not a list"
    },
    managerB: null
  }), {
    managerA: {
      "hitter:C": { ids: ["a", "b"], tiers: [] },
      "hitter:1B": { ids: [], tiers: [] }
    }
  });
});

test("v3 boards keep their tiers through normalization, clamped to the list", () => {
  assert.deepEqual(normalizeDraftRankings({
    managerA: {
      "hitter:C": { ids: ["a", "b", "c", "d"], tiers: [2, 2, 9, 0, "x", 3] },
      "hitter:SS": { ids: ["a"], tiers: [1] },
      "hitter:2B": { tiers: [1] }
    }
  }), {
    managerA: {
      "hitter:C": { ids: ["a", "b", "c", "d"], tiers: [2, 3] },
      "hitter:SS": { ids: ["a"], tiers: [] }
    }
  });
});

test("ranked players can be dragged before or after another player", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(moveRankedIds(ids, "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveRankedIds(ids, "a", "c", { after: true }), ["b", "c", "a", "d"]);
  assert.deepEqual(moveRankedIds(["a", "b"], "new", "b"), ["a", "new", "b"]);
  assert.deepEqual(moveRankedIds(["a", "b"], "new", "unranked"), ["a", "b", "new"]);
  assert.deepEqual(moveRankedIds(["a", "b"], "a", "unranked"), ["b", "a"]);
  assert.deepEqual(ids, ["a", "b", "c", "d"], "the saved source list is not mutated");
});

test("ranking arrow controls nudge a player without crossing the ends", () => {
  assert.deepEqual(nudgeRankedIds(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(nudgeRankedIds(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(nudgeRankedIds(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
});

test("typing a rank inserts the player and shifts everyone below them", () => {
  assert.deepEqual(rankIdAt(["a", "b", "c"], "new", 2), ["a", "new", "b", "c"]);
  assert.deepEqual(rankIdAt(["a", "b", "c"], "a", 2), ["b", "a", "c"]);
  assert.deepEqual(rankIdAt(["a", "b"], "new", 10), ["a", "b", "new"]);
  assert.deepEqual(rankIdAt(["a", "b"], "new", 0), ["a", "b"]);
  assert.deepEqual(rankIdAt(["a", "b"], "a", 0), ["a", "b"]);
  assert.deepEqual(removeRankedId(["a", "b", "c"], "b"), ["a", "c"]);
});

test("tier breaks normalize sorted, deduped, and inside the ranked group", () => {
  assert.deepEqual(normalizeTierBreaks([3, 1, 3, 0, 4, "x", 2.9], 4), [1, 2, 3]);
  assert.deepEqual(normalizeTierBreaks([1], 1), []);
  assert.deepEqual(normalizeTierBreaks("junk", 4), []);
  assert.deepEqual(insertTierBreak([3], 1, 5), [1, 3]);
  assert.deepEqual(insertTierBreak([3], 3, 5), [3]);
  assert.deepEqual(removeTierBreak([1, 3], 3), [1]);
  assert.equal(tierOfRank([2, 5], 2), 1);
  assert.equal(tierOfRank([2, 5], 3), 2);
  assert.equal(tierOfRank([2, 5], 9), 3);
  assert.equal(tierOfRank([], 4), 1);
});

test("a dragged player joins the tier of the row he was dropped on", () => {
  const board = { ids: ["a", "b", "c", "d"], tiers: [3] };
  // Dropped after c — the last card of tier 1 — he stays in tier 1.
  assert.deepEqual(moveRankedWithTiers(board, "a", "c", { after: true }),
    { ids: ["b", "c", "a", "d"], tiers: [3] });
  // Dropped before d — the first card of tier 2 — he crosses the divider.
  assert.deepEqual(moveRankedWithTiers(board, "a", "d"),
    { ids: ["b", "c", "a", "d"], tiers: [2] });
  // The last tier's only card climbing into tier 1 dissolves the divider:
  // every card is tier 1 now, and a break after the final rank means nothing.
  assert.deepEqual(moveRankedWithTiers(board, "d", "b"),
    { ids: ["a", "d", "b", "c"], tiers: [] });
  // A new player dropped on an unranked row lands in the last tier.
  assert.deepEqual(moveRankedWithTiers(board, "new", "unranked"),
    { ids: ["a", "b", "c", "d", "new"], tiers: [3] });
  // A no-op drop leaves the dividers exactly where they were.
  assert.deepEqual(moveRankedWithTiers(board, "c", "c"),
    { ids: ["a", "b", "c", "d"], tiers: [3] });
});

test("dropping on a divider lands exactly above the break, jumping nobody", () => {
  const board = { ids: ["a", "b", "c", "d"], tiers: [2] };
  // d dropped on the tier-2 divider: last card of tier 1, b keeps his spot.
  assert.deepEqual(moveRankedAboveBreak(board, "d", 2),
    { ids: ["a", "b", "d", "c"], tiers: [3] });
  // A new card on the divider joins tier 1 at its bottom.
  assert.deepEqual(moveRankedAboveBreak(board, "new", 2),
    { ids: ["a", "b", "new", "c", "d"], tiers: [3] });
  // The top shelf (break 0) means rank 1, tier 1.
  assert.deepEqual(moveRankedAboveBreak(board, "c", 0),
    { ids: ["c", "a", "b", "d"], tiers: [3] });
  // The last card of tier 1 dropped on its own divider stays put.
  assert.deepEqual(moveRankedAboveBreak(board, "b", 2),
    { ids: ["a", "b", "c", "d"], tiers: [2] });
  // The only card below a divider climbing above it dissolves the tier.
  assert.deepEqual(moveRankedAboveBreak({ ids: ["a", "b", "c"], tiers: [2] }, "c", 2),
    { ids: ["a", "b", "c"], tiers: [] });
});

test("typed ranks and cleared ranks carry the dividers with them", () => {
  const board = { ids: ["a", "b", "c", "d"], tiers: [2] };
  // #2 is a tier-1 slot, so the new player joins tier 1 and it grows.
  assert.deepEqual(rankAtWithTiers(board, "new", 2),
    { ids: ["a", "new", "b", "c", "d"], tiers: [3] });
  // Clearing the last card of tier 1 pulls the divider up.
  assert.deepEqual(removeRankedWithTiers(board, "b"),
    { ids: ["a", "c", "d"], tiers: [1] });
  // Clearing tier 1 entirely dissolves the divider.
  assert.deepEqual(removeRankedWithTiers({ ids: ["a", "b"], tiers: [1] }, "a"),
    { ids: ["b"], tiers: [] });
  // Typing the rank a player already holds changes nothing.
  assert.deepEqual(rankAtWithTiers(board, "b", 2),
    { ids: ["a", "b", "c", "d"], tiers: [2] });
});

test("the arrows treat a divider as a stop: crossing moves the player, not the neighbours", () => {
  const board = { ids: ["a", "b", "c", "d"], tiers: [2] };
  // b is last of tier 1; pressing down slides him across the divider in place.
  assert.deepEqual(nudgeRankedWithTiers(board, "b", 1),
    { ids: ["a", "b", "c", "d"], tiers: [1] });
  // c is first of tier 2; pressing up pulls him into tier 1 in place.
  assert.deepEqual(nudgeRankedWithTiers(board, "c", -1),
    { ids: ["a", "b", "c", "d"], tiers: [3] });
  // Away from a divider the arrows swap neighbours as they always did.
  assert.deepEqual(nudgeRankedWithTiers(board, "d", -1),
    { ids: ["a", "b", "d", "c"], tiers: [2] });
  // A singleton tier hopped out of dissolves rather than surviving empty.
  assert.deepEqual(nudgeRankedWithTiers({ ids: ["a", "b", "c"], tiers: [1, 2] }, "b", -1),
    { ids: ["a", "b", "c"], tiers: [2] });
});

test("notes normalize to trimmed, capped, non-empty lines per manager", () => {
  assert.deepEqual(normalizeDraftNotes({
    managerA: {
      p1: "  elite glove · $30 max  ",
      p2: "",
      p3: "   ",
      p4: "x".repeat(200),
      p5: 42
    },
    managerB: "not notes"
  }), {
    managerA: {
      p1: "elite glove · $30 max",
      p4: "x".repeat(80)
    }
  });
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
      "hitter:C": { ids: ["a", "b"], tiers: [1] },
      "pitcher:SP": { ids: ["p1", "p2"], tiers: [] },
      "hitter:CF": { ids: [], tiers: [] }
    },
    managerB: {
      "hitter:C": { ids: ["secret"], tiers: [] }
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

test("v2 boards saved as bare arrays still load, and a v3 save retires them", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  values.set(
    "mlb-showdown-online-rankings-v2:blue-sky:managerA",
    JSON.stringify({ "hitter:C": ["a", "b"] })
  );

  const migrated = loadOnlineDraftRankings(storage, "blue-sky", "managerA");
  assert.deepEqual(migrated, {
    managerA: { "hitter:C": { ids: ["a", "b"], tiers: [] } }
  });

  assert.equal(saveOnlineDraftRankings(storage, "blue-sky", "managerA", migrated), true);
  assert.equal(values.has("mlb-showdown-online-rankings-v2:blue-sky:managerA"), false,
    "the superseded v2 copy is removed so it cannot resurrect a cleared board");
  assert.deepEqual(loadOnlineDraftRankings(storage, "blue-sky", "managerA"), migrated);
});

test("online notes persist privately by room and seat, like the rankings", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
  const notes = {
    managerA: { p1: "weird chart", p2: "$18 max" },
    managerB: { p1: "secret" }
  };

  assert.equal(saveOnlineDraftNotes(storage, "blue-sky", "managerA", notes), true);
  assert.deepEqual(loadOnlineDraftNotes(storage, "blue-sky", "managerA"), {
    managerA: notes.managerA
  });
  assert.deepEqual(loadOnlineDraftNotes(storage, "blue-sky", "managerB"), {});
  assert.equal(saveOnlineDraftNotes(storage, "blue-sky", "managerA", {}), true);
  assert.deepEqual(loadOnlineDraftNotes(storage, "blue-sky", "managerA"), {});
});

test("the ranking-mode switch is kept per room and seat, and defaults to unset", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  // Nothing stored means "no opinion" — the caller keeps its own default.
  assert.equal(loadOnlineRankingMode(storage, "blue-sky", "managerA"), null);

  assert.equal(saveOnlineRankingMode(storage, "blue-sky", "managerA", false), true);
  assert.equal(loadOnlineRankingMode(storage, "blue-sky", "managerA"), false);
  assert.equal(loadOnlineRankingMode(storage, "blue-sky", "managerB"), null, "another seat is unaffected");
  assert.equal(loadOnlineRankingMode(storage, "other-room", "managerA"), null, "another room is unaffected");

  assert.equal(saveOnlineRankingMode(storage, "blue-sky", "managerA", true), true);
  assert.equal(loadOnlineRankingMode(storage, "blue-sky", "managerA"), true);

  // A spectator has no seat to key on, so there is nothing to keep.
  assert.equal(saveOnlineRankingMode(storage, "blue-sky", null, false), false);
  assert.equal(loadOnlineRankingMode(storage, "blue-sky", null), null);
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
