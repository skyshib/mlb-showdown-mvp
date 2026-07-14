import { RESULTS } from "../rules/cards.js?v=20260714-d";
import { maxPoolManagers } from "../rules/draft.js?v=20260714-d";
import {
  chartFromCounts,
  chartPower,
  dealPool,
  pitcherPoints,
  speedPoints,
  toChart
} from "./playerGeneration.js";

// Real-player pool. Cards are derived from approximate, hand-entered MLB stat
// lines so each card reflects the player's actual skills: the 2025 season for
// current players (injury-shortened seasons lean on recent form) plus famous
// seasons from across baseball history. Era lines are raw and unadjusted —
// 1911 Ty Cobb and 2004 Barry Bonds rake exactly as hard as they really did.
// Speed and fielding are scouting-style ratings on the generated pool's scales.
export const REAL_POOL_SEASON = "1901–2025";

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
  ["Alejandro Kirk", "TOR", "C", "R", 3, 7, 510, 133, 22, 0, 11, 45, 55],
  ["Patrick Bailey", "SF", "C", "S", 5, 8, 480, 100, 20, 2, 8, 35, 120],
  ["Logan O'Hoppe", "LAA", "C", "R", 4, 6, 520, 115, 20, 0, 20, 30, 140],
  ["Freddy Fermin", "KC", "C", "R", 5, 7, 380, 95, 15, 1, 7, 22, 55],
  ["Vladimir Guerrero Jr.", "TOR", "1B", "R", 7, 1, 680, 175, 30, 1, 23, 85, 90],
  ["Freddie Freeman", "LAD", "1B", "L", 9, 1, 615, 160, 32, 2, 24, 60, 95],
  ["Matt Olson", "ATL", "1B", "L", 7, 1, 700, 170, 39, 0, 29, 90, 150],
  ["Pete Alonso", "NYM", "1B", "R", 6, 0, 695, 165, 41, 1, 38, 70, 140],
  ["Bryce Harper", "PHI", "1B", "L", 10, 1, 550, 130, 28, 0, 27, 65, 120],
  ["Rafael Devers", "SF", "1B", "L", 7, 0, 690, 150, 26, 1, 33, 105, 190],
  ["Josh Naylor", "SEA", "1B", "L", 9, 1, 640, 170, 28, 1, 20, 48, 85],
  ["Michael Busch", "CHC", "1B", "L", 5, 1, 600, 140, 26, 3, 30, 65, 150],
  ["Spencer Torkelson", "DET", "1B", "R", 4, 0, 600, 133, 25, 1, 28, 65, 160],
  ["Nathaniel Lowe", "WSH", "1B", "L", 4, 1, 600, 140, 25, 1, 16, 60, 140],
  ["Carlos Santana", "CLE", "1B", "S", 4, 1, 580, 118, 20, 1, 15, 70, 100],
  ["Ketel Marte", "ARI", "2B", "S", 10, 4, 600, 150, 26, 2, 28, 77, 90],
  ["Jose Altuve", "HOU", "2B", "R", 11, 2, 660, 160, 25, 1, 27, 50, 125],
  ["Marcus Semien", "TEX", "2B", "R", 11, 5, 640, 135, 24, 2, 17, 60, 110],
  ["Ozzie Albies", "ATL", "2B", "S", 12, 4, 680, 150, 24, 1, 16, 50, 100],
  ["Brice Turang", "MIL", "2B", "L", 16, 6, 650, 170, 28, 4, 18, 62, 115],
  ["Jackson Holliday", "BAL", "2B", "L", 13, 3, 630, 145, 25, 4, 17, 48, 140],
  ["Jazz Chisholm Jr.", "NYY", "2B", "L", 15, 4, 600, 130, 22, 3, 31, 68, 145],
  ["Luis Arraez", "SD", "2B", "L", 8, 3, 650, 190, 30, 3, 4, 32, 30],
  ["Nico Hoerner", "CHC", "2B", "R", 13, 6, 620, 165, 25, 3, 7, 40, 55],
  ["Brendan Donovan", "STL", "2B", "L", 7, 4, 550, 140, 28, 1, 10, 50, 75],
  ["Andres Gimenez", "TOR", "2B", "L", 12, 6, 500, 100, 18, 2, 10, 35, 90],
  ["Jose Ramirez", "CLE", "3B", "S", 14, 2, 680, 175, 35, 4, 30, 70, 80],
  ["Manny Machado", "SD", "3B", "R", 10, 3, 680, 170, 30, 1, 27, 58, 115],
  ["Alex Bregman", "BOS", "3B", "R", 8, 3, 475, 118, 30, 0, 18, 45, 80],
  ["Junior Caminero", "TB", "3B", "R", 9, 2, 640, 155, 26, 1, 45, 36, 125],
  ["Austin Riley", "ATL", "3B", "R", 8, 2, 440, 105, 22, 0, 16, 34, 115],
  ["Matt Chapman", "SF", "3B", "R", 9, 3, 580, 125, 22, 1, 22, 70, 140],
  ["Eugenio Suarez", "SEA", "3B", "R", 7, 2, 670, 140, 24, 0, 49, 50, 192],
  ["Max Muncy", "LAD", "3B", "L", 4, 2, 450, 90, 15, 0, 19, 70, 120],
  ["Ke'Bryan Hayes", "CIN", "3B", "R", 8, 3, 520, 115, 22, 3, 8, 30, 95],
  ["Ryan McMahon", "NYY", "3B", "L", 5, 3, 560, 110, 20, 1, 18, 60, 170],
  ["Brett Baty", "NYM", "3B", "L", 5, 2, 420, 95, 16, 1, 18, 35, 100],
  ["Bobby Witt Jr.", "KC", "SS", "R", 17, 6, 700, 189, 45, 8, 23, 55, 105],
  ["Gunnar Henderson", "BAL", "SS", "L", 14, 4, 640, 160, 30, 5, 17, 58, 130],
  ["Francisco Lindor", "NYM", "SS", "S", 13, 5, 700, 170, 30, 2, 31, 50, 120],
  ["Elly De La Cruz", "CIN", "SS", "S", 19, 4, 690, 165, 30, 7, 22, 65, 190],
  ["Corey Seager", "TEX", "SS", "L", 8, 4, 500, 122, 22, 0, 21, 63, 100],
  ["Trea Turner", "PHI", "SS", "R", 17, 4, 650, 180, 28, 5, 15, 45, 110],
  ["CJ Abrams", "WSH", "SS", "L", 16, 3, 610, 148, 26, 5, 17, 48, 115],
  ["Mookie Betts", "LAD", "SS", "R", 12, 4, 640, 150, 30, 1, 20, 62, 70],
  ["Masyn Winn", "STL", "SS", "R", 13, 6, 600, 145, 28, 3, 15, 40, 110],
  ["Jeremy Pena", "HOU", "SS", "R", 13, 5, 550, 150, 25, 2, 15, 30, 95],
  ["Xavier Edwards", "MIA", "SS", "S", 16, 3, 600, 160, 20, 6, 2, 45, 75],
  ["Miguel Rojas", "LAD", "SS", "R", 6, 5, 320, 72, 12, 1, 5, 20, 40],
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
  ["Brenton Doyle", "COL", "CF", "R", 15, 3, 560, 125, 22, 3, 20, 35, 160],
  ["Victor Scott II", "STL", "CF", "L", 18, 3, 480, 100, 15, 5, 5, 35, 110],
  ["Jake Meyers", "HOU", "CF", "R", 13, 3, 450, 108, 18, 2, 8, 30, 100],
  ["Trent Grisham", "NYY", "CF", "L", 9, 2, 550, 125, 18, 1, 30, 60, 130],
  ["Aaron Judge", "NYY", "LF/RF", "R", 10, 2, 679, 179, 30, 1, 53, 124, 152],
  ["Juan Soto", "NYM", "LF/RF", "L", 11, 0, 715, 155, 25, 1, 43, 127, 130],
  ["Ronald Acuna Jr.", "ATL", "LF/RF", "R", 14, 2, 480, 115, 18, 1, 21, 70, 105],
  ["Kyle Tucker", "CHC", "LF/RF", "L", 12, 2, 600, 135, 28, 4, 22, 85, 95],
  ["Fernando Tatis Jr.", "SD", "LF/RF", "R", 14, 2, 690, 160, 28, 2, 25, 75, 140],
  ["Corbin Carroll", "ARI", "LF/RF", "L", 18, 2, 650, 150, 26, 17, 31, 55, 130],
  ["Wilyer Abreu", "BOS", "LF/RF", "L", 8, 2, 500, 112, 22, 2, 22, 45, 130],
  ["Jurickson Profar", "ATL", "LF/RF", "S", 7, 1, 350, 85, 15, 1, 10, 40, 65],
  ["Tommy Edman", "LAD", "LF/RF", "S", 14, 2, 480, 105, 20, 3, 12, 30, 70],
  ["Lourdes Gurriel Jr.", "ARI", "LF/RF", "R", 6, 1, 580, 138, 26, 1, 18, 35, 110],
  ["Colton Cowser", "BAL", "LF/RF", "L", 10, 2, 480, 100, 18, 2, 20, 50, 145],
  ["Sal Frelick", "MIL", "LF/RF", "L", 13, 2, 580, 155, 22, 4, 6, 45, 70],
  ["Alex Verdugo", "ATL", "LF/RF", "L", 6, 1, 350, 80, 14, 1, 5, 25, 55],
  ["Kike Hernandez", "LAD", "LF/RF", "R", 7, 2, 380, 70, 12, 1, 10, 30, 90],
  ["Shohei Ohtani", "LAD", "DH", "L", 14, 0, 730, 180, 25, 5, 55, 110, 185],
  ["Yordan Alvarez", "HOU", "DH", "L", 7, 0, 600, 165, 30, 1, 30, 70, 110],
  ["Kyle Schwarber", "PHI", "DH", "L", 7, 0, 730, 155, 20, 1, 56, 105, 185],
  ["Marcell Ozuna", "ATL", "DH", "R", 3, 0, 550, 120, 20, 0, 25, 65, 125],
  ["Ben Rice", "NYY", "DH", "L", 6, 0, 500, 115, 22, 2, 25, 55, 115],
  ["Ryan O'Hearn", "SD", "DH", "L", 4, 0, 480, 125, 22, 1, 15, 45, 85],
  ["Jorge Soler", "LAA", "DH", "R", 3, 0, 480, 98, 16, 0, 20, 45, 130],
  // Era players: famous seasons, raw and era-unadjusted. Negro League lines
  // (Gibson, Charleston, Paige) use the now-official MLB statistics; deadball
  // strikeout totals are estimates. Not all stars on purpose — Mendoza,
  // Uecker, Deer, Gaedel, and friends are here for the die-hards.
  ["Johnny Bench '72", "CIN", "C", "R", 8, 10, 651, 145, 22, 2, 40, 100, 84],
  ["Yogi Berra '54", "NYY", "C", "L", 7, 8, 656, 179, 28, 6, 22, 56, 29],
  ["Mike Piazza '97", "LAD", "C", "R", 6, 4, 633, 201, 32, 1, 40, 69, 77],
  ["Ivan Rodriguez '99", "TEX", "C", "R", 10, 10, 630, 199, 29, 1, 35, 24, 91],
  ["Josh Gibson '43", "HG", "C", "R", 8, 7, 285, 109, 15, 3, 13, 50, 12],
  ["Bob Uecker '67", "ATL", "C", "R", 4, 3, 165, 25, 5, 0, 3, 18, 46],
  ["Willians Astudillo '18", "MIN", "C", "R", 8, 5, 97, 33, 7, 1, 3, 2, 3],
  ["Lou Gehrig '27", "NYY", "1B", "L", 9, 1, 717, 218, 52, 18, 47, 109, 84],
  ["Albert Pujols '09", "STL", "1B", "R", 8, 1, 700, 186, 45, 1, 47, 115, 64],
  ["Joey Votto '17", "CIN", "1B", "L", 6, 1, 707, 179, 34, 1, 36, 134, 83],
  ["Mark McGwire '98", "STL", "1B", "R", 4, 0, 681, 152, 21, 0, 70, 162, 155],
  ["Rogers Hornsby '24", "STL", "2B", "R", 11, 3, 640, 227, 43, 14, 25, 89, 32],
  ["Jackie Robinson '49", "BRO", "2B", "R", 16, 4, 704, 203, 38, 12, 16, 86, 27],
  ["Joe Morgan '75", "CIN", "2B", "L", 15, 5, 639, 163, 27, 6, 17, 132, 52],
  ["Craig Biggio '97", "HOU", "2B", "R", 14, 4, 744, 191, 37, 8, 22, 84, 107],
  ["Mike Schmidt '80", "PHI", "3B", "R", 9, 3, 624, 157, 25, 8, 48, 89, 119],
  ["George Brett '80", "KC", "3B", "L", 11, 2, 515, 175, 33, 9, 24, 58, 22],
  ["Wade Boggs '87", "BOS", "3B", "L", 8, 2, 667, 200, 40, 6, 24, 105, 48],
  ["Brooks Robinson '64", "BAL", "3B", "R", 8, 3, 668, 194, 35, 3, 28, 51, 64],
  ["Chipper Jones '99", "ATL", "3B", "S", 10, 2, 701, 181, 41, 1, 45, 126, 94],
  ["Honus Wagner '08", "PIT", "SS", "R", 15, 5, 641, 201, 39, 19, 10, 54, 40],
  ["Cal Ripken Jr. '91", "BAL", "SS", "R", 8, 5, 717, 210, 46, 5, 34, 53, 46],
  ["Ozzie Smith '87", "STL", "SS", "S", 16, 6, 706, 182, 40, 4, 0, 89, 36],
  ["Derek Jeter '99", "NYY", "SS", "R", 13, 2, 739, 219, 37, 9, 24, 91, 116],
  ["Mario Mendoza '79", "SEA", "SS", "R", 9, 5, 345, 63, 10, 2, 1, 17, 54],
  ["David Eckstein '02", "ANA", "SS", "R", 12, 3, 702, 178, 21, 6, 8, 45, 44],
  ["Ty Cobb '11", "DET", "CF", "L", 19, 2, 654, 248, 47, 24, 8, 44, 35],
  ["Oscar Charleston '25", "HBG", "CF", "L", 16, 3, 420, 158, 26, 12, 20, 55, 25],
  ["Joe DiMaggio '41", "NYY", "CF", "R", 12, 3, 622, 193, 43, 11, 30, 76, 13],
  ["Mickey Mantle '56", "NYY", "CF", "S", 15, 3, 652, 188, 22, 5, 52, 112, 99],
  ["Willie Mays '54", "NYG", "CF", "R", 16, 3, 640, 195, 33, 13, 41, 66, 57],
  ["Ken Griffey Jr. '97", "SEA", "CF", "L", 13, 3, 704, 185, 34, 3, 56, 76, 121],
  ["Mike Trout '18", "LAA", "CF", "R", 14, 2, 608, 147, 24, 4, 39, 122, 124],
  ["Babe Ruth '27", "NYY", "LF/RF", "L", 8, 1, 691, 192, 29, 8, 60, 137, 89],
  ["Ted Williams '41", "BOS", "LF/RF", "L", 8, 1, 606, 185, 33, 3, 37, 147, 27],
  ["Stan Musial '48", "STL", "LF/RF", "L", 11, 1, 698, 230, 46, 18, 39, 79, 34],
  ["Hank Aaron '57", "MLN", "LF/RF", "R", 12, 2, 675, 198, 27, 6, 44, 57, 58],
  ["Roberto Clemente '67", "PIT", "LF/RF", "R", 12, 2, 648, 209, 26, 10, 23, 41, 103],
  ["Rickey Henderson '82", "OAK", "LF/RF", "R", 20, 1, 656, 143, 24, 4, 10, 116, 94],
  ["Tony Gwynn '94", "SD", "LF/RF", "L", 10, 1, 475, 165, 35, 1, 12, 48, 19],
  ["Barry Bonds '04", "SF", "LF/RF", "L", 8, 1, 617, 135, 27, 3, 45, 232, 41],
  ["Ichiro Suzuki '04", "SEA", "LF/RF", "L", 17, 2, 762, 262, 24, 5, 8, 49, 63],
  ["Rob Deer '91", "DET", "LF/RF", "R", 7, 1, 539, 80, 14, 2, 25, 89, 175],
  ["Vince Coleman '85", "STL", "LF/RF", "S", 20, 1, 686, 170, 20, 10, 1, 50, 115],
  ["Frank Thomas '94", "CHW", "DH", "R", 6, 0, 517, 141, 34, 1, 38, 109, 61],
  ["Edgar Martinez '95", "SEA", "DH", "R", 6, 0, 639, 182, 52, 0, 29, 116, 87],
  ["David Ortiz '06", "BOS", "DH", "L", 5, 0, 686, 160, 29, 2, 54, 119, 117],
  ["Eddie Gaedel '51", "SLB", "DH", "R", 1, 0, 1, 0, 0, 0, 0, 1, 0]
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
  ["Mitch Keller", "PIT", "SP", "R", 190, 31, 185, 18, 45, 155],
  ["Jose Berrios", "TOR", "SP", "R", 180, 32, 175, 25, 50, 150],
  ["Tomoyuki Sugano", "BAL", "SP", "R", 160, 28, 165, 22, 25, 100],
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
  ["Randy Rodriguez", "SF", "RP", "R", 65, 0, 40, 3, 15, 85],
  ["Ryan Helsley", "NYM", "RP", "R", 60, 0, 50, 6, 22, 70],
  ["Camilo Doval", "SF", "RP", "R", 62, 0, 48, 4, 28, 70],
  ["Kirby Yates", "LAD", "RP", "R", 55, 0, 40, 6, 22, 65],
  ["Tanner Scott", "LAD", "RP", "L", 60, 0, 55, 8, 20, 60],
  ["Pete Fairbanks", "TB", "RP", "R", 58, 0, 45, 4, 20, 55],
  ["Kenley Jansen", "LAA", "RP", "R", 62, 0, 48, 6, 20, 60],
  // Era pitchers: famous seasons, raw and era-unadjusted. Deadball workhorses
  // earn their IP 8 honestly.
  ["Walter Johnson '13", "WSH", "SP", "R", 346, 36, 232, 3, 38, 243],
  ["Satchel Paige '44", "KCM", "SP", "R", 89, 12, 58, 2, 21, 70],
  ["Sandy Koufax '65", "LAD", "SP", "L", 336, 41, 216, 26, 71, 382],
  ["Bob Gibson '68", "STL", "SP", "R", 305, 34, 198, 11, 62, 268],
  ["Steve Carlton '72", "PHI", "SP", "L", 346, 41, 257, 17, 87, 310],
  ["Nolan Ryan '73", "CAL", "SP", "R", 326, 39, 238, 18, 162, 383],
  ["Mark Fidrych '76", "DET", "SP", "R", 250, 29, 217, 12, 53, 97],
  ["Fernando Valenzuela '81", "LAD", "SP", "L", 192, 25, 140, 11, 61, 180],
  ["Greg Maddux '95", "ATL", "SP", "R", 210, 28, 147, 8, 23, 181],
  ["Pedro Martinez '00", "BOS", "SP", "R", 217, 29, 128, 17, 32, 284],
  ["Randy Johnson '01", "ARI", "SP", "L", 250, 34, 181, 19, 71, 372],
  ["Jamie Moyer '03", "SEA", "SP", "L", 215, 33, 199, 19, 66, 129],
  ["Roy Halladay '10", "PHI", "SP", "R", 251, 33, 231, 24, 30, 219],
  ["R.A. Dickey '12", "NYM", "SP", "R", 234, 33, 192, 24, 54, 230],
  ["Clayton Kershaw '14", "LAD", "SP", "L", 198, 27, 139, 9, 31, 239],
  ["Bartolo Colon '16", "NYM", "SP", "R", 192, 33, 200, 24, 32, 128],
  ["Hoyt Wilhelm '65", "CHW", "RP", "R", 144, 0, 88, 5, 32, 106],
  ["Goose Gossage '78", "NYY", "RP", "R", 134, 0, 87, 5, 59, 122],
  ["Dan Quisenberry '83", "KC", "RP", "R", 139, 0, 118, 7, 11, 48],
  ["Dennis Eckersley '90", "OAK", "RP", "R", 73, 0, 41, 2, 4, 73],
  ["Mitch Williams '91", "PHI", "RP", "L", 88, 0, 56, 4, 62, 84],
  ["Trevor Hoffman '98", "SD", "RP", "R", 73, 0, 41, 2, 21, 86],
  ["Mariano Rivera '08", "NYY", "RP", "R", 71, 0, 41, 4, 6, 77],
  ["Craig Kimbrel '12", "ATL", "RP", "R", 63, 0, 27, 3, 14, 116],
  // Second wave of era arms, so the mound matches the batter's box. Yes, that
  // is pitcher Babe Ruth — draft both Ruths and live the dream.
  ["Cy Young '01", "BOS", "SP", "R", 371, 41, 324, 5, 37, 158],
  ["Christy Mathewson '08", "NYG", "SP", "R", 391, 44, 285, 4, 42, 259],
  ["Babe Ruth '16", "BOS", "SP", "L", 324, 40, 230, 3, 118, 170],
  ["Lefty Grove '31", "PHA", "SP", "L", 289, 30, 249, 10, 62, 175],
  ["Warren Spahn '53", "MLN", "SP", "L", 266, 32, 211, 14, 70, 148],
  ["Whitey Ford '61", "NYY", "SP", "L", 283, 39, 242, 23, 92, 209],
  ["Juan Marichal '66", "SFG", "SP", "R", 307, 36, 228, 21, 36, 222],
  ["Tom Seaver '71", "NYM", "SP", "R", 286, 35, 210, 18, 61, 289],
  ["Ron Guidry '78", "NYY", "SP", "L", 273, 35, 187, 13, 72, 248],
  ["Dwight Gooden '85", "NYM", "SP", "R", 276, 35, 198, 13, 69, 268],
  ["Orel Hershiser '88", "LAD", "SP", "R", 267, 34, 208, 18, 73, 178],
  ["Roger Clemens '97", "TOR", "SP", "R", 264, 34, 204, 9, 68, 292],
  ["Johan Santana '04", "MIN", "SP", "L", 228, 34, 156, 24, 54, 265],
  ["Tim Lincecum '09", "SFG", "SP", "R", 225, 32, 168, 10, 68, 261],
  ["Felix Hernandez '14", "SEA", "SP", "R", 236, 34, 170, 16, 46, 248],
  ["Justin Verlander '11", "DET", "SP", "R", 251, 34, 174, 24, 57, 250],
  ["Al Hrabosky '75", "STL", "RP", "L", 97, 0, 72, 3, 33, 82],
  ["Bruce Sutter '77", "CHC", "RP", "R", 107, 0, 69, 5, 23, 129],
  ["Rollie Fingers '81", "MIL", "RP", "R", 78, 0, 55, 3, 13, 61],
  ["Lee Smith '91", "STL", "RP", "R", 73, 0, 70, 5, 13, 67],
  ["Billy Wagner '99", "HOU", "RP", "L", 75, 0, 35, 5, 23, 124],
  ["John Smoltz '03", "ATL", "RP", "R", 64, 0, 48, 2, 8, 73],
  ["Francisco Rodriguez '08", "LAA", "RP", "R", 68, 0, 54, 4, 34, 77]
];

export function buildRealPlayerPool() {
  const hitters = HITTER_ROWS.map((row) => makeRealHitter(row));
  const pitchers = PITCHER_ROWS.map((row) => makeRealPitcher(row));
  return [...hitters, ...pitchers].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

// The deck shape one draft night sees: a seeded slice of the full set with
// position depth for six managers. Shared with the Mariners set so every
// real-player flavor deals the same-sized deck.
export const REAL_DEAL_QUOTAS = [
  ["C", 7],
  ["1B", 7],
  ["2B", 7],
  ["3B", 7],
  ["SS", 7],
  ["LF/RF", 13],
  ["CF", 7],
  ["DH", 4],
  ["SP", 16],
  ["RP", 14]
];

export function buildRealDraftPool(seed) {
  return dealPool(buildRealPlayerPool(), REAL_DEAL_QUOTAS, `stars-deal:${seed}`);
}

// How deep a pool is, in managers — a draft-legality question, so the math
// lives with the draft rules now. Kept here under its old name for callers
// that still ask this pool how many rooms it seats.
export function maxRealPoolManagers(pool = buildRealPlayerPool()) {
  return maxPoolManagers(pool);
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
    points: pitcherPoints(control, ip, chart),
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
