import assert from "node:assert/strict";
import test from "node:test";

import { CLASSIC_CARD_ROWS } from "../src/data/classicCards.js";
import { decodeCardRows } from "../src/data/realCards.js";
import { chartSpan } from "../src/rules/cards.js";
import { autopick, createDraft } from "../src/rules/draft.js";
import { playerPower } from "../src/ui/render.js";
import { CPU_PERSONALITY_KEYS, createValuationModel } from "../src/rules/valuation.js";

const pool = decodeCardRows(CLASSIC_CARD_ROWS).slice(0, 900);

// The die is the ceiling. Everything that weighs a chart has to agree on it —
// three places worked it out for themselves and two of them forgot.
test("a chart row is worth the faces it can actually land on", () => {
  assert.equal(chartSpan({ from: 1, to: 4 }), 4);
  assert.equal(chartSpan({ from: 20, to: 20 }), 1);
  // "20+" — open-ended on the print, Infinity in the data, one face on the die.
  assert.equal(chartSpan({ from: 20, to: Infinity }), 1);
  assert.equal(chartSpan({ from: 18, to: Infinity }), 3);
  // A row that begins past the die never lands at all.
  assert.equal(chartSpan({ from: 21, to: Infinity }), 0);
});

test("the board's chart sort prices every card finitely", () => {
  const broken = pool.filter((card) => !Number.isFinite(playerPower(card)));
  assert.equal(broken.length, 0, `${broken.length} cards sorted as Infinity`);
});

// A card's top range is open-ended on the print — "20+" — and `to: Infinity` in
// the data. Measuring that range as infinitely wide priced the card at Infinity,
// and `Infinity - Infinity` is NaN, so the comparator that ranked the board on
// these numbers quietly gave up: half the pool was never sorted at all. The die
// is the ceiling, and a card is worth a finite number of runs.
test("every card prices to a finite number", () => {
  const model = createValuationModel("finite-check");
  const broken = pool.filter((card) => !Number.isFinite(model.value(card)));
  assert.equal(broken.length, 0, `${broken.length} cards priced at Infinity or NaN`);
});

test("an open-ended top range is worth its share of the die, not infinity", () => {
  const model = createValuationModel("open-range");
  const openEnded = pool.find((card) => card.chart.some((entry) => !Number.isFinite(entry.to)));
  assert.ok(openEnded, "the classic set should contain an open-ended chart range");
  assert.ok(Number.isFinite(model.value(openEnded)));
});

// The whole point of an archetype is that it drafts a different team. If two of
// them agree on everything, they are one manager wearing two hats.
test("the computer's archetypes build different rosters", () => {
  const managers = CPU_PERSONALITY_KEYS.map((persona) => ({ name: persona, cpu: true, persona }));
  // Read the arm-timing lean at a FULL four-man rotation, where the SP-slot
  // value lift is neutral. At a short rotation (two slots) a starter is worth so
  // much more — he opens half your games — that every archetype, slugger
  // included, reaches for one early, which is correct pricing but washes out the
  // persona lean this test is checking.
  const draft = createDraft(managers, pool, 15, "archetype-spread", { startingPitchers: 4 });
  while (!draft.complete) autopick(draft);

  const by = (key) => draft.managers.find((manager) => manager.persona === key);
  const fielding = (manager) =>
    manager.roster.filter((c) => c.kind === "hitter").reduce((sum, c) => sum + (Number(c.fielding) || 0), 0);

  // The purist fields the best defence at the table.
  const bestGlove = Math.max(...draft.managers.map(fielding));
  assert.equal(fielding(by("purist")), bestGlove);

  // The ace-first man takes an arm before anybody else does.
  const firstArmAt = (manager) => manager.roster.findIndex((card) => card.kind === "pitcher");
  assert.equal(firstArmAt(by("ace")), 0);
  assert.ok(firstArmAt(by("slugger")) > firstArmAt(by("ace")));
});

test("a human's seat carries no archetype, and a computer's always does", () => {
  const draft = createDraft(
    [{ name: "Skylar" }, { name: "Robot", cpu: true }],
    pool,
    13,
    "seats"
  );
  assert.equal(draft.managers[0].persona, null);
  assert.ok(CPU_PERSONALITY_KEYS.includes(draft.managers[1].persona));
});
