import test from "node:test";
import assert from "node:assert/strict";
import { computeAwards } from "../src/rules/awards.js";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { simulateBatch } from "../src/rules/batch.js";
import { autopick, buildTeam, createDraft } from "../src/rules/draft.js";

function hitter(overrides) {
  return {
    id: overrides.id,
    name: overrides.name,
    team: overrides.team ?? "Team 1",
    position: "CF",
    pa: 600, ab: 520, h: 150, d: 30, t: 3, bb: 60, so: 100, hr: 20, rbi: 80,
    r: 70, sb: 10, cs: 3, gidp: 8,
    avg: 0.288, obp: 0.35, slg: 0.45, ops: 0.8,
    hrPerSeason: 0.5, rbiPerSeason: 2, runsPerSeason: 1.75, sbPerSeason: 0.25,
    gidpPerSeason: 0.2, wpaPerSeason: 0.02, wpa: 0.8,
    ...overrides
  };
}

function pitcher(overrides) {
  return {
    id: overrides.id,
    name: overrides.name,
    team: overrides.team ?? "Team 1",
    role: "SP",
    bf: 900, outs: 600, h: 180, bb: 60, so: 170, hr: 20, r: 90,
    inningsPerSeason: 5, runsPerNine: 4.05, strikeoutsPerNine: 7.6, walksPerNine: 2.7,
    wpaPerSeason: 0.01, wpa: 0.4,
    ...overrides
  };
}

const SUMMARY = {
  runs: 40,
  teams: [{ team: "Team 1" }, { team: "Team 2" }],
  hitters: [
    hitter({ id: "h1", name: "Obi Onbase", obp: 0.44, wpaPerSeason: 0.05 }),
    hitter({ id: "h2", name: "Homer Launch", hr: 48, hrPerSeason: 1.2, wpaPerSeason: 0.08 }),
    hitter({ id: "h3", name: "Flash Speed", sb: 44, sbPerSeason: 1.1, cs: 6 }),
    hitter({ id: "h4", name: "Ronnie Rounds", r: 120, runsPerSeason: 3 }),
    hitter({ id: "h5", name: "Dee Pee", gidp: 30, gidpPerSeason: 0.75, wpaPerSeason: -0.04 })
  ],
  pitchers: [
    pitcher({ id: "p1", name: "Ace Steady", runsPerNine: 2.4, outs: 1400, wpaPerSeason: 0.09 }),
    pitcher({ id: "p2", name: "Mid Rotation", runsPerNine: 4.8, outs: 1300 }),
    pitcher({ id: "p3", name: "Door Slammer", role: "RP", runsPerNine: 1.9, outs: 300 }),
    pitcher({ id: "p4", name: "Gas Can", role: "RP", runsPerNine: 6.5, outs: 280, wpaPerSeason: -0.06 })
  ],
  topSwing: {
    playerId: "h2", name: "Homer Launch", wpa: 0.61, result: "HR",
    inning: 9, half: "bottom", game: 17, matchup: "Team 2 at Team 1"
  }
};

const PICKS = { h1: 9, h2: 2, h3: 12, h4: 20, h5: 1, p1: 3, p2: 6, p3: 15, p4: 4 };

test("computeAwards crowns the right winners", () => {
  const awards = computeAwards(SUMMARY, PICKS);
  const byKey = Object.fromEntries(awards.map((item) => [item.key, item]));

  assert.equal(byKey.mvp.name, "Ace Steady", "MVP is the highest WPA producer");
  assert.equal(byKey["cy-young"].name, "Ace Steady");
  assert.equal(byKey.fireman.name, "Door Slammer");
  assert.equal(byKey.obp.name, "Obi Onbase");
  assert.equal(byKey.hr.name, "Homer Launch");
  assert.equal(byKey.sb.name, "Flash Speed");
  assert.equal(byKey.runs.name, "Ronnie Rounds");
  assert.equal(byKey.gidp.name, "Dee Pee");
  assert.equal(byKey.swing.name, "Homer Launch");
  assert.match(byKey.swing.note, /Bottom 9th/);

  assert.ok(byKey.steal, "value pick award exists");
  assert.ok(byKey.bust, "bust award exists");
  assert.equal(byKey.bust.name, "Dee Pee", "top-3-round pick with the worst WPA rank");
});

test("an auction is judged on what a card cost, not on when it came up", () => {
  // Dee Pee is the room's most expensive card and its worst producer; Ronnie
  // Rounds went for nothing and produced. The pick numbers say the opposite —
  // Dee Pee was pick 1 and Ronnie pick 20 — so the prices must be what count.
  const prices = { h1: 300, h2: 250, h3: 120, h4: 5, h5: 900, p1: 400, p2: 200, p3: 60, p4: 500 };
  const awards = computeAwards(SUMMARY, PICKS, prices);
  const byKey = Object.fromEntries(awards.map((item) => [item.key, item]));

  assert.equal(byKey.bust.name, "Dee Pee");
  assert.equal(byKey.bust.label, "Bust of the auction");
  assert.match(byKey.bust.stat, /^Paid 900,/);

  assert.equal(byKey.steal.name, "Ronnie Rounds");
  assert.equal(byKey.steal.label, "Bargain of the auction");
  assert.match(byKey.steal.stat, /^Paid 5,/);
});

test("computeAwards degrades gracefully without pick numbers or WPA stats", () => {
  const noPicks = computeAwards(SUMMARY, null);
  assert.ok(noPicks.length > 0);
  assert.ok(!noPicks.some((item) => item.key === "steal" || item.key === "bust"));

  const legacy = {
    ...SUMMARY,
    hitters: SUMMARY.hitters.map(({ wpaPerSeason, ...rest }) => rest)
  };
  assert.deepEqual(computeAwards(legacy, PICKS), []);
});

test("a real batch summary feeds the full awards show", () => {
  const managers = ["Team 1", "Team 2", "Team 3", "Team 4"];
  const pool = generatePlayerPool("awards-end-to-end-pool", 8, 13);
  const draft = createDraft(managers, pool, 13, "awards-end-to-end");
  while (!draft.complete) autopick(draft);
  const teams = draft.managers.map((manager) => buildTeam(manager));

  const summary = simulateBatch(teams, { seed: "awards-end-to-end", runs: 12 });
  assert.ok(summary.topSwing, "batch tracks a top swing");
  assert.ok(summary.hitters.every((line) => Number.isFinite(line.wpaPerSeason)));
  assert.ok(summary.pitchers.every((line) => Number.isFinite(line.wpaPerSeason)));

  const picks = {};
  let pickNumber = 0;
  const rosterIndexes = new Map();
  const teamCount = draft.managers.length;
  for (let pick = 0; pick < teamCount * 13; pick += 1) {
    const round = Math.floor(pick / teamCount);
    const indexInRound = pick % teamCount;
    const managerIndex = round % 2 === 0 ? indexInRound : teamCount - 1 - indexInRound;
    const manager = draft.managers[managerIndex];
    const rosterIndex = rosterIndexes.get(manager.id) ?? 0;
    rosterIndexes.set(manager.id, rosterIndex + 1);
    const player = manager.roster[rosterIndex];
    if (player) picks[player.id] = (pickNumber += 1);
  }

  const awards = computeAwards(summary, picks);
  const keys = new Set(awards.map((item) => item.key));
  for (const expected of ["mvp", "cy-young", "fireman", "obp", "hr", "runs", "swing"]) {
    assert.ok(keys.has(expected), `award ${expected} present`);
  }
  for (const item of awards) {
    assert.ok(item.name, `${item.key} has a winner`);
    assert.ok(item.stat, `${item.key} has a stat line`);
  }
});
