// Post-simulation awards, computed from a batch summary. Every run in this
// engine is charged to a pitcher and there are no errors, so runs allowed
// per nine is displayed as ERA. "WP" is win probability from the model in
// game.js; per-162 WPA normalizes a player's game-level swings to a familiar pace.

export function computeAwards(summary, pickNumbers = null, prices = null) {
  if (!summary?.hitters?.length || !summary?.pitchers?.length) return [];
  if (summary.hitters[0].wpaPerSeason === undefined) return [];

  const teamCount = summary.teams?.length ?? 0;
  const awards = [];

  const everyone = [...summary.hitters, ...summary.pitchers];
  const mvp = maxBy(everyone, (line) => line.wpaPerSeason);
  if (mvp) {
    const mvpStat = Number.isFinite(mvp.wpaPer162)
      ? `${formatWpa(mvp.wpaPer162)} WPA per 162 games`
      : `${formatWpa(mvp.wpaPerSeason)} WP added/season`;
    awards.push(award("mvp", "Sim MVP", mvp, mvpStat,
      "Win probability added: every swing weighted by how much it moved the game."));
  }

  const starters = summary.pitchers.filter((line) => line.role === "SP" && line.outs >= teamGameMinimum(line, 9));
  const cyYoung = minBy(fallbackIfEmpty(starters, summary.pitchers.filter((line) => line.role === "SP" && line.outs > 0)), (line) => line.runsPerNine);
  if (cyYoung) {
    awards.push(award("cy-young", "Cy Young (SP)", cyYoung, `${cyYoung.runsPerNine.toFixed(2)} ERA`,
      `${pitcherWorkload(cyYoung)} IP per 162 games, ${cyYoung.strikeoutsPerNine.toFixed(1)} K/9.`));
  }

  const relievers = summary.pitchers.filter((line) => line.role === "RP" && line.outs >= teamGameMinimum(line, 3));
  const fireman = minBy(fallbackIfEmpty(relievers, summary.pitchers.filter((line) => line.role === "RP" && line.outs > 0)), (line) => line.runsPerNine);
  if (fireman) {
    awards.push(award("fireman", "Shutdown reliever (RP)", fireman, `${fireman.runsPerNine.toFixed(2)} ERA`,
      `${fireman.strikeoutsPerNine.toFixed(1)} K/9 out of the bullpen.`));
  }

  const qualifiedHitters = summary.hitters.filter((line) => line.pa >= teamGameMinimum(line, 3));
  const onBase = maxBy(fallbackIfEmpty(qualifiedHitters, summary.hitters), (line) => line.obp);
  if (onBase) {
    awards.push(award("obp", "On-base machine", onBase, `${formatBattingStat(onBase.obp)} OBP`,
      `${formatBattingStat(onBase.avg)} AVG with ${per162(onBase.bb, onBase.teamGames).toFixed(1)} walks per 162 games.`));
  }

  const hrKing = maxBy(summary.hitters, (line) => line.hr);
  if (hrKing && hrKing.hr > 0) {
    const hrStat = Number.isFinite(hrKing.hrPer162)
      ? `${Math.round(hrKing.hrPer162)} HR per 162 games`
      : `${hrKing.hrPerSeason.toFixed(2)} HR/season`;
    awards.push(award("hr", "Home run king", hrKing, hrStat,
      `${hrKing.hr} homers across ${summary.runs} simulated games.`));
  }

  const runScorer = maxBy(summary.hitters, (line) => line.r);
  if (runScorer && runScorer.r > 0) {
    const runsStat = Number.isFinite(runScorer.rPer162)
      ? `${Math.round(runScorer.rPer162)} R per 162 games`
      : `${runScorer.runsPerSeason.toFixed(2)} R/season`;
    awards.push(award("runs", "Run scorer", runScorer, runsStat,
      `Crossed the plate ${runScorer.r} times in the sims.`));
  }

  const speedDemon = maxBy(summary.hitters, (line) => line.sb);
  if (speedDemon && speedDemon.sb > 0) {
    const sbStat = Number.isFinite(speedDemon.sbPer162)
      ? `${Math.round(speedDemon.sbPer162)} SB per 162 games`
      : `${speedDemon.sbPerSeason.toFixed(2)} SB/season`;
    awards.push(award("sb", "Speed demon", speedDemon, sbStat,
      `${speedDemon.sb} steals, caught ${speedDemon.cs ?? 0} times.`));
  }

  const rallyKiller = maxBy(summary.hitters, (line) => line.gidp);
  if (rallyKiller && rallyKiller.gidp > 0) {
    const gidpStat = Number.isFinite(rallyKiller.gidpPer162)
      ? `${Math.round(rallyKiller.gidpPer162)} GIDP per 162 games`
      : `${rallyKiller.gidpPerSeason.toFixed(2)} GIDP/season`;
    awards.push(award("gidp", "Rally killer", rallyKiller, gidpStat,
      `Grounded into ${rallyKiller.gidp} double plays. Someone had to.`));
  }

  // What a player was worth, against what he cost. In an auction the cost is
  // money, and money is the only thing a manager actually chose — the order the
  // cards happened to come up in was the queue's doing, not theirs. So an
  // auction is judged on the price paid, and a snake draft on the pick spent.
  const marketRanks = prices && Object.keys(prices).length
    ? rankByCost(everyone, prices, (price) => `Paid ${price}`)
    : pickNumbers && Object.keys(pickNumbers).length
      ? rankByCost(everyone, pickNumbers, (pick) => `Pick #${pick}`, { ascending: true })
      : null;

  if (marketRanks) {
    const { ranked, label, byMoney } = marketRanks;
    const steal = maxBy(ranked, (entry) => entry.costRank - entry.productionRank);
    if (steal && steal.costRank - steal.productionRank > 0) {
      awards.push(award("steal", byMoney ? "Bargain of the auction" : "Steal of the draft", steal.line,
        `${label(steal.cost)}, finished #${steal.productionRank} in WPA`,
        byMoney ? "Nobody else wanted him. Nobody else got him." : "Late-round pick, front-of-the-draft production."));
    }

    // The cards the room paid up for: the priciest few in an auction, the first
    // three rounds in a snake draft. Both come to the same handful of players.
    const premium = ranked.filter((entry) => entry.costRank <= teamCount * 3);
    const bust = maxBy(premium, (entry) => entry.productionRank - entry.costRank);
    if (bust && bust.productionRank - bust.costRank > 0) {
      awards.push(award("bust", byMoney ? "Bust of the auction" : "Bust of the draft", bust.line,
        `${label(bust.cost)}, finished #${bust.productionRank} in WPA`,
        byMoney ? "The room bid him up. The room was wrong." : "First three rounds. This is a safe space."));
    }
  }

  if (summary.topSwing) {
    const swing = summary.topSwing;
    const swingNumber = swing.game ?? swing.season;
    awards.push({
      key: "swing",
      label: "Swing of the sims",
      id: swing.playerId,
      name: swing.name,
      team: teamOf(summary, swing.playerId) ?? "",
      stat: `${swing.result} worth +${(swing.wpa * 100).toFixed(0)}% win probability`,
      note: `${swing.half === "bottom" ? "Bottom" : "Top"} ${ordinal(swing.inning)}, ${swing.matchup}, game ${swingNumber}.`
    });
  }

  return awards;
}

function award(key, label, line, stat, note) {
  return { key, label, id: line.id, name: line.name, team: line.team, stat, note };
}

// Lines up what each player produced against what he cost, so the two can be
// compared as ranks. A pick number is already a rank — pick 7 is the seventh
// costliest thing anyone spent — but a price is only a number, so the field has
// to be sorted by it: the dearest card is cost rank 1.
function rankByCost(everyone, costs, label, options = {}) {
  const ranked = [...everyone]
    .sort((a, b) => b.wpaPerSeason - a.wpaPerSeason)
    .map((line, index) => ({ line, productionRank: index + 1, cost: Number(costs[line.id]) }))
    .filter((entry) => Number.isFinite(entry.cost));
  if (options.ascending) {
    for (const entry of ranked) entry.costRank = entry.cost;
    return { ranked, label, byMoney: false };
  }
  [...ranked]
    .sort((a, b) => b.cost - a.cost)
    .forEach((entry, index) => {
      entry.costRank = index + 1;
    });
  return { ranked, label, byMoney: true };
}

function maxBy(list, valueOf) {
  let best = null;
  let bestValue = -Infinity;
  for (const item of list ?? []) {
    const value = valueOf(item);
    if (Number.isFinite(value) && value > bestValue) {
      best = item;
      bestValue = value;
    }
  }
  return best;
}

function minBy(list, valueOf) {
  const best = maxBy(list, (item) => -valueOf(item));
  return best;
}

function fallbackIfEmpty(preferred, fallback) {
  return preferred?.length ? preferred : fallback;
}

function teamGameMinimum(line, outsOrPaPerGame) {
  const games = Number(line.teamGames);
  return (Number.isFinite(games) && games > 0 ? games : 1) * outsOrPaPerGame;
}

function per162(total, games) {
  return games ? (Number(total) * 162) / games : 0;
}

function pitcherWorkload(line) {
  if (Number.isFinite(line.ipPer162)) return line.ipPer162.toFixed(1);
  return (Number(line.inningsPerSeason) || 0).toFixed(1);
}

function teamOf(summary, playerId) {
  const hitter = summary.hitters.find((line) => line.id === playerId);
  if (hitter) return hitter.team;
  return summary.pitchers.find((line) => line.id === playerId)?.team ?? null;
}

function formatWpa(value) {
  const number = Number(value) || 0;
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}`;
}

function formatBattingStat(value) {
  const number = Number(value) || 0;
  const fixed = number.toFixed(3);
  return number < 1 ? fixed.replace(/^0/, "") : fixed;
}

function ordinal(value) {
  const number = Number(value) || 0;
  const tens = number % 100;
  if (tens >= 11 && tens <= 13) return `${number}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[number % 10] ?? "th";
  return `${number}${suffix}`;
}
