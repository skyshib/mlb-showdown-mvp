import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SNAKE_BENCH_PICKS,
  applyDraftAction,
  autopick,
  availablePlayers,
  canPickPlayer,
  completeSnakeReview,
  createDraft,
  currentManager,
  draftHistory,
  draftReviewComplete,
  draftReviewEnabled,
  draftReviewRemainingMs,
  minimumSnakePicks,
  normalizeSnakePicks,
  normalizeSnakeReviewMs,
  pauseSnake,
  pickPlayer,
  resumeSnake,
  roomDraftOptions,
  rosterPlayerCount,
  snakeClockBankMs,
  snakeClockEnabled,
  snakeReviewComplete,
  startSnakeClock,
  startSnakeReview,
  syncSnakeTimer,
  undoLastPick,
  validateRoster
} from "../src/rules/draft.js";
import { buildDraftPool } from "../src/data/universes.js";

const positions = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

const hitter = {
  id: "h", name: "Hitter", kind: "hitter", position: "LF", onBase: 9, points: 200,
  positions: [{ pos: "LF", fielding: 1 }], speed: "B", chart: []
};
const pitcher = {
  id: "p", name: "Pitcher", kind: "pitcher", role: "SP", control: 4, ip: 6, points: 180, chart: []
};

function makeDraftPool(prefix, hitterCount = 60, pitcherCount = 30) {
  const hitters = Array.from({ length: hitterCount }, (_, index) => ({
    ...hitter,
    id: `${prefix}-h-${index}`,
    name: `${prefix} Hitter ${index}`,
    position: positions[index % positions.length],
    positions: [{ pos: positions[index % positions.length], fielding: 1 }],
    points: 300 - index
  }));
  const pitchers = Array.from({ length: pitcherCount }, (_, index) => ({
    ...pitcher,
    id: `${prefix}-p-${index}`,
    name: `${prefix} Pitcher ${index}`,
    role: index % 2 === 0 ? "SP" : "RP",
    ip: index % 2 === 0 ? 6 : 1,
    points: 200 - index
  }));
  return [...hitters, ...pitchers];
}

// ---- the picks slider --------------------------------------------------------

test("a snake draft is a roster long unless it asks for more", () => {
  const pool = makeDraftPool("length");
  const plain = createDraft(["Ana", "Bo"], pool, 13, "length");
  assert.equal(plain.rosterSize, 13, "nine hitters, two starters, two relievers");
  assert.equal(minimumSnakePicks(2, {}), 13);

  const deep = createDraft(["Ana", "Bo"], pool, 13, "length", { snakePicks: 18 });
  assert.equal(deep.rosterSize, 18, "five bench spots on top of the roster");

  // The floor is a legal roster and the ceiling is the bench the slider allows.
  assert.equal(normalizeSnakePicks(4, 2, {}), 13, "a draft shorter than a roster is not a draft");
  assert.equal(normalizeSnakePicks(500, 2, {}), 13 + MAX_SNAKE_BENCH_PICKS);
  assert.equal(normalizeSnakePicks(undefined, 2, {}), 13, "no setting is the minimum");
  // The floor moves with the rotation and the pen, and so does the ceiling.
  assert.equal(minimumSnakePicks(4, { bullpenMin: 3, bullpenSlots: 3 }), 16);
  assert.equal(normalizeSnakePicks(14, 4, { bullpenMin: 3, bullpenSlots: 3 }), 16);
});

test("the extra picks are bench, and every one of them is drafted", () => {
  const draft = createDraft(["Ana", "Bo", "Cy"], makeDraftPool("bench"), 13, "bench", { snakePicks: 17 });
  while (!draft.complete) autopick(draft);
  for (const manager of draft.managers) {
    assert.ok(rosterPlayerCount(manager) >= 17, `${manager.name} drafted every turn she had`);
    assert.deepEqual(validateRoster(manager, draft), [], `${manager.name} fields a legal nine`);
  }
  assert.equal(draftHistory(draft).length, 3 * 17, "the pick list is the turns, not the cards");
});

// ---- the open board ----------------------------------------------------------

test("an open snake board takes any card, whatever the roster already holds", () => {
  const pool = makeDraftPool("open");
  const draft = createDraft(["Ana", "Bo"], pool, 13, "open");
  const ana = draft.managers[0];
  // Nine catchers is a legal start now. The old rules refused the second one.
  const catchers = pool.filter((card) => card.position === "C");
  assert.ok(catchers.length >= 5);
  for (let index = 0; index < 5; index += 1) {
    assert.equal(canPickPlayer(draft, ana, catchers[index]).ok, true, `catcher ${index + 1} is a legal pick`);
    ana.roster.push(catchers[index]);
    draft.pickedIds.add(catchers[index].id);
  }
  // And so is a card that leaves the league nothing: no reservation, no
  // league-supply guard, no positions to protect.
  assert.equal(canPickPlayer(draft, ana, pool.find((card) => card.role === "SP")).ok, true);
});

test("a roster out of turns is out of cards, open board or not", () => {
  const pool = makeDraftPool("cap");
  const draft = createDraft(["Ana", "Bo"], pool, 13, "cap");
  const ana = draft.managers[0];
  ana.roster = pool.slice(0, 13);
  draft.pickedIds = new Set(ana.roster.map((card) => card.id));
  const spare = availablePlayers(draft)[0];
  assert.equal(canPickPlayer(draft, ana, spare).ok, false, "thirteen picks is thirteen picks");
  assert.match(canPickPlayer(draft, ana, spare).reason, /full/);
});

test("the closing sweep finishes a roster that drafted nothing but bats", () => {
  const pool = makeDraftPool("sweep");
  const draft = createDraft(["Ana", "Bo"], pool, 13, "sweep");
  const [ana, bo] = draft.managers;
  // Ana spends all thirteen turns on hitters; Bo has built a legal twelve and
  // has one turn left.
  const bats = pool.filter((card) => card.kind === "hitter");
  ana.roster = bats.slice(0, 13);
  bo.roster = [
    ...bats.slice(13, 21),
    ...pool.filter((card) => card.role === "SP").slice(0, 2),
    ...pool.filter((card) => card.role === "RP").slice(0, 2)
  ];
  draft.pickedIds = new Set([...ana.roster, ...bo.roster].map((card) => card.id));
  draft.pickNumber = 25;

  // The twenty-sixth pick ends the draft, and the sweep runs on the spot.
  assert.equal(currentManager(draft).id, bo.id);
  pickPlayer(draft, availablePlayers(draft).find((card) => card.kind === "hitter").id);
  assert.equal(draft.complete, true);

  assert.equal(draft.swept.length, 4, "two starters and two relievers, handed over for free");
  assert.ok(draft.swept.every((entry) => entry.managerId === ana.id), "to the manager who was short");
  const free = draft.swept.map((entry) => ana.roster.find((card) => card.id === entry.playerId));
  assert.deepEqual(free.filter((card) => card.role === "SP").length, 2);
  assert.deepEqual(free.filter((card) => card.role === "RP").length, 2);
  assert.deepEqual(validateRoster(ana, draft), [], "and the roster is legal");
  assert.equal(rosterPlayerCount(ana), 17, "thirteen she drafted and four she was given");
  // The sweep took no turns: the pick list is still the picks.
  assert.equal(draftHistory(draft).length, 26);
  assert.equal(draft.pickNumber, 26);
});

test("undo takes the closing sweep back off before it takes the pick", () => {
  const pool = makeDraftPool("undo");
  const draft = createDraft(["Ana", "Bo"], pool, 13, "undo");
  const [ana, bo] = draft.managers;
  const bats = pool.filter((card) => card.kind === "hitter");
  ana.roster = bats.slice(0, 13);
  bo.roster = [
    ...bats.slice(13, 21),
    ...pool.filter((card) => card.role === "SP").slice(0, 2),
    ...pool.filter((card) => card.role === "RP").slice(0, 2)
  ];
  draft.pickedIds = new Set([...ana.roster, ...bo.roster].map((card) => card.id));
  draft.pickNumber = 25;

  const lastPick = availablePlayers(draft).find((card) => card.kind === "hitter");
  pickPlayer(draft, lastPick.id);
  assert.ok(draft.swept.length > 0, "the sweep ran");
  const freeIds = draft.swept.map((entry) => entry.playerId);

  const undone = undoLastPick(draft);
  assert.equal(undone.player.id, lastPick.id, "the real pick is what came back, not a swept card");
  assert.deepEqual(draft.swept, [], "and the free cards left with it");
  for (const id of freeIds) {
    assert.equal(ana.roster.some((card) => card.id === id), false, `${id} is off the roster`);
    assert.equal(draft.pickedIds.has(id), false, `${id} is back on the board`);
  }
  assert.deepEqual(draft.pool.filter((card) => card.replacement && card.sourceId), [], "and no printed copy is left behind");
  assert.equal(draft.complete, false);
  assert.equal(draft.pickNumber, 25);
});

test("a dealt board sweeps to its standing replacements", () => {
  const pool = buildDraftPool("classic", "standing", { managerCount: 2, startingPitchers: 2, bullpenMin: 2, bullpenSlots: 2 });
  const draft = createDraft(["Ana", "Bo"], pool, 13, "standing");
  const [ana, bo] = draft.managers;
  const bats = pool.filter((card) => !card.replacement && card.kind === "hitter");
  ana.roster = bats.slice(0, 13);
  bo.roster = [
    ...bats.slice(13, 21),
    ...pool.filter((card) => !card.replacement && card.role === "SP").slice(0, 2),
    ...pool.filter((card) => !card.replacement && card.role === "RP").slice(0, 2)
  ];
  draft.pickedIds = new Set([...ana.roster, ...bo.roster].map((card) => card.id));
  draft.pickNumber = 25;

  pickPlayer(draft, availablePlayers(draft).find((card) => card.kind === "hitter").id);
  const free = draft.swept
    .filter((entry) => entry.managerId === ana.id)
    .map((entry) => ana.roster.find((card) => card.id === entry.playerId));
  // She drafted no arms at all, so she is handed a whole staff.
  assert.equal(free.filter((card) => card.slot === "SP").length, 2);
  assert.equal(free.filter((card) => card.slot === "RP").length, 2);
  // The standing card at the slot is what a hole costs, and it is what the hole
  // is paid with — the good cards nobody took stay untaken.
  assert.ok(free.every((card) => card.replacement && card.sourceId), "every hole took its standing replacement");
  assert.ok(
    free.every((card) => !draft.pickedIds.has(card.sourceId)),
    "the standing cards themselves are copied, never spent"
  );
  assert.deepEqual(validateRoster(ana, draft), []);
});

test("the computer still closes its own holes before it shops for depth", () => {
  const draft = createDraft(["Ana", "Bo", "Cy"], makeDraftPool("cpu"), 13, "cpu-holes", { snakePicks: 16 });
  while (!draft.complete) autopick(draft);
  for (const manager of draft.managers) {
    assert.equal(
      manager.roster.filter((card) => card.replacement).length,
      0,
      `${manager.name} drafted a legal roster rather than leaning on the sweep`
    );
    assert.deepEqual(validateRoster(manager, draft), []);
  }
});

// ---- the pool review ---------------------------------------------------------

function reviewDraft(options = {}) {
  return createDraft(["Ana", "Bo"], makeDraftPool("review"), 13, "review-seed", { snakeReview: 300, ...options });
}

test("a snake draft has no pool review unless it asks for one", () => {
  const plain = createDraft(["Ana", "Bo"], makeDraftPool("plain"), 13, "plain");
  assert.equal(draftReviewEnabled(plain), false);
  assert.equal(plain.review, undefined, "and carries no review at all");
  assert.equal(draftReviewComplete(plain), true, "so nothing is waiting on it");

  assert.equal(draftReviewEnabled(reviewDraft()), true);
  assert.equal(normalizeSnakeReviewMs(undefined), 0, "a room that names none has none");
  assert.equal(normalizeSnakeReviewMs(90), 90_000);
  assert.equal(normalizeSnakeReviewMs({ reviewSeconds: 120 }), 120_000);
  assert.equal(normalizeSnakeReviewMs(99_999), 3_600_000, "clamped to an hour");
});

test("nobody picks while the board is still being read", () => {
  const draft = reviewDraft();
  const t0 = 5_000_000;
  startSnakeReview(draft, t0);
  assert.equal(draftReviewRemainingMs(draft, t0), 300_000);
  assert.equal(draftReviewRemainingMs(draft, t0 + 60_000), 240_000);
  assert.equal(snakeReviewComplete(draft, t0 + 60_000), false);

  assert.throws(() => pickPlayer(draft, availablePlayers(draft)[0].id, t0 + 60_000), /Review period is still open/);

  // It runs out by itself.
  assert.equal(snakeReviewComplete(draft, t0 + 300_001), true);
  pickPlayer(draft, availablePlayers(draft)[0].id, t0 + 300_001);
  assert.equal(draft.pickNumber, 1);
});

test("the first clock starts when the review ends, not when the board is dealt", () => {
  const draft = reviewDraft({ snakeTimer: { bankSeconds: 60, incrementSeconds: 10 } });
  const t0 = 6_000_000;
  assert.equal(snakeClockEnabled(draft), true);
  startSnakeReview(draft, t0);
  assert.equal(startSnakeClock(draft, t0), false, "the gun does not fire during the review");
  assert.equal(draft.clock.turnStartedAt, null);

  // Five minutes pass with nobody on a clock, and every bank is still whole.
  assert.equal(snakeClockBankMs(draft, draft.managers[0]), 60_000);
  completeSnakeReview(draft, t0 + 300_000);
  assert.equal(draft.clock.turnStartedAt, t0 + 300_000, "and fires the moment the review is over");
  assert.equal(snakeClockBankMs(draft, draft.managers[0]), 60_000);
});

test("a review that ran out is settled at the instant it ended, not when it was noticed", () => {
  const draft = reviewDraft({ snakeTimer: { bankSeconds: 60, incrementSeconds: 10 } });
  const t0 = 7_000_000;
  startSnakeReview(draft, t0);
  // Nobody looked at the room for an hour. The clock still starts at the buzzer.
  assert.equal(syncSnakeTimer(draft, t0 + 3_600_000), true);
  assert.equal(draft.review.completedAt, t0 + 300_000);
  assert.equal(draft.clock.turnStartedAt, t0 + 300_000);
  assert.equal(syncSnakeTimer(draft, t0 + 3_600_000), false, "and only settles once");
});

test("a paused review stops running out", () => {
  const draft = reviewDraft();
  const t0 = 8_000_000;
  startSnakeReview(draft, t0);
  pauseSnake(draft, null, t0 + 60_000);
  assert.equal(draftReviewRemainingMs(draft, t0 + 60_000), 240_000);
  assert.equal(draftReviewRemainingMs(draft, t0 + 600_000), 240_000, "the break costs the review nothing");
  assert.equal(snakeReviewComplete(draft, t0 + 600_000), false);

  resumeSnake(draft, t0 + 600_000);
  assert.equal(draftReviewRemainingMs(draft, t0 + 600_000), 240_000);
  assert.equal(snakeReviewComplete(draft, t0 + 840_001), true);
});

test("a room's rules carry the picks and the review, and replay through them", () => {
  const room = { draftType: "snake", startingPitchers: 2, bullpenMin: 2, snakePicks: 16, snakeReview: 120 };
  const options = roomDraftOptions(room);
  assert.equal(options.snakePicks, 16);
  assert.equal(options.rosterSize, 16);
  assert.equal(options.snakeReview, 120);

  const pool = makeDraftPool("room");
  const rebuild = () => createDraft(["Ana", "Bo"], pool, options.rosterSize, "room-seed", options);
  const live = rebuild();
  const t0 = 9_000_000;
  const log = [
    { type: "start-review", at: t0 },
    { type: "complete-review", at: t0 + 30_000 }
  ];
  for (const action of log) applyDraftAction(live, action);
  const first = availablePlayers(live)[0].id;
  log.push({ type: "pick", playerId: first, at: t0 + 31_000 });
  applyDraftAction(live, { type: "pick", playerId: first, at: t0 + 31_000 });

  // A client joining later replays the same log and lands on the same draft.
  const replica = rebuild();
  for (const action of log) applyDraftAction(replica, action);
  assert.equal(replica.review.completedAt, live.review.completedAt);
  assert.equal(replica.pickNumber, live.pickNumber);
  assert.equal(replica.managers[0].roster[0].id, first);
  assert.equal(currentManager(replica).id, currentManager(live).id);
});

// ---- the board the room is dealt ---------------------------------------------

test("a longer draft is dealt a wider board", () => {
  const cards = (picks) => buildDraftPool("classic", "wide", {
    managerCount: 8,
    startingPitchers: 2,
    bullpenMin: 2,
    bullpenSlots: 2,
    ...(picks === null ? {} : { picks })
  }).filter((card) => !card.replacement).length;

  const standard = cards(null);
  assert.equal(cards(13), standard, "a draft exactly a roster long deals the board it always did");
  const deep = cards(25);
  assert.ok(deep > standard * 1.5, `a draft twice as long deals a board to match (${standard} -> ${deep})`);
  assert.ok(deep >= 8 * 25, "and holds enough cards for every seat's every turn");
});
