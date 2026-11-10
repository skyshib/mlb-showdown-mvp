// The awards and the All-Star shelves are given for whatever the ROOM ranks on.
// An auction's zero is the free replacement card, because banking the money was
// a real option; a snake's is the average man at the position, because a pick
// cannot be declined. Both figures exist for every room — these cover that the
// handover works and that the two really do disagree.
import test from "node:test";
import assert from "node:assert/strict";
import { computeAwards, reachAwards } from "../src/rules/awards.js";
import { buildAllStarDepthChart, buildWpaaIndex } from "../src/rules/allStars.js";
import { buildDraftPool } from "../src/data/universes.js";
import { autopick, buildTeam, createDraft, repairDraftRosters, standingReplacements } from "../src/rules/draft.js";
import { simulateBatch } from "../src/rules/batch.js";

const SEED = "value-stat-room";

function room() {
  const pool = buildDraftPool("classic", SEED, { managerCount: 4 });
  const draft = createDraft(["A", "B", "C", "D"], pool, 13, SEED);
  let guard = 20000;
  while (!draft.complete && guard-- > 0) autopick(draft);
  repairDraftRosters(draft);
  const replacements = standingReplacements(draft);
  const teams = draft.managers.map((manager) => ({ ...buildTeam(manager, { optimize: true }), replacements }));
  const summary = simulateBatch(teams, { runs: 120, seed: `${SEED}-season` });
  return { teams, summary, wpaa: buildWpaaIndex(teams, summary) };
}

const ROOM = room();
const MEASURE = {
  value: (line) => ROOM.wpaa.wpaaFor(line),
  valueLabel: "WPAA",
  baseline: "the average man at his position"
};

test("the sim measured both zeros, and they are not the same number", () => {
  assert.ok(ROOM.summary.attribution, "the room has to have measured WPAR at all");
  assert.ok(ROOM.wpaa, "and the positional averages have to exist");
  const differing = ROOM.summary.hitters.filter((line) => {
    const wpaa = ROOM.wpaa.wpaaFor(line);
    return Number.isFinite(wpaa) && Math.abs(wpaa - (line.warPer162?.total ?? 0)) > 0.01;
  });
  assert.ok(differing.length > 0, "WPAA that equalled WPAR everywhere would make this switch a no-op");
});

test("left alone, the awards still go on WPAR", () => {
  const awards = computeAwards(ROOM.summary);
  const mvp = awards.find((entry) => entry.key === "mvp-hitter");
  assert.ok(mvp, "a measured room gives a hitter MVP");
  assert.match(mvp.stat, /WPAR per 162 games/);
  assert.match(mvp.note, /over the room's replacement card/);
});

test("handed a measure, every value award is given for it instead", () => {
  const awards = computeAwards(ROOM.summary, null, null, MEASURE);
  const mvp = awards.find((entry) => entry.key === "mvp-hitter");
  assert.match(mvp.stat, /WPAA per 162 games/);
  assert.match(mvp.note, /over the average man at his position/);

  // The headline figure has to be the WPAA of the man it names, not his WPAR.
  const line = ROOM.summary.hitters.find((entry) => entry.id === mvp.id);
  const wpaa = ROOM.wpaa.wpaaFor(line);
  assert.match(mvp.stat, new RegExp(`${Math.abs(wpaa).toFixed(1)}`));

  // And the MVP is the best bat BY THAT MEASURE, which is the whole point.
  const best = ROOM.summary.hitters
    .filter((entry) => Number.isFinite(ROOM.wpaa.wpaaFor(entry)))
    .sort((a, b) => ROOM.wpaa.wpaaFor(b) - ROOM.wpaa.wpaaFor(a))[0];
  assert.equal(mvp.id, best.id);

  // The Cy Young is the same award read the same way.
  const cy = awards.find((entry) => entry.key === "cy-young");
  if (cy) assert.match(cy.stat, /WPAA/);
});

test("the steal and bust awards name the measure they ranked on", () => {
  const picks = Object.fromEntries(ROOM.summary.hitters.map((line, index) => [line.id, index + 1]));
  const awards = computeAwards(ROOM.summary, picks, null, MEASURE);
  const ranked = awards.filter((entry) => /^(steal|bust)-/.test(entry.key));
  assert.ok(ranked.length > 0, "a room this size should hand out at least one steal or bust");
  for (const entry of ranked) {
    assert.match(entry.stat, /in WPAA$/, `${entry.key} still names the wrong measure`);
  }
});

test("a reach's gap is the same number either way, and only the unit changes", () => {
  const rows = [{
    id: "x", name: "Reached", managerName: "A", slot: "SS", gap: 2.5, waited: 3,
    best: { name: "Passed over", order: 11, price: 40 }
  }];
  const [wpar] = reachAwards(rows);
  const [wpaa] = reachAwards(rows, { valueLabel: "WPAA" });
  assert.match(wpar.stat, /WPAR\/162 left at SS/);
  assert.match(wpaa.stat, /WPAA\/162 left at SS/);
  // Both read the same gap: a slot's average cancels out of a difference taken
  // WITHIN that slot.
  assert.equal(wpar.stat.replace("WPAR", ""), wpaa.stat.replace("WPAA", ""));
});

test("recentring cannot reorder an All-Star shelf, so the shelves are not re-ranked", () => {
  // WPAA is WPAR less ONE average per position, and a shelf holds exactly one
  // position, so the same constant comes off every candidate on it. The order is
  // therefore identical — which is why buildAllStarDepthChart takes no measure.
  // This is the invariant that makes that safe; if it ever breaks, the shelves
  // need the room's stat passed in after all.
  const chart = buildAllStarDepthChart(ROOM.teams, ROOM.summary);
  for (const slot of chart) {
    if (!slot.leader || slot.depth.length < 2) continue;
    const wpaa = slot.depth.map((candidate) => ROOM.wpaa.wpaaByPlayerId.get(candidate.id));
    // Every candidate on the shelf is measured against the same average, so the
    // WPAR order already is the WPAA order.
    const sorted = [...wpaa].sort((a, b) => b - a);
    assert.deepEqual(wpaa, sorted, `${slot.position} is ordered differently by WPAA than by WPAR`);
  }
});

test("an award ranked ACROSS positions does move, which is where the switch earns its keep", () => {
  // The MVP is picked from every bat in the room, so the per-position constants
  // no longer cancel: a catcher beating catchers can outrank a DH who merely
  // beat the floor by more.
  const byWpar = computeAwards(ROOM.summary).find((entry) => entry.key === "mvp-hitter");
  const byWpaa = computeAwards(ROOM.summary, null, null, MEASURE).find((entry) => entry.key === "mvp-hitter");
  const order = (value) => ROOM.summary.hitters
    .filter((line) => Number.isFinite(value(line)))
    .sort((a, b) => value(b) - value(a))
    .map((line) => line.id);
  assert.notDeepEqual(
    order((line) => ROOM.wpaa.wpaaFor(line)),
    order((line) => line.warPer162?.total),
    "the two measures order the room's bats identically, so nothing here is being tested"
  );
  assert.ok(byWpar.id && byWpaa.id);
});
