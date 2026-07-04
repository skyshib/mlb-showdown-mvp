import { RESULTS } from "../rules/cards.js";
import {
  chartFromCounts,
  chartPower,
  pitcherChartPower,
  speedPoints,
  toChart
} from "./playerGeneration.js?v=20260704-real-players";

// Real-player pool. Cards are derived from approximate 2025 MLB season stat
// lines (hand-entered, rounded; injury-shortened seasons lean on recent form)
// so each card reflects the player's actual skills. Speed and fielding are
// scouting-style ratings on the same scales the generated pool uses.
export const REAL_POOL_SEASON = "2025";

// Environment constants used to translate real rates into card numbers. They
// describe this pool playing against itself, so the derivation stays
// self-consistent: an average pool hitter facing an average pool pitcher
// should reach base at roughly his real-life rate.
export const LEAGUE = {
  obp: 0.312, // approximate 2025 MLB on-base percentage
  poolControl: 4.6, // typical control among this pool's pitchers
  poolOnBase: 11, // typical on-base among this pool's hitters
  pitcherChartOnBase: 0.21, // on-base share of a typical pool pitcher chart
  hitterChartOnBase: 0.58 // on-base share of a typical pool hitter chart
};

// name, team, position, bats, speed, fielding, PA, H, 2B, 3B, HR, BB, SO
const HITTER_ROWS = [
  ["Cal Raleigh", "SEA", "C", "S", 8, 8, 705, 146, 24, 0, 60, 98, 172],
  ["William Contreras", "MIL", "C", "R", 10, 4, 690, 158, 28, 1, 17, 88, 135],
  ["Adley Rutschman", "BAL", "C", "S", 8, 8, 450, 92, 18, 0, 9, 52, 65],
  ["Will Smith", "LAD", "C", "R", 8, 6, 500, 118, 21, 0, 17, 72, 82],
  ["Salvador Perez", "KC", "C", "R", 5, 5, 620, 145, 26, 0, 30, 32, 120],
  ["Austin Wells", "NYY", "C", "L", 8, 7, 430, 85, 17, 1, 21, 38, 105],
  ["Carson Kelly", "CHC", "C", "R", 6, 6, 380, 85, 15, 1, 17, 46, 75],
  ["Vladimir Guerrero Jr.", "TOR", "1B", "R", 7, 1, 680, 175, 30, 1, 23, 85, 90],
  ["Freddie Freeman", "LAD", "1B", "L", 9, 1, 615, 160, 32, 2, 24, 60, 95],
  ["Matt Olson", "ATL", "1B", "L", 7, 1, 700, 170, 39, 0, 29, 90, 150],
  ["Pete Alonso", "NYM", "1B", "R", 6, 0, 695, 165, 41, 1, 38, 70, 140],
  ["Bryce Harper", "PHI", "1B", "L", 10, 1, 550, 130, 28, 0, 27, 65, 120],
  ["Rafael Devers", "SF", "1B", "L", 7, 0, 690, 150, 26, 1, 33, 105, 190],
  ["Josh Naylor", "SEA", "1B", "L", 9, 1, 640, 170, 28, 1, 20, 48, 85],
  ["Ketel Marte", "ARI", "2B", "S", 10, 4, 600, 150, 26, 2, 28, 77, 90],
  ["Jose Altuve", "HOU", "2B", "R", 11, 2, 660, 160, 25, 1, 27, 50, 125],
  ["Marcus Semien", "TEX", "2B", "R", 11, 5, 640, 135, 24, 2, 17, 60, 110],
  ["Ozzie Albies", "ATL", "2B", "S", 12, 4, 680, 150, 24, 1, 16, 50, 100],
  ["Brice Turang", "MIL", "2B", "L", 16, 6, 650, 170, 28, 4, 18, 62, 115],
  ["Jackson Holliday", "BAL", "2B", "L", 13, 3, 630, 145, 25, 4, 17, 48, 140],
  ["Jazz Chisholm Jr.", "NYY", "2B", "L", 15, 4, 600, 130, 22, 3, 31, 68, 145],
  ["Jose Ramirez", "CLE", "3B", "S", 14, 2, 680, 175, 35, 4, 30, 70, 80],
  ["Manny Machado", "SD", "3B", "R", 10, 3, 680, 170, 30, 1, 27, 58, 115],
  ["Alex Bregman", "BOS", "3B", "R", 8, 3, 475, 118, 30, 0, 18, 45, 80],
  ["Junior Caminero", "TB", "3B", "R", 9, 2, 640, 155, 26, 1, 45, 36, 125],
  ["Austin Riley", "ATL", "3B", "R", 8, 2, 440, 105, 22, 0, 16, 34, 115],
  ["Matt Chapman", "SF", "3B", "R", 9, 3, 580, 125, 22, 1, 22, 70, 140],
  ["Eugenio Suarez", "SEA", "3B", "R", 7, 2, 670, 140, 24, 0, 49, 50, 192],
  ["Bobby Witt Jr.", "KC", "SS", "R", 17, 6, 700, 189, 45, 8, 23, 55, 105],
  ["Gunnar Henderson", "BAL", "SS", "L", 14, 4, 640, 160, 30, 5, 17, 58, 130],
  ["Francisco Lindor", "NYM", "SS", "S", 13, 5, 700, 170, 30, 2, 31, 50, 120],
  ["Elly De La Cruz", "CIN", "SS", "S", 19, 4, 690, 165, 30, 7, 22, 65, 190],
  ["Corey Seager", "TEX", "SS", "L", 8, 4, 500, 122, 22, 0, 21, 63, 100],
  ["Trea Turner", "PHI", "SS", "R", 17, 4, 650, 180, 28, 5, 15, 45, 110],
  ["CJ Abrams", "WSH", "SS", "L", 16, 3, 610, 148, 26, 5, 17, 48, 115],
  ["Mookie Betts", "LAD", "SS", "R", 12, 4, 640, 150, 30, 1, 20, 62, 70],
  ["Steven Kwan", "CLE", "LF/RF", "L", 14, 2, 640, 160, 26, 4, 9, 50, 55],
  ["Riley Greene", "DET", "LF/RF", "L", 11, 1, 650, 155, 28, 3, 36, 40, 198],
  ["Jackson Chourio", "MIL", "LF/RF", "R", 15, 1, 600, 155, 30, 5, 21, 32, 105],
  ["James Wood", "WSH", "LF/RF", "L", 12, 1, 680, 150, 26, 3, 31, 90, 200],
  ["Ian Happ", "CHC", "LF/RF", "S", 10, 1, 640, 135, 25, 1, 22, 75, 150],
  ["Christian Yelich", "MIL", "LF/RF", "L", 12, 1, 660, 145, 24, 2, 29, 70, 155],
  ["Pete Crow-Armstrong", "CHC", "CF", "L", 18, 3, 645, 143, 27, 6, 31, 27, 155],
  ["Julio Rodriguez", "SEA", "CF", "R", 15, 3, 700, 172, 32, 2, 32, 42, 165],
  ["Byron Buxton", "MIN", "CF", "R", 16, 3, 520, 125, 22, 4, 35, 42, 140],
  ["Cody Bellinger", "NYY", "CF", "L", 12, 2, 630, 160, 25, 2, 29, 50, 90],
  ["Ceddanne Rafaela", "BOS", "CF", "R", 15, 3, 580, 143, 28, 5, 16, 28, 118],
  ["Jarren Duran", "BOS", "CF", "L", 16, 2, 680, 165, 34, 13, 16, 45, 160],
  ["Michael Harris II", "ATL", "CF", "L", 14, 3, 620, 142, 26, 4, 20, 20, 130],
  ["Aaron Judge", "NYY", "LF/RF", "R", 10, 2, 679, 179, 30, 1, 53, 124, 152],
  ["Juan Soto", "NYM", "LF/RF", "L", 11, 0, 715, 155, 25, 1, 43, 127, 130],
  ["Ronald Acuna Jr.", "ATL", "LF/RF", "R", 14, 2, 480, 115, 18, 1, 21, 70, 105],
  ["Kyle Tucker", "CHC", "LF/RF", "L", 12, 2, 600, 135, 28, 4, 22, 85, 95],
  ["Fernando Tatis Jr.", "SD", "LF/RF", "R", 14, 2, 690, 160, 28, 2, 25, 75, 140],
  ["Corbin Carroll", "ARI", "LF/RF", "L", 18, 2, 650, 150, 26, 17, 31, 55, 130],
  ["Shohei Ohtani", "LAD", "DH", "L", 14, 0, 730, 180, 25, 5, 55, 110, 185],
  ["Yordan Alvarez", "HOU", "DH", "L", 7, 0, 600, 165, 30, 1, 30, 70, 110],
  ["Kyle Schwarber", "PHI", "DH", "L", 7, 0, 730, 155, 20, 1, 56, 105, 185]
];

// name, team, role, throws, IP, GS, H, HR, BB, SO
const PITCHER_ROWS = [
  ["Tarik Skubal", "DET", "SP", "L", 195, 31, 139, 17, 33, 241],
  ["Paul Skenes", "PIT", "SP", "R", 187, 32, 145, 10, 42, 216],
  ["Zack Wheeler", "PHI", "SP", "R", 150, 24, 112, 14, 35, 195],
  ["Garrett Crochet", "BOS", "SP", "L", 205, 32, 158, 15, 46, 255],
  ["Cristopher Sanchez", "PHI", "SP", "L", 202, 32, 175, 9, 42, 212],
  ["Hunter Brown", "HOU", "SP", "R", 185, 31, 140, 15, 52, 206],
  ["Max Fried", "NYY", "SP", "L", 195, 32, 178, 14, 44, 189],
  ["Logan Webb", "SF", "SP", "R", 207, 33, 190, 14, 38, 224],
  ["Framber Valdez", "HOU", "SP", "L", 192, 31, 165, 15, 58, 187],
  ["Yoshinobu Yamamoto", "LAD", "SP", "R", 174, 30, 127, 13, 59, 201],
  ["Jacob deGrom", "TEX", "SP", "R", 172, 30, 135, 16, 30, 185],
  ["Freddy Peralta", "MIL", "SP", "R", 177, 33, 130, 18, 60, 204],
  ["Joe Ryan", "MIN", "SP", "R", 171, 30, 130, 18, 30, 194],
  ["Nathan Eovaldi", "TEX", "SP", "R", 130, 22, 90, 6, 18, 130],
  ["Logan Gilbert", "SEA", "SP", "R", 145, 26, 110, 15, 30, 170],
  ["Bryan Woo", "SEA", "SP", "R", 186, 30, 140, 20, 26, 198],
  ["MacKenzie Gore", "WSH", "SP", "L", 165, 30, 140, 14, 55, 185],
  ["Sonny Gray", "STL", "SP", "R", 180, 32, 165, 18, 30, 190],
  ["Kevin Gausman", "TOR", "SP", "R", 193, 32, 165, 18, 40, 189],
  ["Trevor Rogers", "BAL", "SP", "L", 110, 18, 75, 6, 25, 95],
  ["Ranger Suarez", "PHI", "SP", "L", 157, 26, 140, 10, 35, 151],
  ["Shota Imanaga", "CHC", "SP", "L", 145, 25, 116, 25, 26, 130],
  ["Mason Miller", "SD", "RP", "R", 60, 0, 35, 5, 25, 95],
  ["Josh Hader", "HOU", "RP", "L", 60, 0, 35, 5, 20, 85],
  ["Edwin Diaz", "NYM", "RP", "R", 66, 0, 40, 3, 25, 95],
  ["Andres Munoz", "SEA", "RP", "R", 64, 0, 37, 3, 25, 83],
  ["Jhoan Duran", "PHI", "RP", "R", 65, 0, 50, 3, 20, 75],
  ["Aroldis Chapman", "BOS", "RP", "L", 61, 0, 30, 2, 17, 85],
  ["Cade Smith", "CLE", "RP", "R", 70, 0, 50, 4, 20, 90],
  ["Griffin Jax", "TB", "RP", "R", 65, 0, 55, 4, 15, 85],
  ["Robert Suarez", "SD", "RP", "R", 65, 0, 50, 8, 20, 70],
  ["Raisel Iglesias", "ATL", "RP", "R", 63, 0, 50, 8, 12, 70],
  ["Trevor Megill", "MIL", "RP", "R", 55, 0, 40, 4, 18, 65],
  ["Felix Bautista", "BAL", "RP", "R", 35, 0, 20, 2, 15, 50],
  ["David Bednar", "NYY", "RP", "R", 60, 0, 45, 5, 18, 80],
  ["Randy Rodriguez", "SF", "RP", "R", 65, 0, 40, 3, 15, 85]
];

export function buildRealPlayerPool() {
  const hitters = HITTER_ROWS.map((row) => makeRealHitter(row));
  const pitchers = PITCHER_ROWS.map((row) => makeRealPitcher(row));
  return [...hitters, ...pitchers].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

export function maxRealPoolManagers(pool = buildRealPlayerPool()) {
  const hitters = pool.filter((player) => player.kind === "hitter");
  const pitchers = pool.filter((player) => player.kind === "pitcher");
  const countPosition = (position) => hitters.filter((player) => player.position === position).length;
  const cornerOutfield = countPosition("LF/RF");
  return Math.min(
    ...["C", "2B", "3B", "SS", "CF"].map(countPosition),
    Math.floor(cornerOutfield / 2),
    Math.floor(hitters.length / 9),
    Math.floor(pitchers.filter((player) => player.role === "SP").length / 2),
    Math.floor(pitchers.filter((player) => player.role !== "SP").length / 2),
    Math.floor(pool.length / 13)
  );
}

// Other pools reuse the card math via options: idPrefix/idSuffix keep ids
// unique across pools (and across two cards of the same player), and obpShift
// re-centers a stat line from another run environment onto the LEAGUE
// baseline before rates become card numbers (see marinersPlayers.js).
export function makeRealHitter(row, { idPrefix = "real-h", idSuffix = "", obpShift = 0 } = {}) {
  const [name, team, position, bats, speed, fielding, pa, h, doubles, triples, hr, bb, so] = row;
  const obp = (h + bb) / pa - obpShift;
  const onBase = clamp(Math.round(10.5 + (obp - LEAGUE.obp) * 25), 7, 16);
  const hitterChartProb = clamp((onBase - LEAGUE.poolControl) / 20, 0.05, 0.95);
  const onBaseShare = clamp(
    (obp - (1 - hitterChartProb) * LEAGUE.pitcherChartOnBase) / hitterChartProb,
    0.4,
    0.95
  );
  const onBaseSlots = clamp(Math.round(onBaseShare * 20), 8, 19);
  const outSlots = 20 - onBaseSlots;

  const singles = Math.max(0, h - doubles - triples - hr);
  const onBaseCounts = allocateSlots(onBaseSlots, [bb, singles, doubles, triples, hr]);
  const strikeoutShare = clamp(so / Math.max(1, pa - h - bb), 0, 1);
  const outCounts = allocateSlots(outSlots, [
    strikeoutShare,
    (1 - strikeoutShare) * 0.55,
    (1 - strikeoutShare) * 0.45
  ]);

  const chart = chartFromCounts([
    [RESULTS.SO, outCounts[0]],
    [RESULTS.GB, outCounts[1]],
    [RESULTS.FB, outCounts[2]],
    [RESULTS.BB, onBaseCounts[0]],
    [RESULTS.SINGLE, onBaseCounts[1]],
    [RESULTS.DOUBLE, onBaseCounts[2]],
    [RESULTS.TRIPLE, onBaseCounts[3]],
    [RESULTS.HR, onBaseCounts[4]]
  ]);

  return {
    id: `${idPrefix}-${slug(name)}${idSuffix ? `-${idSuffix}` : ""}`,
    kind: "hitter",
    name,
    team,
    position,
    bats,
    onBase,
    speed,
    fielding,
    points: onBase * 20 + fielding * 7 + speedPoints(speed) + chartPower(chart),
    chart: toChart(chart)
  };
}

export function makeRealPitcher(row, { idPrefix = "real-p", idSuffix = "", obpShift = 0 } = {}) {
  const [name, team, role, throws, inningsPitched, gs, h, hr, bb, so] = row;
  const battersFaced = Math.round(3 * inningsPitched + h + bb);
  const obpAllowed = (h + bb) / battersFaced - obpShift;
  const control = clamp(Math.round(3.2 + (0.3 - obpAllowed) * 28), 0, 6);
  const hitterChartProb = clamp((LEAGUE.poolOnBase - control) / 20, 0.05, 0.95);
  const onBaseShare = clamp(
    (obpAllowed - hitterChartProb * LEAGUE.hitterChartOnBase) / (1 - hitterChartProb),
    0.05,
    0.4
  );
  const onBaseSlots = clamp(Math.round(onBaseShare * 20), 1, 6);
  const outSlots = 20 - onBaseSlots;

  const nonHrHits = Math.max(0, h - hr);
  const onBaseCounts = allocateSlots(onBaseSlots, [bb, nonHrHits * 0.7, nonHrHits * 0.3, hr]);
  const strikeoutShare = clamp(so / Math.max(1, battersFaced - h - bb), 0, 1);
  const outCounts = allocateSlots(outSlots, [
    (1 - strikeoutShare) * 0.15,
    strikeoutShare,
    (1 - strikeoutShare) * 0.5,
    (1 - strikeoutShare) * 0.35
  ]);

  const chart = chartFromCounts([
    [RESULTS.PU, outCounts[0]],
    [RESULTS.SO, outCounts[1]],
    [RESULTS.GB, outCounts[2]],
    [RESULTS.FB, outCounts[3]],
    [RESULTS.BB, onBaseCounts[0]],
    [RESULTS.SINGLE, onBaseCounts[1]],
    [RESULTS.DOUBLE, onBaseCounts[2]],
    [RESULTS.HR, onBaseCounts[3]]
  ]);

  const ip = role === "SP" ? clamp(Math.round(inningsPitched / Math.max(1, gs)), 5, 8) : 1;

  return {
    id: `${idPrefix}-${slug(name)}${idSuffix ? `-${idSuffix}` : ""}`,
    kind: "pitcher",
    name,
    team,
    role,
    throws,
    control,
    ip,
    points: control * 35 + ip * 8 + pitcherChartPower(chart),
    chart: toChart(chart)
  };
}

// Deterministic largest-remainder rounding: weights become slot counts that
// sum exactly to total, with ties broken by list order.
function allocateSlots(total, weights) {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return weights.map(() => 0);
  if (weightTotal <= 0) return weights.map((_, index) => (index === 0 ? total : 0));
  const raw = weights.map((weight) => (weight / weightTotal) * total);
  const counts = raw.map((value) => Math.floor(value));
  let remaining = total - counts.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remaining; i += 1) counts[order[i % order.length].index] += 1;
  return counts;
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
