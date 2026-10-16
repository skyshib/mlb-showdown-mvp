import test from "node:test";
import assert from "node:assert/strict";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { createBatchState, runBatchChunk, simulateBatchGame, summarizeBatch } from "../src/rules/batch.js";
import { autopick, buildTeam, createDraft } from "../src/rules/draft.js";
import {
  CEREMONY_BEATS,
  countdownRows,
  dramaTarget,
  gameDrama,
  leagueLeaderBoard,
  leverageMoments,
  meetingIndices,
  meetingShape,
  pickRepresentative,
  readyForNextBeat,
  TEAM_OFFENSE_KEYS,
  TEAM_DEFENSE_KEYS,
  valuePicks,
  teamStatBoard,
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

test("the stat board runs three categories down each side", () => {
  const { summary } = season("ceremony-traits");
  const board = teamStatBoard(summary);
  assert.deepEqual(board.offense.map((plaque) => plaque.stat), TEAM_OFFENSE_KEYS);
  assert.deepEqual(board.defense.map((plaque) => plaque.stat), TEAM_DEFENSE_KEYS);
  const names = summary.teams.map((row) => row.team);
  for (const plaque of [...board.offense, ...board.defense]) {
    assert.ok(names.includes(plaque.team), `${plaque.key} named ${plaque.team}`);
    assert.match(plaque.value, /\d/);
  }
  // Every plaque has its own key, so a patch cannot write one into another.
  const keys = [...board.offense, ...board.defense].map((plaque) => plaque.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("the board picks the extreme on each side, not just somebody", () => {
  const { summary } = season("ceremony-runs");
  const board = teamStatBoard(summary);
  const totals = (team, lines) => lines.filter((line) => line.team === team);
  // Offence takes the highest team on-base; defence takes the lowest allowed.
  const obpFor = (team) => {
    const bats = totals(team, summary.hitters);
    const h = bats.reduce((sum, line) => sum + line.h, 0);
    const bb = bats.reduce((sum, line) => sum + line.bb, 0);
    const ab = bats.reduce((sum, line) => sum + line.ab, 0);
    return ab + bb ? (h + bb) / (ab + bb) : 0;
  };
  const obpAgainst = (team) => {
    const arms = totals(team, summary.pitchers);
    const h = arms.reduce((sum, line) => sum + line.h, 0);
    const bf = arms.reduce((sum, line) => sum + line.bf, 0);
    const bb = arms.reduce((sum, line) => sum + line.bb, 0);
    return bf ? (h + bb) / bf : 0;
  };
  const best = [...summary.teams].sort((a, b) => obpFor(b.team) - obpFor(a.team))[0];
  const stingiest = [...summary.teams].sort((a, b) => obpAgainst(a.team) - obpAgainst(b.team))[0];
  assert.equal(board.offense.find((plaque) => plaque.stat === "obp").team, best.team);
  assert.equal(board.defense.find((plaque) => plaque.stat === "obp").team, stingiest.team);
});

test("league leaders run three deep in every category", () => {
  const { summary } = season("ceremony-leaders");
  const board = leagueLeaderBoard(summary);
  assert.deepEqual(board.map((entry) => entry.key), ["ops", "obp", "hr", "sb", "era"]);
  const ids = new Set([...summary.hitters, ...summary.pitchers].map((line) => line.id));
  for (const category of board) {
    assert.equal(category.entries.length, 3);
    assert.deepEqual(category.entries.map((entry) => entry.rank), [1, 2, 3]);
    for (const entry of category.entries) {
      assert.ok(ids.has(entry.id), `${category.key} points at a drafted card`);
      assert.ok(entry.name && entry.team);
    }
  }
  // Ranked the right way round, including the two where less is better.
  const ops = board.find((entry) => entry.key === "ops");
  assert.ok(Number(`0${ops.entries[0].value}`) >= Number(`0${ops.entries[1].value}`));
  const era = board.find((entry) => entry.key === "era");
  assert.ok(Number(era.entries[0].value) <= Number(era.entries[1].value));
});

test("value picks run best and worst three of each kind", () => {
  const { summary } = season("ceremony-reckoning");
  const costs = {};
  [...summary.hitters, ...summary.pitchers].forEach((line, index) => { costs[line.id] = index + 1; });
  const board = valuePicks(summary, costs);
  for (const side of ["hitters", "pitchers"]) {
    assert.equal(board[side].best.length, 3);
    assert.equal(board[side].worst.length, 3);
    assert.deepEqual(board[side].best.map((entry) => entry.rank), [1, 2, 3]);
    for (const entry of [...board[side].best, ...board[side].worst]) {
      assert.match(entry.value, /^[+\u2212]\d/);
      assert.ok(Number.isFinite(entry.cost));
    }
    // Best beat its price by more than worst did, and the two ends are sorted
    // away from each other.
    assert.ok(board[side].best[0].surplus >= board[side].best[2].surplus);
    assert.ok(board[side].worst[0].surplus <= board[side].worst[2].surplus);
    assert.ok(board[side].best[0].surplus > board[side].worst[0].surplus);
  }
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

test("a game's shape is read off its line score", () => {
  // Away leads 1-0 after the first and never gives it back: nothing was ever
  // in doubt, and the lead never changed hands.
  assert.deepEqual(
    meetingShape({ away: [1, 0, 0, 0, 0, 0, 0, 0, 2], home: [] }),
    { inDoubtThrough: 0, leadChanges: 0 }
  );
  // Tied after eight, home wins it in the ninth.
  assert.deepEqual(
    meetingShape({ away: [3, 0, 0, 0, 0, 0, 0, 0], home: [0, 0, 3, 0, 0, 0, 0, 0, 1] }),
    { inDoubtThrough: 8, leadChanges: 1 }
  );
  // Back and forth into the eleventh — tied after nine and after ten, as extra
  // innings have to be — with the lead changing hands three times.
  assert.deepEqual(
    meetingShape({
      away: [2, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0],
      home: [0, 3, 0, 0, 0, 0, 0, 1, 0, 1, 2]
    }),
    { inDoubtThrough: 10, leadChanges: 3 }
  );
});

test("drama ranks a thriller over a laugher, and the series says which to aim at", () => {
  const thriller = { awayRuns: 4, homeRuns: 5, inDoubtThrough: 10, leadChanges: 3 };
  const late = { awayRuns: 4, homeRuns: 5, inDoubtThrough: 8, leadChanges: 1 };
  const laugher = { awayRuns: 1, homeRuns: 9, inDoubtThrough: 0, leadChanges: 0 };
  assert.ok(gameDrama(thriller) > gameDrama(late));
  assert.ok(gameDrama(late) > gameDrama(laugher));
  // A series split down the middle aims at the top of the ladder; one taken
  // 60-40 aims low; and the map between them never leaves those bounds.
  assert.ok(dramaTarget(0.501) > 0.85);
  assert.ok(dramaTarget(0.6) <= 0.3 + 1e-9);
  assert.ok(Math.abs(dramaTarget(0.75) - dramaTarget(0.6)) < 1e-9, "past 60-40 it is already as calm as it gets");
  assert.ok(dramaTarget(0.55) < dramaTarget(0.52));
});

test("an even series is replayed through its late games, a lopsided one through a comfortable win", () => {
  // Three kinds of win, in a series the champion also lost often enough for the
  // share to be the only thing that differs between the two cases below.
  const wins = [
    { index: 1, away: "Ana", home: "Bo", awayRuns: 9, homeRuns: 1, winner: "Ana", inDoubtThrough: 0, leadChanges: 0 },
    { index: 2, away: "Ana", home: "Bo", awayRuns: 5, homeRuns: 4, winner: "Ana", inDoubtThrough: 10, leadChanges: 3 },
    { index: 3, away: "Bo", home: "Ana", awayRuns: 2, homeRuns: 6, winner: "Ana", inDoubtThrough: 2, leadChanges: 1 }
  ];
  const loss = (index) => ({ index, away: "Ana", home: "Bo", awayRuns: 1, homeRuns: 4, winner: "Bo", inDoubtThrough: 0, leadChanges: 0 });

  // Split three and three: the extra-inning game.
  const even = pickRepresentative([...wins, loss(4), loss(5), loss(6)], "Ana");
  assert.equal(even.index, 2);
  assert.equal(even.share, 0.5);

  // The same three wins against one loss — three in four — and the room sees a
  // win that was never in doubt instead.
  const clear = pickRepresentative([...wins, loss(4)], "Ana");
  assert.equal(clear.share, 0.75);
  assert.notEqual(clear.index, 2);
  assert.ok(gameDrama(clear) < gameDrama(even));
});

test("the representative game is one the champion won, near their average score", () => {
  // Every win the same shape and the same margin, so drama cannot separate
  // them and typicality decides: Ana averages 4.5 for and 4.75 against across
  // all four, and game 2 is nearest.
  const meetings = [
    { index: 1, away: "Ana", home: "Bo", awayRuns: 9, homeRuns: 7, winner: "Ana", inDoubtThrough: 4, leadChanges: 1 },
    { index: 2, away: "Ana", home: "Bo", awayRuns: 5, homeRuns: 3, winner: "Ana", inDoubtThrough: 4, leadChanges: 1 },
    { index: 3, away: "Bo", home: "Ana", awayRuns: 2, homeRuns: 4, winner: "Ana", inDoubtThrough: 4, leadChanges: 1 },
    { index: 4, away: "Ana", home: "Bo", awayRuns: 0, homeRuns: 7, winner: "Bo", inDoubtThrough: 4, leadChanges: 1 }
  ];
  const pick = pickRepresentative(meetings, "Ana");
  assert.equal(pick.winner, "Ana");
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

test("leverage moments are duels, in order, capped around the ninth on", () => {
  const { teams } = season("ceremony-moments", { games: 200 });
  const game = simulateBatchGame(teams, "ceremony-moments", 7);
  const pitched = game.events
    .map((event, index) => ({ event, index }))
    .filter((entry) => Number.isFinite(entry.event.controlRoll));
  const last = pitched.reduce((high, entry) => Math.max(high, entry.event.inning ?? 0), 0);
  const from = Math.min(9, last);
  const closing = pitched.filter((entry) => (entry.event.inning ?? 0) >= from).map((entry) => entry.index);
  assert.ok(closing.length > 0, "the game ends on a plate appearance");

  const moments = leverageMoments(game, { floor: 0.1, cap: 4 });
  const kept = moments.map((moment) => moment.index);
  assert.deepEqual(closing.filter((index) => kept.includes(index)), closing, "the ninth on is kept whole");
  for (let i = 1; i < moments.length; i += 1) {
    assert.ok(moments[i].index > moments[i - 1].index, "kept in the order they happened");
  }
  const earlier = moments.filter((moment) => !closing.includes(moment.index));
  assert.ok(earlier.length <= 4, "the cap holds over everything before the last inning");
  for (const moment of moments) {
    assert.equal(typeof moment.event.controlRoll, "number", "every moment is a plate appearance");
  }
  for (const moment of earlier) assert.ok(moment.leverage >= 0.1);
  // A floor nothing clears leaves the close and invents nothing else.
  assert.deepEqual(leverageMoments(game, { floor: 99 }).map((moment) => moment.index), closing);
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
