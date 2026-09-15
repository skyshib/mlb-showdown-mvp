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

  assert.equal(byKey["mvp-hitter"].name, "Homer Launch", "hitter MVP is the highest WPA hitter");
  assert.equal(byKey["mvp-pitcher"].name, "Ace Steady", "pitcher MVP is the highest WPA pitcher");
  assert.equal(byKey.mvp, undefined, "there is no combined MVP");
  assert.equal(byKey["cy-young"].name, "Ace Steady");
  assert.equal(byKey.fireman.name, "Door Slammer");
  assert.equal(byKey.obp.name, "Obi Onbase");
  assert.equal(byKey.hr.name, "Homer Launch");
  assert.equal(byKey.sb.name, "Flash Speed");
  assert.equal(byKey.runs.name, "Ronnie Rounds");
  assert.equal(byKey.gidp.name, "Dee Pee");
  assert.equal(byKey.swing.name, "Homer Launch");
  assert.match(byKey.swing.note, /Bottom 9th/);

  // Picks rank within each field: Mid Rotation was the third pitcher taken and
  // the second-best pitcher; Gas Can the second pitcher taken and the worst.
  assert.equal(byKey["steal-pitcher"].name, "Mid Rotation");
  assert.equal(byKey["steal-pitcher"].stat, "Pick #6, #2 of pitchers in WPA");
  assert.equal(byKey["bust-hitter"].name, "Dee Pee", "top-3-round hitter with the worst WPA rank among hitters");
  assert.equal(byKey["bust-hitter"].label, "Bust of the draft (hitter)");
  assert.equal(byKey["bust-pitcher"].name, "Gas Can");
});

test("an auction is judged on what a card cost, not on when it came up", () => {
  // Ace Steady was the first pitcher picked, so by pick he beat nobody's cost and
  // Mid Rotation is the steal. In the auction Gas Can went for more, so the best
  // pitcher was only the second-dearest — the prices must be what count.
  const prices = { h1: 300, h2: 250, h3: 120, h4: 5, h5: 900, p1: 400, p2: 200, p3: 60, p4: 500 };
  const awards = computeAwards(SUMMARY, PICKS, prices);
  const byKey = Object.fromEntries(awards.map((item) => [item.key, item]));

  assert.equal(byKey["bust-hitter"].name, "Dee Pee");
  assert.equal(byKey["bust-hitter"].label, "Bust of the auction (hitter)");
  assert.match(byKey["bust-hitter"].stat, /^Paid 900,/);

  assert.equal(byKey["steal-pitcher"].name, "Ace Steady");
  assert.equal(byKey["steal-pitcher"].label, "Bargain of the auction (pitcher)");
  assert.equal(byKey["steal-pitcher"].stat, "Paid 400, #1 of pitchers in WPA");
});

test("a sim that measured WPAR ranks MVP and value awards on it, not WPA", () => {
  // Ace Steady leads in WPA; Ronnie Rounds leads in WPAR and went for $5.
  const wpar = { h1: 1.1, h2: 2.0, h3: 0.4, h4: 6.2, h5: -1.5, p1: 3.0, p2: 0.8, p3: 0.5, p4: -0.9 };
  const summary = {
    ...SUMMARY,
    attribution: true,
    hitters: SUMMARY.hitters.map((line) => ({ ...line, wpaPer162: line.wpaPerSeason * 162, warPer162: { total: wpar[line.id] } })),
    pitchers: SUMMARY.pitchers.map((line) => ({ ...line, wpaPer162: line.wpaPerSeason * 162, warPer162: { total: wpar[line.id] } }))
  };
  const prices = { h1: 300, h2: 250, h3: 120, h4: 5, h5: 900, p1: 400, p2: 200, p3: 60, p4: 500 };
  const byKey = Object.fromEntries(computeAwards(summary, PICKS, prices).map((item) => [item.key, item]));

  assert.equal(byKey["mvp-hitter"].name, "Ronnie Rounds");
  assert.equal(byKey["mvp-hitter"].stat, "+6.2 WPAR per 162 games");
  assert.match(byKey["mvp-hitter"].note, /\+3\.24 WPA\.$/, "the MVP card still carries WPA");
  assert.equal(byKey["mvp-pitcher"].name, "Ace Steady");
  assert.equal(byKey["steal-hitter"].name, "Ronnie Rounds");
  assert.equal(byKey["steal-hitter"].stat, "Paid 5, #1 of hitters in WPAR");
  assert.equal(byKey["bust-hitter"].name, "Dee Pee");
  assert.match(byKey["bust-hitter"].stat, /of hitters in WPAR$/);
});

test("computeAwards degrades gracefully without pick numbers or WPA stats", () => {
  const noPicks = computeAwards(SUMMARY, null);
  assert.ok(noPicks.length > 0);
  assert.ok(!noPicks.some((item) => /^(steal|bust)-/.test(item.key)));

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
  for (const expected of ["mvp-hitter", "mvp-pitcher", "cy-young", "fireman", "obp", "hr", "runs", "swing"]) {
    assert.ok(keys.has(expected), `award ${expected} present`);
  }
  for (const item of awards) {
    assert.ok(item.name, `${item.key} has a winner`);
    assert.ok(item.stat, `${item.key} has a stat line`);
  }
});
