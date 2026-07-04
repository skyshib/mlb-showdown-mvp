#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { generatePlayerPool } from "../src/data/playerGeneration.js";
import { autopick, buildTeam, createDraft, repairDraftRosters } from "../src/rules/draft.js";
import { RESULTS } from "../src/rules/cards.js";
import { simulateRoundRobin } from "../src/rules/tournament.js";

const DEFAULTS = {
  runs: 100,
  teams: 4,
  rosterSize: 13,
  seed: "balance"
};

export function runBalanceSimulation(options = {}) {
  const config = normalizeOptions(options);
  const tournaments = [];

  for (let index = 0; index < config.runs; index += 1) {
    tournaments.push(simulateDraftTournament(config, index));
  }

  return {
    config,
    tournaments,
    summary: summarizeBalance(tournaments)
  };
}

export function summarizeBalance(tournaments) {
  const games = tournaments.flatMap((tournament) => tournament.games);
  const teamRows = new Map();
  const totals = {
    games: games.length,
    plateAppearances: 0,
    runs: 0,
    homeRuns: 0,
    walks: 0,
    strikeouts: 0
  };

  for (const tournament of tournaments) {
    for (const standing of tournament.standings) {
      const row = teamRows.get(standing.team) ?? {
        team: standing.team,
        tournaments: 0,
        roundRobinWins: [],
        roundRobinLosses: [],
        runsFor: [],
        runsAgainst: [],
        titles: 0
      };
      row.tournaments += 1;
      row.roundRobinWins.push(standing.wins);
      row.roundRobinLosses.push(standing.losses);
      row.runsFor.push(standing.runsFor);
      row.runsAgainst.push(standing.runsAgainst);
      if (tournament.champion === standing.team) row.titles += 1;
      teamRows.set(standing.team, row);
    }
  }

  for (const game of games) {
    totals.runs += game.away.runs + game.home.runs;
    for (const event of game.events) {
      totals.plateAppearances += 1;
      if (event.result === RESULTS.HR) totals.homeRuns += 1;
      if (event.result === RESULTS.BB) totals.walks += 1;
      if (event.result === RESULTS.SO) totals.strikeouts += 1;
    }
  }

  const runsPerGame = games.map((game) => game.away.runs + game.home.runs);
  const homersPerGame = games.map((game) => countResult(game.events, RESULTS.HR));
  const walksPerGame = games.map((game) => countResult(game.events, RESULTS.BB));
  const strikeoutsPerGame = games.map((game) => countResult(game.events, RESULTS.SO));

  return {
    tournaments: tournaments.length,
    games: totals.games,
    plateAppearances: totals.plateAppearances,
    rates: {
      runsPerGame: distribution(runsPerGame),
      homeRunsPerGame: distribution(homersPerGame),
      walksPerGame: distribution(walksPerGame),
      strikeoutsPerGame: distribution(strikeoutsPerGame),
      walkRate: rate(totals.walks, totals.plateAppearances),
      strikeoutRate: rate(totals.strikeouts, totals.plateAppearances),
      homeRunRate: rate(totals.homeRuns, totals.plateAppearances)
    },
    teamWins: [...teamRows.values()]
      .map((row) => ({
        team: row.team,
        tournaments: row.tournaments,
        titleShare: rate(row.titles, row.tournaments),
        roundRobinWins: distribution(row.roundRobinWins),
        roundRobinLosses: distribution(row.roundRobinLosses),
        runsForPerTournament: distribution(row.runsFor),
        runsAgainstPerTournament: distribution(row.runsAgainst)
      }))
      .sort((a, b) => b.titleShare - a.titleShare || b.roundRobinWins.mean - a.roundRobinWins.mean)
  };
}

export function formatBalanceReport(result) {
  const lines = [];
  const { config, summary } = result;
  lines.push(`Balance simulation: ${summary.tournaments} tournaments, ${summary.games} games`);
  lines.push(`Seed: ${config.seed}; teams: ${config.teams}; roster size: ${config.rosterSize}`);
  lines.push("");
  lines.push("Game distributions");
  lines.push(`Runs/game: ${formatDistribution(summary.rates.runsPerGame)}`);
  lines.push(`HR/game: ${formatDistribution(summary.rates.homeRunsPerGame)}`);
  lines.push(`Walks/game: ${formatDistribution(summary.rates.walksPerGame)} (${formatPercent(summary.rates.walkRate)} of PA)`);
  lines.push(`Strikeouts/game: ${formatDistribution(summary.rates.strikeoutsPerGame)} (${formatPercent(summary.rates.strikeoutRate)} of PA)`);
  lines.push(`HR rate: ${formatPercent(summary.rates.homeRunRate)} of PA`);
  lines.push("");
  lines.push("Team distributions");
  for (const row of summary.teamWins) {
    lines.push(
      `${row.team}: titles ${formatPercent(row.titleShare)}, RR wins ${formatDistribution(row.roundRobinWins)}, runs for ${formatDistribution(
        row.runsForPerTournament
      )}`
    );
  }
  return lines.join("\n");
}

function simulateDraftTournament(config, index) {
  const seed = `${config.seed}-${index + 1}`;
  const managers = Array.from({ length: config.teams }, (_, teamIndex) => `Team ${teamIndex + 1}`);
  const pool = generatePlayerPool(`${seed}-pool`, config.teams, config.rosterSize);
  const draft = createDraft(managers, pool, config.rosterSize);

  while (!draft.complete) {
    autopick(draft);
  }
  repairDraftRosters(draft);

  const teams = draft.managers.map(buildTeam);
  const result = simulateRoundRobin(teams, seed);
  const games = result.final ? [...result.games, result.final] : result.games;
  const champion = result.final?.winner ?? result.standings[0]?.team ?? null;

  return {
    seed,
    champion,
    standings: result.standings,
    games
  };
}

function normalizeOptions(options) {
  return {
    runs: positiveInteger(options.runs ?? DEFAULTS.runs, "runs"),
    teams: positiveInteger(options.teams ?? DEFAULTS.teams, "teams", 2),
    rosterSize: positiveInteger(options.rosterSize ?? DEFAULTS.rosterSize, "rosterSize", 13),
    seed: String(options.seed ?? DEFAULTS.seed)
  };
}

function positiveInteger(value, name, minimum = 1) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return number;
}

function countResult(events, result) {
  return events.reduce((sum, event) => sum + (event.result === result ? 1 : 0), 0);
}

function rate(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function distribution(values) {
  if (!values.length) {
    return { count: 0, min: 0, p10: 0, median: 0, mean: 0, p90: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    p10: percentile(sorted, 0.1),
    median: percentile(sorted, 0.5),
    mean: sum / sorted.length,
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1]
  };
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function formatDistribution(stats) {
  return `mean ${formatNumber(stats.mean)}, p10 ${formatNumber(stats.p10)}, median ${formatNumber(stats.median)}, p90 ${formatNumber(
    stats.p90
  )}`;
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--runs") {
      options.runs = argv[++index];
    } else if (arg === "--teams") {
      options.teams = argv[++index];
    } else if (arg === "--roster-size") {
      options.rosterSize = argv[++index];
    } else if (arg === "--seed") {
      options.seed = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage: node scripts/balance-sim.js [options]",
    "",
    "Options:",
    "  --runs <n>         Number of draft/tournament runs (default: 100)",
    "  --teams <n>        Teams per draft (default: 4)",
    "  --roster-size <n>  Players per roster (default: 12)",
    "  --seed <value>     Seed prefix (default: balance)",
    "  --json             Print full JSON result",
    "  --help             Show this help"
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = runBalanceSimulation(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatBalanceReport(result));
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}
