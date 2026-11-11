// THE GRID — the rooms every tweak is measured in.
//
// Its own module because two readers need it and only one of them is a command
// line: scripts/cpu-lab.mjs measures these, and the room server serves them to
// cpu-lab.html so the page can say what is measured and what is still owed.
// Importing cpu-lab.mjs for them would run the CLI.
//
// `teams` is the pool size: the deck is dealt to the room. Rosters and budgets
// are the room defaults for the shape being tested, not variations of their own
// — a cell should differ from its neighbours in ONE thing wherever it can.
// TWO STAGES. A cell costs what its table size costs, and the cost is steeply
// superlinear — measured over 11 hours of this bench: 3 seats 15s a
// measurement, 4 seats 29s, 6 seats 81s, 8 seats 182s. Worse, a wider room has
// more doses to measure (k runs 1..N-1), so one tweak across a8-classic is
// seven measurements at 189s = 22 minutes, against 34 seconds at a3-classic.
// a8 and a6 alone are ~14 of the ~21 hours a full pass of the queue costs.
//
// So they are marked `screen: false` and held back for the SECOND stage. The
// screen runs every candidate over the cheap cells and only the far dose; what
// survives it buys the wide boards and the whole adoption curve. Nothing is
// dropped from the grid — a confirm run measures all 17 — the expensive cells
// are simply not spent on candidates that have shown nothing anywhere.
export const CELLS = [
  { tag: "a3-classic", type: "auction", teams: 3, universe: "classic", nomination: "random", pen: "all", penMin: 2, sp: 4, roster: 15, budget: 1500 },
  { tag: "a4-classic", type: "auction", teams: 4, universe: "classic", nomination: "random", pen: "all", penMin: 2, sp: 4, roster: 15, budget: 1500 },
  { tag: "a6-classic", type: "auction", teams: 6, universe: "classic", nomination: "random", pen: "all", penMin: 2, sp: 4, roster: 15, budget: 1500, screen: false },
  { tag: "a8-classic", type: "auction", teams: 8, universe: "classic", nomination: "random", pen: 3, penMin: 2, sp: 4, roster: 15, budget: 1500, screen: false },
  { tag: "a4-manual", type: "auction", teams: 4, universe: "classic", nomination: "manual", pen: 2, penMin: 2, sp: 4, roster: 15, budget: 1500 },
  { tag: "a4-first", type: "auction", teams: 4, universe: "classic", nomination: "random", pen: "all", penMin: 2, sp: 4, roster: 15, budget: 1500, pricing: "first" },
  { tag: "a4-fiction", type: "auction", teams: 4, universe: "fictional", nomination: "random", pen: "all", penMin: 2, sp: 4, roster: 15, budget: 1500 },
  { tag: "a4-history", type: "auction", teams: 4, universe: "mlb-history", nomination: "random", pen: "all", penMin: 2, sp: 4, roster: 15, budget: 1500 },
  { tag: "a4-short", type: "auction", teams: 4, universe: "classic", nomination: "random", pen: "all", penMin: 2, sp: 2, roster: 13, budget: 1000 },
  // The CAPPED pen, which is the shape a default room actually runs: seven of
  // the nine auction cells above leave it uncapped, so a knob that only bites
  // where a manager may not keep stacking arms was being measured almost
  // nowhere. Differs from a4-classic in the cap and nothing else.
  { tag: "a4-pen2", type: "auction", teams: 4, universe: "classic", nomination: "random", pen: 2, penMin: 2, sp: 4, roster: 15, budget: 1500 },
  // The LONG roster. Depth bidding — what a manager does with the money left
  // once his nine are covered — only fires on a full roster, and at fifteen men
  // the night ends before much of it happens. The budget scales with the roster
  // so the extra five men are a deeper draft rather than five dollar lots; that
  // is two things moving at once, unavoidably, and the comparison that isolates
  // the roster is this cell against a4-classic read together with a4-short.
  { tag: "a4-long", type: "auction", teams: 4, universe: "classic", nomination: "random", pen: "all", penMin: 2, sp: 4, roster: 20, budget: 2000 },

  // ---- the snake ----------------------------------------------------------
  // Two cells used to carry the whole format, and they differed from each other
  // in three things at once (teams, universe, roster), so nothing in between
  // them could be read. s6-classic and s8-classic give the snake the clean
  // width sweep the auction has had all along, which also turns s6-fiction back
  // into what it was meant to be: the universe contrast, one thing changed.
  { tag: "s4-classic", type: "snake", teams: 4, universe: "classic", sp: 4, roster: 15 },
  { tag: "s6-classic", type: "snake", teams: 6, universe: "classic", sp: 4, roster: 15 },
  { tag: "s8-classic", type: "snake", teams: 8, universe: "classic", sp: 4, roster: 15 },
  // The long snake roster. A turn costs the same whatever it buys, so late in a
  // long draft a pick stops upgrading anything — which is the only condition
  // under which slotTiebreak fires at all. `check` found that knob inert in
  // every cell on the old grid because no pick in a fifteen-man snake room ever
  // reaches that branch. This is the cell that reaches it.
  { tag: "s4-long", type: "snake", teams: 4, universe: "classic", sp: 4, roster: 20 },
  { tag: "s4-history", type: "snake", teams: 4, universe: "mlb-history", sp: 4, roster: 15 },
  { tag: "s6-fiction", type: "snake", teams: 6, universe: "fictional", sp: 2, roster: 13 }
];
