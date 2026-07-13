import { simulateGame } from "./game.js?v=20260713-v";

export function simulateRoundRobin(teams, seed = "tournament") {
  const rotation = createRotationTracker(teams);
  const standings = new Map(
    teams.map((team) => [
      team.name,
      {
        team: team.name,
        wins: 0,
        losses: 0,
        runsFor: 0,
        runsAgainst: 0
      }
    ])
  );
  const games = [];

  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) {
      const away = teams[i];
      const home = teams[j];
      const result = simulateGame(teamForGame(away, rotation), teamForGame(home, rotation), `${seed}-${away.name}-${home.name}`);
      games.push(result);
      applyGameToStandings(standings, result);
    }
  }

  const table = [...standings.values()].sort(
    (a, b) => b.wins - a.wins || b.runsFor - b.runsAgainst - (a.runsFor - a.runsAgainst)
  );

  let final = null;
  if (table.length >= 2) {
    const top = teams.find((team) => team.name === table[0].team);
    const second = teams.find((team) => team.name === table[1].team);
    final = simulateGame(teamForGame(second, rotation), teamForGame(top, rotation), `${seed}-final-${second.name}-${top.name}`);
  }

  return { standings: table, games, final };
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

function applyGameToStandings(standings, result) {
  const away = standings.get(result.away.name);
  const home = standings.get(result.home.name);
  away.runsFor += result.away.runs;
  away.runsAgainst += result.home.runs;
  home.runsFor += result.home.runs;
  home.runsAgainst += result.away.runs;

  if (result.away.runs > result.home.runs) {
    away.wins += 1;
    home.losses += 1;
  } else {
    home.wins += 1;
    away.losses += 1;
  }
}
