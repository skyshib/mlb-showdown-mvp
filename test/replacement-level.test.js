import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftPool } from "../src/data/universes.js";
import { autopick, createDraft, positionMatchesSlot, repairDraftRosters } from "../src/rules/draft.js";
import { batterRunsPerPa } from "../src/rules/substitutions.js";
import {
  hitterRunsPerPa,
  hitterSlotValue,
  rankedReplacements,
  replacementBaseline,
  replacementSeats
} from "../src/rules/replacementLevel.js";

const TEAM_COUNT = 6;

function room(seed, options = {}) {
  const { drive = false, ...rules } = options;
  const pool = buildDraftPool("classic", seed, { managerCount: TEAM_COUNT, ...rules });
  const managers = Array.from({ length: TEAM_COUNT }, (unused, i) => ({ name: `T${i + 1}`, cpu: true }));
  const draft = createDraft(managers, pool, 15, seed, {
    draftType: "snake", timer: false, snakeTimer: false, ...rules
  });
  if (drive) {
    let guard = 20000;
    while (!draft.complete && guard-- > 0) autopick(draft);
    repairDraftRosters(draft);
  }
  return draft;
}

const slotsOf = (cards) => Object.fromEntries(cards.map((card) => [card.slot, card.id]));

test("the floor is read off the board, so the draft cannot move it", () => {
  // The whole reason for ranking the board instead of the finished draft: one
  // manager reaching, or one autopick blunder, must not change what every other
  // card in the room is measured against.
  const before = room("exogenous-room");
  const after = room("exogenous-room", { drive: true });
  assert.deepEqual(slotsOf(rankedReplacements(after)), slotsOf(rankedReplacements(before)));
});

test("the same board drafted in a different order names the same floor", () => {
  const a = room("order-room", { drive: true });
  // Same deck, different pick sequence: createDraft's own seed drives the order.
  const pool = buildDraftPool("classic", "order-room", { managerCount: TEAM_COUNT });
  const managers = Array.from({ length: TEAM_COUNT }, (unused, i) => ({ name: `S${i + 1}`, cpu: true }));
  const b = createDraft(managers, pool, 15, "order-room-shuffled", {
    draftType: "snake", timer: false, snakeTimer: false
  });
  let guard = 20000;
  while (!b.complete && guard-- > 0) autopick(b);
  repairDraftRosters(b);
  assert.deepEqual(slotsOf(rankedReplacements(b)), slotsOf(rankedReplacements(a)));
});

test("N is the seats the room fields, not a constant", () => {
  const plain = replacementSeats(room("seats-room"));
  assert.equal(plain.SS, TEAM_COUNT);
  assert.equal(plain["LF/RF"], TEAM_COUNT * 2, "the corners seat two men a club");
  assert.equal(plain.DH, TEAM_COUNT);

  const deep = replacementSeats(room("seats-room", { startingPitchers: 5, bullpenSlots: 4 }));
  assert.equal(deep.SP, TEAM_COUNT * 5);
  assert.equal(deep.RP, TEAM_COUNT * 4);

  // An unlimited pen is priced at the most that can pitch.
  const open = replacementSeats(room("seats-room", { bullpenSlots: "all" }));
  assert.ok(open.RP > TEAM_COUNT * 4, `unlimited pen should seat the lot, got ${open.RP}`);
});

test("every floor is a card that can legally stand at its slot", () => {
  const draft = room("legal-room", { drive: true });
  const cards = rankedReplacements(draft);
  assert.ok(cards.length >= 10, `expected a floor at every slot, got ${cards.length}`);
  for (const card of cards) {
    if (card.slot === "SP" || card.slot === "RP") {
      assert.equal(card.kind, "pitcher");
      assert.equal(card.role === "SP" ? "SP" : "RP", card.slot);
      continue;
    }
    assert.equal(card.kind, "hitter");
    if (card.slot === "DH") continue;
    const label = card.slot === "LF/RF" ? "LF" : card.slot;
    assert.ok(positionMatchesSlot(card, label), `${card.name} cannot play ${card.slot}`);
  }
});

test("the floor is the marginal starter, not the worst card on the board", () => {
  // A deep board is the point: where the room seats far fewer men than the deck
  // holds, the Nth-best card at a slot stands well clear of the bottom of it.
  const draft = room("marginal-room", { drive: true });
  const ranked = new Map(rankedReplacements(draft).map((card) => [card.slot, card]));
  const bats = draft.pool.filter((card) => card.kind === "hitter" && !card.replacement);
  const staff = { controls: [3, 4, 4, 5, 5, 6], runValue: 0 };
  for (const slot of ["C", "2B", "SS", "CF"]) {
    const floor = ranked.get(slot);
    const eligible = bats.filter((card) => positionMatchesSlot(card, slot === "LF/RF" ? "LF" : slot));
    const values = eligible.map((card) => hitterSlotValue(card, slot, staff)).sort((a, b) => a - b);
    const mine = hitterSlotValue(floor, slot, staff);
    assert.ok(mine >= values[0], `${slot} floor is below the worst eligible card`);
    assert.ok(mine < values[values.length - 1], `${slot} floor is the best card at the slot`);
  }
});

test("a slot the board cannot fill falls back rather than standing empty", () => {
  const draft = room("thin-room");
  const catchers = draft.pool.filter((card) => card.kind === "hitter" && positionMatchesSlot(card, "C"));
  const keep = catchers[0];
  // One catcher for six seats: there is no sixth-best, and the floor has to give
  // before the slot does.
  draft.pool = draft.pool.filter((card) => !positionMatchesSlot(card, "C") || card.id === keep.id || card.replacement);
  const floor = rankedReplacements(draft).find((card) => card.slot === "C");
  assert.ok(floor, "the catcher slot lost its floor entirely");
});

test("the baseline follows the format: dollars buy a free card, picks do not", () => {
  const snake = room("format-room", { drive: true });
  assert.deepEqual(slotsOf(replacementBaseline(snake)), slotsOf(rankedReplacements(snake)));

  const auction = room("format-room");
  auction.draftType = "auction";
  const board = replacementBaseline(auction);
  assert.ok(board.length > 0, "an auction keeps the board's own floor");
  assert.ok(board.every((card) => card.replacement), "an auction floor is the standing replacement card");
});

test("the batter's half of the control roll agrees with the engine's own reading", () => {
  const draft = room("agree-room");
  const arm = draft.pool.find((card) => card.kind === "pitcher" && Number(card.control) > 0);
  const staff = { controls: [Number(arm.control)], runValue: 0 };
  // hitterRunsPerPa over a one-arm ladder is batterRunsPerPa against that arm,
  // bar the arm's own chart, which the ladder carries as an average instead.
  for (const bat of draft.pool.filter((card) => card.kind === "hitter").slice(0, 25)) {
    const mine = hitterRunsPerPa(bat, staff);
    const theirs = batterRunsPerPa(bat, { ...arm, chart: [] });
    assert.ok(Math.abs(mine - theirs) < 1e-9, `${bat.name}: ${mine} vs ${theirs}`);
  }
});
