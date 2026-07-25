const CATEGORY_ORDER = [
  "highestScoring",
  "biggestComeback",
  "biggestWpaSwing",
  "mostSteals",
  "longestGame",
  "pitchingGem"
];

export function createInterestingGameState() {
  return new Map();
}

export function considerInterestingGame(state, game, index) {
  if (!(state instanceof Map) || !game) return state;
  const base = gameSummary(game, index);
  const totalRuns = base.awayRuns + base.homeRuns;
  const margin = Math.abs(base.awayRuns - base.homeRuns);

  keepBest(state, "highestScoring", {
    ...base,
    label: "Highest scoring",
    metric: `${totalRuns} combined runs`,
    note: `${base.winner} won by ${margin}`,
    value: totalRuns
  }, totalRuns, margin);

  const comeback = largestWinnerDeficit(game);
  if (comeback > 0) {
    keepBest(state, "biggestComeback", {
      ...base,
      label: "Biggest comeback",
      metric: `${comeback}-run comeback`,
      note: `${base.winner} erased a ${comeback}-run deficit`,
      value: comeback
    }, comeback, totalRuns);
  }

  const swing = biggestWpaEvent(game.events ?? []);
  if (swing) {
    const half = swing.half === "bottom" ? "Bot" : "Top";
    const player = swing.batter ?? swing.runner ?? swing.name ?? "A play";
    keepBest(state, "biggestWpaSwing", {
      ...base,
      label: "Biggest WPA swing",
      metric: `${(Math.abs(swing.wpa) * 100).toFixed(1)}% swing`,
      note: `${player} · ${swing.result ?? "play"}, ${half} ${swing.inning ?? "?"}`,
      value: Math.abs(swing.wpa)
    }, Math.abs(swing.wpa), totalRuns);
  }

  const stealLines = [
    ...(game.boxScore?.away?.hitters ?? []),
    ...(game.boxScore?.home?.hitters ?? [])
  ];
  const steals = stealLines.reduce((sum, line) => sum + (line.sb ?? 0), 0);
  if (steals > 0) {
    const topThief = [...stealLines].sort((a, b) => (b.sb ?? 0) - (a.sb ?? 0))[0];
    keepBest(state, "mostSteals", {
      ...base,
      label: "Most steals",
      metric: `${steals} stolen base${steals === 1 ? "" : "s"}`,
      note: topThief?.sb ? `${topThief.name} stole ${topThief.sb}` : "",
      value: steals
    }, steals, totalRuns);
  }

  keepBest(state, "longestGame", {
    ...base,
    label: "Longest game",
    metric: `${base.innings} innings`,
    note: `${totalRuns} combined runs`,
    value: base.innings
  }, base.innings, totalRuns);

  const gem = bestPitchingGem(game);
  if (gem) {
    keepBest(state, "pitchingGem", {
      ...base,
      label: gem.kind,
      metric: `${gem.strikeouts} K · ${gem.hits} H · ${gem.walks} BB`,
      note: `${gem.team}: ${gem.pitchers}`,
      value: gem.tier
    }, gem.rank, gem.outs);
  }
  return state;
}

export function summarizeInterestingGames(state) {
  if (!(state instanceof Map)) return [];
  return CATEGORY_ORDER
    .map((key) => state.get(key))
    .filter(Boolean)
    .map(({ rank, tieBreaker, ...entry }) => entry);
}

function gameSummary(game, index) {
  return {
    index,
    away: game.away?.name ?? game.boxScore?.away?.team ?? "Away",
    home: game.home?.name ?? game.boxScore?.home?.team ?? "Home",
    awayRuns: Number(game.away?.runs ?? game.boxScore?.away?.runs ?? 0),
    homeRuns: Number(game.home?.runs ?? game.boxScore?.home?.runs ?? 0),
    winner: game.winner ?? (
      Number(game.away?.runs ?? 0) > Number(game.home?.runs ?? 0)
        ? game.away?.name
        : game.home?.name
    ) ?? "Winner",
    innings: finalInning(game.events ?? [])
  };
}

function keepBest(state, key, candidate, rank, tieBreaker = 0) {
  const current = state.get(key);
  if (
    !current
    || rank > current.rank
    || (rank === current.rank && tieBreaker > current.tieBreaker)
    || (rank === current.rank && tieBreaker === current.tieBreaker && candidate.index < current.index)
  ) {
    state.set(key, { ...candidate, rank, tieBreaker });
  }
}

function finalInning(events) {
  return Math.max(9, ...events.map((event) => Number(event.inning) || 0));
}

function largestWinnerDeficit(game) {
  const winnerSide = game.winner === game.away?.name ? "away" : "home";
  const loserSide = winnerSide === "away" ? "home" : "away";
  return (game.events ?? []).reduce((largest, event) => {
    const score = event.scoreAfter;
    if (!score) return largest;
    return Math.max(largest, (Number(score[loserSide]) || 0) - (Number(score[winnerSide]) || 0));
  }, 0);
}

function biggestWpaEvent(events) {
  return events.reduce((biggest, event) => {
    if (!Number.isFinite(event.wpa)) return biggest;
    return !biggest || Math.abs(event.wpa) > Math.abs(biggest.wpa) ? event : biggest;
  }, null);
}

function bestPitchingGem(game) {
  const candidates = [];
  for (const side of ["away", "home"]) {
    const opponent = side === "away" ? "home" : "away";
    const pitchers = game.boxScore?.[side]?.pitchers ?? [];
    const outs = pitchers.reduce((sum, line) => sum + (line.outs ?? 0), 0);
    const hits = pitchers.reduce((sum, line) => sum + (line.h ?? 0), 0);
    const walks = pitchers.reduce((sum, line) => sum + (line.bb ?? 0), 0);
    const strikeouts = pitchers.reduce((sum, line) => sum + (line.so ?? 0), 0);
    const runsAllowed = Number(game[opponent]?.runs ?? game.boxScore?.[opponent]?.runs ?? 0);
    if (outs < 27 || runsAllowed !== 0) continue;

    const activePitchers = pitchers.filter((line) => (line.outs ?? 0) > 0);
    const onePitcher = activePitchers.length === 1;
    const tier = hits === 0 && walks === 0 ? 3 : hits === 0 ? 2 : 1;
    const kind = tier === 3
      ? (onePitcher ? "Perfect game" : "Combined perfect game")
      : tier === 2
        ? (onePitcher ? "No-hitter" : "Combined no-hitter")
        : "Best shutout";
    candidates.push({
      kind,
      tier,
      rank: tier * 1_000_000 + (100 - hits) * 1_000 + strikeouts,
      outs,
      hits,
      walks,
      strikeouts,
      team: game[side]?.name ?? game.boxScore?.[side]?.team ?? side,
      pitchers: activePitchers.map((line) => line.name).join(", ") || "Pitching staff"
    });
  }
  return candidates.sort((a, b) => b.rank - a.rank || b.outs - a.outs)[0] ?? null;
}
