import test from "node:test";
import assert from "node:assert/strict";
import { dominatedPicks } from "../src/rules/pickDominance.js";

const ALPHA = { id: "m-alpha", name: "Alpha" };
const BETA = { id: "m-beta", name: "Beta" };

function pick(pickNumber, manager, id, { price = null, slot = "SS", round = 1, ...rest } = {}) {
  return {
    pickNumber,
    round,
    manager,
    price,
    player: { id, name: id, kind: "hitter", position: slot, ...rest }
  };
}

// Every test hands the finder the slot each card filled and the WPAR it earned,
// which is exactly what the batch recap has on hand.
function run(picks, wpars, { auction = false, slots = {} } = {}) {
  return dominatedPicks(picks, {
    auction,
    wparById: new Map(Object.entries(wpars)),
    slotOf: (player) => slots[player.id] ?? player.position ?? player.role ?? null
  });
}

test("a snake pick is dominated by a better card at the same slot taken later", () => {
  const picks = [pick(1, ALPHA, "early-ss"), pick(2, BETA, "late-ss")];
  const result = run(picks, { "early-ss": 1.5, "late-ss": 4 });
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.equal(row.id, "early-ss");
  assert.equal(row.best.id, "late-ss");
  assert.equal(row.gap, 2.5);
  assert.equal(row.waited, 1);
});

test("a card taken earlier was not on the board, however good he turned out", () => {
  const picks = [pick(1, BETA, "great-ss"), pick(2, ALPHA, "weak-ss")];
  const result = run(picks, { "great-ss": 6, "weak-ss": 1 });
  assert.deepEqual(result.rows, []);
  assert.equal(result.considered, 2);
});

test("a better card at a different slot is no alternative", () => {
  const picks = [pick(1, ALPHA, "ss", { slot: "SS" }), pick(2, BETA, "first", { slot: "1B" })];
  const result = run(picks, { ss: 1, first: 9 });
  assert.deepEqual(result.rows, []);
});

test("an SP is never allowed to dominate an RP", () => {
  const picks = [
    pick(1, ALPHA, "closer", { slot: "RP", role: "RP" }),
    pick(2, BETA, "ace", { slot: "SP", role: "SP" })
  ];
  const result = run(picks, { closer: 2, ace: 8 }, { slots: { closer: "RP", ace: "SP" } });
  assert.deepEqual(result.rows, []);
});

test("a manager's own later pick is not held against his earlier one", () => {
  const picks = [pick(1, ALPHA, "first-ss"), pick(2, ALPHA, "second-ss")];
  const result = run(picks, { "first-ss": 1, "second-ss": 5 });
  assert.deepEqual(result.rows, []);
});

test("a snake alternative still unsold at the manager's next turn is flagged as one he could have waited for", () => {
  const picks = [
    pick(1, ALPHA, "early-ss"),
    pick(2, BETA, "beta-ss"),
    pick(3, ALPHA, "alpha-second", { slot: "1B" }),
    pick(4, BETA, "later-ss")
  ];
  const result = run(picks, { "early-ss": 1, "beta-ss": 2, "alpha-second": 1, "later-ss": 3 });
  const row = result.rows.find((item) => item.id === "early-ss");
  assert.ok(row, "the early pick is flagged");
  assert.equal(row.stillThereNextTurn, true, "a shortstop was still there after Alpha's next turn");
  const beta = row.alternatives.find((item) => item.id === "beta-ss");
  assert.equal(beta.stillThereNextTurn, false, "the one taken before that turn was not");
});

test("an auction pick is dominated only by a card that was both unsold and no dearer", () => {
  const picks = [
    pick(1, ALPHA, "pricey", { price: 200 }),
    pick(2, BETA, "cheap-better", { price: 80 }),
    pick(3, BETA, "dear-better", { price: 400 })
  ];
  const result = run(picks, { pricey: 2, "cheap-better": 5, "dear-better": 9 }, { auction: true });
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.equal(row.id, "pricey");
  assert.deepEqual(row.alternatives.map((item) => item.id), ["cheap-better"]);
  assert.equal(row.saved, 120);
  assert.equal(row.gap, 3);
});

test("an equal card for less money is dominance too, and an equal card for the same money is not", () => {
  const picks = [
    pick(1, ALPHA, "paid-up", { price: 150 }),
    pick(2, BETA, "same-price", { price: 150 }),
    pick(3, BETA, "less-money", { price: 90 })
  ];
  const result = run(picks, { "paid-up": 3, "same-price": 3, "less-money": 3 }, { auction: true });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0].alternatives.map((item) => item.id), ["less-money"]);
  assert.equal(result.rows[0].gap, 0);
  assert.equal(result.rows[0].saved, 60);
});

test("the best card and the biggest saving are reported separately", () => {
  const picks = [
    pick(1, ALPHA, "pricey", { price: 300 }),
    pick(2, BETA, "best-card", { price: 250 }),
    pick(3, BETA, "biggest-saving", { price: 20 })
  ];
  const result = run(picks, { pricey: 1, "best-card": 7, "biggest-saving": 2 }, { auction: true });
  const [row] = result.rows;
  assert.equal(row.best.id, "best-card");
  assert.equal(row.cheapest.id, "biggest-saving");
  assert.equal(row.saved, 50, "the headline saving is the best card's");
  const alpha = result.byManager.find((item) => item.managerId === ALPHA.id);
  assert.equal(alpha.savings, 280, "the manager's savings read off the cheapest alternative");
});

test("coaches, swept replacements and unmeasured cards are left out of the test", () => {
  const picks = [
    pick(1, ALPHA, "coach", { kind: "coach" }),
    pick(2, ALPHA, "swept", { replacement: true }),
    pick(3, ALPHA, "no-stats"),
    pick(4, BETA, "measured")
  ];
  const result = run(picks, { coach: 0, swept: 9, measured: 9 });
  assert.equal(result.considered, 1, "only the one measured, chosen card counts");
  assert.deepEqual(result.rows, []);
});

test("every manager gets a line, dominated or not", () => {
  const picks = [pick(1, ALPHA, "early-ss"), pick(2, BETA, "late-ss")];
  const result = run(picks, { "early-ss": 1, "late-ss": 4 });
  assert.deepEqual(
    result.byManager.map((row) => [row.name, row.picks, row.dominated]),
    [["Alpha", 1, 1], ["Beta", 1, 0]]
  );
  assert.equal(result.byManager[0].wparLeftBehind, 3);
});
