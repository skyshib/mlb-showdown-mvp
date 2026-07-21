import { distribution, rate } from "./stats.js?v=20260716-records";
import { aggregateEventSkillStats, createTeamSkillLine } from "./teamSkillStats.js?v=20260716-records";
import { simulateGame } from "./game.js?v=20260717-draft-wpa";
import { createRng } from "./rng.js?v=20260716-records";

export const DEFAULT_BATCH_RUNS = 10000;
export const BATCH_SCHEDULE_VERSION = 2;

export function normalizeBatchRuns(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 1) return DEFAULT_BATCH_RUNS;
  return number;
}

// One pass. Win probability comes off the MLB historical table, which is fixed,
// so there is nothing to learn from the season before scoring it — this used to
// simulate every game twice (once to calibrate a per-draft table, once to score
// against it). See winProbabilityHome in game.js for why that table went away.
export function simulateBatch(teams, options = {}) {
  const runs = normalizeBatchRuns(options.runs ?? DEFAULT_BATCH_RUNS);
  const seed = String(options.seed ?? "batch");
  return summarizeBatch(runBatchChunk(createBatchState(teams), teams, seed, 0, runs));
}

export function createBatchState(teams, options = {}) {
  const state = {
    runs: 0,
    teams: new Map(),
    headToHead: new Map(),
    hitters: new Map(),
    pitchers: new Map(),
    topSwing: null,
    scheduleVersion: options.scheduleVersion ?? BATCH_SCHEDULE_VERSION
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

export function runBatchChunk(state, teams, seed, startIndex, count, options = {}) {
  const schedule = createSchedule(
    teams,
    options.scheduleVersion ?? state.scheduleVersion ?? BATCH_SCHEDULE_VERSION
  );
  if (!schedule.length) return state;
  for (let index = startIndex; index < startIndex + count; index += 1) {
    foldGame(state, playScheduledGame(schedule[index % schedule.length], seed, index));
  }
  return state;
}

function playScheduledGame(matchup, seed, index) {
  const gameSeed = `${seed}-game-${index + 1}-${matchup.away.name}-${matchup.home.name}`;
  return simulateGame(
    teamForGame(matchup.away, gameSeed, "away"),
    teamForGame(matchup.home, gameSeed, "home"),
    gameSeed
  );
}

// Re-simulates games [startIndex, startIndex + count) of a batch run. Batch
// games are fully determined by (teams, seed, index) — including each team's
// starter, which teamForGame picks from a seed derived from the game — so the
// review log can page through every game of a finished run without storing any
// of them, and without replaying the games before startIndex.
export function replayBatchGames(teams, seed, startIndex, count, options = {}) {
  const schedule = createSchedule(
    teams,
    options.scheduleVersion ?? BATCH_SCHEDULE_VERSION
  );
  if (!schedule.length) return [];
  const games = [];
  for (let index = startIndex; index < startIndex + count; index += 1) {
    const matchup = schedule[index % schedule.length];
    games.push({ index, game: playScheduledGame(matchup, seed, index) });
  }
  return games;
}

// One-game convenience over replayBatchGames, numbered from 1 the way the
// game-log UI counts.
export function simulateBatchGame(teams, seed, gameNumber, options = {}) {
  const targetIndex = Math.max(0, Math.round(Number(gameNumber) || 1) - 1);
  return replayBatchGames(teams, seed, targetIndex, 1, options)[0]?.game ?? null;
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
    .map((line) => summarizePitcherLine(line, state.runs))
    .sort((a, b) => (a.outs === 0) - (b.outs === 0) || a.runsPerNine - b.runsPerNine || b.outs - a.outs);

  return {
    runs: state.runs,
    teams,
    headToHead: [...state.headToHead.values()],
    hitters,
    pitchers,
    topSwing: state.topSwing,
    scheduleVersion: state.scheduleVersion
  };
}

function foldGame(state, game) {
  state.runs += 1;

  foldTeamResult(state, game.away.name, game.away.runs, game.home.runs);
  foldTeamResult(state, game.home.name, game.home.runs, game.away.runs);
  foldHeadToHead(state, game.away.name, game.home.name, game.away.runs, game.home.runs);
  foldHeadToHead(state, game.home.name, game.away.name, game.home.runs, game.away.runs);
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

function foldHeadToHead(state, team, opponent, runsFor, runsAgainst) {
  const key = `${team}\u0000${opponent}`;
  const row = state.headToHead.get(key) ?? {
    team,
    opponent,
    games: 0,
    wins: 0,
    losses: 0,
    runsFor: 0,
    runsAgainst: 0
  };
  row.games += 1;
  row.wins += runsFor > runsAgainst ? 1 : 0;
  row.losses += runsFor > runsAgainst ? 0 : 1;
  row.runsFor += runsFor;
  row.runsAgainst += runsAgainst;
  state.headToHead.set(key, row);
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
    for (const key of ["bf", "outs", "h", "bb", "so", "hr", "r", "wpa"]) {
      row.fresh[key] += line.fresh?.[key] ?? 0;
    }
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
    wpa: 0,
    fresh: emptyPitcherTotals()
  });
}

function emptyPitcherTotals() {
  return {
    bf: 0,
    outs: 0,
    h: 0,
    bb: 0,
    so: 0,
    hr: 0,
    r: 0,
    wpa: 0
  };
}

function summarizePitcherLine(line, runs) {
  return {
    ...summarizePitcherTotals(line, line.teamGames, runs),
    fresh: summarizePitcherTotals(line.fresh ?? emptyPitcherTotals(), line.teamGames, runs)
  };
}

function summarizePitcherTotals(line, teamGames, runs) {
  return {
    ...line,
    ipPer162: per162(line.outs / 3, teamGames),
    inningsPerSeason: rate(line.outs, runs * 3),
    runsPerNine: rate(line.r * 27, line.outs),
    strikeoutsPerNine: rate(line.so * 27, line.outs),
    walksPerNine: rate(line.bb * 27, line.outs),
    wpaPer162: per162(line.wpa, teamGames),
    wpaPerSeason: rate(line.wpa, runs)
  };
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
    doublePlays: row.doublePlays,
    baserunningWpa: row.baserunningWpa,
    baserunningWpaAllowed: row.baserunningWpaAllowed
  };
}

function per162(total, games) {
  return rate(total * 162, games);
}

function createSchedule(teams, scheduleVersion) {
  const schedule = [];
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      schedule.push({ away: teams[i], home: teams[j] });
      if (scheduleVersion >= 2) {
        schedule.push({ away: teams[j], home: teams[i] });
      }
    }
  }
  return schedule;
}

// Each game draws a random starter for each team rather than walking the
// rotation in lockstep — otherwise the fixed schedule kept pairing the same two
// starters against each other every time a matchup came around. The pick is
// seeded off the game (which already encodes seed, index, and both team names),
// so a batch stays fully replayable from (teams, seed, index).
function teamForGame(team, gameSeed, side) {
  const starters = team.starters?.length ? team.starters : team.pitchers?.slice(0, 1) ?? [];
  const bullpen = team.bullpen?.length ? team.bullpen : team.pitchers?.slice(1) ?? [];
  const starterIndex = starters.length
    ? createRng(`${gameSeed}:${side}:sp`).int(0, starters.length - 1)
    : 0;
  const starter = starters.length ? starters[starterIndex] : null;
  return {
    ...team,
    starterIndex,
    pitchers: [starter, ...bullpen].filter(Boolean)
  };
}

function formatDistributionTotal(value) {
  return value?.reduce((sum, item) => sum + item, 0) ?? 0;
}
