import { LEAGUE, makeRealHitter, makeRealPitcher } from "./realPlayers.js?v=20260704-real-players";

// Mariners-only pool spanning the whole franchise, 1977-2025. Rows follow the
// realPlayers.js convention: approximate season stat lines, hand-entered and
// rounded, with scouting-style speed/fielding on the generated pool's scales.
// BB columns fold in HBP where it meaningfully moves an on-base profile.
export const MARINERS_POOL_ERAS = "'77-'25";

// Approximate league OBP for each stretch of franchise history. A card's stat
// line is re-centered onto the LEAGUE baseline (eraObp - LEAGUE.obp becomes
// obpShift) so a .350 OBP from the 1996 launching pad and one from a 2023
// pitcher's year stop reading as the same skill.
const ERA_OBP = [
  [1992, 0.325], // expansion era through 1992
  [2000, 0.345], // the mid-90s offense spike
  [2009, 0.333], // early Safeco years
  [2019, 0.318], // the 2010s run drought
  [Infinity, LEAGUE.obp] // 2020s baseline the card math is calibrated to
];

// name, season, position, bats, speed, fielding, PA, H, 2B, 3B, HR, BB, SO
const HITTER_ROWS = [
  ["Cal Raleigh", 2025, "C", "S", 8, 8, 705, 146, 24, 0, 60, 98, 172],
  ["Dan Wilson", 1996, "C", "R", 6, 8, 530, 140, 24, 0, 18, 32, 88],
  ["Mike Zunino", 2017, "C", "R", 5, 7, 435, 97, 25, 0, 25, 39, 160],
  ["Kenji Johjima", 2006, "C", "R", 6, 7, 542, 147, 25, 1, 18, 20, 46],
  ["Dave Valle", 1993, "C", "R", 4, 7, 507, 109, 19, 0, 13, 48, 56],
  ["Alvin Davis", 1984, "1B", "L", 5, 1, 678, 161, 34, 3, 27, 97, 78],
  ["John Olerud", 2001, "1B", "L", 5, 1, 680, 173, 32, 1, 21, 94, 70],
  ["Tino Martinez", 1995, "1B", "L", 5, 1, 594, 152, 35, 3, 31, 62, 91],
  ["Richie Sexson", 2005, "1B", "R", 4, 0, 656, 147, 36, 1, 39, 89, 167],
  ["Ty France", 2022, "1B", "R", 4, 1, 613, 157, 27, 1, 20, 35, 94],
  ["Josh Naylor", 2025, "1B", "L", 9, 1, 640, 170, 28, 1, 20, 48, 85],
  ["Bret Boone", 2001, "2B", "R", 9, 5, 690, 206, 37, 3, 37, 40, 110],
  ["Harold Reynolds", 1989, "2B", "S", 16, 5, 678, 184, 24, 9, 0, 55, 45],
  ["Robinson Cano", 2016, "2B", "L", 6, 5, 715, 195, 33, 2, 39, 47, 100],
  ["Joey Cora", 1997, "2B", "S", 13, 3, 636, 172, 40, 4, 11, 53, 49],
  ["Jorge Polanco", 2025, "2B", "S", 7, 3, 540, 130, 25, 1, 26, 40, 110],
  ["Julio Cruz", 1978, "2B", "S", 18, 4, 631, 129, 12, 6, 1, 79, 68],
  ["Kyle Seager", 2016, "3B", "L", 5, 3, 676, 166, 36, 3, 30, 69, 108],
  ["Adrian Beltre", 2007, "3B", "R", 8, 3, 646, 164, 41, 2, 26, 38, 104],
  ["Edgar Martinez", 1992, "3B", "R", 5, 2, 592, 181, 46, 3, 18, 54, 61],
  ["Jim Presley", 1985, "3B", "R", 4, 2, 620, 157, 33, 1, 28, 44, 100],
  ["Mike Blowers", 1995, "3B", "R", 4, 2, 510, 113, 24, 1, 23, 53, 128],
  ["Eugenio Suarez", 2025, "3B", "R", 7, 2, 670, 140, 24, 0, 49, 50, 192],
  ["Alex Rodriguez", 1996, "SS", "R", 12, 4, 677, 215, 54, 1, 36, 59, 104],
  ["Omar Vizquel", 1992, "SS", "S", 11, 6, 522, 142, 20, 4, 0, 32, 38],
  ["Carlos Guillen", 2003, "SS", "S", 8, 3, 455, 113, 21, 3, 7, 50, 62],
  ["J.P. Crawford", 2023, "SS", "L", 8, 5, 638, 145, 35, 0, 19, 94, 126],
  ["Jean Segura", 2017, "SS", "R", 12, 4, 568, 157, 30, 2, 11, 34, 83],
  ["Ichiro Suzuki", 2001, "LF/RF", "L", 18, 2, 738, 242, 34, 8, 8, 38, 53],
  ["Ichiro Suzuki", 2004, "LF/RF", "L", 17, 2, 762, 262, 24, 5, 8, 53, 63],
  ["Jay Buhner", 1996, "LF/RF", "R", 4, 2, 678, 153, 29, 0, 44, 91, 159],
  ["Phil Bradley", 1985, "LF/RF", "R", 12, 1, 714, 192, 33, 8, 26, 55, 129],
  ["Randy Winn", 2003, "LF/RF", "S", 13, 1, 662, 177, 37, 4, 11, 44, 102],
  ["Raul Ibanez", 2006, "LF/RF", "L", 4, 0, 710, 181, 33, 5, 33, 64, 115],
  ["Nelson Cruz", 2015, "LF/RF", "R", 5, 0, 655, 178, 22, 1, 44, 59, 164],
  ["Leon Roberts", 1978, "LF/RF", "R", 6, 1, 522, 142, 21, 8, 22, 41, 89],
  ["Tom Paciorek", 1981, "LF/RF", "R", 4, 1, 449, 132, 28, 4, 14, 29, 60],
  ["Mitch Haniger", 2018, "LF/RF", "R", 8, 1, 683, 170, 38, 4, 26, 78, 148],
  ["Randy Arozarena", 2025, "LF/RF", "R", 12, 1, 640, 135, 25, 2, 27, 70, 160],
  ["Ken Griffey Jr.", 1993, "CF", "L", 13, 3, 691, 180, 38, 3, 45, 100, 91],
  ["Ken Griffey Jr.", 1997, "CF", "L", 12, 3, 704, 185, 34, 3, 56, 84, 121],
  ["Julio Rodriguez", 2025, "CF", "R", 15, 3, 700, 172, 32, 2, 32, 42, 165],
  ["Mike Cameron", 2001, "CF", "R", 14, 3, 636, 144, 30, 5, 25, 75, 155],
  ["Franklin Gutierrez", 2009, "CF", "R", 11, 3, 629, 160, 24, 2, 18, 46, 122],
  ["Ruppert Jones", 1977, "CF", "L", 11, 2, 660, 157, 26, 8, 24, 55, 120],
  ["Edgar Martinez", 1995, "DH", "R", 4, 0, 639, 182, 52, 0, 29, 118, 87],
  ["Ken Phelps", 1987, "DH", "L", 3, 0, 420, 86, 13, 1, 27, 80, 75],
  ["Gorman Thomas", 1985, "DH", "R", 3, 0, 580, 104, 13, 0, 32, 84, 126]
];

// name, season, role, throws, IP, GS, H, HR, BB, SO
const PITCHER_ROWS = [
  ["Randy Johnson", 1995, "SP", "L", 214, 30, 159, 12, 65, 294],
  ["Felix Hernandez", 2010, "SP", "R", 250, 34, 194, 17, 70, 232],
  ["Felix Hernandez", 2014, "SP", "R", 236, 34, 170, 16, 46, 248],
  ["Mark Langston", 1987, "SP", "L", 272, 35, 242, 30, 114, 262],
  ["Floyd Bannister", 1982, "SP", "L", 247, 35, 225, 32, 77, 209],
  ["Mike Moore", 1985, "SP", "R", 247, 34, 230, 21, 70, 155],
  ["Erik Hanson", 1990, "SP", "R", 236, 33, 205, 17, 68, 211],
  ["Jamie Moyer", 2001, "SP", "L", 210, 33, 187, 23, 44, 119],
  ["Freddy Garcia", 2001, "SP", "R", 239, 34, 199, 16, 69, 163],
  ["Hisashi Iwakuma", 2013, "SP", "R", 220, 33, 179, 25, 42, 185],
  ["James Paxton", 2018, "SP", "L", 160, 28, 134, 23, 42, 208],
  ["Luis Castillo", 2023, "SP", "R", 197, 33, 160, 28, 47, 219],
  ["George Kirby", 2023, "SP", "R", 191, 31, 179, 19, 19, 172],
  ["Bryan Woo", 2025, "SP", "R", 186, 30, 140, 20, 26, 198],
  ["Logan Gilbert", 2025, "SP", "R", 145, 26, 110, 15, 30, 170],
  ["Glenn Abbott", 1977, "SP", "R", 204, 31, 212, 21, 56, 100],
  ["Edwin Diaz", 2018, "RP", "R", 73, 0, 41, 5, 17, 124],
  ["Kazuhiro Sasaki", 2001, "RP", "R", 67, 0, 47, 6, 11, 62],
  ["J.J. Putz", 2007, "RP", "R", 72, 0, 37, 6, 13, 82],
  ["Arthur Rhodes", 2001, "RP", "L", 68, 0, 46, 4, 12, 83],
  ["Jeff Nelson", 1995, "RP", "R", 79, 0, 58, 4, 27, 96],
  ["Norm Charlton", 1995, "RP", "L", 48, 0, 23, 2, 16, 58],
  ["Mike Schooler", 1989, "RP", "R", 77, 0, 58, 3, 19, 69],
  ["Bill Caudill", 1982, "RP", "R", 96, 0, 63, 5, 35, 111],
  ["Andres Munoz", 2025, "RP", "R", 64, 0, 37, 3, 25, 83],
  ["Paul Sewald", 2022, "RP", "R", 64, 0, 37, 7, 19, 72],
  ["Enrique Romo", 1977, "RP", "R", 114, 0, 92, 8, 39, 105],
  ["Rafael Soriano", 2006, "RP", "R", 60, 0, 45, 4, 21, 65]
];

export function buildMarinersPool() {
  const hitters = HITTER_ROWS.map((row) => makeMariner(row, makeRealHitter, "sea-h"));
  const pitchers = PITCHER_ROWS.map((row) => makeMariner(row, makeRealPitcher, "sea-p"));
  return [...hitters, ...pitchers].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function makeMariner(row, make, idPrefix) {
  const [name, season, ...rest] = row;
  const card = make([name, teamLabel(season), ...rest], {
    idPrefix,
    idSuffix: String(season),
    obpShift: eraObp(season) - LEAGUE.obp
  });
  // The era rides in the display name ("Ken Griffey Jr. '97") because no
  // screen renders the team field, and it keeps the two Griffeys tellable
  // apart everywhere: draft table, hover cards, box scores, history.
  return { ...card, name: `${name} ${eraTick(season)}`, season };
}

function teamLabel(season) {
  return `SEA ${eraTick(season)}`;
}

function eraTick(season) {
  return `'${String(season).slice(-2)}`;
}

function eraObp(season) {
  return ERA_OBP.find(([lastSeason]) => season <= lastSeason)[1];
}
