import test from "node:test";
import assert from "node:assert/strict";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { createBatchState, runBatchChunk, simulateBatchGame, summarizeBatch } from "../src/rules/batch.js";
import { autopick, buildTeam, createDraft } from "../src/rules/draft.js";
import {
  CEREMONY_BEATS,
  countdownRows,
  leagueLeaders,
  leverageMoments,
  meetingIndices,
  pickRepresentative,
  readyForNextBeat,
  reckoning,
  traitLeaders,
  winProbabilitySeries
} from "../src/rules/ceremony.js";

function season(seed, { teamCount = 4, games = 1200 } = {}) {
  const managers = Array.from({ length: teamCount }, (_, i) => `Team ${i + 1}`);
  const pool = generatePlayerPool(`${seed}-pool`, teamCount * 2, 13);
  const draft = createDraft(managers, pool, 13);
  while (!draft.complete) autopick(draft);
  const teams = draft.managers.map((manager) => buildTeam(manager, { optimize: true }));
  const state = createBatchState(teams);
  let done = 0;
  while (done < games) {
    const size = Math.min(200, games - done);
    runBatchChunk(state, teams, seed, done, size);
    done += size;
  }
  return { teams, summary: summarizeBatch(state), games };
}

test("the gates rise, and nothing opens before its gate", () => {
  const gates = CEREMONY_BEATS.map((beat) => beat.gate);
  for (let i = 1; i < gates.length; i += 1) {
    assert.ok(gates[i] >= gates[i - 1], `gate ${i} (${gates[i]}) must not precede ${gates[i - 1]}`);
  }
  assert.equal(CEREMONY_BEATS[CEREMONY_BEATS.length - 1].gate, 1);
  // The standings wait for the last game however long the beat before has held.
  const countdown = CEREMONY_BEATS.findIndex((beat) => beat.key === "countdown");
  assert.equal(readyForNextBeat(countdown - 1, { progress: 0.99, heldMs: 60000 }), false);
  assert.equal(readyForNextBeat(countdown - 1, { progress: 1, heldMs: 60000 }), true);
});

test("a beat is never flashed past, and never stalls once its gate is met", () => {
  const first = CEREMONY_BEATS[0];
  assert.equal(readyForNextBeat(0, { progress: 1, heldMs: first.min - 1 }), false);
  assert.equal(readyForNextBeat(0, { progress: 1, heldMs: first.min + 1 }), true);
  // Skipping goes straight through whatever is on screen.
  assert.equal(readyForNextBeat(0, { progress: 0, heldMs: 0, skipping: true }), true);
});

test("trait plaques name a manager for every category", () => {
  const { summary } = season("ceremony-traits");
  const traits = traitLeaders(summary);
  assert.equal(traits.length, 6);
  const names = summary.teams.map((row) => row.team);
  for (const trait of traits) {
    assert.ok(names.includes(trait.team), `${trait.key} named ${trait.team}`);
    assert.match(trait.value, /\d/);
    assert.ok(trait.label.length > 2);
  }
  assert.deepEqual(traits.map((trait) => trait.key), ["rs", "ra", "hr", "sb", "bsr", "def"]);
});

test("the runs plaques pick the extremes, not just somebody", () => {
  const { summary } = season("ceremony-runs");
  const traits = traitLeaders(summary);
  const scored = traits.find((trait) => trait.key === "rs");
  const allowed = traits.find((trait) => trait.key === "ra");
  const most = [...summary.teams].sort((a, b) => b.runsFor.mean - a.runsFor.mean)[0];
  const fewest = [...summary.teams].sort((a, b) => a.runsAgainst.mean - b.runsAgainst.mean)[0];
  assert.equal(scored.team, most.team);
  assert.equal(allowed.team, fewest.team);
});

test("league leaders are real cards with real numbers", () => {
  const { summary } = season("ceremony-leaders");
  const leaders = leagueLeaders(summary);
  assert.deepEqual(leaders.map((entry) => entry.key), ["hr", "obp", "sb", "era"]);
  const ids = new Set([...summary.hitters, ...summary.pitchers].map((line) => line.id));
  for (const leader of leaders) {
    assert.ok(ids.has(leader.id), `${leader.key} points at a drafted card`);
    assert.ok(leader.name);
  }
  // The on-base leader really is the best on-base among those who qualified.
  const obp = leaders.find((entry) => entry.key === "obp");
  const topObp = Math.max(...summary.hitters.map((line) => line.obp ?? 0));
  assert.ok(Math.abs(Number(`0${obp.value}`) - topObp) < 0.06);
});

test("the reckoning ranks three of each and marks the bargains", () => {
  const { summary } = season("ceremony-reckoning");
  const costs = {};
  [...summary.hitters, ...summary.pitchers].forEach((line, index) => { costs[line.id] = index + 1; });
  const board = reckoning(summary, costs);
  assert.equal(board.hitters.length, 3);
  assert.equal(board.pitchers.length, 3);
  assert.deepEqual(board.hitters.map((entry) => entry.rank), [1, 2, 3]);
  for (const entry of [...board.hitters, ...board.pitchers]) {
    assert.match(entry.value, /^[+−]\d/);
    assert.ok(entry.cost !== null);
  }
  // Ranked by value: each one is worth at least as much as the next.
  const value = summary.attribution
    ? (id) => summary.hitters.find((line) => line.id === id)?.warPer162.total
    : (id) => summary.hitters.find((line) => line.id === id)?.wpaPerSeason;
  assert.ok(value(board.hitters[0].id) >= value(board.hitters[1].id));
});

test("the countdown stops at third and holds the last two back", () => {
  const { summary } = season("ceremony-countdown");
  const { counted, finalists, all } = countdownRows(summary);
  assert.equal(counted.length + finalists.length, all.length);
  assert.equal(finalists.length, 2);
  // Counted rows run from last place upward, and stop before second.
  assert.equal(counted[0].team, all[all.length - 1].team);
  assert.equal(counted[counted.length - 1].team, all[2].team);
  assert.ok(!counted.some((row) => finalists.includes(row)), "a finalist is never counted down");
  assert.ok(finalists[0].winPct >= finalists[1].winPct);
});

test("meeting indices are exactly the games the two clubs played", () => {
  const { teams, games } = season("ceremony-meetings", { games: 400 });
  const [a, b] = teams.map((team) => team.name);
  const indices = meetingIndices(teams, games, a, b);
  assert.ok(indices.length > 0);
  for (const index of indices.slice(0, 12)) {
    const game = simulateBatchGame(teams, "ceremony-meetings", index + 1);
    const pair = [game.away.name ?? game.away, game.home.name ?? game.home].map(String);
    assert.ok(pair.includes(a) && pair.includes(b), `game ${index} is ${pair.join(" at ")}`);
  }
  // Every other index belongs to somebody else.
  const outsider = [...Array(40).keys()].filter((index) => !indices.includes(index))[0];
  const other = simulateBatchGame(teams, "ceremony-meetings", outsider + 1);
  const otherPair = [other.away.name ?? other.away, other.home.name ?? other.home].map(String);
  assert.ok(!(otherPair.includes(a) && otherPair.includes(b)));
});

test("the representative game is one the champion won, near their average score", () => {
  const meetings = [
    { index: 1, away: "Ana", home: "Bo", awayRuns: 9, homeRuns: 1, winner: "Ana" },
    { index: 2, away: "Ana", home: "Bo", awayRuns: 5, homeRuns: 3, winner: "Ana" },
    { index: 3, away: "Bo", home: "Ana", awayRuns: 2, homeRuns: 6, winner: "Ana" },
    { index: 4, away: "Ana", home: "Bo", awayRuns: 0, homeRuns: 7, winner: "Bo" }
  ];
  const pick = pickRepresentative(meetings, "Ana");
  assert.equal(pick.winner, "Ana");
  // Ana averages 5 for and 3.25 against across all four; game 2 is nearest.
  assert.equal(pick.index, 2);
  assert.equal(pick.meetings, 4);
  assert.equal(pick.won, 3);
});

test("a champion who lost every meeting still gets a game", () => {
  const meetings = [
    { index: 1, away: "Ana", home: "Bo", awayRuns: 1, homeRuns: 4, winner: "Bo" },
    { index: 2, away: "Ana", home: "Bo", awayRuns: 2, homeRuns: 3, winner: "Bo" }
  ];
  const pick = pickRepresentative(meetings, "Ana");
  assert.ok(pick, "falls back to their meetings rather than showing nothing");
  assert.equal(pick.won, 0);
});

test("leverage moments are duels, in order, capped", () => {
  const { teams } = season("ceremony-moments", { games: 200 });
  const game = simulateBatchGame(teams, "ceremony-moments", 7);
  const moments = leverageMoments(game, { floor: 0.1, cap: 4 });
  assert.ok(moments.length <= 4);
  for (let i = 1; i < moments.length; i += 1) {
    assert.ok(moments[i].index > moments[i - 1].index, "kept in the order they happened");
  }
  for (const moment of moments) {
    assert.equal(typeof moment.event.controlRoll, "number", "every moment is a plate appearance");
    assert.ok(moment.leverage >= 0.1);
  }
  // A floor nothing clears shows nothing rather than inventing a moment.
  assert.deepEqual(leverageMoments(game, { floor: 99 }), []);
});

test("the win probability line is read from the champion's side", () => {
  const { teams } = season("ceremony-wp", { games: 200 });
  const game = simulateBatchGame(teams, "ceremony-wp", 5);
  const home = winProbabilitySeries(game, "home");
  const away = winProbabilitySeries(game, "away");
  assert.equal(home[0].wp, 50);
  assert.equal(home.length, away.length);
  for (let i = 1; i < home.length; i += 1) {
    assert.ok(Math.abs(home[i].wp + away[i].wp - 100) < 1e-6, "the two sides are complements");
  }
  // It ends where the game ended.
  const last = home[home.length - 1].wp;
  assert.ok(last > 99 || last < 1, `the line finishes decided, got ${last}`);
});
