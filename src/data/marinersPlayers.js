import { LEAGUE, makeRealHitter, makeRealPitcher, REAL_DEAL_QUOTAS } from "./realPlayers.js";
import { dealPool } from "./playerGeneration.js";

// Mariners-only card set spanning the whole franchise, 1977-2025. Rows follow
// the realPlayers.js convention: approximate season stat lines, hand-entered
// and rounded, with scouting-style speed/fielding on the generated pool's
// scales. BB columns fold in HBP where it meaningfully moves an on-base
// profile. The set deliberately mixes tiers — franchise legends, solid
// regulars, cult heroes, and honest scrubs — because each draft deals only a
// seeded slice of it (see buildMarinersDraftPool), so no two nights fight
// over the same cards.
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
  ["Tom Murphy", 2019, "C", "R", 5, 7, 281, 67, 10, 1, 18, 21, 87],
  ["Bob Stinson", 1977, "C", "S", 4, 6, 416, 92, 19, 2, 6, 44, 65],
  ["Jim Sundberg", 1984, "C", "R", 4, 8, 380, 88, 15, 1, 2, 38, 37],
  ["Scott Bradley", 1987, "C", "L", 5, 6, 380, 95, 15, 1, 5, 17, 18],
  ["Miguel Olivo", 2011, "C", "R", 5, 5, 507, 109, 19, 1, 19, 10, 140],
  ["Alvin Davis", 1984, "1B", "L", 5, 1, 678, 161, 34, 3, 27, 97, 78],
  ["John Olerud", 2001, "1B", "L", 5, 1, 680, 173, 32, 1, 21, 94, 70],
  ["Tino Martinez", 1995, "1B", "L", 5, 1, 594, 152, 35, 3, 31, 62, 91],
  ["Richie Sexson", 2005, "1B", "R", 4, 0, 656, 147, 36, 1, 39, 89, 167],
  ["Ty France", 2022, "1B", "R", 4, 1, 613, 157, 27, 1, 20, 35, 94],
  ["Josh Naylor", 2025, "1B", "L", 9, 1, 640, 170, 28, 1, 20, 48, 85],
  ["Bruce Bochte", 1979, "1B", "L", 4, 1, 645, 182, 38, 2, 16, 59, 71],
  ["David Segui", 1998, "1B", "S", 5, 1, 625, 178, 36, 2, 19, 32, 80],
  ["Paul Sorrento", 1996, "1B", "L", 4, 0, 600, 136, 32, 1, 23, 57, 103],
  ["Pete O'Brien", 1990, "1B", "L", 4, 1, 470, 95, 15, 1, 5, 44, 60],
  ["Justin Smoak", 2013, "1B", "S", 3, 1, 521, 108, 19, 0, 20, 64, 111],
  ["Logan Morrison", 2015, "1B", "L", 4, 1, 511, 103, 16, 2, 17, 47, 87],
  ["Bret Boone", 2001, "2B", "R", 9, 5, 690, 206, 37, 3, 37, 40, 110],
  ["Harold Reynolds", 1989, "2B", "S", 16, 5, 678, 184, 24, 9, 0, 55, 45],
  ["Robinson Cano", 2016, "2B", "L", 6, 5, 715, 195, 33, 2, 39, 47, 100],
  ["Joey Cora", 1997, "2B", "S", 13, 3, 636, 172, 40, 4, 11, 53, 49],
  ["Jorge Polanco", 2025, "2B", "S", 7, 3, 540, 130, 25, 1, 26, 40, 110],
  ["Julio Cruz", 1978, "2B", "S", 18, 4, 631, 129, 12, 6, 1, 79, 68],
  ["Danny Tartabull", 1986, "2B", "R", 8, 2, 580, 138, 25, 6, 25, 61, 157],
  ["Dylan Moore", 2024, "2B", "R", 15, 4, 465, 81, 15, 3, 10, 51, 120],
  ["David Bell", 1999, "2B", "R", 6, 4, 634, 161, 32, 3, 21, 33, 101],
  ["Jack Perconte", 1984, "2B", "L", 13, 4, 612, 162, 18, 5, 0, 46, 45],
  ["Chone Figgins", 2010, "2B", "S", 15, 3, 702, 156, 21, 3, 1, 74, 114],
  ["Kyle Seager", 2016, "3B", "L", 5, 3, 676, 166, 36, 3, 30, 69, 108],
  ["Adrian Beltre", 2007, "3B", "R", 8, 3, 646, 164, 41, 2, 26, 38, 104],
  ["Edgar Martinez", 1992, "3B", "R", 5, 2, 592, 181, 46, 3, 18, 54, 61],
  ["Edgar Martinez", 1990, "3B", "R", 5, 2, 573, 147, 27, 2, 11, 74, 62],
  ["Jim Presley", 1985, "3B", "R", 4, 2, 620, 157, 33, 1, 28, 44, 100],
  ["Mike Blowers", 1995, "3B", "R", 4, 2, 510, 113, 24, 1, 23, 53, 128],
  ["Eugenio Suarez", 2025, "3B", "R", 7, 2, 670, 140, 24, 0, 49, 50, 192],
  ["Russ Davis", 1999, "3B", "R", 4, 2, 465, 104, 21, 1, 21, 34, 118],
  ["Willie Bloomquist", 2008, "3B", "R", 13, 2, 197, 46, 3, 2, 0, 27, 30],
  ["Jeff Cirillo", 2002, "3B", "R", 5, 3, 528, 121, 21, 2, 6, 26, 56],
  ["Alex Rodriguez", 1996, "SS", "R", 12, 4, 677, 215, 54, 1, 36, 59, 104],
  ["Alex Rodriguez", 1998, "SS", "R", 14, 4, 748, 213, 35, 5, 42, 51, 121],
  ["Omar Vizquel", 1992, "SS", "S", 11, 6, 522, 142, 20, 4, 0, 32, 38],
  ["Carlos Guillen", 2003, "SS", "S", 8, 3, 455, 113, 21, 3, 7, 50, 62],
  ["J.P. Crawford", 2023, "SS", "L", 8, 5, 638, 145, 35, 0, 19, 94, 126],
  ["Jean Segura", 2017, "SS", "R", 12, 4, 568, 157, 30, 2, 11, 34, 83],
  ["Rey Quinones", 1987, "SS", "R", 8, 4, 510, 132, 30, 3, 12, 24, 52],
  ["Brendan Ryan", 2011, "SS", "R", 9, 6, 480, 108, 21, 2, 3, 39, 90],
  ["Spike Owen", 1984, "SS", "S", 10, 4, 576, 130, 18, 8, 3, 46, 63],
  ["Craig Reynolds", 1978, "SS", "L", 8, 4, 590, 160, 16, 7, 5, 36, 42],
  ["Yuniesky Betancourt", 2007, "SS", "R", 7, 4, 560, 155, 38, 2, 9, 15, 48],
  ["Ketel Marte", 2016, "SS", "S", 14, 4, 466, 113, 21, 2, 1, 18, 84],
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
  ["Jose Guillen", 2007, "LF/RF", "R", 6, 2, 652, 172, 28, 2, 23, 51, 118],
  ["Teoscar Hernandez", 2023, "LF/RF", "R", 8, 1, 678, 161, 29, 3, 26, 34, 211],
  ["Mickey Brantley", 1987, "LF/RF", "R", 9, 1, 370, 106, 20, 2, 14, 18, 51],
  ["Mark McLemore", 2001, "LF/RF", "S", 14, 2, 490, 117, 20, 2, 5, 71, 78],
  ["Ben Gamel", 2017, "LF/RF", "L", 10, 1, 550, 140, 27, 2, 11, 36, 122],
  ["Dan Meyer", 1977, "LF/RF", "L", 6, 1, 625, 159, 24, 4, 22, 43, 51],
  ["Jose Cruz Jr.", 1997, "LF/RF", "S", 10, 2, 183, 44, 8, 0, 12, 16, 45],
  ["Jesse Winker", 2022, "LF/RF", "L", 4, 0, 547, 104, 19, 0, 14, 77, 103],
  ["Ken Griffey Jr.", 1993, "CF", "L", 13, 3, 691, 180, 38, 3, 45, 100, 91],
  ["Ken Griffey Jr.", 1997, "CF", "L", 12, 3, 704, 185, 34, 3, 56, 84, 121],
  ["Julio Rodriguez", 2025, "CF", "R", 15, 3, 700, 172, 32, 2, 32, 42, 165],
  ["Mike Cameron", 2001, "CF", "R", 14, 3, 636, 144, 30, 5, 25, 75, 155],
  ["Franklin Gutierrez", 2009, "CF", "R", 11, 3, 629, 160, 24, 2, 18, 46, 122],
  ["Franklin Gutierrez", 2015, "CF", "R", 10, 3, 190, 50, 9, 0, 13, 13, 53],
  ["Ruppert Jones", 1977, "CF", "L", 11, 2, 660, 157, 26, 8, 24, 55, 120],
  ["Dave Henderson", 1984, "CF", "R", 9, 3, 372, 98, 23, 0, 14, 19, 56],
  ["Leonys Martin", 2016, "CF", "L", 14, 3, 576, 128, 16, 2, 15, 45, 149],
  ["Jarred Kelenic", 2023, "CF", "L", 10, 2, 416, 96, 20, 2, 11, 31, 130],
  ["Henry Cotto", 1988, "CF", "R", 14, 2, 400, 100, 18, 1, 8, 23, 53],
  ["Edgar Martinez", 1995, "DH", "R", 4, 0, 639, 182, 52, 0, 29, 118, 87],
  ["Edgar Martinez", 2000, "DH", "R", 4, 0, 667, 180, 31, 0, 37, 105, 90],
  ["Ken Phelps", 1987, "DH", "L", 3, 0, 420, 86, 13, 1, 27, 80, 75],
  ["Gorman Thomas", 1985, "DH", "R", 3, 0, 580, 104, 13, 0, 32, 84, 126],
  ["Nelson Cruz", 2016, "DH", "R", 4, 0, 667, 169, 27, 1, 43, 68, 159],
  ["Willie Horton", 1979, "DH", "R", 3, 0, 700, 180, 20, 3, 29, 42, 93],
  ["Richie Zisk", 1981, "DH", "R", 3, 0, 397, 111, 19, 1, 16, 34, 57],
  ["Jose Vidro", 2007, "DH", "S", 4, 0, 590, 172, 24, 1, 6, 39, 48],
  ["Kendrys Morales", 2013, "DH", "S", 3, 0, 657, 167, 34, 0, 23, 49, 114]
];

// name, season, role, throws, IP, GS, H, HR, BB, SO
const PITCHER_ROWS = [
  ["Randy Johnson", 1995, "SP", "L", 214, 30, 159, 12, 65, 294],
  ["Randy Johnson", 1993, "SP", "L", 255, 35, 185, 22, 99, 308],
  ["Felix Hernandez", 2010, "SP", "R", 250, 34, 194, 17, 70, 232],
  ["Felix Hernandez", 2014, "SP", "R", 236, 34, 170, 16, 46, 248],
  ["Mark Langston", 1987, "SP", "L", 272, 35, 242, 30, 114, 262],
  ["Floyd Bannister", 1982, "SP", "L", 247, 35, 225, 32, 77, 209],
  ["Mike Moore", 1985, "SP", "R", 247, 34, 230, 21, 70, 155],
  ["Erik Hanson", 1990, "SP", "R", 236, 33, 205, 17, 68, 211],
  ["Jamie Moyer", 2001, "SP", "L", 210, 33, 187, 23, 44, 119],
  ["Jamie Moyer", 2003, "SP", "L", 215, 33, 199, 19, 66, 129],
  ["Freddy Garcia", 2001, "SP", "R", 239, 34, 199, 16, 69, 163],
  ["Hisashi Iwakuma", 2013, "SP", "R", 220, 33, 179, 25, 42, 185],
  ["James Paxton", 2018, "SP", "L", 160, 28, 134, 23, 42, 208],
  ["Luis Castillo", 2023, "SP", "R", 197, 33, 160, 28, 47, 219],
  ["George Kirby", 2023, "SP", "R", 191, 31, 179, 19, 19, 172],
  ["Bryan Woo", 2025, "SP", "R", 186, 30, 140, 20, 26, 198],
  ["Logan Gilbert", 2025, "SP", "R", 145, 26, 110, 15, 30, 170],
  ["Glenn Abbott", 1977, "SP", "R", 204, 31, 212, 21, 56, 100],
  ["Gaylord Perry", 1982, "SP", "R", 217, 32, 245, 23, 54, 116],
  ["Matt Young", 1983, "SP", "L", 203, 32, 178, 17, 79, 130],
  ["Scott Bankhead", 1989, "SP", "R", 210, 33, 187, 19, 63, 140],
  ["Dave Fleming", 1992, "SP", "L", 228, 33, 225, 13, 60, 112],
  ["Aaron Sele", 2001, "SP", "R", 215, 34, 216, 20, 51, 114],
  ["Joel Pineiro", 2002, "SP", "R", 194, 28, 188, 19, 54, 136],
  ["Erik Bedard", 2008, "SP", "L", 81, 15, 70, 8, 37, 72],
  ["Doug Fister", 2011, "SP", "R", 146, 21, 145, 5, 32, 89],
  ["Marco Gonzales", 2019, "SP", "L", 203, 34, 210, 23, 56, 147],
  ["Diego Segui", 1977, "SP", "R", 111, 21, 108, 14, 57, 71],
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
  ["Rafael Soriano", 2006, "RP", "R", 60, 0, 45, 4, 21, 65],
  ["Shigetoshi Hasegawa", 2003, "RP", "R", 73, 0, 57, 2, 18, 32],
  ["Tom Wilhelmsen", 2012, "RP", "R", 73, 0, 52, 3, 29, 87],
  ["Bobby Ayala", 1994, "RP", "R", 57, 0, 42, 4, 26, 76],
  ["Mike Jackson", 1991, "RP", "R", 89, 0, 64, 5, 34, 74],
  ["Ed Vande Berg", 1982, "RP", "L", 76, 0, 61, 3, 24, 71],
  ["Brandon League", 2011, "RP", "R", 61, 0, 58, 4, 12, 45],
  ["Fernando Rodney", 2014, "RP", "R", 66, 0, 46, 2, 28, 76],
  ["Carson Smith", 2015, "RP", "R", 70, 0, 49, 2, 22, 92],
  ["Matt Brash", 2023, "RP", "R", 71, 0, 59, 3, 28, 107]
];

// The complete card set: every Mariner ever made into a card.
export function buildMarinersPool() {
  const hitters = HITTER_ROWS.map((row) => makeMariner(row, makeRealHitter, "sea-h"));
  const pitchers = PITCHER_ROWS.map((row) => makeMariner(row, makeRealPitcher, "sea-p"));
  return [...hitters, ...pitchers].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

// One draft night's deck: a seeded deal from the full set with the shared
// real-pool quotas, so any deal supports the same manager count. The same
// seed always deals the same deck, which is what lets online rooms rebuild
// an identical pool on every machine.
export function buildMarinersDraftPool(seed) {
  return dealPool(buildMarinersPool(), REAL_DEAL_QUOTAS, `mariners-deal:${seed}`);
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
