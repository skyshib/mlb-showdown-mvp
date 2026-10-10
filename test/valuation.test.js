import assert from "node:assert/strict";
import test from "node:test";

import { CLASSIC_CARD_ROWS } from "../src/data/classicCards.js";
import { buildDraftPool } from "../src/data/universes.js";
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
//
// Read on DEALT boards, across seeds, and on MARGINS rather than on who came
// first. The earlier version of this test drafted from a raw 900-card slice —
// no deal, no positional quotas, no replacement cards, a pool no room ever uses
// — and asserted that the purist held the single best glove in that one room.
// Both halves were weak. On a real board "purist holds the best glove" is true
// in only 4 of 6 rooms, and it is true in 4 of 6 with every archetype forced to
// `balanced` too: it reads seat luck, not character. These margins separate the
// real archetypes from a converged field by a wide gap in both directions —
// checked by forcing all four personas to `balanced` and watching every one of
// them fail.
test("the computer's archetypes build different rosters", () => {
  const seeds = ["arch-1", "arch-2", "arch-3", "arch-4", "arch-5", "arch-6"];
  const firstArm = { ace: [], slugger: [] };
  const armPoints = { ace: [], slugger: [] };
  const glove = { purist: [], slugger: [] };

  for (const seed of seeds) {
    const board = buildDraftPool("classic", seed, { managerCount: 4, startingPitchers: 4 });
    const managers = CPU_PERSONALITY_KEYS.map((persona) => ({ name: persona, cpu: true, persona }));
    const draft = createDraft(managers, board, 15, seed, { startingPitchers: 4 });
    let guard = 4 * 15 + 40;
    while (!draft.complete && guard-- > 0) autopick(draft);
    assert.ok(draft.complete, `${seed} did not finish`);

    const seat = (persona) => draft.managers.find((manager) => manager.persona === persona);
    const firstArmAt = (manager) => manager.roster.findIndex((card) => card.kind === "pitcher");
    const staffPoints = (manager) => manager.roster
      .filter((card) => card.kind === "pitcher")
      .reduce((sum, card) => sum + (Number(card.points) || 0), 0);
    const fielding = (manager) => manager.roster
      .filter((card) => card.kind === "hitter")
      .reduce((sum, card) => sum + (Number(card.fielding) || 0), 0);

    for (const persona of ["ace", "slugger"]) {
      firstArm[persona].push(firstArmAt(seat(persona)));
      armPoints[persona].push(staffPoints(seat(persona)));
    }
    for (const persona of ["purist", "slugger"]) glove[persona].push(fielding(seat(persona)));
  }

  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;

  // The ace-first man opens on an arm. (Converged field: 5.67.)
  assert.ok(mean(firstArm.ace) <= 2, `ace waits until pick ${mean(firstArm.ace).toFixed(2)} for an arm`);

  // The slugger lets them come to him. (Converged field: the gap inverts to -2.17.)
  const waitGap = mean(firstArm.slugger) - mean(firstArm.ace);
  assert.ok(waitGap >= 3, `slugger reaches for an arm only ${waitGap.toFixed(2)} picks later than the ace`);

  // And he ends up with the staff to show for it. (Converged field: -198.)
  const staffGap = mean(armPoints.ace) - mean(armPoints.slugger);
  assert.ok(staffGap >= 300, `ace's staff beats the slugger's by only ${staffGap.toFixed(0)} points`);

  // The purist fields a real defence; the slugger will not ask who is catching.
  // (Converged field: 1.8.)
  const gloveGap = mean(glove.purist) - mean(glove.slugger);
  assert.ok(gloveGap >= 5, `purist's defence beats the slugger's by only ${gloveGap.toFixed(1)}`);
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
