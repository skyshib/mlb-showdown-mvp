// Post-simulation awards, computed from a batch summary. Every run in this
// engine is charged to a pitcher and there are no errors, so runs allowed
// per nine is displayed as ERA. "WP" is win probability from the model in
// game.js; per-season WPA is the sum of a player's win-probability swings.

export function computeAwards(summary, pickNumbers = null) {
  if (!summary?.hitters?.length || !summary?.pitchers?.length) return [];
  if (summary.hitters[0].wpaPerSeason === undefined) return [];

  const runs = Math.max(1, summary.runs ?? 1);
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

  const starters = summary.pitchers.filter((line) => line.role === "SP" && line.outs >= runs * 9);
  const cyYoung = minBy(fallbackIfEmpty(starters, summary.pitchers.filter((line) => line.role === "SP" && line.outs > 0)), (line) => line.runsPerNine);
  if (cyYoung) {
    awards.push(award("cy-young", "Cy Young (SP)", cyYoung, `${cyYoung.runsPerNine.toFixed(2)} ERA`,
      `${cyYoung.inningsPerSeason.toFixed(1)} IP per season, ${cyYoung.strikeoutsPerNine.toFixed(1)} K/9.`));
  }

  const relievers = summary.pitchers.filter((line) => line.role === "RP" && line.outs >= runs * 3);
  const fireman = minBy(fallbackIfEmpty(relievers, summary.pitchers.filter((line) => line.role === "RP" && line.outs > 0)), (line) => line.runsPerNine);
  if (fireman) {
    awards.push(award("fireman", "Shutdown reliever (RP)", fireman, `${fireman.runsPerNine.toFixed(2)} ERA`,
      `${fireman.strikeoutsPerNine.toFixed(1)} K/9 out of the bullpen.`));
  }

  const qualifiedHitters = summary.hitters.filter((line) => line.pa >= runs * 3);
  const onBase = maxBy(fallbackIfEmpty(qualifiedHitters, summary.hitters), (line) => line.obp);
  if (onBase) {
    awards.push(award("obp", "On-base machine", onBase, `${formatBattingStat(onBase.obp)} OBP`,
      `${formatBattingStat(onBase.avg)} AVG with ${(rateOf(onBase.bb, runs)).toFixed(1)} walks per season.`));
  }

  const hrKing = maxBy(summary.hitters, (line) => line.hr);
  if (hrKing && hrKing.hr > 0) {
    const hrStat = Number.isFinite(hrKing.hrPer162)
      ? `${Math.round(hrKing.hrPer162)} HR per 162 games`
      : `${hrKing.hrPerSeason.toFixed(2)} HR/season`;
    awards.push(award("hr", "Home run king", hrKing, hrStat,
      `${hrKing.hr} homers across ${summary.runs} seasons.`));
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

  if (pickNumbers && Object.keys(pickNumbers).length) {
    const ranked = [...everyone]
      .sort((a, b) => b.wpaPerSeason - a.wpaPerSeason)
      .map((line, index) => ({ line, productionRank: index + 1, pick: pickNumbers[line.id] }))
      .filter((entry) => Number.isFinite(entry.pick));

    const steal = maxBy(ranked, (entry) => entry.pick - entry.productionRank);
    if (steal && steal.pick - steal.productionRank > 0) {
      awards.push(award("steal", "Steal of the draft", steal.line,
        `Pick #${steal.pick}, finished #${steal.productionRank} in WPA`,
        `Late-round pick, front-of-the-draft production.`));
    }

    const earlyPicks = ranked.filter((entry) => entry.pick <= teamCount * 3);
    const bust = maxBy(earlyPicks, (entry) => entry.productionRank - entry.pick);
    if (bust && bust.productionRank - bust.pick > 0) {
      awards.push(award("bust", "Bust of the draft", bust.line,
        `Pick #${bust.pick}, finished #${bust.productionRank} in WPA`,
        `First three rounds. This is a safe space.`));
    }
  }

  if (summary.topSwing) {
    const swing = summary.topSwing;
    awards.push({
      key: "swing",
      label: "Swing of the sims",
      id: swing.playerId,
      name: swing.name,
      team: teamOf(summary, swing.playerId) ?? "",
      stat: `${swing.result} worth +${(swing.wpa * 100).toFixed(0)}% win probability`,
      note: `${swing.half === "bottom" ? "Bottom" : "Top"} ${ordinal(swing.inning)}, ${swing.matchup}, season ${swing.season}${swing.isFinal ? " final" : ""}.`
    });
  }

  return awards;
}

function award(key, label, line, stat, note) {
  return { key, label, id: line.id, name: line.name, team: line.team, stat, note };
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

function rateOf(total, runs) {
  return runs > 0 ? total / runs : 0;
}

function teamOf(summary, playerId) {
  const hitter = summary.hitters.find((line) => line.id === playerId);
  if (hitter) return hitter.team;
  return summary.pitchers.find((line) => line.id === playerId)?.team ?? null;
}

function formatWpa(value) {
  const number = Number(value) || 0;
  return `${number >= 0 ? "+" : ""}${number.toFixed(3)}`;
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
