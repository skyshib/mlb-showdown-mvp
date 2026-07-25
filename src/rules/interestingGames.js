const CATEGORY_ORDER = [
  "highestScoring",
  "pitchersDuel",
  "biggestBlowout",
  "biggestComeback",
  "biggestWpaSwing",
  "mostLeadChanges",
  "walkOff",
  "mostHomeRuns",
  "mostSteals",
  "longestGame",
  "pitchingGem"
];

const CATEGORY_LABELS = {
  highestScoring: "Highest scoring",
  pitchersDuel: "Pitchers' duels",
  biggestBlowout: "Biggest blowouts",
  biggestComeback: "Biggest comebacks",
  biggestWpaSwing: "Biggest WPA swings",
  mostLeadChanges: "Most lead changes",
  walkOff: "Walk-off finishes",
  mostHomeRuns: "Home-run derbies",
  mostSteals: "Most steals",
  longestGame: "Longest games",
  pitchingGem: "Pitching gems"
};

const GAMES_PER_CATEGORY = 3;

export function createInterestingGameState() {
  return new Map();
}

export function considerInterestingGame(state, game, index) {
  if (!(state instanceof Map) || !game) return state;
  const base = gameSummary(game, index);
  const totalRuns = base.awayRuns + base.homeRuns;
  const margin = Math.abs(base.awayRuns - base.homeRuns);

  keepTop(state, "highestScoring", {
    ...base,
    label: "Highest scoring",
    metric: `${totalRuns} combined runs`,
    note: `${base.winner} won by ${margin}`,
    value: totalRuns
  }, totalRuns, margin);

  keepTop(state, "pitchersDuel", {
    ...base,
    label: "Pitchers' duel",
    metric: `${totalRuns} combined run${totalRuns === 1 ? "" : "s"}`,
    note: `${base.winner} won ${Math.max(base.awayRuns, base.homeRuns)}-${Math.min(base.awayRuns, base.homeRuns)}`,
    value: totalRuns
  }, -totalRuns, -margin);

  keepTop(state, "biggestBlowout", {
    ...base,
    label: "Biggest blowout",
    metric: `${margin}-run margin`,
    note: `${base.winner} scored ${Math.max(base.awayRuns, base.homeRuns)}`,
    value: margin
  }, margin, totalRuns);

  const comeback = largestWinnerDeficit(game);
  if (comeback > 0) {
    keepTop(state, "biggestComeback", {
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
    keepTop(state, "biggestWpaSwing", {
      ...base,
      label: "Biggest WPA swing",
      metric: `${(Math.abs(swing.wpa) * 100).toFixed(1)}% swing`,
      note: `${player} · ${swing.result ?? "play"}, ${half} ${swing.inning ?? "?"}`,
      value: Math.abs(swing.wpa)
    }, Math.abs(swing.wpa), totalRuns);
  }

  const leadChanges = countLeadChanges(game.events ?? []);
  if (leadChanges > 0) {
    keepTop(state, "mostLeadChanges", {
      ...base,
      label: "Most lead changes",
      metric: `${leadChanges} lead change${leadChanges === 1 ? "" : "s"}`,
      note: `${totalRuns} combined runs`,
      value: leadChanges
    }, leadChanges, totalRuns);
  }

  const walkOff = walkOffFinish(game);
  if (walkOff) {
    keepTop(state, "walkOff", {
      ...base,
      label: "Walk-off finish",
      metric: `${ordinal(walkOff.inning)}-inning walk-off`,
      note: `${walkOff.player} · ${walkOff.result}`,
      value: walkOff.inning
    }, walkOff.inning, Math.abs(walkOff.wpa));
  }

  const stealLines = [
    ...(game.boxScore?.away?.hitters ?? []),
    ...(game.boxScore?.home?.hitters ?? [])
  ];
  const steals = stealLines.reduce((sum, line) => sum + (line.sb ?? 0), 0);
  if (steals > 0) {
    const topThief = [...stealLines].sort((a, b) => (b.sb ?? 0) - (a.sb ?? 0))[0];
    keepTop(state, "mostSteals", {
      ...base,
      label: "Most steals",
      metric: `${steals} stolen base${steals === 1 ? "" : "s"}`,
      note: topThief?.sb ? `${topThief.name} stole ${topThief.sb}` : "",
      value: steals
    }, steals, totalRuns);
  }

  const homers = stealLines.reduce((sum, line) => sum + (line.hr ?? 0), 0);
  if (homers > 0) {
    const topSlugger = [...stealLines].sort((a, b) => (b.hr ?? 0) - (a.hr ?? 0))[0];
    keepTop(state, "mostHomeRuns", {
      ...base,
      label: "Home-run derby",
      metric: `${homers} home run${homers === 1 ? "" : "s"}`,
      note: topSlugger?.hr ? `${topSlugger.name} hit ${topSlugger.hr}` : "",
      value: homers
    }, homers, totalRuns);
  }

  keepTop(state, "longestGame", {
    ...base,
    label: "Longest game",
    metric: `${base.innings} innings`,
    note: `${totalRuns} combined runs`,
    value: base.innings
  }, base.innings, totalRuns);

  const gem = bestPitchingGem(game);
  if (gem) {
    keepTop(state, "pitchingGem", {
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
  return CATEGORY_ORDER.flatMap((key) => {
    const stored = state.get(key);
    const entries = Array.isArray(stored) ? stored : stored ? [stored] : [];
    return entries.map(({ rank, tieBreaker, ...entry }, index) => ({
      ...entry,
      categoryKey: key,
      categoryLabel: CATEGORY_LABELS[key],
      place: index + 1
    }));
  });
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

function keepTop(state, key, candidate, rank, tieBreaker = 0) {
  const stored = state.get(key);
  const current = Array.isArray(stored) ? [...stored] : stored ? [stored] : [];
  const next = { ...candidate, rank, tieBreaker };
  const duplicate = current.findIndex((entry) => entry.index === candidate.index);
  if (duplicate >= 0) current.splice(duplicate, 1);
  current.push(next);
  current.sort(compareRankedGames);
  state.set(key, current.slice(0, GAMES_PER_CATEGORY));
}

function compareRankedGames(a, b) {
  return b.rank - a.rank || b.tieBreaker - a.tieBreaker || a.index - b.index;
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

function countLeadChanges(events) {
  let leader = null;
  let changes = 0;
  for (const event of events) {
    const away = Number(event.scoreAfter?.away) || 0;
    const home = Number(event.scoreAfter?.home) || 0;
    const nextLeader = away === home ? null : away > home ? "away" : "home";
    if (!nextLeader) continue;
    if (leader && leader !== nextLeader) changes += 1;
    leader = nextLeader;
  }
  return changes;
}

function walkOffFinish(game) {
  const event = (game.events ?? []).at(-1);
  if (
    !event
    || event.half !== "bottom"
    || Number(event.inning) < 9
    || Number(event.scoreAfter?.home) <= Number(event.scoreAfter?.away)
  ) return null;
  return {
    inning: Number(event.inning),
    player: event.batter ?? event.runner ?? "Home team",
    result: event.result ?? "winning play",
    wpa: Number(event.wpa) || 0
  };
}

function ordinal(value) {
  const number = Number(value) || 0;
  const mod100 = number % 100;
  const suffix = mod100 >= 11 && mod100 <= 13
    ? "th"
    : number % 10 === 1
      ? "st"
      : number % 10 === 2
        ? "nd"
        : number % 10 === 3
          ? "rd"
          : "th";
  return `${number}${suffix}`;
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
