// THE GRID — the rooms every tweak is measured in.
//
// Its own module because two readers need it and only one of them is a command
// line: scripts/cpu-lab.mjs measures these, and the room server serves them to
// cpu-lab.html so the page can say what is measured and what is still owed.
// Importing cpu-lab.mjs for them would run the CLI.
//
// ---- THE DEFAULT SHAPE IS THE ONE PEOPLE PLAY (re-based 2026-11-12) ---------
//
// The old grid was built from this bench's own habits and matched no real room
// on any axis. Counting the 36 archived rooms in data/rooms:
//
//   roster size     13 in 32 of 36          the old grid ran 15
//   starting SP      2 in 30 (the default)  the old grid ran 4
//   bullpen slots    2 in 30 (the default)  the old grid ran open
//   auction budget   5000 in 24             the old grid ran 1500
//   universe         fictional 18 / classic 17    mostly classic
//   nomination       manual 18 / random 17        mostly random
//   table size       2, 3 or 4 — NEVER MORE       54% of the clock on 8
//
// Budget mattered most: $5000 over 13 men is $385 a man where the old grid bid
// $100. That is not a variation, it is a different auction, and it sits
// upstream of every bidding knob the lab measures. So the CORE is the real
// shape — 13 men, 2 SP, a 2-slot pen, $5000 — and the old settings survive as
// named variations (`-sp4`, `-thin`) rather than as the unexamined default.
//
// ---- HOW THE WEIGHT IS SPREAD ----------------------------------------------
//
// A cell contributes `teams - 1` doses, so one 8-manager room carries seven
// times the weight of a 2-manager room in anything pooled across the grid. Left
// alone that makes every average a statement about big rooms, which are the
// rooms nobody plays.
//
// Evened out by giving the SMALL sizes more cells. The copies are not
// duplicates — they are the variation sweep, which is affordable at two and
// three seats and is not at eight. So the universe, the house rules, the money
// and the roster length all get swept where they are cheap, and the wide rooms
// each contribute one canonical cell:
//
//   seats   doses/cell   auction   snake   doses      share
//     2         1           8        8       16        17%
//     3         2           4        4       16        17%
//     4         3           5        4       27        29%   <- tested hardest
//     6         5           2        2       20        22%
//     8         7           1        1       14        15%
//
// 39 cells, 93 doses a batch, snake 48% of them against 11% of the old grid's
// clock.
//
// ORDERED CHEAPEST FIRST, and that is load-bearing: `run` works the list in
// order under a --minutes budget, so a run cut short has covered the most
// ground instead of spending everything on the widest room. The old grid put
// a8 fourth, and a8 was half the clock.
const RICH = (roster) => roster * 385;       // what rooms actually set: ~$385 a man
const THIN = (roster) => roster * 100;       // the app's own default
const auction = (tag, teams, extra = {}) => ({
  tag, type: "auction", teams, universe: "classic", nomination: "random",
  pen: 2, penMin: 2, sp: 2, roster: 13, budget: RICH(13), ...extra
});
const snake = (tag, teams, extra = {}) => ({
  tag, type: "snake", teams, universe: "classic", sp: 2, roster: 13, ...extra
});

export const CELLS = [
  // ---- 2 managers: the cheapest cells, so they carry the variation sweep ----
  // k runs 1..N-1, so a 2-manager room has exactly one dose: one chair tweaked
  // against one that is not. A straight duel, and the cheapest honest reading
  // the bench can take.
  snake("s2", 2),
  snake("s2-fiction", 2, { universe: "fictional" }),
  snake("s2-history", 2, { universe: "mlb-history" }),
  snake("s2-long", 2, { roster: 20 }),
  snake("s2-sp4", 2, { sp: 4, roster: 15 }),
  snake("s2-sp4-history", 2, { sp: 4, roster: 15, universe: "mlb-history" }),
  snake("s2-long-fiction", 2, { roster: 20, universe: "fictional" }),
  snake("s2-short", 2, { roster: 11 }),
  auction("a2", 2),
  auction("a2-fiction", 2, { universe: "fictional" }),
  auction("a2-history", 2, { universe: "mlb-history" }),
  auction("a2-manual", 2, { nomination: "manual" }),
  auction("a2-first", 2, { pricing: "first" }),
  auction("a2-thin", 2, { budget: THIN(13) }),
  auction("a2-long", 2, { roster: 20, budget: RICH(20) }),
  auction("a2-sp4", 2, { sp: 4, pen: "all", roster: 15, budget: THIN(15) }),

  // ---- 3 managers: the most common AUCTION size in the archive (16 rooms) --
  snake("s3", 3),
  snake("s3-fiction", 3, { universe: "fictional" }),
  snake("s3-long", 3, { roster: 20 }),
  snake("s3-sp4", 3, { sp: 4, roster: 15 }),
  auction("a3", 3),
  auction("a3-fiction", 3, { universe: "fictional" }),
  auction("a3-manual", 3, { nomination: "manual" }),
  auction("a3-thin", 3, { budget: THIN(13) }),

  // ---- 4 managers: tested hardest, by request ------------------------------
  snake("s4", 4),
  snake("s4-fiction", 4, { universe: "fictional" }),
  // The ONLY cell on any grid where slotTiebreak has ever been reachable: the
  // branch fires on a snake pick that upgrades nothing, and no short draft
  // produces one.
  snake("s4-long", 4, { roster: 20 }),
  snake("s4-sp4", 4, { sp: 4, roster: 15 }),
  auction("a4", 4),
  auction("a4-fiction", 4, { universe: "fictional" }),
  auction("a4-manual", 4, { nomination: "manual" }),
  // The old grid's entire shape, kept as one cell. Every number this bench
  // produced before 2026-11-12 was measured in a room like this one, so it is
  // the only place a new reading can be held against the old record.
  auction("a4-sp4", 4, { sp: 4, pen: "all", roster: 15, budget: THIN(15) }),
  // Depth bidding only fires once the nine are covered.
  auction("a4-long", 4, { roster: 20, budget: RICH(20) }),

  // ---- 6 and 8 managers: one canonical cell each, and they are not cheap ---
  snake("s6", 6),
  snake("s6-fiction", 6, { universe: "fictional" }),
  auction("a6", 6),
  auction("a6-fiction", 6, { universe: "fictional" }),
  snake("s8", 8),
  auction("a8", 8)
];

// WHAT A TAG MEANT WHEN A ROW WAS BANKED. A cell's tag is a name, not a
// definition, and editing the grid can leave the name pointing at a different
// room — the 2026-11-12 re-base changed the room behind `a4-manual`,
// `a4-fiction`, `a4-long` and `s4-long` while keeping their names. Rows from
// either side of that would pool silently and average two rooms into one
// number, which is the same fault the `baseline` field exists to stop.
//
// So every row records the shape it was measured in, and pooling requires a
// match. Cheap to compute, and it moves only when the room really changes.
export function cellShape(cell) {
  const body = Object.keys(cell).filter((k) => k !== "tag" && k !== "screen").sort()
    .map((k) => `${k}=${JSON.stringify(cell[k])}`).join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 6);
}
