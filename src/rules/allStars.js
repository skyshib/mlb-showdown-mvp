// Left and right field are one position everywhere analysis looks at a card: an
// LF/RF card plays either corner at the same glove, so the two corners pool into
// a single field of candidates with a single positional average.
export const CORNER_OUTFIELD_POSITION = "LF/RF";
export const ALL_STAR_POSITIONS = ["C", "1B", "2B", "3B", "SS", CORNER_OUTFIELD_POSITION, "CF", "DH", "SP", "RP"];
const INLINE_ALL_STAR_DEPTH_LIMIT = 5;

// The position a card is analysed at: the lineup slot it filled, with left and
// right lumped. Mirrors replacementSlotFor in attribution.js, which sends both
// corners to the one LF/RF replacement card.
export function analysisPosition(position) {
  if (position === "LF" || position === "RF" || position === CORNER_OUTFIELD_POSITION) return CORNER_OUTFIELD_POSITION;
  return position;
}

// Ranks each position on WPA over replacement (WPAR) when the sim measured it,
// and on WPA for sims that predate it. Every candidate carries both.
export function buildAllStarDepthChart(teams, summary) {
  const byWpar = Boolean(summary?.attribution);
  const value = byWpar ? (candidate) => candidate.wparPer162 : (candidate) => candidate.wpaPer162;
  const hitterLines = statLineIndex(summary?.hitters ?? []);
  const pitcherLines = statLineIndex(summary?.pitchers ?? []);
  const candidates = new Map(ALL_STAR_POSITIONS.map((position) => [position, []]));

  for (const team of teams ?? []) {
    for (const player of team.lineup ?? []) {
      const position = analysisPosition(player.assignedPosition ?? player.defensivePosition);
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
      .sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name) || a.team.localeCompare(b.team));
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

// WPAA: WPAR read against the league's average WPAR at the same position, so a
// catcher is measured against catchers rather than against the room's whole
// field. The average is taken over the cards the rooms rostered at that position
// — every club's lineup regular there, every rostered starter, every rostered
// reliever — so a bench card is held to the same yardstick as the regular he
// sits behind without dragging that yardstick down.
//
// `value` picks which WPAR is averaged; the pitchers' Not-tired split hands over
// its own so the split's WPAA is measured against the split's average.
export function buildWpaaIndex(teams, summary, { value = (line) => line.warPer162?.total } = {}) {
  if (!summary?.attribution) return null;
  const hitterLines = statLineIndex(summary.hitters ?? []);
  const pitcherLines = statLineIndex(summary.pitchers ?? []);
  const positionById = new Map();
  const totals = new Map();

  const register = (player, team, lines, position) => {
    if (!player?.id || !position) return;
    positionById.set(player.id, position);
    const line = findLine(lines, team, player);
    const wpar = Number(value(line ?? {}));
    if (!Number.isFinite(wpar)) return;
    const bucket = totals.get(position) ?? { sum: 0, count: 0 };
    bucket.sum += wpar;
    bucket.count += 1;
    totals.set(position, bucket);
  };

  for (const team of teams ?? []) {
    for (const player of team.lineup ?? []) {
      register(player, team.name, hitterLines, analysisPosition(player.assignedPosition ?? player.defensivePosition ?? player.position));
    }
    for (const player of team.starters ?? []) register(player, team.name, pitcherLines, "SP");
    for (const player of team.bullpen ?? []) register(player, team.name, pitcherLines, "RP");
  }

  const averages = new Map([...totals].map(([position, bucket]) => [position, bucket.sum / bucket.count]));
  // A card that never took a roster spot — a bench bat that got into games, an
  // arm the auto-manager reached for — is read at the position printed on it.
  const positionOf = (line) => positionById.get(line?.id)
    ?? analysisPosition(line?.role ?? line?.fieldPosition ?? line?.position);
  const wpaaByPlayerId = new Map();
  for (const line of [...(summary.hitters ?? []), ...(summary.pitchers ?? [])]) {
    if (line?.id == null) continue;
    const wpar = Number(value(line));
    const average = averages.get(positionOf(line));
    if (!Number.isFinite(wpar) || !Number.isFinite(average)) continue;
    wpaaByPlayerId.set(line.id, wpar - average);
  }

  return {
    averages,
    positionOf,
    wpaaByPlayerId,
    wpaaFor: (line) => (line?.id == null ? null : wpaaByPlayerId.get(line.id) ?? null)
  };
}

export function allStarComparisonCandidates(depth) {
  if (!Array.isArray(depth)) return [];
  return depth.length <= INLINE_ALL_STAR_DEPTH_LIMIT
    ? depth.slice(1)
    : depth.slice(1, 3);
}

export function shouldShowFullAllStarDepth(depth) {
  return Array.isArray(depth) && depth.length > INLINE_ALL_STAR_DEPTH_LIMIT;
}

function statLineIndex(lines) {
  const index = new Map();
  for (const line of lines) {
    index.set(`${line.team}\u0000${line.id}`, line);
    index.set(`${line.team}\u0000${line.name}`, line);
  }
  return index;
}

function findLine(lines, team, player) {
  return lines.get(`${team}\u0000${player.id}`) ?? lines.get(`${team}\u0000${player.name}`) ?? null;
}

function addCandidate(bucket, player, team, lines) {
  if (!bucket || !player) return;
  const line = findLine(lines, team, player);
  if (!line) return;
  bucket.push({
    id: player.id,
    name: player.name,
    team,
    player,
    wpaPer162: Number.isFinite(line.wpaPer162) ? line.wpaPer162 : 0,
    wparPer162: Number.isFinite(line.warPer162?.total) ? line.warPer162.total : 0
  });
}
