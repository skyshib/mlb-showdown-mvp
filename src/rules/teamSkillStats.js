export function createTeamSkillLine(team) {
  return {
    team,
    stealAttempts: 0,
    steals: 0,
    caughtStealing: 0,
    advanceAttempts: 0,
    advances: 0,
    tagAttempts: 0,
    tagAdvances: 0,
    outsOnBases: 0,
    advanceChances: 0,
    advancesAllowed: 0,
    stealsAllowed: 0,
    cutDowns: 0,
    homeCutDowns: 0,
    caughtStealingByDefense: 0,
    doublePlayChances: 0,
    doublePlays: 0,
    // Win probability the team added on the bases (steals + extra bases taken),
    // and the win probability it let opponents add running against it.
    baserunningWpa: 0,
    baserunningWpaAllowed: 0
  };
}

export function aggregateEventSkillStats(teams, event) {
  const battingTeam = event.battingTeam;
  const pitchingTeam = event.pitchingTeam;
  const details = event.playDetails;
  if (!details || !battingTeam || !pitchingTeam) return;

  // The baserunning WP swing (batting-team perspective) is recorded on the play
  // itself, since on a hit or fly it's only a slice of the whole event's WPA. The
  // runners' team banks it; the defense that let it happen is charged the same.
  if (Number.isFinite(details.baserunningWpa) && details.baserunningWpa !== 0) {
    getTeamSkillLine(teams, battingTeam).baserunningWpa += details.baserunningWpa;
    getTeamSkillLine(teams, pitchingTeam).baserunningWpaAllowed += details.baserunningWpa;
  }

  if (details.kind === "steal" && details.stealAttempt) {
    trackAdvanceAttempt(teams, battingTeam, pitchingTeam, details.stealAttempt, "steal");
    return;
  }

  if (details.kind === "hit") {
    for (const attempt of details.extraBaseAttempts ?? []) {
      trackAdvanceAttempt(teams, battingTeam, pitchingTeam, attempt, "hit");
    }
    return;
  }

  if (details.kind === "flyout") {
    for (const attempt of details.tagUpAttempts ?? []) {
      trackAdvanceAttempt(teams, battingTeam, pitchingTeam, attempt, "tag");
    }
    return;
  }

  if (details.kind === "groundout" && details.doublePlayAttempt) {
    const defense = getTeamSkillLine(teams, pitchingTeam);
    defense.doublePlayChances += 1;
    if (details.doublePlayAttempt.batterOut) defense.doublePlays += 1;
  }
}

export function getTeamSkillLine(map, team) {
  if (!map.has(team)) map.set(team, createTeamSkillLine(team));
  return map.get(team);
}

function trackAdvanceAttempt(teams, battingTeam, pitchingTeam, attempt, kind) {
  const offense = getTeamSkillLine(teams, battingTeam);
  const defense = getTeamSkillLine(teams, pitchingTeam);

  if (kind === "steal") {
    offense.stealAttempts += 1;
    if (attempt.safe) {
      offense.steals += 1;
      defense.stealsAllowed += 1;
    } else {
      offense.caughtStealing += 1;
      offense.outsOnBases += 1;
      defense.caughtStealingByDefense += 1;
    }
  } else {
    offense.advanceAttempts += 1;
    defense.advanceChances += 1;
    if (kind === "tag") offense.tagAttempts += 1;
    if (attempt.safe) {
      offense.advances += 1;
      defense.advancesAllowed += 1;
      if (kind === "tag") offense.tagAdvances += 1;
    } else {
      offense.outsOnBases += 1;
      defense.cutDowns += 1;
      if (attempt.to === "home") defense.homeCutDowns += 1;
    }
    return;
  }

  defense.advanceChances += 1;
  if (!attempt.safe) defense.cutDowns += 1;
}
