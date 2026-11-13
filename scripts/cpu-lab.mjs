#!/usr/bin/env node
// THE CPU LAB — a standing test bench for changes to how computers draft.
//
// The question it answers is always the same one: if half the managers in a
// room get a tweak and the other half do not, does the tweaked half win more?
// It answers it the same way every time, across a grid of board sizes, with the
// archetypes switched off, and it writes every answer to one file so the record
// accumulates run after run instead of scrolling past.
//
//   node scripts/cpu-lab.mjs list                     what is queued, what is measured
//   node scripts/cpu-lab.mjs run                      measure everything not yet measured
//   node scripts/cpu-lab.mjs run --tweak share-steep  one candidate, every cell
//   node scripts/cpu-lab.mjs run --minutes 480         work the queue until the budget runs out
//   node scripts/cpu-lab.mjs report                   the table, pooled over every batch
//
// ---- WHY IT LOOKS LIKE THIS -------------------------------------------------
//
// PERSONAS OFF. Every seat is the same archetype, so the only difference across
// a table is the tweak. This is not tidiness: a persona's win% is almost
// entirely a fact about the FIELD it sits in, not about how well it drafts (the
// slugger is -5.3 in the standings and -0.35 in absolute strength), so a tweak
// measured against a mixed field is measured against the loudest thing in the
// room. `--persona rotate` puts the archetypes back for a final check.
//
// EVERY CELL IS MEASURED TWICE, and the pair is the point:
//
//   MIXED      one room, half the seats tweaked, bidding against each other for
//              the same cards. Mirrored over both parities, so every seat is
//              tweaked in exactly one of the two rooms and no chair or
//              nomination slot can carry the result. This is the competitive
//              read: what happens at a table that does not all think alike.
//
//   IDENTICAL  the same room drafted twice off one seed, all-tweaked and
//              all-shipped, each roster then playing its OWN counterpart from
//              the other room. Nobody ever bid against the other side, so this
//              is strength alone.
//
// The GAP is denial. A change that only reaches earlier and leaves rivals the
// dregs scores in mixed and nothing in identical — that is how the 1.3x
// reliever lift (+1.5 to +4.9 mixed, 49.6-49.9% identical) and the first-price
// runner-up estimator (+3.65 mixed, -2.43 identical) were caught, and both were
// reverted. Anything shipping to ALL computers has to clear identical.
//
// POOL SIZES. The deck is dealt to the room, so the table size IS the pool
// size: three managers see a thin board where every lot matters, eight see a
// wide one with real alternatives at every spot. A knob can easily be right at
// one width and wrong at another — the 5-SP starter discount was — so the grid
// runs 3, 4, 6 and 8 seats, three card sets, both nomination rules, both
// pricing rules, and the snake as well as the auction.
//
// TWO FIXTURES RUN FIRST, always (see cpu-lab-tweaks.mjs): `null`, which must
// print 0.00 exactly or the measurement is broken, and `jiggle`, the placebo
// that says what this bench pays for a change worth nothing.
//
// ---- WHAT ACCUMULATES -------------------------------------------------------
//
// Every (tweak, cell, mode) measurement appends one row to
// data/cpu-lab/results.jsonl holding its per-league edges. Re-running adds a
// FRESH BATCH on new seeds rather than redoing the old one, and `report` pools
// every batch, so precision grows the longer the bench runs. Nothing is ever
// rewritten, so a result can always be traced back to the commit that produced
// it.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { autopick, buildTeam, completeAuctionReview, createDraft, repairDraftRosters } from "../src/rules/draft.js";
import { buildDraftPool } from "../src/data/universes.js";
import { simulateBatch } from "../src/rules/batch.js";
import { CPU_KNOB_GENERATIONS, CPU_TUNABLE_DEFAULTS, baselineKey, cpuTunables, knobGeneration } from "../src/rules/cpuTunables.js";
import { IDEA_REJECTS, TWEAKS, tweakById } from "./cpu-lab-tweaks.mjs";
import { appendIdea, ideasFile, knobKey } from "./cpu-lab-ideas.mjs";
import { RULE, chances, verdictSoFar } from "./cpu-lab-rule.mjs";
// The grid lives in its own module: the room server reads it too, and importing
// this file for it would run the CLI.
import { CELLS, cellShape } from "./cpu-lab-cells.mjs";

export { CELLS };


const USAGE = `cpu-lab — a standing bench for CPU draft tweaks

  THE TWO STAGES — screen wide and cheap, then spend on what survives:
  node scripts/cpu-lab.mjs run --stage screen                every candidate, 15 cheap cells, far dose, 1 batch
  node scripts/cpu-lab.mjs screen                            what that bought, ranked, with the cut applied
  node scripts/cpu-lab.mjs ship --tweak ID                   the pre-ship checklist; reports, never edits
  node scripts/cpu-lab.mjs run --stage confirm --tweak ID    a survivor: all 17 cells, whole curve, 4 batches

  node scripts/cpu-lab.mjs list
  node scripts/cpu-lab.mjs run    [--tweak id,id|all] [--cells tag,tag|all] [--mode mixed|identical|both|dose|all]
                                  [--leagues N] [--runs N] [--batches N] [--minutes N]
                                  [--persona KEY|rotate] [--perturb N] [--no-fixtures] [--out FILE]
  node scripts/cpu-lab.mjs bench  [--versus GENERATION] [...the run flags]
  node scripts/cpu-lab.mjs report [--tweak id,id|all] [--cells tag,tag|all] [--versus G] [--out FILE]
  node scripts/cpu-lab.mjs idea   --id NAME --knobs '{"knob":value}' --note "what it claims"
                                  [--room ROOM] [--why "the observation"] [--by WHO]
  node scripts/cpu-lab.mjs bracket --knob KNOB [--values a,b,c] [--why "..."] [--by WHO]

  idea        propose a candidate from outside this bench — an agent that read
              one room, a study of one board, anything with evidence behind it.
              Validated and appended to scripts/cpu-lab-ideas.jsonl, after which
              it is a candidate like any other and the next run measures it.
              Values here may contain spaces; they end at the next --flag.

  bracket     a knob that measured as real has been shown to MATTER, not to be
              right: the bench compared one value against one other value, and
              the shape either side of it is unmeasured. This queues the
              neighbours as candidates through the ideas inbox. It also queues
              THE REVERSAL — the value an older generation holds — whose reading
              against the new baseline must reproduce the shipped move with the
              sign flipped. Nothing else here checks that the effect is a
              property of the knob rather than of the comparison.

  bench       the live bidder against a frozen generation of knobs across the
              whole grid (default "naive", the tuning backed out — the absolute
              scale). --versus tuned-... is the drift read: a round of changes
              that beat each other but not the generation they came from was
              fitted to its own seeds.
  --mode      dose (the default): the same room at every k of N chairs tweaked,
              reading what those chairs won over the room's par — the adoption
              curve. Also mixed (half and half), identical (two rooms off one
              seed, each roster against its own counterpart), both, or all. Dose reads the TWEAKED TEAMS' OWN win% against the 50%
              a seat averages when nothing sets it apart — which is why some
              chairs stay untweaked: with every chair on the tweak there is
              nothing left for them to win it from.
  --baseline  READ ONLY: pool the rows taken when the shipped bidder was a
              different generation (a knob that ships changes what the control
              chairs believe, so those are a different experiment and are
              quarantined by default). Rows banked before 2026-11-11 carry no
              baseline and count as tuned-2026-11-10.
  --versus    who sits in the CONTROL chairs: a generation out of
              cpuTunables.js, or "defaults" (the live values).
  --holdout   move every seed into a separate namespace. Confirm a winner here
              and it is a winner on seeds that had no hand in picking it.
  --leagues   leagues per batch (default 24). One league = two drafted rooms.
  --runs      games simulated per league (default 1500) — the LEAGUE's total,
              not each team's. Every team plays runs x 2 / teams of them, so a
              team plays 1500 games in a two-manager room, 750 in a four and
              372 in an eight. Averaging over more seats makes up most of the
              difference, but a wide room is not giving each team more data.
  --batches   how deep each FIXTURE is measured (default 1).
  --passes    how many times a candidate may sweep the whole grid before giving
              up on deciding (default 4). A pass covers every room once before
              any room is measured twice, so the stopping rule sees breadth
              first. One pass settles a real +0.3 about 21% of the time, four
              about 66%, eight about 85%; the kill rate stays near 9% whatever
              you choose, so waiting costs time and not accuracy.
  --minutes   stop starting new work after this long. Finished rows are kept.
  --accept    stop and accept once the average is above zero with at least
              this confidence (default 0.99 — which gives a 5% false-accept
              rate in practice, not 1%, because the question is asked after
              every reading). Accepting means "measure this one properly",
              never "ship it".
  --kill      stop and kill once this much of the posterior sits below zero
              (default 0.90). --kill 0 measures everything regardless.
  --accept-above  the value the average must beat to be accepted (default 0).
  --prior     how big effects are expected to be before measuring anything
              (default 0.5 win points). Centred on zero, because nearly all
              tweaks are worth nothing.
  --min-looks don't call it before this many readings (default 5).
  --min-rooms don't measure a candidate the grid barely reaches: once every
              room has been walked once, drop it if it moves nothing in all but
              this many (default 3). Not a verdict on the knob — it says the
              grid cannot answer, and only a room built for the knob's
              precondition could. --min-rooms 0 measures them anyway.
  --accept-sizes  don't ACCEPT until the readings span this many different
              table sizes (default 2). The grid runs smallest room first, so
              without it a candidate could be accepted having only ever been
              seen at two managers — the very axis a knob is most likely to
              vary along. Killing does not wait for breadth.
  --persona   the archetype every seat wears (default balanced), or "rotate".
  --perturb   the seeded wobble on a manager's weights (default 0.25, the
              shipped value; 0 makes every seat of an archetype think alike).
`;

const argv = process.argv.slice(2);
const flagsAt = argv.findIndex((token) => token.startsWith("--"));
const command = argv.includes("--help") || argv.includes("-h")
  ? "help"
  : (flagsAt === -1 ? argv : argv.slice(0, flagsAt)).find((token) => !token.startsWith("--")) ?? "report";
const args = Object.fromEntries((flagsAt === -1 ? [] : argv.slice(flagsAt)).join(" ").split("--")
  .filter(Boolean).map((chunk) => chunk.trim().split(/\s+/)).map(([key, value]) => [key, value ?? "1"]));

// The parser above keeps only the first word of a value, which is right for
// --leagues 24 and wrong for --note "a whole sentence". Flags that carry prose
// read through this instead: everything up to the next --flag.
function rawFlag(name) {
  const at = argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const words = [];
  for (let i = at + 1; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) break;
    words.push(argv[i]);
  }
  return words.join(" ");
}

// ---- THE TWO STAGES ---------------------------------------------------------
// The bench's budget problem is arithmetic, not method. One pass of the queue
// over the whole grid costs ~21 hours and lands a SINGLE batch on each pair,
// and a single batch is ±1.1 win points at the lone-adopter end — wider than
// any effect worth shipping. Spreading the budget evenly over 27 candidates
// buys 27 unreadable numbers.
//
//   --stage screen    every candidate, every room, every adoption level, one
//                     batch each. One pass of the grid.
//   --stage confirm   the survivors, the same ground at four batches.
//
// THE SCREEN MEASURES EVERY ADOPTION LEVEL because the criterion averages over
// them: a gain when 1 of 4 managers has the tweak counts exactly as much as a
// gain when 3 of 4 do (Skylar, 2026-11-12). You cannot average over something
// you did not measure, so the two stages now differ only in depth.
//
// It used to screen on the LAST HOLDOUT alone — the 3-of-4 reading — on the
// argument that it is the precise end of the curve and the one that answers
// the shipping question. The first half was true and the second was not, and
// it let a change ship that was worth nothing: at 3 of 4 there is still one
// manager without the tweak, so there is still somebody to take cards from.
const STAGE = args.stage ?? null;
if (STAGE && !["screen", "confirm"].includes(STAGE)) {
  console.error(`cpu-lab: --stage is screen or confirm, not "${STAGE}"`);
  process.exit(1);
}
const STAGE_MODE = { screen: "dose", confirm: "dose" };
const STAGE_BATCHES = { screen: 1, confirm: 4 };

const LEAGUES = Number(args.leagues ?? 24);
const RUNS = Number(args.runs ?? 1500);
const BATCHES = Number(args.batches ?? STAGE_BATCHES[STAGE] ?? 1);
const MINUTES = args.minutes == null ? Infinity : Number(args.minutes);
const PERSONA = args.persona ?? "balanced";
const PERTURB = args.perturb == null ? null : Number(args.perturb);
const MODE = args.mode ?? STAGE_MODE[STAGE] ?? "dose";
const OUT = path.resolve(args.out ?? path.join(path.dirname(new URL(import.meta.url).pathname), "..", "data", "cpu-lab", "results.jsonl"));
// Every seat shares this, tweaked side and shipped side alike, so it is a
// property of the ROOM and never of the thing being measured.
const BASE = PERTURB == null ? {} : { perturbation: PERTURB };
// WHO SITS IN THE CONTROL CHAIRS. The live defaults by default; with --versus,
// a frozen generation out of cpuTunables.js, which is the only control that
// cannot drift under the thing being measured. Run the `null` fixture against a
// generation and the measurement IS the live bidder against that generation —
// the drift read, on seeds that picked none of the knobs in between.
const VERSUS = args.versus ?? (command === "bench" ? "naive" : "defaults");
// A separate seed namespace. Candidates are chosen on the seeds the bench has
// always used, which is how a knob comes to be fitted to them; re-reading a
// winner here asks whether it was the seeds.
const HOLDOUT = args.holdout == null ? "" : "-holdout";
const CONTROL = VERSUS === "defaults" ? {} : knobGeneration(VERSUS).knobs;

// WHO THE CONTROL CHAIRS ARE. `--versus defaults` seats them on the LIVE
// defaults, so it names a different bidder every time a knob ships and two
// readings taken either side of that are two different experiments. Recorded on
// every row and required to match before anything pools.
//
// Rows banked before 2026-11-11 carry no such field, and they were all taken
// against the knob set frozen as `tuned-2026-11-10` — that is what the defaults
// were — so that is what a missing one means.
// `--baseline <generation>` reads the record as it stood against an OLDER
// shipped bidder. It only ever reads: a run always measures against the live
// defaults, because that is the bidder the control chairs actually are.
// HOW THE NUMBER WAS ARRIVED AT. Changing the statistic changes what a row
// MEANS, exactly the way changing the shipped knobs or the room does, and the
// record has now been quietly mixed three times by three different versions of
// that mistake. `room-mean` compared a seat to its room's average and carried
// every seat's luck; `seat-paired` compares a seat to itself in the same room
// with nobody tweaked. Rows with no `method` predate the field and are
// `room-mean`.
const METHOD = "seat-paired";
const LEGACY_METHOD = "room-mean";
const methodOf = (row) => row.method ?? LEGACY_METHOD;

const BASELINE = args.baseline ?? baselineKey();
const LEGACY_BASELINE = "tuned-2026-11-10";
// The knobs the THRONE last moved — what a challenger would have to displace
// rather than stack with. Read off the two newest generations: whatever differs
// between them is what the last ship changed.
const THRONE_KNOBS = (() => {
  const gens = Object.entries(CPU_KNOB_GENERATIONS).filter(([, g]) => g.knobs);
  const live = gens.find(([, g]) => cpuTunables(g.knobs).key === "");
  if (!live) return new Set();
  const previous = gens.find(([name, g]) => name !== live[0] && g.at && g.at <= live[1].at
    && Object.keys(g.knobs).length === Object.keys(live[1].knobs).length);
  if (!previous) return new Set();
  return new Set(Object.keys(live[1].knobs).filter((knob) =>
    JSON.stringify(live[1].knobs[knob]) !== JSON.stringify(previous[1].knobs[knob])));
})();

const baselineOf = (row) => row.baseline ?? LEGACY_BASELINE;

const GIT = (() => {
  try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { return "unknown"; }
})();

const mean = (list) => (list.length ? list.reduce((sum, x) => sum + x, 0) / list.length : 0);
const std = (list) => {
  if (list.length < 2) return 0;
  const m = mean(list);
  return Math.sqrt(list.reduce((sum, x) => sum + (x - m) ** 2, 0) / (list.length - 1));
};
const ci95 = (list) => (list.length > 1 ? 1.96 * std(list) / Math.sqrt(list.length) : 0);
const signed = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
const cellByTag = (tag) => {
  const found = CELLS.find((cell) => cell.tag === tag);
  if (!found) throw new Error(`cpu-lab: no cell "${tag}". Known: ${CELLS.map((c) => c.tag).join(", ")}`);
  return found;
};

// ---- one room ---------------------------------------------------------------
// Driven exactly the way the app drives a table of computers: autopick runs a
// whole auction lot, or one snake turn. Which means the lab reads the same
// nomination, the same closing sweep and the same bid resolution a live room
// does — the knobs are the only seam.
function driveRoom(cell, seed, paramsForSeat, persona) {
  const pen = cell.type === "auction" ? { bullpenSlots: cell.pen, bullpenMin: cell.penMin } : {};
  const pool = buildDraftPool(cell.universe, seed, {
    nomination: cell.nomination, managerCount: cell.teams, startingPitchers: cell.sp, ...pen
  });
  const draft = createDraft(
    Array.from({ length: cell.teams }, (unused, seat) => ({ name: `T${seat}`, cpu: true })),
    pool, cell.roster, seed,
    {
      draftType: cell.type,
      nomination: cell.nomination,
      startingPitchers: cell.sp,
      snakePicks: cell.type === "snake" ? cell.roster : undefined,
      budget: cell.budget ?? 1500,
      auctionPricing: cell.pricing ?? null,
      timer: false,
      snakeTimer: false,
      ...pen
    }
  );
  draft.managers.forEach((manager, seat) => {
    manager.persona = persona(seat);
    manager.tunables = cpuTunables({ ...BASE, ...paramsForSeat(seat) });
  });
  completeAuctionReview?.(draft, 0);
  let guard = 60000;
  while (!draft.complete && guard > 0) {
    guard -= 1;
    autopick(draft, 0);
  }
  if (!draft.complete) throw new Error(`cpu-lab: ${cell.tag} never finished (seed ${seed})`);
  repairDraftRosters?.(draft);
  return draft;
}

const ROTATION = ["balanced", "ace", "slugger", "purist"];
const personaFor = (seat) => (PERSONA === "rotate" ? ROTATION[seat % ROTATION.length] : PERSONA);

// ---- does the knob reach this cell at all? ----------------------------------
// Two rooms off one seed, one all-tweaked and one all-shipped, and NO games: it
// compares the rosters they drafted and the prices they paid. Three things come
// out of it, all of them cheap.
//
// A tweak that moves nothing here cannot possibly move a win%, so the run skips
// it and says so rather than spending an hour measuring a zero. (Half the knobs
// are like this somewhere: the snake does not bid, an uncapped pen never
// reaches the branch that prices a surplus arm, and a room whose picks run out
// never reaches the endgame at all.)
//
// A tweak that moves a lot of money and no rosters is a PRICE change, not an
// allocation change, and in a Vickrey room that is usually nothing.
//
// And with no tweak at all it is the determinism check: the two rooms must come
// out byte for byte identical, or something is leaking between them.
const rosterIds = (manager) => manager.roster.map((card) => card.id).join(" ");
const priceOf = (draft) => new Map((draft.auction?.history ?? [])
  .map((lot) => [lot.playerId, lot.price]));

function reach(cell, params, control = CONTROL, seeds = 2) {
  let seats = 0;
  let seatsMoved = 0;
  let lots = 0;
  let lotsMoved = 0;
  let dollars = 0;
  for (let sample = 0; sample < seeds; sample += 1) {
    const seed = `lab-reach-${cell.tag}-${sample}`;
    const tweaked = driveRoom(cell, seed, () => params, personaFor);
    const shipped = driveRoom(cell, seed, () => control, personaFor);
    for (let seat = 0; seat < cell.teams; seat += 1) {
      seats += 1;
      if (rosterIds(tweaked.managers[seat]) !== rosterIds(shipped.managers[seat])) seatsMoved += 1;
    }
    const after = priceOf(tweaked);
    const before = priceOf(shipped);
    for (const [id, price] of after) {
      lots += 1;
      const was = before.get(id);
      if (was !== price) {
        lotsMoved += 1;
        dollars += Math.abs(price - (was ?? 0));
      }
    }
  }
  return {
    seats,
    seatsMoved,
    lots,
    lotsMoved,
    dollars: lotsMoved ? dollars / lotsMoved : 0,
    moves: seatsMoved > 0 || lotsMoved > 0
  };
}

// ---- mixed: half the table, both parities ----------------------------------
function runMixed(cell, params, seedOf) {
  const edges = [];
  for (let league = 0; league < LEAGUES; league += 1) {
    const seed = seedOf(league);
    const tweaked = [];
    const shipped = [];
    heartbeat({ league: league + 1 });
    for (const parity of [0, 1]) {
      const isTweaked = (seat) => seat % 2 === parity;
      const draft = driveRoom(cell, seed, (seat) => (isTweaked(seat) ? params : CONTROL), personaFor);
      const teams = draft.managers.map((manager) => buildTeam(manager, { optimize: true }));
      // Both parities share the schedule and the dice. They are different rooms
      // — the tweak sits in the other chairs — so nothing is being double
      // counted, and sharing the stream means a tweak that changes nothing
      // cancels to EXACTLY zero instead of leaving sim noise behind. That is
      // what makes the `null` fixture a real check on the plumbing.
      const win = new Map(simulateBatch(teams, { runs: RUNS, seed: `${seed}-sim` })
        .teams.map((row) => [row.team, row.winPct]));
      draft.managers.forEach((manager, seat) => {
        (isTweaked(seat) ? tweaked : shipped).push(win.get(manager.name) ?? 0);
      });
    }
    edges.push(mean(tweaked) - mean(shipped));
  }
  return edges;
}

// ---- dose: the same room with k of its seats tweaked ------------------------
//
// One room, k chairs on the tweak and the rest on the control, and the contrast
// read inside that room. Run it at every k and you get a curve, which answers
// the question a single half-and-half table cannot: HOW DOES THE EDGE DECAY AS
// RIVALS ADOPT IT.
//
//   k = 1        the lone innovator, with every mispriced card still on the
//                board for him. The most flattering reading a tweak ever gets.
//   k = N/2      the half-and-half table (what `mixed` measures, by a different
//                seat assignment).
//   k = N-1      the holdout's view: everyone has it but one chair. If the edge
//                is still here, a computer that does NOT get the change is
//                punished for it — which is the case for shipping it to all.
//
// A curve that holds flat across k is an edge that survives adoption. One that
// decays toward zero is an edge that exists only while rivals do not have it:
// the same thing the mixed-minus-identical gap calls denial, read without
// leaving the room.
//
// WHAT IT CANNOT SAY, at any k: whether a table of tweaked computers is better
// than a table of shipped ones. Win% inside one room sums to a constant — the
// seats always average 50% between them — so every number here is one side
// against the other side of the SAME room, and at k = N there is no other side
// left. That question needs two rooms (see runIdentical) or a fixed opponent
// from outside. It is not a flaw in this design; it is what "relative" means.
//
// Which chairs get it ROTATES with the league, so over a batch every seat
// carries the tweak exactly k/N of the time and no chair or nomination slot can
// carry the result.
// THE NO-TWEAK RUN OF THE SAME ROOM, which is what every seat is measured
// against: the same room and seed with nobody carrying the tweak, so a seat's
// own luck is the same number on both sides and cancels.
//
// IT DOES NOT DEPEND ON THE TWEAK. Only on the room, the seed, who the control
// chairs are, and how the games are played — so it is byte-identical for every
// candidate the bench will ever measure, and worth keeping.
//
// It was in-memory only and capped at 64, while a pass needs 936 (39 rooms x 24
// leagues). A room's 24 fit, so the adoption levels WITHIN a room shared them
// and then eviction threw them away — which meant every candidate rebuilt all
// 936, every pass, forever. That is 30% of the room-building work
// (936 control against 2,232 treated) spent re-deriving the same rooms.
//
// Kept on disk now, so the first run that needs one pays and nothing ever pays
// again: across candidates, across the three parallel processes, across
// restarts. Append-only one line each, a few hundred KB in all, and reloaded
// when another process has written since — the entries are deterministic, so a
// race costs one wasted rebuild and never a wrong answer.
const CONTROL_RUNS = new Map();
const CONTROL_STORE = path.join(path.dirname(OUT), "controls.jsonl");
let controlStoreAt = -1;

// Everything the control room depends on. The tweak is deliberately absent.
const controlKeyFor = (cell, seed) =>
  `${cell.tag}:${cellShape(cell)}:${seed}:${BASELINE}:${VERSUS}:${PERSONA}:${PERTURB ?? "shipped"}:${RUNS}`;

function loadControlStore() {
  let at = 0;
  try { at = fs.statSync(CONTROL_STORE).mtimeMs; } catch { return; }
  if (at === controlStoreAt) return;
  controlStoreAt = at;
  try {
    for (const line of fs.readFileSync(CONTROL_STORE, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const saved = JSON.parse(line);
        if (saved?.k && Array.isArray(saved.w)) CONTROL_RUNS.set(saved.k, saved.w);
      } catch { /* a line half-written by another process; it will be reread */ }
    }
  } catch { /* gone between the stat and the read */ }
}

function controlRun(cell, seed) {
  const key = controlKeyFor(cell, seed);
  let found = CONTROL_RUNS.get(key);
  if (!found) {
    loadControlStore();                       // another process may have it
    found = CONTROL_RUNS.get(key);
  }
  if (!found) {
    const draft = driveRoom(cell, seed, () => CONTROL, personaFor);
    const teams = draft.managers.map((manager) => buildTeam(manager, { optimize: true }));
    const win = new Map(simulateBatch(teams, { runs: RUNS, seed: `${seed}-sim` })
      .teams.map((row) => [row.team, row.winPct]));
    found = draft.managers.map((manager) => win.get(manager.name) ?? 0);
    CONTROL_RUNS.set(key, found);
    try {
      fs.mkdirSync(path.dirname(CONTROL_STORE), { recursive: true });
      fs.appendFileSync(CONTROL_STORE, `${JSON.stringify({ k: key, w: found })}\n`);
      controlStoreAt = fs.statSync(CONTROL_STORE).mtimeMs;   // our own write, not news
    } catch { /* unwritable: the run still works, it just pays again next time */ }
  }
  return found;
}

function runDose(cell, params, seedOf, k) {
  const edges = [];
  const foils = [];
  for (let league = 0; league < LEAGUES; league += 1) {
    const seed = seedOf(league);
    heartbeat({ league: league + 1 });
    const offset = league % cell.teams;
    const isTweaked = (seat) => {
      const slot = (seat - offset + cell.teams) % cell.teams;
      return slot < k;
    };
    const draft = driveRoom(cell, seed, (seat) => (isTweaked(seat) ? params : CONTROL), personaFor);
    const teams = draft.managers.map((manager) => buildTeam(manager, { optimize: true }));
    const win = new Map(simulateBatch(teams, { runs: RUNS, seed: `${seed}-sim` })
      .teams.map((row) => [row.team, row.winPct]));
    // Each seat against ITSELF in the room where nobody was tweaked.
    const before = controlRun(cell, seed);
    const tweaked = [];
    const shipped = [];
    draft.managers.forEach((manager, seat) => {
      (isTweaked(seat) ? tweaked : shipped).push((win.get(manager.name) ?? 0) - before[seat]);
    });
    // THE TWEAKED TEAMS' OWN WIN%, against the room's par. Not the gap to the
    // other chairs: that gap is this number scaled by N/(N-k), so it says the
    // same thing while making a k of 1 look bigger than a k of 3 for arithmetic
    // reasons rather than real ones.
    //
    // Par is the room's OWN mean rather than a flat 50%, because a batch
    // schedule does not hand every team exactly the same number of games and
    // the room therefore misses 50% by a hair — a hair that measured 0.12 to
    // 0.16 win points, which is a third of the smallest effect worth shipping.
    // Against the room's own mean the two sides sum back to it exactly, by
    // construction, which is the identity the foil below is kept to check.
    // WHAT THE TWEAKED SEATS GAINED OVER THEMSELVES. Measuring against the
    // room's own mean instead made every seat's luck part of the answer: with
    // no tweak at all the reading was one chair's good season against the
    // room average, which at two seats is one roster's luck against one
    // other's. The `null` fixture read -1.31 and +3.14 in neighbouring rooms
    // and the page painted both as results.
    //
    // Paired against the same seat in the no-tweak room, that luck is the same
    // number on both sides and cancels. null is now EXACTLY zero, by
    // construction, in every room and at every adoption level.
    //
    // This buys precision, not a different question: a room's win% still sums
    // to a constant, so what the tweaked seats gain the others lose, and this
    // reading still cannot tell drafting better from taking cards off rivals.
    // The foil is kept because it says which seats paid for it.
    edges.push(mean(tweaked));
    foils.push(mean(shipped));
  }
  return { edges, foils };
}

// ---- identical: two rooms off one seed, roster against counterpart ---------
function runIdentical(cell, params, seedOf) {
  const edges = [];
  for (let league = 0; league < LEAGUES; league += 1) {
    const seed = seedOf(league);
    heartbeat({ league: league + 1 });
    const a = driveRoom(cell, seed, () => params, personaFor);
    const b = driveRoom(cell, seed, () => CONTROL, personaFor);
    let edge = 0;
    for (let seat = 0; seat < cell.teams; seat += 1) {
      // Which roster is listed first alternates by seat. Two identical teams
      // give the first slot 49.85% +-0.20 over 20 duels x 3000 games — no real
      // advantage, but it costs nothing to make it cancel exactly instead of
      // leaving a tenth of a point of house edge in every identical read.
      const tweakedFirst = seat % 2 === 0;
      const tweaked = { ...buildTeam(a.managers[seat], { optimize: true }), name: tweakedFirst ? "A" : "B" };
      const shipped = { ...buildTeam(b.managers[seat], { optimize: true }), name: tweakedFirst ? "B" : "A" };
      const win = new Map(simulateBatch(tweakedFirst ? [tweaked, shipped] : [shipped, tweaked],
        { runs: RUNS, seed: `${seed}-h2h-${seat}` }).teams.map((row) => [row.team, row.winPct]));
      edge += ((win.get(tweaked.name) ?? 0.5) - (win.get(shipped.name) ?? 0.5)) / cell.teams;
    }
    edges.push(edge);
  }
  return edges;
}

// ---- the record -------------------------------------------------------------
// ---- the heartbeat ----------------------------------------------------------
// A measurement takes a minute and a half, and a night's queue takes a night, so
// a row landing is too coarse to watch. Each process keeps a small file beside
// the results saying what it is on and which league it has reached; the room
// server collects them for cpu-lab.html, and a file nobody has touched in two
// minutes belongs to a process that is gone. Keyed by pid, because running the
// bench and a queue at the same time is normal.
const PROGRESS = path.join(path.dirname(OUT), `progress-${process.pid}.json`);
let NOW = null;

function heartbeat(patch) {
  if (patch === null) {
    try { fs.unlinkSync(PROGRESS); } catch { /* already gone */ }
    return;
  }
  NOW = {
    pid: process.pid,
    command,
    git: GIT,
    versus: VERSUS,
    persona: PERSONA,
    holdout: HOLDOUT,
    ...NOW,
    ...patch,
    at: new Date().toISOString()
  };
  try {
    fs.mkdirSync(path.dirname(PROGRESS), { recursive: true });
    fs.writeFileSync(PROGRESS, JSON.stringify(NOW));
  } catch { /* the heartbeat must never be the thing that fails a run */ }
}

process.on("exit", () => heartbeat(null));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

function readRows(file = OUT) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function appendRow(row) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.appendFileSync(OUT, `${JSON.stringify(row)}\n`);
}

// A measurement is identified by what could change its answer: the tweak's own
// knobs (not just its name — rename the id and the old rows still apply, change
// the numbers and they do not), the cell, the mode, and the room controls.
const paramKey = (params) => JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]));
const rowMatches = (row, tweak, cell, mode) => row.tweak === tweak.id
  && row.params === paramKey(tweak.params) && row.cell === cell.tag && row.mode === mode
  && row.persona === PERSONA && row.perturb === (PERTURB == null ? "shipped" : PERTURB)
  && (row.versus ?? "defaults") === VERSUS && (row.holdout ?? "") === HOLDOUT
  && baselineOf(row) === BASELINE
  && methodOf(row) === METHOD
  && (row.shape == null || row.shape === cellShape(cell))
  && row.runs === RUNS;

function measure(tweak, cell, mode, rows) {
  const done = rows.filter((row) => rowMatches(row, tweak, cell, mode));
  const batch = done.length;
  // THE ROOM SEED DOES NOT CARRY THE ADOPTION LEVEL. Every level of a batch
  // draws the same rooms, so they all share one control room — the no-tweak
  // run each is measured against — and that control is drafted and simulated
  // once instead of once per level.
  const seedOf = (league) => `lab-${cell.tag}-${batch}-${league}${HOLDOUT}`;
  const started = Date.now();
  heartbeat({
    tweak: tweak.id,
    note: tweak.note,
    cell: cell.tag,
    mode,
    batch,
    league: 0,
    leagues: LEAGUES,
    runs: RUNS,
    startedAt: new Date(started).toISOString()
  });
  const dose = mode.startsWith("dose-") ? Number(mode.slice(5)) : null;
  const measured = dose
    ? runDose(cell, tweak.params, seedOf, dose)
    : { edges: mode === "mixed" ? runMixed(cell, tweak.params, seedOf) : runIdentical(cell, tweak.params, seedOf) };
  const { edges, foils } = measured;
  const row = {
    at: new Date().toISOString(),
    git: GIT,
    baseline: BASELINE,
    method: METHOD,
    // What the cell's tag MEANT when this was measured. A tag is a name, not a
    // definition; editing the grid can point it at a different room.
    shape: cellShape(cell),
    tweak: tweak.id,
    note: tweak.note,
    params: paramKey(tweak.params),
    cell: cell.tag,
    mode,
    versus: VERSUS,
    holdout: HOLDOUT,
    batch,
    leagues: LEAGUES,
    runs: RUNS,
    persona: PERSONA,
    perturb: PERTURB == null ? "shipped" : PERTURB,
    seconds: Math.round((Date.now() - started) / 1000),
    // What a row MEANS depends on its mode, and the unit is win points either
    // way: `dose-k` holds the tweaked teams' own win% against 50, and `mixed`
    // and `identical` hold one side's win% minus the other's. The foil is the
    // untweaked chairs of the same room, kept so the two can be checked against
    // each other later without re-running the night.
    edges: edges.map((edge) => Number((edge * 100).toFixed(4))),
    ...(foils ? { foils: foils.map((foil) => Number((foil * 100).toFixed(4))) } : {}),
    ...(dose ? { k: dose, teams: cell.teams } : {})
  };
  appendRow(row);
  rows.push(row);
  return row;
}

// ---- report -----------------------------------------------------------------
function pooled(rows) {
  const edges = rows.flatMap((row) => row.edges);
  return { n: edges.length, mean: mean(edges), ci: ci95(edges), batches: rows.length };
}

// A different games count is more of the same measurement, so batches at 300
// and 3000 games pool. A different PERSONA or perturbation is a different
// experiment and must not: the field a tweak sits in is the loudest thing in
// the room.
const sameRoom = (row) => row.persona === PERSONA
  && row.perturb === (PERTURB == null ? "shipped" : PERTURB)
  && (row.versus ?? "defaults") === VERSUS
  && (row.holdout ?? "") === HOLDOUT
  && baselineOf(row) === BASELINE
  && methodOf(row) === METHOD;

// The record outlives the queue: a candidate measured months ago and since
// deleted from cpu-lab-tweaks.mjs still has rows, and they still count. So the
// report reads the tweak out of the file when the queue no longer has it, and
// says so rather than throwing.
function tweakOf(id, rows) {
  try {
    return tweakById(id);
  } catch {
    const row = rows.find((entry) => entry.tweak === id);
    return { id, note: `${row?.note ?? "unknown"} (no longer in the queue)`, params: null, retired: row?.params };
  }
}

function reportFor(tweakIds, cellTags, rows) {
  const width = 13;
  const elsewhere = rows.filter((row) => !sameRoom(row));
  if (elsewhere.length) {
    const sets = [...new Set(elsewhere.map((row) =>
      `persona=${row.persona} perturb=${row.perturb} versus=${row.versus ?? "defaults"}${row.holdout ?? ""}`))];
    console.log(`\n  (${elsewhere.length} measurements sit under other room controls — ${sets.join("; ")}`
      + ` — and are not pooled here. Pass --persona/--perturb to read them.)`);
  }
  const stale = rows.filter((row) => baselineOf(row) !== BASELINE
    && row.persona === PERSONA && (row.versus ?? "defaults") === VERSUS
    && (row.holdout ?? "") === HOLDOUT);
  if (stale.length) {
    const sets = [...new Set(stale.map(baselineOf))].sort();
    console.log(`\n  (${stale.length} measurements were taken against a DIFFERENT SHIPPED BIDDER`
      + ` — ${sets.join(", ")}, where this is ${BASELINE} — and are not pooled here. A knob that`
      + `\n   ships changes what the control chairs believe, so those readings answer a question`
      + ` about a bidder that no longer exists.)`);
  }
  for (const id of tweakIds) {
    const tweak = tweakOf(id, rows);
    const wanted = tweak.retired ?? paramKey(tweak.params);
    const mine = rows.filter((row) => row.tweak === id && row.params === wanted && sameRoom(row));
    if (!mine.length) continue;
    const benchmarking = id === "null" && VERSUS !== "defaults";
    console.log(`\n${benchmarking ? `BENCHMARK: the live bidder versus ${VERSUS}` : id}  —  `
      + `${benchmarking ? knobGeneration(VERSUS).note : tweak.note}`);
    if (id === "null" && !benchmarking) {
      console.log("  (fixture: mixed must read 0.00 exactly — anything else is state leaking between rooms.");
      console.log("   identical is each roster against a copy of itself, so it reads the SIMULATOR's noise");
      console.log("   at this games count: the floor every candidate's identical column has to clear.)");
    }
    if (id === "jiggle") console.log("  (placebo: this is what the bench pays for nothing)");
    console.log(`  ${"cell".padEnd(width)}${"mixed".padStart(18)}${"identical".padStart(18)}${"denial".padStart(10)}${"leagues".padStart(10)}`);
    const everyMixed = [];
    const everyAbs = [];
    for (const tag of cellTags) {
      const mixed = pooled(mine.filter((row) => row.cell === tag && row.mode === "mixed"));
      const abs = pooled(mine.filter((row) => row.cell === tag && row.mode === "identical"));
      if (!mixed.n && !abs.n) continue;
      everyMixed.push(...mine.filter((row) => row.cell === tag && row.mode === "mixed").flatMap((r) => r.edges));
      everyAbs.push(...mine.filter((row) => row.cell === tag && row.mode === "identical").flatMap((r) => r.edges));
      const cellOf = (stat) => (stat.n ? `${signed(stat.mean)} ±${stat.ci.toFixed(2)}` : "—");
      console.log(`  ${tag.padEnd(width)}${cellOf(mixed).padStart(18)}${cellOf(abs).padStart(18)}`
        + `${(mixed.n && abs.n ? signed(mixed.mean - abs.mean) : "—").padStart(10)}`
        + `${String(Math.max(mixed.n, abs.n)).padStart(10)}`);
    }
    const mixedAll = { n: everyMixed.length, mean: mean(everyMixed), ci: ci95(everyMixed) };
    const absAll = { n: everyAbs.length, mean: mean(everyAbs), ci: ci95(everyAbs) };
    console.log(`  ${"ALL CELLS".padEnd(width)}`
      + `${(everyMixed.length ? `${signed(mixedAll.mean)} ±${mixedAll.ci.toFixed(2)}` : "—").padStart(18)}`
      + `${(everyAbs.length ? `${signed(absAll.mean)} ±${absAll.ci.toFixed(2)}` : "—").padStart(18)}`
      + `${(everyMixed.length && everyAbs.length ? signed(mixedAll.mean - absAll.mean) : "—").padStart(10)}`
      + `${String(Math.max(mixedAll.n, absAll.n)).padStart(10)}`);
    reportDose(mine, cellTags);
    console.log(`  verdict: ${verdict(mixedAll, absAll, id, doseEnds(mine))}`);
  }
}

// THE ADOPTION CURVE. The same room with k of its N chairs on the tweak, and
// what those chairs won: their own win% against the 50% a seat averages when
// nothing sets it apart. Read down the row and you see what the tweak is worth
// as rivals pick it up — biggest to a lone innovator with every mispriced card
// still on the board, smallest when only one holdout is left to take it from.
//
// Every number is RELATIVE, necessarily: the seats of one room average 50%
// between them whatever happens, which is exactly why some chairs stay
// untweaked. Tweak all N and there is nobody left to win it from.
function reportDose(rows, cellTags) {
  const dosed = rows.filter((row) => row.mode.startsWith("dose-"));
  if (!dosed.length) return;
  console.log(`  adoption curve — the tweaked chairs' own win%, k of N on the tweak`);
  for (const tag of cellTags) {
    const mine = dosed.filter((row) => row.cell === tag);
    if (!mine.length) continue;
    const cell = cellByTag(tag);
    const columns = [];
    for (let k = 1; k < cell.teams; k += 1) {
      const stat = pooled(mine.filter((row) => row.mode === `dose-${k}`));
      columns.push(stat.n
        ? `${k}/${cell.teams}: ${signed(stat.mean)} ±${stat.ci.toFixed(2)}`
        : `${k}/${cell.teams}: —`);
    }
    console.log(`    ${tag.padEnd(13)}${columns.map((text) => text.padStart(21)).join("")}`);
    const first = pooled(mine.filter((row) => row.mode === "dose-1"));
    const last = pooled(mine.filter((row) => row.mode === `dose-${cell.teams - 1}`));
    if (first.n && last.n) {
      const fall = first.mean - last.mean;
      const read = Math.abs(fall) < first.ci + last.ci
        ? "holds up as rivals adopt it"
        : fall > 0
          ? `fades ${fall.toFixed(2)} pts from lone innovator to last holdout`
          : `grows ${(-fall).toFixed(2)} pts as rivals adopt it`;
      console.log(`    ${"".padEnd(13)}${read}`);
    }
  }
}

// A deliberately strict read, because the record is full of changes that looked
// good in one column. Strength first: a tweak that does not beat its own
// counterpart head to head is not an improvement, whatever it does to rivals.
// The two ends of the curve, pooled across whatever boards were measured: what
// one chair wins when nobody else has the tweak, and what it is still worth when
// only one holdout does not.
function doseEnds(rows) {
  return {
    lone: pooled(rows.filter((row) => (row.k ?? 0) === 1)),
    crowd: pooled(rows.filter((row) => row.k && row.k === (row.teams ?? 0) - 1))
  };
}

function verdict(mixed, abs, id, dose = { lone: { n: 0 }, crowd: { n: 0 } }) {
  // With a generation in the control chairs, the `null` tweak is not a fixture
  // at all: nothing is changed relative to the LIVE bidder, so what it measured
  // is the live bidder against that generation.
  if (id === "null" && VERSUS !== "defaults") {
    if (!abs.n || !mixed.n) return "not measured yet — needs both modes";
    const beats = abs.mean - abs.ci > 0;
    const loses = abs.mean + abs.ci < 0;
    if (VERSUS === "naive") {
      return beats
        ? `the tuning is worth ${signed(abs.mean)} win points head to head (${signed(mixed.mean)} at a mixed `
          + `table). That is the absolute scale: a candidate worth +1 is worth a thirtieth of all of it.`
        : `*** the tuning does not beat an untuned bidder (${signed(abs.mean)} ±${abs.ci.toFixed(2)}). `
          + `Either the bench is wrong or something has regressed. ***`;
    }
    if (loses) {
      return `*** DRIFT — the live bidder is WEAKER than ${VERSUS} by ${signed(-abs.mean)} win points. `
        + `The knobs that shipped since were fitted to their own seeds; ${VERSUS} is still in `
        + `cpuTunables.js to go back to. ***`;
    }
    return beats
      ? `the live bidder beats ${VERSUS} by ${signed(abs.mean)} head to head — the changes since hold up `
        + `on seeds that had no hand in picking them`
      : `no measurable drift from ${VERSUS} (${signed(abs.mean)} ±${abs.ci.toFixed(2)}): the changes since `
        + `are not worth anything together, whatever each read on its own`;
  }
  if (id === "null") {
    if (!mixed.n) return "mixed not measured — run it, it is the plumbing check";
    return Math.abs(mixed.mean) < 0.005
      ? `the bench measures nothing as nothing (mixed 0.00). The identical column's `
        + `${abs.n ? `±${abs.ci.toFixed(2)}` : "interval"} is the simulator's own noise at this games count.`
      : `*** BROKEN — mixed reads ${signed(mixed.mean)} where it must read 0.00. State is leaking `
        + `between rooms; every other number here is suspect. ***`;
  }
  if (id === "jiggle" && mixed.n && abs.n) {
    return `the placebo. A real candidate has to beat ${signed(mixed.mean)} mixed / ${signed(abs.mean)} `
      + `identical by more than the intervals above.`;
  }
  // Measured on the adoption curve alone — the default. Read every dose, not
  // just the first: the lone-adopter point is one seat's deviation and carries
  // the widest interval of the lot, so a verdict that consulted it alone would
  // call a clearly negative candidate a null. (cpu-lab.html decides this the
  // same way; the two must not disagree about the same rows.)
  if ((!abs.n || !mixed.n) && (dose.lone.n || dose.crowd.n)) {
    const reads = [
      { stat: dose.lone, where: "to a lone adopter" },
      { stat: dose.crowd, where: "with all but one chair on it" }
    ].filter((read) => read.stat.n).sort((a, b) => a.stat.ci - b.stat.ci);
    const loses = reads.find((read) => read.stat.mean + read.stat.ci < 0);
    if (loses) return `costs ${signed(loses.stat.mean)} ${loses.where} — and nothing here says whether a `
      + `whole table of them would be worse, which only --mode identical can`;
    const wins = reads.find((read) => read.stat.mean - read.stat.ci > 0);
    if (wins) return `worth ${signed(wins.stat.mean)} ${wins.where}. That is an edge over rivals who do `
      + `not have it; --mode identical is what says whether a table that all had it would be better`;
    return "null on the curve so far — inside its interval, needs more batches or it is nothing";
  }
  if (!abs.n || !mixed.n) return "not measured yet";
  const absBeats = abs.mean - abs.ci > 0;
  const absLoses = abs.mean + abs.ci < 0;
  const mixedBeats = mixed.mean - mixed.ci > 0;
  if (absLoses) return "REJECT — weaker than the shipped bidder head to head";
  if (absBeats && mixedBeats) return "SHIP-WORTHY — stronger head to head and at a mixed table";
  if (absBeats) return "promising — stronger head to head; mixed read still inside its interval";
  if (mixedBeats) return "DENIAL ONLY — wins at a mixed table, nothing head to head; do not ship to every computer";
  return "null so far — inside the interval, needs more batches or it is nothing";
}

// ---- WHEN TO GIVE UP ON A CANDIDATE -----------------------------------------
//
// One batch of one candidate over the whole grid is about two hours, and most
// candidates are worth nothing — that is the normal and correct outcome of a
// bench like this, and the record bears it out. Spending the same two hours on
// each of them is the single biggest waste left in the lab.
//
// So a candidate is judged as it goes. The grid runs cheapest room first, so by
// the time the two- and three-seat rooms are done a candidate has a real
// reading for a few minutes of work, and the expensive eight-seat rooms are
// only bought by candidates that still look alive.
//
// THE MODEL. Each room-and-adoption-level gives one observation of the true
// average effect. Take those observations as normal around the truth with a
// spread estimated from themselves, and put a prior on the truth centred at
// zero — because the overwhelming majority of tweaks ARE zero, and a prior
// that pretends otherwise is how a bench talks itself into noise.
//
// Either call is a SCREENING decision, not a verdict: it is made on the rooms
// measured so far, and those are the small ones. A candidate called either way
// keeps its rows and is re-opened by naming it with --tweak.
//
// THE RULE lives in cpu-lab-rule.mjs, because cpu-lab.html needs it too and
// keeping a second copy on the page is how the page and the bench came to
// disagree about the positive control. The flags below override its defaults.
//
// Either call is a SCREENING decision, not a verdict: it is made on the rooms
// measured so far, and the grid runs cheapest-first so those are the small
// ones. A candidate called either way keeps its rows and is re-opened by
// naming it with --tweak.
const RULE_ARGS = {
  prior: Number(args.prior ?? RULE.prior),
  accept: Number(args.accept ?? RULE.accept),
  kill: Number(args.kill ?? RULE.kill),
  above: Number(args["accept-above"] ?? RULE.above),
  minLooks: Number(args["min-looks"] ?? RULE.minLooks),
  acceptSizes: Number(args["accept-sizes"] ?? RULE.acceptSizes)
};
// HOW MANY ROOMS A CANDIDATE MUST BITE IN to be worth measuring at all. Some
// knobs only apply where a precondition holds — an uncapped bullpen, a long
// roster — and the grid is built from the rooms people actually play, where
// those are rare. `check` skips a room the knob moves nothing in, so such a
// candidate runs out of grid and sits undecided forever however many passes it
// is given. Dropping it is not a verdict on the knob: it says the grid cannot
// answer the question, and only a room built for the precondition could.
const MIN_ROOMS = Number(args["min-rooms"] ?? 3);
const KILL_AT = RULE_ARGS.kill;
const ACCEPT_ABOVE = RULE_ARGS.above;

// ---- commands ---------------------------------------------------------------
const allTweakIds = TWEAKS.map((tweak) => tweak.id);
const wanted = (value, every) => (value == null || value === "all" ? every : value.split(","));
const tweakIds = wanted(args.tweak, allTweakIds);
// --stage screen leaves out the two cells that cost more than the other
// fifteen put together. Naming --cells overrides it: the stage picks a default,
// it does not take the grid away.
const screenCells = CELLS.filter((cell) => cell.screen !== false);
const cellTags = wanted(args.cells,
  (STAGE === "screen" ? screenCells : CELLS).map((cell) => cell.tag));
// `dose` is a family rather than a mode: one measurement per k, and how many
// there are depends on how many chairs the room has.
const doseModes = (cell) => Array.from({ length: cell.teams - 1 }, (unused, i) => `dose-${i + 1}`);
const modesFor = (cell, tweak) => {
  // The `null` fixture always keeps its half-and-half run whatever else is
  // asked for: that is the one measurement that must read 0.00 exactly, and it
  // is how the bench proves it can measure nothing as nothing. A dose run
  // cannot do that job — which chairs are tweaked rotates, so the fixture would
  // read the sampling noise of the rotation instead of a flat zero.
  const plumbing = tweak?.id === "null" ? ["mixed"] : [];
  if (MODE === "both") return [...new Set([...plumbing, "mixed", "identical"])];
  // The screen's mode: the last holdout alone, the precise end of the curve.
  if (MODE === "far") return [...new Set([...plumbing, `dose-${cell.teams - 1}`])];
  if (MODE === "dose") return [...new Set([...plumbing, ...doseModes(cell)])];
  if (MODE === "all") return [...new Set([...plumbing, "mixed", "identical", ...doseModes(cell)])];
  return [...new Set([...plumbing, MODE])];
};

if (command === "list") {
  const rows = readRows();
  console.log(`cpu-lab — ${OUT}`);
  // THE COUNTS ARE AGAINST THE BIDDER THAT SHIPS TODAY, and the last column is
  // what that cost. Shipping a knob moves the control chairs, so every earlier
  // reading answers a question about an opponent that no longer exists; pooling
  // the two silently is the mistake this whole column exists to prevent, and it
  // had already been made three times before `baseline` was recorded at all.
  console.log(`\n  THE THRONE is ${BASELINE}, the bidder that ships today`
    + `${THRONE_KNOBS.size ? ` — its last ship moved ${[...THRONE_KNOBS].join(", ")}` : ""}`);
  // An accepted candidate is a CHALLENGER, not a winner: it beat whoever was on
  // the throne when it was measured, and a ship replaces that opponent. Listing
  // them here is how you see, without running anything, what the next pass will
  // spend its first hours on.
  const pretenders = challengerRank(rows);
  if (pretenders.size) {
    const claims = [...pretenders.entries()].sort((a, b) => b[1].mean - a[1].mean);
    console.log(`  ${claims.length} challenger(s), measured first by every run until they are settled:`);
    for (const [id, claim] of claims) {
      console.log(`    ${id.padEnd(30)} ${signed(claim.mean).padStart(6)} over ${String(claim.n).padStart(3)}`
        + ` readings against ${claim.norm}`
        + `${claim.current ? " (the current throne)" : " — must win again"}`
        + `${claim.rival ? ", RIVAL for the same knob" : ""}`);
    }
  }
  console.log(`\n  ${"tweak".padEnd(30)}${"cells measured".padStart(16)}${"leagues".padStart(10)}`
    + `${"older norm".padStart(12)}  knobs`);
  let strandedTotal = 0;
  const strandedSets = new Set();
  for (const tweak of TWEAKS) {
    const every = rows.filter((row) => row.tweak === tweak.id && row.params === paramKey(tweak.params));
    const mine = every.filter((row) => baselineOf(row) === BASELINE);
    const stale = every.filter((row) => baselineOf(row) !== BASELINE);
    for (const row of stale) strandedSets.add(baselineOf(row));
    const stranded = stale.reduce((sum, row) => sum + row.edges.length, 0);
    strandedTotal += stranded;
    const cells = new Set(mine.map((row) => row.cell));
    const leagues = mine.reduce((sum, row) => sum + row.edges.length, 0);
    const mark = tweak.fixture ? `${tweak.id} *` : (tweak.idea ? `${tweak.id} +` : tweak.id);
    const older = stranded ? String(stranded) : "-";
    if (tweak.settled) {
      console.log(`  ${mark.padEnd(30)}${"ANSWERED".padStart(16)}${String(leagues).padStart(10)}`
        + `${older.padStart(12)}  ${tweak.settled}`);
      continue;
    }
    console.log(`  ${mark.padEnd(30)}`
      + `${`${cells.size}/${CELLS.length}`.padStart(16)}${String(leagues).padStart(10)}${older.padStart(12)}  `
      + `${Object.entries(tweak.params).map(([k, v]) => `${k}=${v}`).join(" ") || "(none)"}`);
  }
  if (strandedTotal) {
    console.log(`\n  "older norm" is ${strandedTotal} leagues measured when a DIFFERENT bidder shipped`);
    console.log(`  (${[...strandedSets].sort().join(", ")}). They are real measurements and they still`);
    console.log(`  say what they said — about an opponent that is no longer in the control chairs — so`);
    console.log(`  they are not pooled with the columns to their left. Read them with --baseline <gen>.`);
  }
  console.log(`\n  * fixture: null must read 0.00, jiggle is the placebo, no-starter-discount is the positive control`);
  const answered = TWEAKS.filter((tweak) => tweak.settled);
  if (answered.length) {
    console.log(`  ${answered.length} candidate(s) ANSWERED — a sweep leaves them alone; --tweak ${answered[0].id} re-opens one`);
  }
  const ideas = TWEAKS.filter((tweak) => tweak.idea);
  if (ideas.length) {
    console.log(`  + proposed in ${ideasFile()}`);
    for (const idea of ideas) {
      console.log(`      ${idea.id.padEnd(22)} ${idea.by ?? "unattributed"}${idea.room ? `, from ${idea.room}` : ""}`);
      if (idea.why) console.log(`        ${idea.why}`);
    }
  }
  if (IDEA_REJECTS.length) {
    console.log(`\n  ${IDEA_REJECTS.length} proposal(s) in the inbox COULD NOT BE USED and were skipped:`);
    for (const bad of IDEA_REJECTS) {
      console.log(`    line ${String(bad.line).padStart(3)}  ${bad.id ?? "(no id)"} — ${bad.reason}`);
    }
  }
  console.log(`  cells: ${CELLS.map((cell) => cell.tag).join(", ")}`);
  console.log(`\n  generations (frozen knob sets; --versus one of these seats it in the control chairs)`);
  for (const [name, generation] of Object.entries(CPU_KNOB_GENERATIONS)) {
    const drift = cpuTunables(generation.knobs).key;
    const measured = rows.filter((row) => (row.versus ?? "defaults") === name).length;
    // Two different counts, and conflating them is easy: `measured` is rows
    // where this generation sat in the CONTROL chairs because somebody passed
    // --versus, while `norm` is rows taken while this generation WAS what
    // shipped. The second is the one that says whether a candidate's record
    // still applies.
    const norm = rows.filter((row) => baselineOf(row) === name).length;
    console.log(`    ${name.padEnd(20)} ${generation.at}  ${String(generation.git ?? "-").padEnd(9)}`
      + `${drift ? `${drift.split("|").length} knobs differ from live` : "matches the live defaults"}`
      + `${norm ? `, the norm for ${norm} rows` : ""}`
      + `${measured ? `, seated as control in ${measured}` : ""}`);
    console.log(`      ${generation.note}`);
  }
} else if (command === "idea") {
  const knobsRaw = rawFlag("knobs");
  let knobs = null;
  try {
    knobs = knobsRaw ? JSON.parse(knobsRaw) : null;
  } catch (error) {
    console.log(`  refused: --knobs is not JSON — ${error.message}`);
    console.log(`           got: ${knobsRaw}`);
    console.log(`           want: --knobs '{"shareExponent":1.05}'  (quote it, so the shell leaves it alone)`);
    process.exit(1);
  }
  // What the hand-written queue already spoke for. Without this the inbox would
  // accept a proposal that duplicates a queued candidate and then refuse to read
  // it back — written, and never measured.
  const spokenFor = new Map();
  for (const tweak of TWEAKS) {
    if (tweak.idea) continue;
    spokenFor.set(`id:${tweak.id}`, tweak.fixture ? "a fixture" : "a queued candidate");
    if (Object.keys(tweak.params).length) spokenFor.set(`knobs:${knobKey(tweak.params)}`, tweak.id);
  }
  const outcome = appendIdea({
    id: rawFlag("id"),
    knobs,
    note: rawFlag("note") ?? "",
    room: rawFlag("room"),
    why: rawFlag("why"),
    by: rawFlag("by")
  }, spokenFor);
  if (!outcome.ok) {
    console.log(`  refused: ${outcome.reason}`);
    console.log(`\n  the knobs are the ones in src/rules/cpuTunables.js — "cpu-lab.mjs list" prints every`);
    console.log(`  one of them with the value that ships today.`);
    process.exit(1);
  }
  console.log(`  queued "${outcome.record.id}" -> ${ideasFile()}`);
  console.log(`    ${Object.entries(outcome.record.knobs).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`    ${outcome.record.note}`);
  if (outcome.record.why) console.log(`    because: ${outcome.record.why}${outcome.record.room ? ` (${outcome.record.room})` : ""}`);
  console.log(`\n  It is a candidate from now on. The next run with budget measures it across the grid:`);
  console.log(`    node scripts/cpu-lab.mjs run --tweak ${outcome.record.id} --no-fixtures`);
} else if (command === "check") {
  // No games at all: the determinism check, then what each knob actually moves.
  console.log(`cpu-lab check — two rooms a cell off one seed, no games played, git ${GIT}\n`);
  let broken = 0;
  console.log(`  determinism (an untweaked room drafted twice must come out identical)`);
  for (const tag of cellTags) {
    const touch = reach(cellByTag(tag), {}, {});
    if (touch.moves) broken += 1;
    console.log(`    ${tag.padEnd(13)} ${touch.moves
      ? `*** ${touch.seatsMoved}/${touch.seats} rosters and ${touch.lotsMoved}/${touch.lots} prices MOVED ***`
      : "identical"}`);
  }
  if (broken) {
    console.log(`\n  ${broken} cells are not reproducible. Every number this bench prints is suspect `
      + `until that is fixed — state is leaking between rooms.`);
    process.exitCode = 1;
  }
  console.log(`\n  reach (what each tweak moves, two seeds a cell)`);
  console.log(`    ${"tweak".padEnd(32)}${"cell".padEnd(13)}${"rosters".padStart(10)}${"prices".padStart(10)}${"mean $".padStart(9)}`);
  for (const id of tweakIds) {
    const tweak = tweakById(id);
    // `null` changes nothing against the live defaults, so there is nothing to
    // reach — but against a GENERATION it is the whole benchmark, and whether
    // the two rooms draft differently at all is the first thing to know about
    // a benchmark that reads zero.
    if (id === "null" && VERSUS === "defaults") continue;
    for (const tag of cellTags) {
      const touch = reach(cellByTag(tag), tweak.params);
      console.log(`    ${id.padEnd(32)}${tag.padEnd(13)}`
        + `${`${touch.seatsMoved}/${touch.seats}`.padStart(10)}`
        + `${`${touch.lotsMoved}/${touch.lots}`.padStart(10)}`
        + `${touch.dollars.toFixed(1).padStart(9)}`
        + `${touch.moves ? "" : "   inert"}`);
    }
  }
} else if (command === "run" || command === "bench") {
  const rows = readRows();
  const deadline = Date.now() + MINUTES * 60_000;
  // Fixtures first: there is no point measuring a candidate on a bench that has
  // not shown it can measure nothing.
  // The bench is the `null` tweak against a frozen generation: nothing is
  // changed relative to the LIVE defaults, so what it measures is the live
  // bidder against that generation.
  // FIXTURES FIRST, THEN THE CHALLENGERS. An accepted candidate beat whoever was
  // on the throne at the time; once something ships it has to win again against
  // the new control, and it gets measured first because it is the only thing in
  // the queue with a claim.
  const pretenders = command === "bench" ? new Map() : challengerRank(rows);
  const order = command === "bench"
    ? ["null"]
    : [...tweakIds].sort((a, b) => {
      const fixture = Number(Boolean(tweakById(b).fixture)) - Number(Boolean(tweakById(a).fixture));
      if (fixture) return fixture;
      const ca = pretenders.get(a);
      const cb = pretenders.get(b);
      if (Boolean(ca) !== Boolean(cb)) return Number(Boolean(cb)) - Number(Boolean(ca));
      if (ca && cb) return cb.mean - ca.mean;
      return 0;
    });
  console.log(`cpu-lab ${command} — ${LEAGUES} leagues x ${RUNS} games a batch, persona=${PERSONA}, `
    + `perturb=${PERTURB == null ? "shipped" : PERTURB}, versus ${VERSUS}${HOLDOUT}, git ${GIT}`);
  if (VERSUS !== "defaults") {
    const generation = knobGeneration(VERSUS);
    console.log(`  control chairs: ${VERSUS} (${generation.at}, ${generation.git}) — ${generation.note}`);
  }
  console.log(`  ${order.length} tweaks x ${cellTags.length} cells x ${MODE} x ${BATCHES} batches -> ${OUT}`);
  const claiming = order.filter((id) => pretenders.has(id));
  if (claiming.length) {
    console.log(`\n  THE THRONE is ${BASELINE}`
      + `${THRONE_KNOBS.size ? ` — last ship moved ${[...THRONE_KNOBS].join(", ")}` : ""}.`);
    console.log(`  ${claiming.length} challenger(s) measured first, strongest claim first:`);
    for (const id of claiming) {
      const claim = pretenders.get(id);
      console.log(`    ${id.padEnd(30)} ${signed(claim.mean).padStart(6)} over ${String(claim.n).padStart(3)} readings`
        + ` against ${claim.norm}${claim.current ? " (the current throne)" : " — must win again"}`
        + `${claim.rival ? ", RIVAL for the same knob" : ""}`);
    }
    console.log("");
  } else {
    console.log("");
  }
  let ran = 0;
  let stopped = false;
  // THE ORDER THE WORK IS DONE IN, as a flat list of (tweak, cell) pairs,
  // because --minutes means the list is usually not finished and WHERE it stops
  // decides what the morning's report can say.
  //
  // Fixtures first, all of them, across every cell: there is no point measuring
  // a candidate on a bench that has not shown it can measure nothing.
  //
  // Then CELL-OUTER — every candidate on one board before any candidate moves
  // to the next. Tweak-outer, which this used to be, spends a budget that runs
  // short on finishing the first few candidates across the whole grid and
  // leaves the rest with nothing; cell-outer leaves every candidate measured on
  // the SAME boards, which is a comparison. The first is a report you cannot
  // read across.
  // Fixtures first, all of them, across every room: there is no point
  // measuring a candidate on a bench that has not shown it can measure nothing.
  //
  // Then CANDIDATE-OUTER, cheapest room first. This used to be room-outer so
  // that a budget running short left every candidate measured on the same
  // ground — a fair comparison. Abandoning early is worth more than that
  // fairness: a candidate has to accumulate its own evidence in one run before
  // the rule can act on it, and the rooms are ordered cheapest-first so the
  // verdict arrives before the expensive rooms are bought.
  // PASSES. One sweep of the grid is 93 readings, and at the spread those
  // readings actually have, 93 is not enough to settle a tweak worth +0.3 —
  // simulated, one pass accepts a real +0.3 only 21% of the time and leaves 71%
  // undecided. Four passes take it to 66%, eight to 85%. Nothing is lost by
  // waiting: the KILL rate stays flat at about 9% however long a candidate
  // runs, so the asymmetry holds — obvious losers still die in the first
  // fifteen readings, and only the ones still alive cost more.
  //
  // What does creep is the false accepts on a true null, 5.0% at one pass and
  // 7.2% at four, because every extra look is another chance to cross the bar
  // by luck. Four is the default on that basis.
  //
  // BREADTH BEFORE DEPTH. A pass covers every room once before any room is
  // measured twice. Asking for the depth with --batches instead measures one
  // room four times and then moves on, which is the wrong order for a rule
  // meant to decide early: it would spend its whole budget in the two-seat
  // rooms before seeing a four-seat one.
  const PASSES = Number(args.passes ?? RULE.passes);
  const plan = [];
  for (const id of order) {
    if (!tweakById(id).fixture) continue;
    for (const tag of cellTags) plan.push([id, tag, BATCHES]);
  }
  for (const id of order) {
    if (tweakById(id).fixture) continue;
    for (let pass = 1; pass <= PASSES; pass += 1) {
      for (const tag of cellTags) plan.push([id, tag, pass]);
    }
  }
  // What each candidate has read, one number per room-and-adoption-level, and
  // who has been called.
  //
  // PRIMED FROM WHAT IS ALREADY BANKED, not just what this process measures. A
  // run resumes: rooms already at the asked-for depth are skipped, so a fresh
  // process would otherwise judge only the handful it happened to measure
  // itself. That is exactly what went wrong with the positive control — 63 of
  // its 73 readings were on disk from an earlier process, the page showed it
  // at 91% against a 90% bar, and the bench sat on ten readings and never
  // fired. The decision has to use every reading that exists under these
  // controls, not the ones this process has personally seen.
  // id -> Map("<cell>|<dose>" -> that pair's pooled mean). KEYED, not a list:
  // a reading is a room-and-adoption-level, pooled over however many batches
  // it has, and a repeat batch REPLACES that pair's number instead of adding a
  // second one. Pushing each batch as its own entry made the same pair count
  // as independent evidence — scarcity-off's 51 pairs arrived as 115 entries,
  // and the extra n carried it over the 99% accept bar that the page, reading
  // the same rows off disk, put at 97.8%. Two data sources, two verdicts.
  const seenSoFar = new Map();
  const readingsFor = (id) => [...(seenSoFar.get(id)?.values() ?? [])];
  const seenSizes = new Map();          // which table sizes each candidate has read in
  const roomsTried = new Map();         // rooms walked, and of those the ones it moves
  const abandoned = new Map();
  for (const id of order) {
    const tweak = tweakById(id);
    const already = new Map();
    for (const tag of cellTags) {
      const cell = cellByTag(tag);
      for (const mode of modesFor(cell, tweak)) {
        if (!mode.startsWith("dose-")) continue;
        const banked = rows.filter((row) => rowMatches(row, tweak, cell, mode));
        if (banked.length) {
          already.set(`${tag}|${mode}`, pooled(banked).mean);
          if (!seenSizes.has(id)) seenSizes.set(id, new Set());
          seenSizes.get(id).add(cell.teams);
        }
      }
    }
    if (already.size) seenSoFar.set(id, already);
  }
  outer:
  {
    for (const [id, tag, want] of plan) {
      const tweak = tweakById(id);
      if (args["no-fixtures"] != null && tweak.fixture) continue;
      // A candidate that has been ANSWERED is not measured again by a sweep.
      // Naming it with --tweak still runs it — settling a question is a
      // judgement, and a judgement has to stay re-openable — but a bench whose
      // queue only grows spends its nights re-measuring things it already
      // knows. The answer lives on the tweak in cpu-lab-tweaks.mjs.
      if (tweak.settled && args.tweak == null) continue;
      if (abandoned.has(id)) continue;
      // ASK BEFORE SPENDING, not only after. The rule used to be evaluated at
      // the END of a room, and a room already banked hits the `continue`
      // below — so a resumed run had to measure one whole fresh room before it
      // would even consider what the readings on disk already said. With the
      // positive control that meant five more levels of a six-seat room, about
      // twelve minutes, to reach a verdict its 74 banked readings had already
      // settled.
      {
        const called = verdictSoFar(readingsFor(id), RULE_ARGS, (seenSizes.get(id) ?? new Set()).size);
        if (called) {
          abandoned.set(id, called);
          const why = called.call === "accept"
            ? `${(100 * called.above).toFixed(1)}% above ${signed(ACCEPT_ABOVE)}`
            : `${(100 * called.below).toFixed(1)}% below zero`;
          const word = tweak.fixture
            ? (called.call === "kill" ? "CONFIRMED" : "UNEXPECTED")
            : (called.call === "accept" ? "ACCEPTED " : "KILLED   ");
          console.log(`  ${id.padEnd(32)} ${word} on what was already banked — `
            + `${called.n} readings, ${signed(called.mean)}, ${why}`);
          if (called.call === "accept") pickTheKnob(id, called, abandoned, seenSoFar);
          continue;
        }
      }
      const cell = cellByTag(tag);
      const owed = modesFor(cell, tweak).filter((mode) =>
        rows.filter((row) => rowMatches(row, tweak, cell, mode)).length < want);
      // Work the queue: a pair already measured to the asked-for depth is left
      // alone, so re-running fills the gaps first and `--batches 3` is how you
      // deepen. Nothing is ever redone, and nothing is ever rewritten.
      if (!owed.length) continue;
      // A knob that does not reach this cell — an auction knob in a snake room,
      // a pen-cap knob in a room with no cap — would measure its own absence.
      // Skip it rather than bank a meaningless zero. The fixtures are exempt:
      // `null` reaching nothing is the whole point of it.
      if (!tweak.fixture) {
        heartbeat({ tweak: tweak.id, cell: cell.tag, mode: "reach", league: 0, leagues: 0 });
        const touch = reach(cell, tweak.params);
        if (!roomsTried.has(id)) roomsTried.set(id, { walked: new Set(), bites: new Set() });
        const seen = roomsTried.get(id);
        seen.walked.add(tag);
        if (touch.moves) seen.bites.add(tag);
        // Once the whole grid has been walked once, we know how much of it this
        // knob can ever reach. Below the bar, stop: more passes cannot help.
        if (MIN_ROOMS > 0 && seen.walked.size >= cellTags.length && seen.bites.size < MIN_ROOMS) {
          abandoned.set(id, { call: "narrow", n: seen.bites.size });
          console.log(`  ${id.padEnd(32)} DROPPED — moves nothing in ${cellTags.length - seen.bites.size} `
            + `of ${cellTags.length} rooms; ${seen.bites.size} is too few for this grid to settle it`);
          continue;
        }
        if (!touch.moves) {
          console.log(`  ${id.padEnd(32)} ${tag.padEnd(12)} INERT — no roster and no price moved, skipped`);
          continue;
        }
      }
      for (const mode of owed) {
        let have = rows.filter((row) => rowMatches(row, tweak, cell, mode)).length;
        while (have < want) {
          if (Date.now() > deadline) {
            console.log(`\n  time budget reached — ${ran} measurements banked`);
            stopped = true;
            break outer;
          }
          const row = measure(tweak, cell, mode, rows);
          const stat = pooled([row]);
          have += 1;
          ran += 1;
          // EVERY tweak's readings are recorded, fixtures included. The rule
          // was made to apply to fixtures — a control expected to be negative
          // passes by being killed — but this guard stayed, so the control's
          // readings were never collected and the rule judged an empty list
          // and never fired. The page, reading the stored rows, showed it at
          // 91% against a 90% bar while the run carried on regardless: two
          // different data sources for the same question.
          if (!seenSoFar.has(id)) seenSoFar.set(id, new Map());
          // Re-pooled from every batch this pair has, so a second batch sharpens
          // the pair's number rather than counting as a second reading.
          seenSoFar.get(id).set(`${tag}|${mode}`,
            pooled(rows.filter((row) => rowMatches(row, tweak, cell, mode))).mean);
          if (!seenSizes.has(id)) seenSizes.set(id, new Set());
          seenSizes.get(id).add(cell.teams);
          console.log(`  ${id.padEnd(32)} ${tag.padEnd(12)} ${mode.padEnd(10)} b${row.batch} `
            + `${signed(stat.mean).padStart(7)} ±${stat.ci.toFixed(2).padStart(5)}  ${row.seconds}s`);
        }
      }
      // ENOUGH? Asked after each room, because the grid runs cheapest first
      // and the point is to decide before the eight-seat rooms are bought.
      const soFar = readingsFor(id);
      // THE RULE APPLIES TO FIXTURES TOO. The positive control is expected to
      // be NEGATIVE, so the kill call is its PASS: it stops as soon as the
      // readings are confidently below zero, which on the last run would have
      // been after nine of them rather than all ninety-three. `null` is
      // unaffected — every reading is exactly zero, so the posterior sits on
      // zero and neither call ever fires, and it simply finishes its rooms.
      //
      // Coverage and verdict are different jobs and the control cannot do both
      // cheaply. This buys the verdict in minutes; a full sweep for coverage is
      // a deliberate `--kill 0` run, not something every launch pays for.
      if (KILL_AT > 0) {
        const called = verdictSoFar(soFar, RULE_ARGS, (seenSizes.get(id) ?? new Set()).size);
        if (called) {
          abandoned.set(id, called);
          const why = called.call === "accept"
            ? `${(100 * called.above).toFixed(1)}% above ${signed(ACCEPT_ABOVE)}`
            : `${(100 * called.below).toFixed(1)}% below zero`;
          // For the positive control, confidently negative is the PASS.
          const word = tweak.fixture
            ? (called.call === "kill" ? "CONFIRMED" : "UNEXPECTED")
            : (called.call === "accept" ? "ACCEPTED " : "KILLED   ");
          console.log(`  ${id.padEnd(32)} ${word} after `
            + `${called.n} readings — ${signed(called.mean)} so far, ${why}`);
          if (called.call === "accept") pickTheKnob(id, called, abandoned, seenSoFar);
        }
      }
    }
  }
  if (abandoned.size) {
    const tally = (call) => [...abandoned.values()].filter((v) => v.call === call).length;
    console.log(`\n  ${tally("kill")} killed, ${tally("accept")} accepted, ${tally("parked")} parked behind an`);
    console.log(`  accepted value of the same knob, ${tally("narrow")} dropped for reaching too little of`);
    console.log(`  the grid. All keep their rows and are measured again whenever named with`);
    console.log(`  --tweak; --kill 0 and --min-rooms 0 turn the two rules off.`);
  }
  console.log(ran || stopped ? "" : "\n  nothing owed — every pair already has its batches. --batches N to deepen.\n");
  reportFor(order, cellTags, readRows());
} else if (command === "report") {
  const rows = readRows();
  if (!rows.length) {
    console.log(`cpu-lab — nothing measured yet (${OUT}). Start with:\n  node scripts/cpu-lab.mjs run --tweak null,jiggle`);
  } else {
    console.log(`cpu-lab report — ${rows.length} measurements, ${OUT}`);
    console.log(`  edges are win-point differences, tweaked side minus shipped side, one observation a league.`);
    const recorded = [...new Set(rows.map((row) => row.tweak))];
    const asked = args.tweak == null || args.tweak === "all"
      ? [...allTweakIds, ...recorded.filter((id) => !allTweakIds.includes(id))]
      : tweakIds;
    reportFor(asked.filter((id) => recorded.includes(id)), cellTags, rows);
  }
} else if (command === "bracket") {
  bracket();
} else if (command === "ship") {
  shipCheck(rawFlag("tweak") ?? args.tweak);
} else if (command === "screen") {
  screenReport(readRows());
} else {
  console.log(USAGE);
  process.exit(command === "help" || args.help ? 0 : 1);
}

// BRACKET A KNOB THAT MOVED. A knob that measures as real has been shown to
// matter, not to be RIGHT — the bench tested one value against one other value,
// and the honest reading of "0.8 -> 0.6 is worth +0.42" is "0.6 beats 0.8",
// never "0.6 is the answer". The shape either side of it is unmeasured, and the
// first value anybody happened to try is a bad place to stop.
//
// So: name a knob, get its neighbours queued as candidates. They go in through
// the ideas inbox like any other proposal, which gets them validation, the
// duplicate check and provenance for free, and makes them candidates everywhere
// at once with no file to edit.
//
//   node scripts/cpu-lab.mjs bracket --knob poolPremiumThreshold
//   node scripts/cpu-lab.mjs bracket --knob poolPremiumThreshold --values 0.5,0.7
//
// THE REVERSAL IS QUEUED TOO, and it is the most interesting one. Where an
// older generation holds a different value for this knob, that value goes in
// the bracket — because the bench has already measured the move away from it
// and knows what it is worth. Measuring the move BACK, against the new
// baseline, must reproduce that number with the sign flipped. If it does not,
// the effect was never a property of the knob; it was a property of the
// comparison, and every number this bench has produced is worth less than it
// looks. Nothing else here checks that.
function bracket() {
  const knob = rawFlag("knob");
  if (!knob || !(knob in CPU_TUNABLE_DEFAULTS)) {
    console.log(`  bracket: --knob must name a knob out of src/rules/cpuTunables.js, got ${JSON.stringify(knob)}`);
    console.log(`  "cpu-lab.mjs list" prints every one with the value that ships today.`);
    process.exit(1);
  }
  const shipped = CPU_TUNABLE_DEFAULTS[knob];
  if (typeof shipped !== "number") {
    console.log(`  bracket: ${knob} ships as ${JSON.stringify(shipped)}, which has no neighbours to try.`);
    process.exit(1);
  }

  // Where an older generation disagrees, that value is the reversal.
  const reversals = [...new Set(Object.entries(CPU_KNOB_GENERATIONS)
    .map(([name, generation]) => [name, generation.knobs[knob]])
    .filter(([, value]) => typeof value === "number" && value !== shipped)
    .map(([, value]) => value))];

  const asked = rawFlag("values");
  // Default neighbours: a step either side, sized to the knob rather than to a
  // fixed number, because these range from 0.05 to 1000.
  const step = Math.abs(shipped) * 0.17;
  const round = (value) => Number(value.toPrecision(3));
  const values = [...new Set((asked
    ? asked.split(",").map((text) => Number(text.trim()))
    : [round(shipped - step), round(shipped + step), ...reversals])
    .filter((value) => Number.isFinite(value) && value !== shipped))];

  if (!values.length) {
    console.log(`  bracket: nothing to queue — every value given is already what ${knob} ships (${shipped}).`);
    process.exit(1);
  }

  const spokenFor = new Map();
  for (const tweak of TWEAKS) {
    spokenFor.set(`id:${tweak.id}`, tweak.fixture ? "a fixture" : (tweak.idea ? "in the inbox" : "a queued candidate"));
    if (Object.keys(tweak.params).length) spokenFor.set(`knobs:${knobKey(tweak.params)}`, tweak.id);
  }

  const slug = knob.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const tag = (value) => String(value).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const why = rawFlag("why") ?? `${knob} measured as real at ${shipped}, which says it matters, not that it is `
    + `right — the bench compared it against one other value and the shape either side is unmeasured.`;

  console.log(`cpu-lab bracket — ${knob}, which ships at ${shipped}\n`);
  for (const value of values) {
    const reversal = reversals.includes(value);
    const outcome = appendIdea({
      id: `${slug}-${tag(value)}`,
      knobs: { [knob]: value },
      note: reversal
        ? `the reversal: back to ${value}, the value ${knob} shipped before. Must read the move that `
          + `replaced it with the SIGN FLIPPED, or the bench is measuring the comparison and not the knob`
        : `bracket: ${knob} at ${value} instead of the shipped ${shipped}`,
      why,
      by: rawFlag("by") ?? "cpu-lab bracket"
    }, spokenFor);
    if (outcome.ok) {
      spokenFor.set(`id:${outcome.record.id}`, "in the inbox");
      spokenFor.set(`knobs:${knobKey(outcome.record.knobs)}`, outcome.record.id);
      console.log(`  queued  ${outcome.record.id.padEnd(30)} ${knob} -> ${value}`
        + `${reversal ? "   (the reversal — expect the ship's number, negated)" : ""}`);
    } else {
      console.log(`  skipped ${`${slug}-${tag(value)}`.padEnd(30)} ${outcome.reason}`);
    }
  }
  console.log(`\n  they are candidates from the next command onward: the screen picks them up with`);
  console.log(`  "cpu-lab.mjs run --stage screen".`);
}

// ONE WINNER PER KNOB, DECIDED WHEN THE FIRST VALUE IS ACCEPTED (Skylar,
// 2026-11-13). Once a value of a knob is accepted, the other values of that
// same knob stop being measured: they are a bracket on one question — how far
// should this knob move — and the question is now answered well enough to act
// on. Carrying on would spend passes refining a number nobody is waiting for,
// and would leave two accepted values of one knob to untangle later.
//
// It does mean the winner is whichever value crossed the bar FIRST, not
// necessarily the best. pool-premium-threshold-0-7 was accepted beside 0-5
// while reading +0.41 against 0-5's +0.73, so the first-past-the-post pick can
// be the weaker one. The parked siblings keep their rows and are re-opened by
// naming them with --tweak, which is where the better value would be found.
function pickTheKnob(winner, called, abandoned, seenSoFar) {
  const mine = Object.keys(tweakById(winner).params ?? {});
  for (const other of TWEAKS) {
    if (other.id === winner || other.fixture || other.settled) continue;
    if (abandoned.has(other.id)) continue;
    if (!Object.keys(other.params ?? {}).some((knob) => mine.includes(knob))) continue;
    abandoned.set(other.id, { call: "parked", n: (seenSoFar.get(other.id)?.size ?? 0) });
    console.log(`  ${other.id.padEnd(32)} PARKED — ${winner} was accepted first on the same knob; `
      + `re-open it with --tweak if the chosen value disappoints`);
  }
}

// THE PRE-SHIP CHECKLIST. Read-only: it never edits the bidder. Shipping a knob
// changes what every computer in every room does, so the edit is a human's to
// make — this only says whether the evidence is there, and names what is
// missing when it is not.
//
// IT EXISTS BECAUSE "ACCEPTED" DOES NOT MEAN "SHIP". The average boost asks
// whether a manager carrying the tweak beats managers who do not, which is the
// right question for a room with humans in it and the wrong one for a change
// going to every computer at once. poolPremiumThreshold is the worked example:
// it reads clearly positive on that measure, it shipped on 2026-11-11, and the
// absolute test read +1.48 mixed against -0.04 identical — it beat a table that
// lacked it and gained nothing against a table that had it. Reverted the next
// day, and the current screen promotes two more values of the same knob.
//
// So the gate is the absolute read, and it is the only check here that needs a
// comparison ACROSS rooms rather than within one.
function shipCheck(id) {
  if (!id) {
    console.log("cpu-lab ship — the pre-ship checklist for one candidate.\n");
    console.log("  node scripts/cpu-lab.mjs ship --tweak <candidate>\n");
    console.log("  Reports only. It never edits the bidder.");
    return;
  }
  const tweak = tweakById(id);
  const rows = readRows();
  const knobs = Object.keys(tweak.params ?? {});
  const ok = [];
  const no = [];

  // 1. Does it read positive, and is it clear of zero?
  //
  // NO READINGS IS NOT A NEGATIVE READING. After a ship every candidate's
  // record is against the previous bidder, so this check goes from a number to
  // nothing at all — and saying "+0.00, and it is negative" of an empty set
  // reads as a verdict the bench has not got.
  const mine = rows.filter((row) => sameRoom(row) && row.tweak === id && row.mode.startsWith("dose-"));
  const boost = averageBoost(mine);
  const doseStale = rows.filter((row) => row.tweak === id && row.mode.startsWith("dose-")
    && baselineOf(row) !== BASELINE);
  const clear = boost.n > 1 && Math.abs(boost.mean) > boost.ci;
  (clear && boost.mean > 0 ? ok : no).push(boost.n
    ? `the average boost is ${signed(boost.mean)} ±${boost.ci.toFixed(2)} over ${boost.n} readings`
      + `${clear ? "" : " — not clear of zero"}${boost.mean > 0 ? "" : " — and it is negative"}`
    : `NOT MEASURED against ${BASELINE} yet`
      + `${doseStale.length ? ` — its ${doseStale.length} readings were taken against `
        + `${[...new Set(doseStale.map(baselineOf))].sort().join(", ")}, so they answer a question `
        + `about a bidder that no longer exists` : ""}`);

  // 2. How much of the grid can it even reach?
  const roomsHit = new Set(mine.map((row) => row.cell)).size;
  (roomsHit >= MIN_ROOMS ? ok : no).push(
    `it moves something in ${roomsHit} of ${CELLS.length} rooms`);

  // 3. OTHER VALUES OF THE SAME KNOB. Usually not a conflict but a BRACKET: a
  // knob that measured as real gets its neighbours queued, and several of them
  // reading positive is that working. The question then is not "which of these
  // competing candidates" but "how far does this knob want to move", and the
  // answer is the best of them rather than whichever crossed the bar first —
  // which would be picked by noise.
  const family = TWEAKS.filter((other) => other.id !== id && !other.fixture && !other.settled
    && Object.keys(other.params ?? {}).some((knob) => knobs.includes(knob)))
    .map((other) => ({
      other,
      stat: averageBoost(rows.filter((row) => sameRoom(row) && row.tweak === other.id
        && row.mode.startsWith("dose-")))
    }))
    .filter((kin) => kin.stat.n > 1);
  const better = family.filter((kin) => kin.stat.mean > boost.mean
    && Math.abs(kin.stat.mean) > kin.stat.ci);
  const unsettled = family.filter((kin) => kin.stat.n > 1 && Math.abs(kin.stat.mean) <= kin.stat.ci);
  if (!family.length) {
    ok.push("no other candidate moves these knobs");
  } else if (better.length) {
    no.push(`a better value of the same knob is on the board: `
      + better.map((kin) => `${kin.other.id} at ${signed(kin.stat.mean)}`).join(", ")
      + ` against this one's ${signed(boost.mean)} — ship the best of a bracket, not the first past the bar`);
  } else if (unsettled.length) {
    no.push(`${unsettled.length} other value(s) of the same knob are still undecided — `
      + `finish the bracket before picking: ${unsettled.map((kin) => kin.other.id).join(", ")}`);
  } else {
    ok.push(`the best of ${family.length + 1} values tried on this knob`
      + ` (${[...family.map((kin) => `${kin.other.id} ${signed(kin.stat.mean)}`), `this one ${signed(boost.mean)}`].join(", ")})`);
  }

  // 4. Does it hold on seeds that had no hand in choosing it?
  // ONLY ROWS TAKEN AGAINST THE BIDDER THAT SHIPS TODAY. Checks 1 and 3 get
  // this from sameRoom; 4 and 5 used to read the whole file, so a candidate
  // could clear the gate on a head-to-head against a bidder that has since been
  // changed — which is precisely the failure the gate was added to catch.
  const currentNorm = (row) => baselineOf(row) === BASELINE && methodOf(row) === METHOD
    && row.persona === PERSONA && row.perturb === (PERTURB == null ? "shipped" : PERTURB);
  const strandedFor = (keep) => rows.filter((row) => row.tweak === id && keep(row) && !currentNorm(row));
  const sinceNote = (stale) => stale.length
    ? ` (${stale.length} more were taken against ${[...new Set(stale.map(baselineOf))].sort().join(", ")}`
      + ` and do not count here)` : "";

  const held = rows.filter((row) => row.tweak === id && (row.holdout ?? "") === "-holdout"
    && row.mode.startsWith("dose-") && currentNorm(row));
  const heldStale = strandedFor((row) => (row.holdout ?? "") === "-holdout" && row.mode.startsWith("dose-"));
  const holdout = averageBoost(held);
  (holdout.n > 1 && holdout.mean > 0 && Math.abs(holdout.mean) > holdout.ci ? ok : no).push(
    holdout.n > 1
      ? `on holdout seeds it reads ${signed(holdout.mean)} ±${holdout.ci.toFixed(2)} over ${holdout.n} readings`
        + sinceNote(heldStale)
      : `NOT MEASURED on holdout seeds against ${BASELINE}${sinceNote(heldStale)}`
        + ` — run: cpu-lab.mjs run --holdout --tweak ${id}`);

  // 5. THE GATE. Does a table of them beat a table without?
  //
  // AND IS IT STILL A "WITHOUT"? In identical mode the opposing table is the
  // `versus` generation, which defaults to the live bidder. Once this knob has
  // shipped the live bidder HAS the tweak, so a --versus defaults reading
  // compares a table against a copy of itself and reads zero for a reason that
  // has nothing to do with the knob. Such a row is not evidence either way, so
  // it is dropped rather than pooled into a pass or a fail.
  const degenerate = cpuTunables(tweak.params ?? {}).key === "";
  const gateRows = rows.filter((row) => row.tweak === id && row.mode === "identical"
    && (row.holdout ?? "") === "" && currentNorm(row)
    && !(degenerate && (row.versus ?? "defaults") === "defaults"));
  const gateStale = strandedFor((row) => row.mode === "identical" && (row.holdout ?? "") === "");
  const framings = [...new Set(gateRows.map((row) => row.versus ?? "defaults"))].sort();
  const abs = pooled(gateRows);
  (abs.n && abs.mean - abs.ci > 0 ? ok : no).push(abs.n
    ? `head to head against ${framings.join(", ")}, a table of them reads `
      + `${signed(abs.mean)} ±${abs.ci.toFixed(2)}`
      + `${abs.mean - abs.ci > 0 ? "" : " — NOT clear of zero, so this is denial and not strength"}`
      + sinceNote(gateStale)
    : `NOT MEASURED head to head against ${BASELINE} — the check that caught `
      + `poolPremiumThreshold.${sinceNote(gateStale)}\n        Run: cpu-lab.mjs run --tweak ${id} `
      + `--mode identical${degenerate ? ` --versus <the generation before it shipped>` : ""}`
      + `${degenerate ? `\n        (its knobs are the live values now, so --versus defaults would `
        + `compare a table against a copy of itself)` : ""}`);

  console.log(`cpu-lab ship — ${id}`);
  console.log(`  ${tweak.note}`);
  console.log(`  ${knobs.map((knob) => `${knob}: ${JSON.stringify(CPU_TUNABLE_DEFAULTS[knob])} -> ${JSON.stringify(tweak.params[knob])}`).join(", ")}`);
  // A candidate whose knobs ARE the live values has already shipped. Say so, or
  // the header reads "0.5 -> 0.5" and the whole checklist below looks broken
  // rather than looking like what it is: the after-the-fact audit of a ship.
  if (cpuTunables(tweak.params ?? {}).key === "") {
    console.log(`  THESE ARE THE LIVE VALUES — this candidate has SHIPPED, and the checks below are`);
    console.log(`  the audit of that ship, not a decision still to be taken.`);
  }
  console.log("");
  for (const line of ok) console.log(`  PASS  ${line}`);
  for (const line of no) console.log(`  STOP  ${line}`);

  if (no.length) {
    console.log(`\n  ${no.length} of ${ok.length + no.length} checks not met. Not ready.`);
    return;
  }
  console.log(`\n  All ${ok.length} checks met. To ship it:`);
  console.log(`    1. set ${knobs.map((knob) => `${knob} = ${JSON.stringify(tweak.params[knob])}`).join(", ")} in src/rules/cpuTunables.js`);
  console.log(`    2. record a generation beside tuned-${new Date().toISOString().slice(0, 10)} holding the whole knob set`);
  console.log(`    3. re-record test/fixtures/cpu-fingerprint.txt IN THE SAME COMMIT — the bidder is`);
  console.log(`       meant to change, and the moved hashes are how a reviewer sees which rooms moved`);
  console.log(`    4. mark ${id} settled in cpu-lab-tweaks.mjs with what it bought`);
  console.log(`    5. re-screen: the control chairs are now a different bidder, so every other`);
  console.log(`       candidate's reading is about an opponent that no longer exists`);
}

// THE CUT. What the screen stage bought, ranked, with the rule applied rather
// than described — the whole point of writing it here is that the decision
// stops depending on which number catches somebody's eye on the page.
//
// THE RULE, and why it is set where it is:
//
//   promote if the POOLED far-dose reading over the screen cells clears |z| 2,
//   or if ANY single cell clears |z| 3.
//
// The pooled test is the sharp one — fifteen cells of 24 leagues is ~±0.15 —
// and it is the right default because a knob that helps everywhere is what the
// bidder wants. The per-cell escape hatch exists because pooling has one real
// failure mode: a knob that is +2 on narrow boards and -2 on wide ones pools to
// nothing, and that knob is interesting. Hence both, and hence z 3 on the
// per-cell arm, which is roughly a Bonferroni bar over fifteen cells.
//
// THIS BAR IS DELIBERATELY LOOSE, and the count below says how loose. A screen
// is a filter, not a verdict: its job is to spend the expensive stage on the
// right few, and the cost of wrongly promoting is some hours, while the cost of
// wrongly dropping is never finding the thing at all. Nothing SHIPS off this
// table. A candidate ships by clearing the confirm stage — the whole adoption
// curve, four batches, both wide boards — and then reading the same way on
// --holdout seeds that had no hand in choosing it.
// THE AVERAGE BOOST — what a manager carrying the tweak gains, averaged over
// every room on the grid AND over every number of rivals who also have it.
//
// Skylar's rule, 2026-11-12: a gain when 1 of 4 managers has the tweak counts
// exactly as much as a gain when 3 of 4 do. So each (room, adoption level) is
// one observation of equal weight, and the answer is their plain average.
//
// WHY NOT POOL THE LEAGUES. Pooling every league together would weight a room
// by how many measurements it happens to produce, and a room with eight
// managers produces seven (one for each number of rivals who could have the
// tweak) where a two-manager room produces one. That would quietly make the
// answer a statement about big rooms. Averaging the per-measurement means
// instead gives every room-and-adoption-level the same say, which is what was
// asked for.
//
// THE INTERVAL IS TAKEN ACROSS THOSE MEANS, not within them. That is the
// conservative choice and the honest one: it carries the spread BETWEEN rooms,
// not just the luck inside each, so a tweak that helps in half the rooms and
// hurts in the other half reads as unsettled rather than as a confident zero.
// ---- the throne ------------------------------------------------------------
// WHO IS CHALLENGING, and why "accepted" is not a resting place.
//
// Skylar's rule, 2026-11-13: the shipped bidder is the throne. A candidate the
// stopping rule ACCEPTS has beaten whoever was on the throne AT THE TIME — and
// the moment anything ships, that sentence is about a bidder that no longer
// exists. So an accepted candidate does not retire to the back of the queue
// holding a win: it goes to the FRONT and has to beat the new control before it
// can take the throne itself.
//
// Derived from the record rather than hand-flagged, so it cannot go stale. A
// candidate is a challenger if the rule reads `accept` on it under ANY norm and
// it has not since been settled. Ranked by the size of that accepted reading,
// so the strongest pretender is measured first.
//
// NOTE WHAT "THE THRONE" MEANS FOR AN ORTHOGONAL KNOB. Two candidates moving
// the SAME knob are rivals — only one value can ship. Candidates moving
// different knobs are not: they would ship alongside each other, and beating
// the new control means clearing it on top of the shipped change rather than
// instead of it. The `rival` flag below is the difference.
function challengerRank(rows) {
  const out = new Map();
  const sizeOf = new Map(CELLS.map((cell) => [cell.tag, cell.teams]));
  const shipped = new Set(Object.keys(CPU_TUNABLE_DEFAULTS));
  for (const tweak of TWEAKS) {
    if (tweak.fixture || tweak.settled) continue;
    const mine = rows.filter((row) => row.tweak === tweak.id
      && row.params === paramKey(tweak.params)
      && row.mode.startsWith("dose-")
      && row.persona === PERSONA && row.perturb === (PERTURB == null ? "shipped" : PERTURB)
      && (row.versus ?? "defaults") === "defaults" && (row.holdout ?? "") === ""
      && methodOf(row) === METHOD);
    if (!mine.length) continue;
    // One verdict per norm: a reading against an older bidder still counts as
    // the win that made this a challenger, it just does not count as the win
    // that takes the throne.
    const byNorm = new Map();
    for (const row of mine) {
      const norm = baselineOf(row);
      if (!byNorm.has(norm)) byNorm.set(norm, new Map());
      const key = `${row.cell}|${row.mode}`;
      const seen = byNorm.get(norm);
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(...row.edges);
    }
    let best = null;
    for (const [norm, seen] of byNorm) {
      const samples = [...seen.values()].map((edges) => mean(edges));
      const sizes = new Set([...seen.keys()].map((key) => sizeOf.get(key.split("|")[0])));
      const called = verdictSoFar(samples, RULE_ARGS, sizes.size);
      if (called?.call !== "accept") continue;
      const score = mean(samples);
      // The current norm always wins the tie: a win against today's bidder is
      // the one that counts, whatever an older bucket says.
      if (!best || (norm === BASELINE && best.norm !== BASELINE) || (norm === best.norm && score > best.mean)) {
        best = { norm, mean: score, n: samples.length, rooms: new Set([...seen.keys()].map((k) => k.split("|")[0])).size };
      }
    }
    if (!best) continue;
    out.set(tweak.id, {
      ...best,
      current: best.norm === BASELINE,
      // Does it move a knob the reigning bidder's last ship moved? Then it is a
      // succession fight over one number. Otherwise it stacks.
      rival: Object.keys(tweak.params ?? {}).some((knob) => shipped.has(knob)
        && THRONE_KNOBS.has(knob))
    });
  }
  return out;
}


function averageBoost(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.cell}|${row.mode}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(...row.edges);
  }
  const means = [...groups.values()].map((edges) => mean(edges));
  if (!means.length) return { n: 0, mean: 0, ci: 0, spots: 0, leagues: 0 };
  const m = mean(means);
  const leagues = [...groups.values()].reduce((sum, e) => sum + e.length, 0);
  if (means.length < 2) return { n: means.length, mean: m, ci: Infinity, spots: 1, leagues };
  const sd = Math.sqrt(means.reduce((a, b) => a + (b - m) * (b - m), 0) / (means.length - 1));
  return { n: means.length, mean: m, ci: 1.96 * sd / Math.sqrt(means.length), spots: means.length, leagues };
}

function screenReport(rows) {
  const tags = new Set(screenCells.map((cell) => cell.tag));
  const far = rows.filter((row) => (row.versus ?? "defaults") === VERSUS
    && (row.holdout ?? "") === HOLDOUT && row.persona === PERSONA
    && baselineOf(row) === BASELINE && methodOf(row) === METHOD
    && tags.has(row.cell) && row.mode.startsWith("dose-"));
  if (!far.length) {
    // "NOTHING MEASURED" AND "NOTHING MEASURED AGAINST THIS BIDDER" are
    // different situations and only one of them means the bench is empty. A
    // ship puts every row on the wrong side of the baseline filter at once, so
    // this is the message that greets you the morning after one.
    const elsewhere = rows.filter((row) => baselineOf(row) !== BASELINE && row.mode.startsWith("dose-"));
    if (elsewhere.length) {
      console.log(`cpu-lab screen — nothing measured against ${BASELINE}, the bidder that ships today.`);
      console.log(`  ${elsewhere.length} readings stand against `
        + `${[...new Set(elsewhere.map(baselineOf))].sort().join(", ")} — a knob has shipped since, so`);
      console.log(`  the control chairs are a different bidder and those readings are not pooled here.`);
      console.log(`  Re-screen: node scripts/cpu-lab.mjs run --stage screen`);
      console.log(`  Or read the old bucket: node scripts/cpu-lab.mjs screen --baseline `
        + `${[...new Set(elsewhere.map(baselineOf))].sort()[0]}`);
      return;
    }
    console.log(`cpu-lab screen — nothing measured yet (${OUT}).\n  node scripts/cpu-lab.mjs run --stage screen`);
    return;
  }
  const ids = [...new Set(far.map((row) => row.tweak))];
  const scored = ids.map((id) => {
    const mine = far.filter((row) => row.tweak === id);
    const all = averageBoost(mine);
    // Each room on its own, averaged over that room's adoption levels, so a
    // candidate that helps in one shape and hurts in another is visible rather
    // than averaged into nothing.
    const cells = [...new Set(mine.map((row) => row.cell))].map((tag) => {
      const stat = averageBoost(mine.filter((row) => row.cell === tag));
      return { tag, ...stat, z: stat.ci && Number.isFinite(stat.ci) ? Math.abs(stat.mean) / (stat.ci / 1.96) : 0 };
    }).sort((a, b) => b.mean - a.mean);
    const z = all.ci && Number.isFinite(all.ci) ? Math.abs(all.mean) / (all.ci / 1.96) : 0;
    const tweak = TWEAKS.find((t) => t.id === id);
    return { id, fixture: !!tweak?.fixture, note: tweak?.note ?? "", all, z, cells,
      best: cells[0], worst: cells[cells.length - 1] };
  }).sort((a, b) => b.all.mean - a.all.mean);

  const verdict = (s) => {
    if (s.fixture) return "fixture";
    const answered = TWEAKS.find((t) => t.id === s.id)?.settled;
    if (answered) return `settled — ${answered}`;
    // A knob the grid barely reaches cannot be settled by measuring harder.
    if (s.cells.length && s.cells.length <= Math.max(3, CELLS.length * 0.12)) {
      return `only bites in ${s.cells.length} of ${CELLS.length} rooms — the grid cannot settle it`;
    }
    if (s.all.ci >= Math.abs(s.all.mean)) {
      // Not separated from zero. Say whether the rooms at least agree, because
      // "every room says a small plus" and "half say plus, half say minus" are
      // different kinds of nothing and only one of them is worth more batches.
      const up = s.cells.filter((cell) => cell.mean > 0).length;
      return up === s.cells.length ? "unsettled — every room leans up, none of it clear"
        : up === 0 ? "unsettled — every room leans down"
        : `unsettled — ${up} of ${s.cells.length} rooms lean up, the rest down`;
    }
    if (s.all.mean < 0) return `REJECT — costs ${signed(s.all.mean)} on average`;
    return `PROMOTE — worth ${signed(s.all.mean)} on average across the grid`;
  };

  console.log(`cpu-lab screen — the AVERAGE BOOST: what a manager carrying the tweak gains,`);
  console.log(`  averaged over every room and every number of rivals who also have it.`);
  console.log(`  A gain with 1 of 4 managers on it counts the same as one with 3 of 4.`);
  console.log(`  ${tags.size} rooms, ${VERSUS} controls, against the ${BASELINE} bidder. The interval is`);
  console.log(`  the spread BETWEEN rooms, so it is wide`);
  console.log(`  on purpose: a tweak that helps in half of them and hurts in the rest reads unsettled.\n`);
  console.log(`  ${"candidate".padEnd(26)} ${"average".padStart(14)}  ${"rooms".padStart(5)}  `
    + `${"best room".padStart(20)}  ${"worst room".padStart(20)}   verdict`);
  for (const s of scored) {
    const room = (cell) => cell ? `${cell.tag} ${signed(cell.mean)}` : "—";
    console.log(`  ${s.id.padEnd(26)} ${(signed(s.all.mean) + " ±" + (Number.isFinite(s.all.ci) ? s.all.ci.toFixed(2) : "?")).padStart(14)}  `
      + `${String(s.cells.length).padStart(5)}  ${room(s.best).padStart(20)}  ${room(s.worst).padStart(20)}   ${verdict(s)}`);
  }
  const live = scored.filter((s) => !s.fixture && !TWEAKS.find((t) => t.id === s.id)?.settled);
  const promoted = live.filter((s) => verdict(s).startsWith("PROMOTE"));
  console.log(`\n  ${promoted.length} of ${live.length} candidates are clear of zero and positive. At this bar about `
    + `${(live.length * 0.025).toFixed(1)} would be\n  from luck alone, so a promotion buys a deeper measurement rather than a change to the bidder.`);
  const spots = tags.size && live.length ? Math.max(...live.map((s) => s.all.spots)) : 0;
  const missing = live.filter((s) => s.all.spots < spots);
  if (missing.length) {
    console.log(`\n  measured in fewer places than the fullest candidate (${spots} room-and-adoption-levels):`);
    for (const s of missing.slice(0, 8)) console.log(`    ${s.id.padEnd(26)} ${s.all.spots}`);
  }
  if (promoted.length) {
    console.log(`\n  node scripts/cpu-lab.mjs run --stage confirm --tweak ${promoted.map((s) => s.id).join(",")}`);
  }

}
