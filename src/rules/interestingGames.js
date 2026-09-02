const CATEGORY_ORDER = [
  "highestScoring",
  "heroPerformance",
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
  heroPerformance: "Biggest hero performances",
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

  const hero = bestSingleGameHero(game);
  if (hero) {
    keepTop(state, "heroPerformance", {
      ...base,
      label: "Biggest hero",
      metric: `${hero.wpa >= 0 ? "+" : ""}${(hero.wpa * 100).toFixed(1)}% WPA`,
      note: `${hero.name} · ${hero.team}${hero.detail ? ` · ${hero.detail}` : ""}`,
      value: hero.wpa
    }, hero.wpa, totalRuns);
  }

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

function bestSingleGameHero(game) {
  const candidates = [];
  for (const side of ["away", "home"]) {
    const teamBox = game.boxScore?.[side];
    if (!teamBox) continue;
    const players = new Map();
    const addLine = (line, kind) => {
      if (!line || !Number.isFinite(line.wpa)) return;
      const key = line.id ?? line.name;
      const player = players.get(key) ?? {
        name: line.name ?? "Unknown player",
        team: teamBox.team ?? game[side]?.name ?? side,
        wpa: 0,
        batting: null,
        pitching: null
      };
      player.wpa += line.wpa;
      if (kind === "hitter") {
        player.batting = {
          hits: line.h ?? 0,
          homeRuns: line.hr ?? 0,
          rbi: line.rbi ?? 0,
          steals: line.sb ?? 0
        };
      } else {
        player.pitching = {
          outs: line.outs ?? 0,
          strikeouts: line.so ?? 0
        };
      }
      players.set(key, player);
    };
    for (const line of teamBox.hitters ?? []) addLine(line, "hitter");
    for (const line of teamBox.pitchers ?? []) addLine(line, "pitcher");
    candidates.push(...players.values());
  }
  const hero = candidates
    .filter((candidate) => candidate.wpa > 0)
    .sort((a, b) => b.wpa - a.wpa || a.name.localeCompare(b.name))[0];
  return hero ? { ...hero, detail: heroPerformanceDetail(hero) } : null;
}

function heroPerformanceDetail(hero) {
  const details = [];
  if (hero.batting) {
    if (hero.batting.homeRuns) details.push(`${hero.batting.homeRuns} HR`);
    if (hero.batting.rbi) details.push(`${hero.batting.rbi} RBI`);
    if (hero.batting.steals) details.push(`${hero.batting.steals} SB`);
    if (!details.length && hero.batting.hits) details.push(`${hero.batting.hits} H`);
  }
  if (hero.pitching?.outs) {
    details.push(`${Math.floor(hero.pitching.outs / 3)}.${hero.pitching.outs % 3} IP`);
    if (hero.pitching.strikeouts) details.push(`${hero.pitching.strikeouts} K`);
  }
  return details.join(" · ");
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
    const gem = sideShutout(game, side);
    if (!gem) continue;
    candidates.push({
      ...gem,
      rank: gem.tier * 1_000_000 + (100 - gem.hits) * 1_000 + gem.strikeouts,
      pitchers: gem.activePitchers.map((line) => line.name).join(", ") || "Pitching staff"
    });
  }
  return candidates.sort((a, b) => b.rank - a.rank || b.outs - a.outs)[0] ?? null;
}

// One side's complete shutout, if it threw one: a full nine innings' worth of
// outs with nothing across. The tier is what kind — 3 perfect, 2 hitless, 1 a
// plain shutout — and the tiers are exclusive, so a perfect game is counted as
// perfect and nowhere else.
function sideShutout(game, side) {
  const opponent = side === "away" ? "home" : "away";
  const pitchers = game.boxScore?.[side]?.pitchers ?? [];
  const outs = pitchers.reduce((sum, line) => sum + (line.outs ?? 0), 0);
  const hits = pitchers.reduce((sum, line) => sum + (line.h ?? 0), 0);
  const walks = pitchers.reduce((sum, line) => sum + (line.bb ?? 0), 0);
  const strikeouts = pitchers.reduce((sum, line) => sum + (line.so ?? 0), 0);
  const runsAllowed = Number(game[opponent]?.runs ?? game.boxScore?.[opponent]?.runs ?? 0);
  if (outs < 27 || runsAllowed !== 0) return null;

  const activePitchers = pitchers.filter((line) => (line.outs ?? 0) > 0);
  const onePitcher = activePitchers.length === 1;
  const tier = hits === 0 && walks === 0 ? 3 : hits === 0 ? 2 : 1;
  const kind = tier === 3
    ? (onePitcher ? "Perfect game" : "Combined perfect game")
    : tier === 2
      ? (onePitcher ? "No-hitter" : "Combined no-hitter")
      : "Best shutout";
  return {
    kind,
    tier,
    onePitcher,
    outs,
    hits,
    walks,
    strikeouts,
    activePitchers,
    team: game[side]?.name ?? game.boxScore?.[side]?.team ?? side
  };
}

// ---- the notable-games tally ----
//
// The shelves above keep the three best of each kind. This keeps the count:
// how many perfect games a team threw across ten thousand simulated games, how
// many times it hit for the cycle, how often it walked one off. A shelf tells
// you what the best one was; a counter tells you how rare it is — which is the
// only way to read a feat that happens twice in a season and eleven times in a
// career.
//
// Feats are exclusive by construction (a perfect game is not also counted as a
// no-hitter) so the per-team total is a real total, and each is credited to the
// team that did it, not to the game it happened in.
const NOTABLE_FEATS = [
  { key: "perfectGame", label: "Perfect games" },
  { key: "noHitter", label: "No-hitters" },
  { key: "shutout", label: "Shutouts" },
  { key: "bigStrikeoutGame", label: "15-K games" },
  { key: "cycle", label: "Cycles" },
  { key: "threeHomerGame", label: "3-HR games" },
  { key: "walkOff", label: "Walk-offs" }
];

// How many example games each (team, feat) keeps a pointer to, so the count can
// be clicked through to an actual replay rather than being a dead number.
const NOTABLE_EXAMPLES = 3;

export function notableFeats() {
  return NOTABLE_FEATS.map((feat) => ({ ...feat }));
}

// Seeded with the room's teams so a club that never threw a no-hitter still has
// a row saying so — a missing row reads as missing data, a zero reads as a zero.
export function createNotableGameTally(teamNames = []) {
  const tally = new Map();
  for (const team of teamNames) tally.set(team, new Map());
  return tally;
}

export function foldNotableGame(tally, game, index) {
  if (!(tally instanceof Map) || !game) return tally;
  for (const side of ["away", "home"]) {
    const team = game[side]?.name ?? game.boxScore?.[side]?.team ?? side;

    const shutout = sideShutout(game, side);
    if (shutout) {
      creditFeat(tally, team, shutout.tier === 3 ? "perfectGame" : shutout.tier === 2 ? "noHitter" : "shutout", index);
    }

    for (const line of game.boxScore?.[side]?.pitchers ?? []) {
      if ((line.so ?? 0) >= 15) creditFeat(tally, team, "bigStrikeoutGame", index);
    }

    for (const line of game.boxScore?.[side]?.hitters ?? []) {
      const homers = line.hr ?? 0;
      const singles = (line.h ?? 0) - (line.d ?? 0) - (line.t ?? 0) - homers;
      if (singles >= 1 && (line.d ?? 0) >= 1 && (line.t ?? 0) >= 1 && homers >= 1) {
        creditFeat(tally, team, "cycle", index);
      }
      if (homers >= 3) creditFeat(tally, team, "threeHomerGame", index);
    }
  }

  // A walk-off belongs to the home team, which is the only side that can hit one.
  if (walkOffFinish(game)) {
    creditFeat(tally, game.home?.name ?? game.boxScore?.home?.team ?? "home", "walkOff", index);
  }
  return tally;
}

export function summarizeNotableGames(tally) {
  if (!(tally instanceof Map)) return null;
  const teams = [...tally.entries()]
    .map(([team, feats]) => {
      const counts = {};
      const examples = {};
      let total = 0;
      for (const { key } of NOTABLE_FEATS) {
        const entry = feats.get(key);
        counts[key] = entry?.count ?? 0;
        examples[key] = [...(entry?.indexes ?? [])];
        total += counts[key];
      }
      return { team, counts, examples, total };
    })
    .sort((a, b) => b.total - a.total || a.team.localeCompare(b.team));
  return { feats: notableFeats(), teams };
}

function creditFeat(tally, team, key, index) {
  if (!tally.has(team)) tally.set(team, new Map());
  const feats = tally.get(team);
  const entry = feats.get(key) ?? { count: 0, indexes: [] };
  entry.count += 1;
  if (Number.isInteger(index) && entry.indexes.length < NOTABLE_EXAMPLES && !entry.indexes.includes(index)) {
    entry.indexes.push(index);
  }
  feats.set(key, entry);
}
