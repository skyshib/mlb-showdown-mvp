export const ALL_STAR_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "SP", "RP"];

export function buildAllStarDepthChart(teams, summary) {
  const hitterLines = statLineIndex(summary?.hitters ?? []);
  const pitcherLines = statLineIndex(summary?.pitchers ?? []);
  const candidates = new Map(ALL_STAR_POSITIONS.map((position) => [position, []]));

  for (const team of teams ?? []) {
    for (const player of team.lineup ?? []) {
      const position = player.assignedPosition ?? player.defensivePosition;
      if (!candidates.has(position)) continue;
      addCandidate(candidates.get(position), player, team.name, hitterLines);
    }
    for (const player of team.starters ?? []) {
      addCandidate(candidates.get("SP"), player, team.name, pitcherLines);
    }
    for (const player of team.bullpen ?? []) {
      addCandidate(candidates.get("RP"), player, team.name, pitcherLines);
    }
  }

  return ALL_STAR_POSITIONS.map((position) => {
    const depth = candidates.get(position)
      .sort((a, b) => b.wpaPer162 - a.wpaPer162 || a.name.localeCompare(b.name) || a.team.localeCompare(b.team));
    const leader = depth[0] ?? null;
    return {
      position,
      leader,
      depth: depth.map((candidate, index) => ({
        ...candidate,
        rank: index + 1
      }))
    };
  });
}

function statLineIndex(lines) {
  const index = new Map();
  for (const line of lines) {
    index.set(`${line.team}\u0000${line.id}`, line);
    index.set(`${line.team}\u0000${line.name}`, line);
  }
  return index;
}

function addCandidate(bucket, player, team, lines) {
  if (!bucket || !player) return;
  const line = lines.get(`${team}\u0000${player.id}`) ?? lines.get(`${team}\u0000${player.name}`);
  if (!line) return;
  bucket.push({
    id: player.id,
    name: player.name,
    team,
    player,
    wpaPer162: Number.isFinite(line.wpaPer162) ? line.wpaPer162 : 0
  });
}
