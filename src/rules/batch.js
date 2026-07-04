import { distribution, rate } from "./stats.js";
import { simulateRoundRobin } from "./tournament.js?v=20260704-player-rate-stats";

export const DEFAULT_BATCH_RUNS = 1000;
export const MAX_BATCH_RUNS = 20000;

export function normalizeBatchRuns(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 1) return DEFAULT_BATCH_RUNS;
  return Math.min(number, MAX_BATCH_RUNS);
}

export function simulateBatch(teams, options = {}) {
  const runs = normalizeBatchRuns(options.runs ?? DEFAULT_BATCH_RUNS);
  const seed = String(options.seed ?? "batch");
  const state = createBatchState(teams);
  runBatchChunk(state, teams, seed, 0, runs);
  return summarizeBatch(state);
}

export function createBatchState(teams) {
  const state = {
    runs: 0,
    teams: new Map(),
    hitters: new Map(),
    pitchers: new Map()
  };

  for (const team of teams) {
    state.teams.set(team.name, {
      team: team.name,
      titles: 0,
      finalsAppearances: 0,
      wins: [],
      losses: [],
      runsFor: [],
      runsAgainst: []
    });
    for (const player of team.lineup ?? []) {
      registerHitter(state, team.name, player);
    }
    for (const player of [...(team.starters ?? []), ...(team.bullpen ?? [])]) {
      registerPitcher(state, team.name, player);
    }
  }

  return state;
}

export function runBatchChunk(state, teams, seed, startIndex, count) {
  for (let index = startIndex; index < startIndex + count; index += 1) {
    const result = simulateRoundRobin(teams, `${seed}-season-${index + 1}`);
    foldTournament(state, result);
  }
  return state;
}

export function batchProgressSnapshot(state) {
  return {
    runs: state.runs,
    rows: [...state.teams.values()].map((row) => ({
      team: row.team,
      titles: row.titles,
      share: rate(row.titles, state.runs)
    }))
  };
}

export function summarizeBatch(state) {
  const teams = [...state.teams.values()]
    .map((row) => ({
      team: row.team,
      titleShare: rate(row.titles, state.runs),
      finalsShare: rate(row.finalsAppearances, state.runs),
      wins: distribution(row.wins),
      losses: distribution(row.losses),
      runsFor: distribution(row.runsFor),
      runsAgainst: distribution(row.runsAgainst)
    }))
    .sort((a, b) => b.titleShare - a.titleShare || b.wins.mean - a.wins.mean);

  const hitters = [...state.hitters.values()]
    .map((line) => {
      const singles = line.h - line.d - line.t - line.hr;
      const totalBases = singles + line.d * 2 + line.t * 3 + line.hr * 4;
      const obp = rate(line.h + line.bb, line.pa);
      const slg = rate(totalBases, line.ab);
      return {
        ...line,
        avg: rate(line.h, line.ab),
        obp,
        slg,
        ops: obp + slg,
        hrPerSeason: rate(line.hr, state.runs),
        rbiPerSeason: rate(line.rbi, state.runs)
      };
    })
    .sort((a, b) => b.ops - a.ops || b.pa - a.pa);

  const pitchers = [...state.pitchers.values()]
    .map((line) => ({
      ...line,
      inningsPerSeason: rate(line.outs, state.runs * 3),
      runsPerNine: rate(line.r * 27, line.outs),
      strikeoutsPerNine: rate(line.so * 27, line.outs),
      walksPerNine: rate(line.bb * 27, line.outs)
    }))
    .sort((a, b) => (a.outs === 0) - (b.outs === 0) || a.runsPerNine - b.runsPerNine || b.outs - a.outs);

  return {
    runs: state.runs,
    teams,
    hitters,
    pitchers
  };
}

function foldTournament(state, result) {
  state.runs += 1;

  const champion = result.final?.winner ?? result.standings[0]?.team;
  const championRow = state.teams.get(champion);
  if (championRow) championRow.titles += 1;

  if (result.final) {
    for (const name of [result.final.away.name, result.final.home.name]) {
      const row = state.teams.get(name);
      if (row) row.finalsAppearances += 1;
    }
  }

  for (const standing of result.standings) {
    const row = state.teams.get(standing.team);
    if (!row) continue;
    row.wins.push(standing.wins);
    row.losses.push(standing.losses);
    row.runsFor.push(standing.runsFor);
    row.runsAgainst.push(standing.runsAgainst);
  }

  const games = result.final ? [...result.games, result.final] : result.games;
  for (const game of games) {
    foldBoxScore(state, game.boxScore?.away);
    foldBoxScore(state, game.boxScore?.home);
  }
}

function foldBoxScore(state, teamBox) {
  if (!teamBox) return;
  for (const line of teamBox.hitters) {
    const row = state.hitters.get(line.id);
    if (!row) continue;
    row.pa += line.pa;
    row.ab += line.ab;
    row.h += line.h;
    row.d += line.d ?? 0;
    row.t += line.t ?? 0;
    row.r += line.r ?? 0;
    row.bb += line.bb;
    row.so += line.so;
    row.hr += line.hr;
    row.sb += line.sb ?? 0;
    row.cs += line.cs ?? 0;
    row.rbi += line.rbi;
  }
  for (const line of teamBox.pitchers) {
    const row = state.pitchers.get(line.id);
    if (!row) continue;
    row.bf += line.bf;
    row.outs += line.outs;
    row.h += line.h;
    row.bb += line.bb;
    row.so += line.so;
    row.hr += line.hr;
    row.r += line.r;
  }
}

function registerHitter(state, teamName, player) {
  if (!player || state.hitters.has(player.id)) return;
  state.hitters.set(player.id, {
    id: player.id,
    name: player.name,
    team: teamName,
    position: player.cardPosition ?? player.position,
    pa: 0,
    ab: 0,
    h: 0,
    d: 0,
    t: 0,
    r: 0,
    bb: 0,
    so: 0,
    hr: 0,
    sb: 0,
    cs: 0,
    rbi: 0
  });
}

function registerPitcher(state, teamName, player) {
  if (!player || state.pitchers.has(player.id)) return;
  state.pitchers.set(player.id, {
    id: player.id,
    name: player.name,
    team: teamName,
    role: player.role === "SP" ? "SP" : "RP",
    bf: 0,
    outs: 0,
    h: 0,
    bb: 0,
    so: 0,
    hr: 0,
    r: 0
  });
}
