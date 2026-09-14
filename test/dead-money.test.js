import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftPool } from "../src/data/universes.js";
import {
  ROSTER_BENCH_KEY,
  activeRoster,
  applyDraftAction,
  autopick,
  benchLedger,
  benchPlayers,
  createDraft
} from "../src/rules/draft.js";

// A random-nomination room of computers, run to the closing sweep: the one
// draft type where a manager owns more cards than he fields.
function unlimitedRoom(seed, managerCount = 3) {
  const managers = Array.from({ length: managerCount }, (_, index) => ({ name: `M${index + 1}`, cpu: true }));
  const pool = buildDraftPool("classic", seed, { nomination: "random", managerCount });
  const draft = createDraft(managers, pool, 13, seed, {
    draftType: "auction",
    nomination: "random",
    budget: 5000,
    timer: false
  });
  applyDraftAction(draft, { type: "finish", at: 0 });
  assert.equal(draft.complete, true);
  return draft;
}

function pricesPaidBy(draft, manager) {
  return new Map(
    draft.auction.history
      .filter((entry) => entry.managerId === manager.id)
      .map((entry) => [entry.playerId, entry.price])
  );
}

test("dead money is what a manager paid for the cards he is not fielding", () => {
  const draft = unlimitedRoom("dead-money");
  let benched = 0;
  for (const manager of draft.managers) {
    const ledger = benchLedger(draft, manager);
    const bench = benchPlayers(manager);
    const paid = pricesPaidBy(draft, manager);
    assert.deepEqual(ledger.players.map((player) => player.id), bench.map((player) => player.id));
    assert.equal(ledger.count, bench.length);
    assert.equal(ledger.spent, bench.reduce((sum, player) => sum + (paid.get(player.id) ?? 0), 0));
    assert.equal(ledger.points, bench.reduce((sum, player) => sum + player.points, 0));
    assert.equal(ledger.total, [...paid.values()].reduce((sum, price) => sum + price, 0));
    assert.ok(ledger.spent <= ledger.total);
    // Nothing the manager fields counts, however much it cost.
    for (const player of activeRoster(manager)) assert.ok(!ledger.players.some((benched) => benched.id === player.id));
    benched += bench.length;
  }
  assert.ok(benched > 0, "an unlimited roster leaves somebody a bench to price");
});

test("dead money follows the lineup: sit a starter down and his price moves onto the bench", () => {
  const draft = unlimitedRoom("dead-money-moves");
  const manager = draft.managers.find((item) => benchPlayers(item).some((player) => player.kind === "hitter")) ?? draft.managers[0];
  const paid = pricesPaidBy(draft, manager);
  const before = benchLedger(draft, manager);
  const original = { ...(manager.lineupAssignments ?? {}) };

  // The most expensive fielded bat sits down, the way the roster board does
  // it: a lineup action carrying the explicit bench.
  const starter = activeRoster(manager)
    .filter((player) => player.kind === "hitter")
    .sort((a, b) => (paid.get(b.id) ?? 0) - (paid.get(a.id) ?? 0))[0];
  applyDraftAction(draft, {
    type: "lineup",
    managerId: manager.id,
    assignments: { ...original, [ROSTER_BENCH_KEY]: [...(original[ROSTER_BENCH_KEY] ?? []), starter.id] }
  });
  const after = benchLedger(draft, manager);
  assert.ok(after.players.some((player) => player.id === starter.id), "he is on the bench now");
  assert.equal(after.spent, after.players.reduce((sum, player) => sum + (paid.get(player.id) ?? 0), 0));
  assert.ok(after.spent >= before.spent + (paid.get(starter.id) ?? 0) - Math.max(0, ...before.players.map((player) => paid.get(player.id) ?? 0)),
    "his price came onto the bench; at most one bench bat took his spot");
  assert.equal(after.total, before.total, "what was spent does not change; where it sits does");

  // Put the lineup back and the ledger is what it was.
  applyDraftAction(draft, { type: "lineup", managerId: manager.id, assignments: original });
  assert.deepEqual(benchLedger(draft, manager), before);
});

test("a snake draft spends no money and fields every card it drafts", () => {
  const pool = buildDraftPool("classic", "dead-money-snake", { managerCount: 2 });
  const draft = createDraft(["A", "B"], pool, 13, "dead-money-snake");
  while (!draft.complete) autopick(draft);
  for (const manager of draft.managers) {
    assert.deepEqual(benchLedger(draft, manager), { players: [], count: 0, points: 0, spent: null, total: null });
  }
});
