import { ensureAlmanac } from "./state.js?v=20260714-f";

// Other people's afternoons.
//
// The hall of fame ranks runs and the book ranks feats, and neither could ever
// tell you HOW: which games, against whom, who carried them. The games could, and
// they were the one thing that never left the machine they were played on.
//
// So a campaign's games go up — the box score and the players in it, not the
// play-by-play. A log is 24 KB a game and it is the one genuinely private thing
// in here; it stays in your own save, and the almanac still opens it. What
// travels is what somebody ELSE would want: the score, the lines, the stars.
//
// They go one at a time, because a run's worth of box scores is a couple of
// hundred kilobytes and the server takes 64 at a bite.

function inBrowser() {
  return typeof document !== "undefined" && typeof fetch === "function";
}

// The game as the league sees it: no events, no lineScore padding, nothing that
// is only meaningful on the machine it was played on.
export function travelling(game) {
  return {
    day: game.day,
    trainerId: game.trainerId,
    opponent: game.opponent,
    won: game.won,
    innings: game.innings,
    playerSide: game.playerSide,
    score: game.score,
    feats: game.feats ?? [],
    boxScore: game.boxScore,
    lineScore: game.lineScore ?? null
  };
}

export function uploadGame(save, game) {
  if (!inBrowser() || !save || !game) return Promise.resolve(false);
  return fetch("/api/games", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saveSeed: save.saveSeed, game: travelling(game) })
  }).then((response) => response.ok, () => false);
}

// Every game of a finished run, one request each. Best effort and quiet about
// it: a manager whose network dropped still has their plaque, it simply has no
// games hanging under it until the next time they open the hall.
export async function uploadRun(save) {
  if (!inBrowser() || !save) return 0;
  let sent = 0;
  for (const game of ensureAlmanac(save)) {
    if (await uploadGame(save, game)) sent += 1;
  }
  return sent;
}

// One campaign's games, fetched when somebody actually opens that campaign.
// Cached per seed for the session: a plaque you page back and forth through is
// one fetch, not one per keypress.
const cache = new Map();

export function cachedGames(saveSeed) {
  return cache.get(saveSeed) ?? null;
}

export async function fetchGames(saveSeed) {
  if (!inBrowser() || !saveSeed) return [];
  if (cache.has(saveSeed)) return cache.get(saveSeed);
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(saveSeed)}`);
    if (!response.ok) throw new Error(`Games fetch failed (${response.status})`);
    const data = await response.json();
    const games = Array.isArray(data.games) ? data.games : [];
    cache.set(saveSeed, games);
    return games;
  } catch {
    cache.set(saveSeed, []);
    return [];
  }
}

// ---- Reading a run out of its games -------------------------------------------

// Who they beat, and how. One row per opponent, in the order they were first
// met: the club, the record against them, and the runs both ways.
export function opponentsOf(games) {
  const byTrainer = new Map();
  for (const game of games ?? []) {
    const key = game.trainerId || game.opponent;
    if (!byTrainer.has(key)) {
      byTrainer.set(key, {
        trainerId: game.trainerId,
        opponent: game.opponent,
        games: [],
        wins: 0,
        losses: 0,
        runsFor: 0,
        runsAgainst: 0
      });
    }
    const row = byTrainer.get(key);
    const theirs = game.playerSide === "away" ? "home" : "away";
    row.games.push(game);
    if (game.won) row.wins += 1;
    else row.losses += 1;
    row.runsFor += game.score?.[game.playerSide] ?? 0;
    row.runsAgainst += game.score?.[theirs] ?? 0;
  }
  return [...byTrainer.values()];
}

// A RATE cannot be added to a rate. Three games at .300 is not a .900 hitter,
// and an ERA is not a running total — so the counting stats fold and the rates
// are worked out again at the bottom, off the folded counts, which is the only
// place they mean anything.
const RATES = new Set(["avg", "obp", "slg", "ops", "runsPerNine", "strikeoutsPerNine"]);

const rate = (top, bottom) => (bottom > 0 ? top / bottom : 0);

function reckonHitter(line) {
  const singles = Math.max(0, (line.h ?? 0) - (line.d ?? 0) - (line.t ?? 0) - (line.hr ?? 0));
  const bases = singles + 2 * (line.d ?? 0) + 3 * (line.t ?? 0) + 4 * (line.hr ?? 0);
  line.avg = rate(line.h ?? 0, line.ab ?? 0);
  line.obp = rate((line.h ?? 0) + (line.bb ?? 0), line.pa ?? 0);
  line.slg = rate(bases, line.ab ?? 0);
  line.ops = line.obp + line.slg;
  return line;
}

function reckonPitcher(line) {
  line.runsPerNine = rate((line.r ?? 0) * 27, line.outs ?? 0);
  line.strikeoutsPerNine = rate((line.so ?? 0) * 27, line.outs ?? 0);
  return line;
}

// The other club's season against you, folded out of the box scores: their
// players, their numbers, in the games you played them. It comes out in the same
// shape the season page uses, so it renders with the same code.
export function opposingLines(games) {
  const hitters = new Map();
  const pitchers = new Map();
  const fold = (book, line) => {
    const seen = book.get(line.id) ?? { id: line.id, name: line.name, games: 0 };
    seen.games += 1;
    for (const [key, value] of Object.entries(line)) {
      if (typeof value !== "number" || RATES.has(key)) continue;
      seen[key] = (seen[key] ?? 0) + value;
    }
    book.set(line.id, seen);
  };
  for (const game of games ?? []) {
    const theirs = game.playerSide === "away" ? "home" : "away";
    const box = game.boxScore?.[theirs];
    if (!box) continue;
    for (const line of box.hitters ?? []) fold(hitters, line);
    for (const line of box.pitchers ?? []) fold(pitchers, line);
  }
  return {
    hitters: [...hitters.values()].map(reckonHitter).sort((a, b) => (b.wpa ?? 0) - (a.wpa ?? 0)),
    pitchers: [...pitchers.values()].map(reckonPitcher).sort((a, b) => (b.wpa ?? 0) - (a.wpa ?? 0))
  };
}
