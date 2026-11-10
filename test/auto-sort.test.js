import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftPool } from "../src/data/universes.js";
import {
  activeRoster,
  applyDraftAction,
  assignLineupSlots,
  availablePlayers,
  benchPlayers,
  canPickPlayer,
  canPlayerFillLineupSlot,
  createDraft,
  currentManager,
  pickPlayer,
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

// A computer used to field his picks in the order he made them until the
// draft completed, so a star bought late sat behind a lesser early buy for the
// whole night. Every pick now re-seats him.
test("a computer re-seats his team on the pick, not at the buzzer", () => {
  const pool = buildDraftPool("classic", "cpu-resort", { managerCount: 2 });
  const draft = createDraft(
    [{ name: "Alpha", cpu: true }, { name: "Beta" }],
    pool, 13, "cpu-resort", { startingPitchers: 1, timer: false }
  );
  const [alpha, beta] = draft.managers;
  const starters = pool.filter((card) => card.kind === "pitcher" && card.role === "SP" && !card.replacement)
    .sort((a, b) => a.points - b.points);
  const weak = starters[0];
  const strong = starters[starters.length - 1];
  assert.ok(strong.points > weak.points);

  // Alpha buys the worse arm first, the better one later; Beta takes bats in
  // between so the turn comes back around.
  const bats = pool.filter((card) => card.kind === "hitter" && !card.replacement);
  const alphaTargets = [weak, strong];
  while (alphaTargets.length) {
    const current = currentManager(draft);
    pickPlayer(draft, current.id === alpha.id
      ? alphaTargets.shift().id
      : bats.find((card) => !draft.pickedIds.has(card.id)).id);
  }

  assert.equal(draft.complete, false, "this is mid-draft, nowhere near the sweep");
  assert.equal(alpha.staffAssignments.SP1, strong.id, "the better arm starts");
  assert.ok(activeRoster(alpha).some((card) => card.id === strong.id));
  assert.ok(benchPlayers(alpha).some((card) => card.id === weak.id), "the worse arm is benched");
  // The human in the room is seated by the same pick, for the same reason: he
  // has never arranged anything himself, so the draft arranges it for him.
  assert.ok(Object.keys(beta.lineupAssignments ?? {}).length > 0, "the human is seated too");
});

// A human manager who never opens his roster board gets Auto-sort on every
// pick — and the moment he arranges something himself, every later pick (and
// the completion sync) leaves his board exactly as he left it.
test("a human is auto-sorted on the pick until he arranges his own board", () => {
  // Everyone takes bats until the named manager has taken one, so the turn
  // comes back around to him without the room drafting anything exotic.
  const pickBatsUntil = (draft, who) => {
    while (!draft.complete) {
      const current = currentManager(draft);
      const card = availablePlayers(draft).find((item) => item.kind === "hitter" && !item.replacement);
      pickPlayer(draft, card.id);
      if (current.id === who.id) return card;
    }
    return null;
  };

  const pool = buildDraftPool("classic", "human-resort", { managerCount: 2 });
  const draft = createDraft(
    [{ name: "Hand" }, { name: "Alpha", cpu: true }],
    pool, 13, "human-resort", { startingPitchers: 1, timer: false }
  );
  const [human] = draft.managers;

  pickBatsUntil(draft, human);
  assert.ok(Object.keys(human.lineupAssignments ?? {}).length > 0, "his first bat is seated for him");

  // He arranges his own board: one bat moved to a spot he picked.
  const seated = assignLineupSlots(human.roster, human.lineupAssignments).slots.find((slot) => slot.player);
  const open = assignLineupSlots(human.roster, human.lineupAssignments).slots
    .find((slot) => !slot.player && canPlayerFillLineupSlot(seated.player, slot.label));
  applyDraftAction(draft, {
    type: "lineup",
    managerId: human.id,
    assignments: { [open.label]: seated.player.id }
  });
  assert.equal(human.teamChoicesByHand, true);

  const arranged = { ...human.lineupAssignments };
  assert.ok(pickBatsUntil(draft, human), "he picked again");
  assert.deepEqual(human.lineupAssignments, arranged, "his arrangement survives the next pick");

  // Through to the end of the draft, and through the completion sync.
  while (!draft.complete) {
    pickPlayer(draft, availablePlayers(draft).find((card) => canPickPlayer(draft, currentManager(draft), card).ok).id);
  }
  assert.equal(draft.complete, true);
  assert.deepEqual(human.lineupAssignments, arranged, "the buzzer does not re-seat a board he set himself");
  assert.equal(
    assignLineupSlots(human.roster, human.lineupAssignments).slots.find((slot) => slot.label === open.label).player.id,
    seated.player.id,
    "the bat he moved is still where he put him"
  );

  // Auto-sort hands it back: it is not an arrangement of his own.
  const { lineupAssignments } = pointMaximalAssignments(human, draft);
  applyDraftAction(draft, { type: "lineup", managerId: human.id, assignments: lineupAssignments, byHand: false });
  assert.equal(human.teamChoicesByHand, false);
});
