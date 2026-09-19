import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftPool } from "../src/data/universes.js";
import {
  activeRoster,
  applyDraftAction,
  assignLineupSlots,
  benchPlayers,
  canPlayerFillLineupSlot,
  createDraft,
  pointMaximalAssignments
} from "../src/rules/draft.js";

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
  return draft;
}

const fieldPoints = (manager) => activeRoster(manager).reduce((sum, player) => sum + player.points, 0);

test("auto-sort fields the most card points and no bench card can beat a starter", () => {
  for (const seed of ["auto-sort-1", "auto-sort-2", "auto-sort-3"]) {
    const draft = unlimitedRoom(seed);
    for (const manager of draft.managers) {
      const before = fieldPoints(manager);
      const filledBefore = activeRoster(manager).length;
      const { lineupAssignments, staffAssignments } = pointMaximalAssignments(manager, draft);
      applyDraftAction(draft, { type: "lineup", managerId: manager.id, assignments: lineupAssignments });
      applyDraftAction(draft, { type: "staff", managerId: manager.id, assignments: staffAssignments });
      assert.ok(fieldPoints(manager) >= before, `${seed} ${manager.name}: ${fieldPoints(manager)} < ${before}`);
      assert.ok(activeRoster(manager).length >= filledBefore);

      const slots = assignLineupSlots(manager.roster, manager.lineupAssignments).slots;
      for (const bench of benchPlayers(manager)) {
        if (bench.kind === "hitter") {
          for (const slot of slots) {
            if (canPlayerFillLineupSlot(bench, slot.label)) assert.ok(bench.points <= (slot.player?.points ?? -1));
          }
        } else {
          const role = bench.role === "SP" ? "SP" : "RP";
          const seated = activeRoster(manager).filter((player) => player.kind === "pitcher" && (player.role === "SP" ? "SP" : "RP") === role);
          for (const arm of seated) assert.ok(bench.points <= arm.points);
        }
      }
    }
  }
});
