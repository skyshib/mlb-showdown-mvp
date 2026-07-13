import { RESULTS } from "../rules/cards.js?v=20260713-c";
import { createRng } from "../rules/rng.js?v=20260713-c";

const FIRST_NAMES = [
  "Aaliyah",
  "Aaron",
  "Abdiel",
  "Abigail",
  "Abeni",
  "Abram",
  "Ada",
  "Adelaide",
  "Adela",
  "Aditya",
  "Agnes",
  "Aiko",
  "Aina",
  "Aisha",
  "Akari",
  "Akira",
  "Alaric",
  "Alba",
  "Alessia",
  "Alejandro",
  "Alexei",
  "Ali",
  "Amara",
  "Amias",
  "Anand",
  "Ananya",
  "Anders",
  "Andre",
  "Andromeda",
  "Anika",
  "Ansel",
  "Antonia",
  "Antonio",
  "Aoife",
  "Aria",
  "Ariadne",
  "Arjun",
  "Artem",
  "Asami",
  "Astrid",
  "Athena",
  "Atticus",
  "Aurelia",
  "Avi",
  "Aziza",
  "Bao",
  "Basil",
  "Beatriz",
  "Benicio",
  "Bjorn",
  "Brigid",
  "Cal",
  "Caius",
  "Camila",
  "Cassia",
  "Casimir",
  "Cedric",
  "Celeste",
  "Chandra",
  "Chiara",
  "Cian",
  "Clara",
  "Clarice",
  "Cleo",
  "Cosima",
  "Cyrus",
  "Dahlia",
  "Daphne",
  "Darius",
  "Deirdre",
  "Diego",
  "Dmitri",
  "Dorian",
  "Eamon",
  "Edda",
  "Eira",
  "Milo",
  "Jules",
  "Rafa",
  "Tate",
  "Nico",
  "Eli",
  "Theo",
  "Sam",
  "Marco",
  "Drew",
  "Luis",
  "Owen",
  "Kai",
  "Noah",
  "Elena",
  "Elias",
  "Elif",
  "Elio",
  "Elisabet",
  "Eloise",
  "Emil",
  "Emilia",
  "Enzo",
  "Esme",
  "Esteban",
  "Evander",
  "Farid",
  "Fatima",
  "Felix",
  "Freya",
  "Gael",
  "Galen",
  "Giselle",
  "Greta",
  "Hadrian",
  "Hana",
  "Haru",
  "Hassan",
  "Helena",
  "Hiro",
  "Idris",
  "Iker",
  "Imani",
  "Imara",
  "Ines",
  "Ingrid",
  "Isandro",
  "Isolde",
  "Itzel",
  "Jae",
  "Jamal",
  "Javier",
  "Jia",
  "Joaquin",
  "Johann",
  "Juno",
  "Jun",
  "Kaito",
  "Kamal",
  "Keiko",
  "Kenji",
  "Khalil",
  "Kiran",
  "Kwame",
  "Laila",
  "Lakshmi",
  "Leif",
  "Leila",
  "Lena",
  "Leonardo",
  "Liana",
  "Linnea",
  "Lucia",
  "Lucian",
  "Mael",
  "Maia",
  "Malcolm",
  "Marcel",
  "Marisol",
  "Mateo",
  "Matilda",
  "Mei",
  "Min",
  "Mira",
  "Mireille",
  "Nadia",
  "Naledi",
  "Naomi",
  "Natalia",
  "Navid",
  "Nia",
  "Nikhil",
  "Nnamdi",
  "Noor",
  "Octavia",
  "Omar",
  "Ophelia",
  "Orion",
  "Oscar",
  "Paloma",
  "Paolo",
  "Pilar",
  "Priya",
  "Quentin",
  "Rafael",
  "Raj",
  "Rania",
  "Remy",
  "Renata",
  "Riku",
  "Rohan",
  "Rosa",
  "Saanvi",
  "Sabine",
  "Santiago",
  "Saoirse",
  "Saskia",
  "Selene",
  "Selim",
  "Serena",
  "Silas",
  "Sofia",
  "Soren",
  "Soraya",
  "Talia",
  "Tariq",
  "Thalia",
  "Thiago",
  "Tobias",
  "Tomoko",
  "Uma",
  "Valentina",
  "Veda",
  "Viggo",
  "Viola",
  "Willa",
  "Xavier",
  "Ximena",
  "Yael",
  "Yara",
  "Yasmin",
  "Youssef",
  "Zain",
  "Zara",
  "Ziya",
  "Zora"
];

const LAST_NAMES = [
  "Adebayo",
  "Adeyemi",
  "Aguilar",
  "Aksoy",
  "Al-Fayed",
  "Aliyev",
  "Almeida",
  "Alvarez",
  "Amari",
  "Andersen",
  "Andersson",
  "Angelopoulos",
  "Antonelli",
  "Antipov",
  "Aras",
  "Arendt",
  "Arya",
  "Asakura",
  "Ashworth",
  "Ayele",
  "Bahl",
  "Barros",
  "Batalha",
  "Becker",
  "Bellamy",
  "Benitez",
  "Bianchi",
  "Bjork",
  "Blackwood",
  "Bonnet",
  "Brandt",
  "Calderon",
  "Campos",
  "Caruso",
  "Castillo",
  "Chen",
  "Chiba",
  "Choudhury",
  "Cohen",
  "Costa",
  "Cruz",
  "D'Amico",
  "Dahl",
  "Darzi",
  "Delgado",
  "Diop",
  "Dubois",
  "Duran",
  "Eklund",
  "El-Sayed",
  "Esposito",
  "Farah",
  "Fernandes",
  "Fischer",
  "Fontaine",
  "Fujimoto",
  "Garcia",
  "Ghosh",
  "Giordano",
  "Gomez",
  "Gonzalez",
  "Granger",
  "Guerrero",
  "Haddad",
  "Hansen",
  "Harada",
  "Herrera",
  "Hoffmann",
  "Hossain",
  "Ibrahim",
  "Ivanov",
  "Jensen",
  "Kaczmarek",
  "Kamara",
  "Kapoor",
  "Karimi",
  "Kaur",
  "Kim",
  "Kobayashi",
  "Kovacs",
  "Kozlov",
  "Kumar",
  "Laghari",
  "Laurent",
  "Lefevre",
  "Li",
  "Lindholm",
  "Liu",
  "Lombardi",
  "Lopez",
  "Lund",
  "MacLeod",
  "Mahajan",
  "Makonnen",
  "Malik",
  "Mancini",
  "Matsuda",
  "Mbeki",
  "Mensah",
  "Meyer",
  "Mikhailov",
  "Morales",
  "Moreau",
  "Moreno",
  "Mueller",
  "Nakamura",
  "Nascimento",
  "Nguyen",
  "Nielsen",
  "Novak",
  "Nunes",
  "Ochoa",
  "Okafor",
  "Osei",
  "Papadakis",
  "Patel",
  "Pereira",
  "Petrov",
  "Popescu",
  "Rahman",
  "Rasmussen",
  "Reyes",
  "Ribeiro",
  "Ricci",
  "Rios",
  "Rossi",
  "Rousseau",
  "Ruiz",
  "Saito",
  "Salazar",
  "Sanchez",
  "Sato",
  "Schmidt",
  "Silva",
  "Singh",
  "Solberg",
  "Sorensen",
  "Souza",
  "Steiner",
  "Suleiman",
  "Suzuki",
  "Tanaka",
  "Teixeira",
  "Thompson",
  "Torres",
  "Tran",
  "Vargas",
  "Vasquez",
  "Vinter",
  "Volkov",
  "Watanabe",
  "Weber",
  "Yamamoto",
  "Yilmaz",
  "Zhang",
  "Zuniga",
  "Mercer",
  "Vega",
  "Raines",
  "Bishop",
  "Okada",
  "Santos",
  "Hale",
  "Quinn",
  "Park",
  "Morrow",
  "Stone",
  "Ibarra",
  "Lowell",
  "Chavez",
  "Banks",
  "Klein",
  "Abarca",
  "Abebe",
  "Ainsley",
  "Alarcon",
  "Amano",
  "Anwar",
  "Arias",
  "Bae",
  "Bakker",
  "Barrera",
  "Belmonte",
  "Bennani",
  "Bergstrom",
  "Bhatt",
  "Bouchard",
  "Camara",
  "Cardoso",
  "Carmichael",
  "Carrington",
  "Cespedes",
  "Cho",
  "Christensen",
  "Constantin",
  "da Costa",
  "Dlamini",
  "Dominguez",
  "Duarte",
  "Echeverri",
  "Ekong",
  "Farouk",
  "Ferreira",
  "Flores",
  "Fournier",
  "Galloway",
  "Gebre",
  "Hernandez",
  "Hoang",
  "Ionescu",
  "Jafari",
  "Jankowski",
  "Khan",
  "Kowalski",
  "Kruger",
  "Larsen",
  "Leclerc",
  "Machado",
  "Mendoza",
  "Montoya",
  "Ndiaye",
  "Nowak",
  "Ortega",
  "Qureshi",
  "Rojas",
  "Romano",
  "Saidi",
  "Sharma",
  "Takahashi",
  "Tavares",
  "Tesfaye",
  "Velasquez",
  "Villanueva",
  "Yeboah",
  "Zapata"
];

const POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF/RF", "CF"];
// Corner outfielders are one interchangeable group covering two lineup slots,
// so their bucket generates twice as many copies as single-slot positions.
const POSITION_POOL_MULTIPLIER = { "LF/RF": 2 };
const FIELDING_DISTRIBUTIONS = {
  C: { min: 1, max: 10, mean: 6, sd: 1.5 },
  "1B": { min: 0, max: 1, mean: 0.5, sd: 0.5 },
  "2B": { min: 0, max: 6, mean: 2.5, sd: 1.5 },
  "3B": { min: 0, max: 3, mean: 1.5, sd: 1 },
  SS: { min: 0, max: 6, mean: 3, sd: 1.5 },
  "LF/RF": { min: 0, max: 2, mean: 1, sd: 2 / 3 },
  CF: { min: 1, max: 3, mean: 2, sd: 2 / 3 }
};

const SPEED_MEANS = {
  C: 10,
  "1B": 10,
  "2B": 12,
  "3B": 11,
  SS: 12,
  "LF/RF": 12,
  CF: 14
};

export function generatePlayerPool(seed, teamCount = 4, rosterSize = 13) {
  const rng = createRng(seed);
  const normalizedTeamCount = Math.max(1, Math.floor(Number(teamCount) || 4));
  const hitterCopiesPerPosition = normalizedTeamCount * 2;
  const pitcherCopiesPerRole = normalizedTeamCount * 4;
  const players = [];
  const usedNames = new Set();
  let hitterCount = 0;
  let pitcherCount = 0;

  for (const position of POSITIONS) {
    const copies = hitterCopiesPerPosition * (POSITION_POOL_MULTIPLIER[position] ?? 1);
    for (let copy = 0; copy < copies; copy += 1) {
      hitterCount += 1;
      players.push(makeHitterCard(rng, hitterCount, usedNames, position));
    }
  }

  for (let copy = 0; copy < pitcherCopiesPerRole; copy += 1) {
    pitcherCount += 1;
    players.push(makePitcherCard(rng, pitcherCount, usedNames, "SP"));
  }

  for (let copy = 0; copy < pitcherCopiesPerRole; copy += 1) {
    pitcherCount += 1;
    players.push(makePitcherCard(rng, pitcherCount, usedNames, "RP"));
  }

  return players.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

// ---- Deep set, per-draft deal ---------------------------------------------

// Every pool flavor keeps a deep card set behind the scenes and deals a
// seeded slice of it into any given draft: same seed, same deck; new seed,
// new deck. Quotas are per position (or pitching role) so every deal keeps
// the same depth at every spot and supports the same number of managers.
export function dealPool(pool, quotas, dealSeed) {
  const rng = createRng(dealSeed);
  const dealt = quotas.flatMap(([group, quota]) =>
    shuffleCards(pool.filter((player) => dealGroup(player) === group), rng).slice(0, quota)
  );
  return dealt.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

function dealGroup(player) {
  return player.kind === "pitcher" ? player.role : player.position;
}

// Fisher-Yates on a copy, driven by the seeded rng.
function shuffleCards(players, rng) {
  const copy = [...players];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// The fictional randoms are one persistent league rather than a fresh
// invention per room: the same made-up players live behind the scenes
// (generated once from a fixed seed), and each draft deals a slice of them.
// Rooms meet the same characters night after night without ever seeing the
// whole league at once. Bump the version in the seed to trigger a full
// expansion draft of new fictional players.
const FICTIONAL_UNIVERSE_SEED = "fictional-universe-v1";
const FICTIONAL_UNIVERSE_TEAMS = 8;
const FICTIONAL_DEAL_QUOTAS = [
  ["C", 10],
  ["1B", 10],
  ["2B", 10],
  ["3B", 10],
  ["SS", 10],
  ["LF/RF", 20],
  ["CF", 10],
  ["SP", 16],
  ["RP", 16]
];

let fictionalUniverseCache = null;

export function buildFictionalUniverse() {
  fictionalUniverseCache ??= generatePlayerPool(FICTIONAL_UNIVERSE_SEED, FICTIONAL_UNIVERSE_TEAMS, 13);
  return fictionalUniverseCache;
}

export function buildFictionalDraftPool(seed) {
  return dealPool(buildFictionalUniverse(), FICTIONAL_DEAL_QUOTAS, `fictional-deal:${seed}`);
}

function makeHitterCard(rng, index, usedNames, position) {
  const chart = makeHitterChart(rng);
  const outSlots = countChartSlots(chart, [RESULTS.SO, RESULTS.GB, RESULTS.FB]);
  const onBase = normalInt(rng, 10.5 - (outSlots - 6) * 0.25, 1.6, 6, 15);
  const speed = randomSpeed(rng, position, outSlots);
  const fielding = randomFielding(rng, position);
  const points = onBase * 20 + fielding * 7 + speedPoints(speed) + chartPower(chart);
  return {
    id: `h-${index}`,
    kind: "hitter",
    name: makeName(rng, usedNames),
    position,
    bats: rng.pick(["R", "L", "S"]),
    onBase,
    speed,
    fielding,
    points,
    chart: toChart(chart)
  };
}

function makePitcherCard(rng, index, usedNames, role) {
  const isReliever = role === "RP";
  const control = normalInt(rng, 3.5, 1.5, 0, 6);
  const ip = isReliever ? 1 : starterIp(rng);
  const chart = makePitcherChart(rng);
  const points = pitcherPoints(control, ip, chart);
  return {
    id: `p-${index}`,
    kind: "pitcher",
    name: makeName(rng, usedNames),
    role: isReliever ? "RP" : "SP",
    throws: rng.pick(["R", "L"]),
    control,
    ip,
    points,
    chart: toChart(chart)
  };
}

function makeName(rng, usedNames) {
  const maxAttempts = Math.min(FIRST_NAMES.length * LAST_NAMES.length, 200);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  const fallback = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${usedNames.size + 1}`;
  usedNames.add(fallback);
  return fallback;
}

export function toChart(rows) {
  return rows.map(([from, to, result]) => ({ from, to, result }));
}

function makeHitterChart(rng) {
  const outs = normalInt(rng, 6, 2.2, 1, 11);
  const remaining = 20 - outs;
  const hitRate = normalFloat(rng, 0.8, 0.16, 0.5, 0.98);
  const hits = clamp(Math.round(remaining * hitRate), 1, remaining);
  const walks = remaining - hits;
  const extraBaseHits = clamp(Math.round(hits * normalFloat(rng, 0.32, 0.18, 0, 0.8)), 0, hits);
  const singles = hits - extraBaseHits;
  const triples = extraBaseHits >= 2 && rng.next() < 0.22 ? 1 : 0;
  const homeRuns = clamp(Math.round((extraBaseHits - triples) * normalFloat(rng, 0.42, 0.25, 0, 0.95)), 0, extraBaseHits - triples);
  const doubles = extraBaseHits - triples - homeRuns;
  const outCounts = splitSlots(rng, outs, [
    normalFloat(rng, 0.32, 0.18, 0.03, 0.75),
    normalFloat(rng, 0.38, 0.2, 0.03, 0.8),
    normalFloat(rng, 0.3, 0.18, 0.03, 0.75)
  ]);

  return chartFromCounts([
    [RESULTS.SO, outCounts[0]],
    [RESULTS.GB, outCounts[1]],
    [RESULTS.FB, outCounts[2]],
    [RESULTS.BB, walks],
    [RESULTS.SINGLE, singles],
    [RESULTS.DOUBLE, doubles],
    [RESULTS.TRIPLE, triples],
    [RESULTS.HR, homeRuns]
  ]);
}

function makePitcherChart(rng) {
  const outs = normalInt(rng, 16, 1.6, 11, 19);
  const remaining = 20 - outs;
  const walkRate = normalFloat(rng, 0.35, 0.18, 0.05, 0.75);
  const walks = clamp(Math.round(remaining * walkRate), 0, remaining);
  const hits = remaining - walks;
  const extraBaseHits = clamp(Math.round(hits * normalFloat(rng, 0.28, 0.16, 0, 0.75)), 0, hits);
  const singles = hits - extraBaseHits;
  const homeRuns = clamp(Math.round(extraBaseHits * normalFloat(rng, 0.35, 0.25, 0, 0.9)), 0, extraBaseHits);
  const doubles = extraBaseHits - homeRuns;
  const outCounts = splitSlots(rng, outs, [
    normalFloat(rng, 0.12, 0.08, 0.01, 0.32),
    normalFloat(rng, 0.34, 0.18, 0.06, 0.75),
    normalFloat(rng, 0.34, 0.18, 0.06, 0.75),
    normalFloat(rng, 0.2, 0.12, 0.03, 0.55)
  ]);

  return chartFromCounts([
    [RESULTS.PU, outCounts[0]],
    [RESULTS.SO, outCounts[1]],
    [RESULTS.GB, outCounts[2]],
    [RESULTS.FB, outCounts[3]],
    [RESULTS.BB, walks],
    [RESULTS.SINGLE, singles],
    [RESULTS.DOUBLE, doubles],
    [RESULTS.HR, homeRuns]
  ]);
}

export function chartFromCounts(counts) {
  const rows = [];
  let cursor = 1;
  for (const [result, slots] of counts) {
    if (slots <= 0) continue;
    rows.push([cursor, cursor + slots - 1, result]);
    cursor += slots;
  }
  return rows;
}

function countChartSlots(chart, results) {
  const wanted = new Set(results);
  return chart.reduce((sum, [from, to, result]) => sum + (wanted.has(result) ? to - from + 1 : 0), 0);
}

function splitSlots(rng, total, weights) {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (weight / weightTotal) * total);
  const counts = raw.map((value) => Math.floor(value));
  let remaining = total - counts.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value), jitter: rng.next() }))
    .sort((a, b) => b.fraction - a.fraction || b.jitter - a.jitter);
  for (let i = 0; i < remaining; i += 1) counts[order[i % order.length].index] += 1;
  return counts;
}

function randomSpeed(rng, position, outSlots) {
  const outAdjustment = (6 - outSlots) * 0.6;
  return Math.max(1, Math.round(normal(rng, (SPEED_MEANS[position] ?? 12) + outAdjustment, 4.5)));
}

function randomFielding(rng, position) {
  const distribution = FIELDING_DISTRIBUTIONS[position] ?? { min: 0, max: 3, mean: 1.5, sd: 1 };
  return normalInt(rng, distribution.mean, distribution.sd, distribution.min, distribution.max);
}

function starterIp(rng) {
  const ip = normalInt(rng, 6, 0.5, 5, 7);
  return rng.next() < 0.02 ? 8 : ip;
}

export function speedPoints(speed) {
  const value = Number(speed);
  return Number.isFinite(value) ? Math.max(0, Math.round((value - 1) * 1.5)) : 0;
}

function normalInt(rng, mean, sd, min, max) {
  return clamp(Math.round(normal(rng, mean, sd)), min, max);
}

function normalFloat(rng, mean, sd, min, max) {
  return clamp(normal(rng, mean, sd), min, max);
}

function normal(rng, mean, sd) {
  const u1 = Math.max(rng.next(), Number.EPSILON);
  const u2 = Math.max(rng.next(), Number.EPSILON);
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function chartPower(chart) {
  const values = {
    [RESULTS.SO]: -4,
    [RESULTS.GB]: -2,
    [RESULTS.FB]: -2,
    [RESULTS.BB]: 4,
    [RESULTS.SINGLE]: 5,
    [RESULTS.DOUBLE]: 9,
    [RESULTS.TRIPLE]: 11,
    [RESULTS.HR]: 14
  };
  return chart.reduce((sum, [from, to, result]) => sum + (to - from + 1) * values[result], 0);
}

export function pitcherChartPower(chart) {
  const values = {
    [RESULTS.PU]: 8,
    [RESULTS.SO]: 10,
    [RESULTS.GB]: 8,
    [RESULTS.FB]: 6,
    [RESULTS.BB]: -5,
    [RESULTS.SINGLE]: -7,
    [RESULTS.DOUBLE]: -11,
    [RESULTS.HR]: -16
  };
  return chart.reduce((sum, [from, to, result]) => sum + (to - from + 1) * values[result], 0);
}

// A pitcher's control and chart apply to every batter he faces, so quality
// points scale with workload: full price at the 6-IP starter baseline, half
// for a 1-IP reliever. The flat IP term stays as the fatigue-onset premium.
export function ipWorkloadWeight(ip) {
  return ((Number(ip) || 0) + 4) / 10;
}

export function pitcherPoints(control, ip, chart) {
  return Math.round((control * 35 + pitcherChartPower(chart)) * ipWorkloadWeight(ip)) + ip * 8;
}
