import { distribution, rate } from "./stats.js";
import { aggregateEventSkillStats, createTeamSkillLine } from "./teamSkillStats.js?v=20260705-batch-team-skills";
import { simulateGame } from "./game.js?v=20260705-awards-show";

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
    pitchers: new Map(),
    topSwing: null,
    rotation: createRotationTracker(teams)
  };

  for (const team of teams) {
    state.teams.set(team.name, {
      ...createTeamSkillLine(team.name),
      games: 0,
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
  const schedule = createSchedule(teams);
  if (!schedule.length) return state;
  for (let index = startIndex; index < startIndex + count; index += 1) {
    const matchup = schedule[index % schedule.length];
    const result = simulateGame(
      teamForGame(matchup.away, state.rotation),
      teamForGame(matchup.home, state.rotation),
      `${seed}-game-${index + 1}-${matchup.away.name}-${matchup.home.name}`
    );
    foldGame(state, result);
  }
  return state;
}

export function batchProgressSnapshot(state) {
  return {
    runs: state.runs,
    rows: [...state.teams.values()].map((row) => ({
      team: row.team,
      wins: formatDistributionTotal(row.wins),
      losses: formatDistributionTotal(row.losses),
      games: row.games,
      share: rate(formatDistributionTotal(row.wins), row.games)
    }))
  };
}

export function summarizeBatch(state) {
  const teams = [...state.teams.values()]
    .map((row) => ({
      team: row.team,
      games: row.games,
      wins: distribution(row.wins),
      losses: distribution(row.losses),
      runsFor: distribution(row.runsFor),
      runsAgainst: distribution(row.runsAgainst),
      winPct: rate(formatDistributionTotal(row.wins), row.games),
      ...teamSkillTotals(row)
    }))
    .sort((a, b) => b.winPct - a.winPct || b.wins.sum - a.wins.sum);

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
        paPer162: per162(line.pa, line.teamGames),
        hrPer162: per162(line.hr, line.teamGames),
        rPer162: per162(line.r, line.teamGames),
        rbiPer162: per162(line.rbi, line.teamGames),
        sbPer162: per162(line.sb, line.teamGames),
        csPer162: per162(line.cs, line.teamGames),
        gidpPer162: per162(line.gidp, line.teamGames),
        wpaPer162: per162(line.wpa, line.teamGames),
        hrPerSeason: rate(line.hr, state.runs),
        rbiPerSeason: rate(line.rbi, state.runs),
        runsPerSeason: rate(line.r, state.runs),
        sbPerSeason: rate(line.sb, state.runs),
        gidpPerSeason: rate(line.gidp, state.runs),
        wpaPerSeason: rate(line.wpa, state.runs)
      };
    })
    .sort((a, b) => b.ops - a.ops || b.pa - a.pa);

  const pitchers = [...state.pitchers.values()]
    .map((line) => ({
      ...line,
      ipPer162: per162(line.outs / 3, line.teamGames),
      inningsPerSeason: rate(line.outs, state.runs * 3),
      runsPerNine: rate(line.r * 27, line.outs),
      strikeoutsPerNine: rate(line.so * 27, line.outs),
      walksPerNine: rate(line.bb * 27, line.outs),
      wpaPer162: per162(line.wpa, line.teamGames),
      wpaPerSeason: rate(line.wpa, state.runs)
    }))
    .sort((a, b) => (a.outs === 0) - (b.outs === 0) || a.runsPerNine - b.runsPerNine || b.outs - a.outs);

  return {
    runs: state.runs,
    teams,
    hitters,
    pitchers,
    topSwing: state.topSwing
  };
}

function foldGame(state, game) {
  state.runs += 1;

  foldTeamResult(state, game.away.name, game.away.runs, game.home.runs);
  foldTeamResult(state, game.home.name, game.home.runs, game.away.runs);
  foldBoxScore(state, game.boxScore?.away);
  foldBoxScore(state, game.boxScore?.home);
  for (const event of game.events ?? []) {
    aggregateEventSkillStats(state.teams, event);
  }
  if (game.topSwing && (!state.topSwing || game.topSwing.wpa > state.topSwing.wpa)) {
    state.topSwing = {
      ...game.topSwing,
      game: state.runs,
      matchup: `${game.away.name} at ${game.home.name}`
    };
  }
}

function foldTeamResult(state, teamName, runsFor, runsAgainst) {
  const row = state.teams.get(teamName);
  if (!row) return;
  row.wins.push(runsFor > runsAgainst ? 1 : 0);
  row.losses.push(runsFor > runsAgainst ? 0 : 1);
  row.runsFor.push(runsFor);
  row.runsAgainst.push(runsAgainst);
}

function foldBoxScore(state, teamBox) {
  if (!teamBox) return;
  const team = state.teams.get(teamBox.team);
  if (team) team.games += 1;
  for (const row of state.hitters.values()) {
    if (row.team === teamBox.team) row.teamGames += 1;
  }
  for (const row of state.pitchers.values()) {
    if (row.team === teamBox.team) row.teamGames += 1;
  }
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
    row.gidp += line.gidp ?? 0;
    row.wpa += line.wpa ?? 0;
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
    row.wpa += line.wpa ?? 0;
  }
}

function registerHitter(state, teamName, player) {
  if (!player || state.hitters.has(player.id)) return;
  state.hitters.set(player.id, {
    id: player.id,
    name: player.name,
    team: teamName,
    position: player.cardPosition ?? player.position,
    teamGames: 0,
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
    rbi: 0,
    gidp: 0,
    wpa: 0
  });
}

function registerPitcher(state, teamName, player) {
  if (!player || state.pitchers.has(player.id)) return;
  state.pitchers.set(player.id, {
    id: player.id,
    name: player.name,
    team: teamName,
    role: player.role === "SP" ? "SP" : "RP",
    teamGames: 0,
    bf: 0,
    outs: 0,
    h: 0,
    bb: 0,
    so: 0,
    hr: 0,
    r: 0,
    wpa: 0
  });
}

function teamSkillTotals(row) {
  return {
    stealAttempts: row.stealAttempts,
    steals: row.steals,
    caughtStealing: row.caughtStealing,
    advanceAttempts: row.advanceAttempts,
    advances: row.advances,
    tagAttempts: row.tagAttempts,
    tagAdvances: row.tagAdvances,
    outsOnBases: row.outsOnBases,
    advanceChances: row.advanceChances,
    advancesAllowed: row.advancesAllowed,
    stealsAllowed: row.stealsAllowed,
    cutDowns: row.cutDowns,
    homeCutDowns: row.homeCutDowns,
    caughtStealingByDefense: row.caughtStealingByDefense,
    doublePlayChances: row.doublePlayChances,
    doublePlays: row.doublePlays
  };
}

function per162(total, games) {
  return rate(total * 162, games);
}

function createSchedule(teams) {
  const schedule = [];
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      schedule.push({ away: teams[i], home: teams[j] });
    }
  }
  return schedule;
}

function createRotationTracker(teams) {
  return new Map(teams.map((team) => [team.name, 0]));
}

function teamForGame(team, rotation) {
  const starters = team.starters?.length ? team.starters : team.pitchers?.slice(0, 1) ?? [];
  const bullpen = team.bullpen?.length ? team.bullpen : team.pitchers?.slice(1) ?? [];
  const startCount = rotation.get(team.name) ?? 0;
  rotation.set(team.name, startCount + 1);
  const starter = starters.length ? starters[startCount % starters.length] : null;
  return {
    ...team,
    starterIndex: starters.length ? startCount % starters.length : 0,
    pitchers: [starter, ...bullpen].filter(Boolean)
  };
}

function formatDistributionTotal(value) {
  return value?.reduce((sum, item) => sum + item, 0) ?? 0;
}
