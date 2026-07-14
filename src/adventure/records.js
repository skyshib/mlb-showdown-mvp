import { ensureAlmanac, seasonHitters, seasonPitchers } from "./state.js?v=20260714-j";
import { loadHallOfFame } from "./hallOfFame.js?v=20260714-j";

// The record book, and it is the whole league's, not yours.
//
// The trophy room is a display case for the things YOU did. This is the other
// thing: the number to beat. Every record here is read back out of the almanac —
// the box score of every game you have ever played is already sitting in the
// save — so most of them light up the moment you open the screen, with the
// history you already have behind them.
//
// The exception is the hit streak, which needs the play-by-play and not the box
// score, and the play-by-play is not kept. So it is measured at the final out
// and filed on the almanac page (see recordFinishedGame). Games played before
// today have no streak on them and simply do not compete for it: an empty record
// is honest, and a fabricated one is not.
//
// The book has two halves, because it is keeping two different kinds of score.
// A MANAGER record is a thing you did on an afternoon: nine runs, a two-hit
// shutout, six in a row. A PLAYER record is a thing one of your men did over a
// whole campaign, and it belongs to HIM — the manager who owned him goes on the
// line too, the way a record is always read out. They rank separately, because
// ranking them together would be asking whether a slugger beat a Tuesday.

const HIT_RESULTS = new Set(["1B", "1B+", "2B", "3B", "HR"]);

// The longest run of hits, back to back, with nothing in between. A walk is not
// a hit and it breaks the run — these are CONSECUTIVE HITS, not a hitting
// streak, and the difference is the point of the record.
export function longestHitStreak(events, teamName) {
  let best = 0;
  let run = 0;
  for (const event of events ?? []) {
    // Steals and extra-base attempts are not plate appearances; they have no
    // result and they neither make nor break a run of hits.
    if (!event?.result || event.battingTeam !== teamName) continue;
    run = HIT_RESULTS.has(event.result) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

const sum = (lines, field) => (lines ?? []).reduce((total, line) => total + (Number(line[field]) || 0), 0);

// The two halves of the book, in the order you page through them.
export const RECORD_PAGES = [
  { key: "manager", title: "MANAGER RECORDS" },
  { key: "player", title: "PLAYER RECORDS" }
];

// A rate is not a count, and printing it as one ("0.8421052631578947 OPS") is
// how you lose a reader. Three decimals, no leading nought, the way it is
// printed on the back of the card.
const rate = (value) => value.toFixed(3).replace(/^0\./, ".");

// A man has to have played enough to have a rate at all. One perfect afternoon
// is not a season, and a board that cannot tell the difference belongs to
// whoever went 1-for-1 in September.
const QUALIFIED_PA = 40;
const QUALIFIED_OUTS = 45; // fifteen innings

// Every record: what it is called, which half of the book it is in, which way is
// better, and how to read it out of a save. `read` returns the best mark for it,
// or null when the save has never done the thing.
export const RECORDS = [
  {
    key: "runs-game",
    page: "manager",
    group: "AT THE PLATE",
    title: "MOST RUNS IN A GAME",
    better: "max",
    unit: "runs",
    read: (save) => bestGame(save, "max", (game) => game.score?.[game.playerSide])
  },
  {
    key: "margin-game",
    page: "manager",
    group: "AT THE PLATE",
    title: "BIGGEST WIN MARGIN",
    better: "max",
    unit: "runs",
    read: (save) => bestGame(save, "max", (game) => {
      if (!game.won) return null;
      const theirs = game.playerSide === "away" ? "home" : "away";
      return game.score[game.playerSide] - game.score[theirs];
    })
  },
  {
    key: "homers-game",
    page: "manager",
    group: "AT THE PLATE",
    title: "MOST HOMERS IN A GAME",
    better: "max",
    unit: "HR",
    read: (save) => bestGame(save, "max", (game) => sum(mine(game)?.hitters, "hr"))
  },
  {
    key: "strikeouts-game",
    page: "manager",
    group: "ON THE MOUND",
    title: "MOST STRIKEOUTS IN A GAME",
    better: "max",
    unit: "K",
    read: (save) => bestGame(save, "max", (game) => sum(mine(game)?.pitchers, "so"))
  },
  {
    key: "hits-allowed-win",
    page: "manager",
    group: "ON THE MOUND",
    title: "FEWEST HITS ALLOWED IN A WIN",
    better: "min",
    unit: "hits",
    // Nine innings or it is not a pitching record, it is a short game.
    read: (save) => bestGame(save, "min", (game) => {
      if (!game.won || (game.innings ?? 0) < 9) return null;
      return sum(mine(game)?.pitchers, "h");
    })
  },
  {
    key: "hit-streak",
    page: "manager",
    group: "STREAKS",
    title: "MOST CONSECUTIVE HITS",
    better: "max",
    unit: "hits",
    read: (save) => bestGame(save, "max", (game) => game.hitStreak ?? null)
  },
  {
    key: "win-streak",
    page: "manager",
    group: "STREAKS",
    title: "LONGEST WINNING STREAK",
    better: "max",
    unit: "wins",
    read: (save) => longestWinStreak(save)
  },
  // Two boards, not one. A pennant bought with an uncapped chequebook and a
  // pennant built inside the budget are not the same feat, and the clock does not
  // know the difference — so ranking them against each other only ever tells you
  // which manager was allowed to spend more. One book each; they are not rivals.
  {
    key: "fastest-title-budget",
    page: "manager",
    group: "THE LONG HAUL",
    title: "FASTEST CHAMPIONSHIP (BUDGET)",
    better: "min",
    unit: "days",
    read: () => fastestTitle("budget")
  },
  {
    key: "fastest-title-uncapped",
    page: "manager",
    group: "THE LONG HAUL",
    title: "FASTEST CHAMPIONSHIP (UNCAPPED)",
    better: "min",
    unit: "days",
    read: () => fastestTitle("uncapped")
  },

  // The other half. Every one of these is a campaign total for ONE man, and the
  // man is named on the line — the manager is only the club he did it for.
  {
    key: "player-homers",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST HOMERS, ONE PLAYER",
    better: "max",
    unit: "HR",
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => line.hr || null)
  },
  {
    key: "player-hits",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST HITS, ONE PLAYER",
    better: "max",
    unit: "hits",
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => line.h || null)
  },
  {
    key: "player-rbi",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST RBI, ONE PLAYER",
    better: "max",
    unit: "RBI",
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => line.rbi || null)
  },
  {
    key: "player-steals",
    page: "player",
    group: "AT THE PLATE",
    title: "MOST STOLEN BASES, ONE PLAYER",
    better: "max",
    unit: "SB",
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => line.sb || null)
  },
  {
    key: "player-ops",
    page: "player",
    group: "AT THE PLATE",
    title: `BEST OPS (${QUALIFIED_PA} PA)`,
    better: "max",
    unit: "OPS",
    format: rate,
    read: (save) => bestPlayer(seasonHitters(save), "max", (line) => (line.pa >= QUALIFIED_PA ? line.ops : null))
  },
  {
    key: "player-strikeouts",
    page: "player",
    group: "ON THE MOUND",
    title: "MOST STRIKEOUTS, ONE PITCHER",
    better: "max",
    unit: "K",
    read: (save) => bestPlayer(seasonPitchers(save), "max", (line) => line.so || null)
  },
  {
    key: "player-ra9",
    page: "player",
    group: "ON THE MOUND",
    // A shutout arm reads 0.000 here, and that is a real number, not a missing
    // one — so this measure must never be filtered on truthiness.
    title: `LOWEST RUNS PER 9 (${QUALIFIED_OUTS / 3} IP)`,
    better: "min",
    unit: "RA9",
    format: rate,
    read: (save) => bestPlayer(seasonPitchers(save), "min", (line) => (line.outs >= QUALIFIED_OUTS ? line.runsPerNine : null))
  }
];

export const RECORD_KEYS = RECORDS.map((record) => record.key);

export function recordsOnPage(page) {
  return RECORDS.filter((record) => record.page === page);
}

function mine(game) {
  return game?.boxScore?.[game.playerSide] ?? null;
}

// The best single game for one measure, and the page it happened on.
function bestGame(save, better, measure) {
  let best = null;
  for (const game of ensureAlmanac(save)) {
    const value = measure(game);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    if (!best || (better === "max" ? value > best.value : value < best.value)) {
      best = { value, day: game.day, opponent: game.opponent };
    }
  }
  return best;
}

// The best man on the club for one measure, and his name, which is the whole
// point of this half of the book.
//
// Every line in the season stats is a man who has actually played FOR you — that
// is the only way a line gets written (see recordGameStats) — so "a player you
// own" needs no further test. He is not filtered against the roster you happen
// to be carrying today, either: a man you cut in August still hit the homers he
// hit in July, and a record book that forgets them the moment he clears waivers
// is not a record book.
function bestPlayer(lines, better, measure) {
  let best = null;
  for (const line of lines ?? []) {
    const value = measure(line);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    if (!best || (better === "max" ? value > best.value : value < best.value)) {
      best = { value, player: line.name };
    }
  }
  return best;
}

// Wins in a row, in the order they were played. The streak is reported with the
// day it REACHED its length — the game that made it what it is.
function longestWinStreak(save) {
  let best = null;
  let run = 0;
  for (const game of ensureAlmanac(save)) {
    run = game.won ? run + 1 : 0;
    if (run > 0 && (!best || run > best.value)) {
      best = { value: run, day: game.day, opponent: game.opponent };
    }
  }
  return best;
}

// The one record that does not live in the almanac: a finished run, and how many
// days it took. The hall of fame already keeps them, and it keeps the mode each
// was won in — so each board only ever counts the runs that were actually playing
// its game. A run predating the field is a budget run, which is what the league
// was before the cheques were uncapped.
function fastestTitle(mode) {
  let best = null;
  for (const run of loadHallOfFame()) {
    if ((run.mode ?? "budget") !== mode) continue;
    const days = Number(run.days);
    if (!Number.isFinite(days) || days <= 0) continue;
    if (!best || days < best.value) best = { value: days, day: days, opponent: run.name };
  }
  return best;
}

// Everything this save has to submit: one line per record it has actually set.
export function personalBests(save) {
  if (!save) return {};
  const bests = {};
  for (const record of RECORDS) {
    const best = record.read(save);
    if (best) bests[record.key] = best;
  }
  return bests;
}

// ---- The shared board -------------------------------------------------------
//
// Same shape as the hall of fame: the server keeps the league's book at
// /api/records, your own bests are computed locally, and the screen shows both.
// Offline, you still see your own — the board is simply empty behind you.

let globalRecords = null;

function inBrowser() {
  return typeof document !== "undefined" && typeof fetch === "function";
}

export function cachedGlobalRecords() {
  return globalRecords;
}

export async function fetchGlobalRecords() {
  const response = await fetch("/api/records");
  if (!response.ok) throw new Error(`Records fetch failed (${response.status})`);
  const data = await response.json();
  globalRecords = data.records && typeof data.records === "object" ? data.records : {};
  return globalRecords;
}

// Your bests go up whenever the book is opened. A save that has beaten its own
// old mark simply overwrites it — one line per campaign per record, so a long
// run cannot fill the board with its own history.
export function submitRecords(save) {
  if (!inBrowser() || !save) return Promise.resolve(false);
  const records = personalBests(save);
  if (!Object.keys(records).length) return Promise.resolve(false);
  return fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: save.player.name,
      saveSeed: save.saveSeed,
      mode: save.mode ?? "budget",
      records
    })
  }).then((response) => response.ok, () => false);
}

// The board for one record: the league's top few, with YOUR best folded in even
// when the server has never heard of it (offline, or a board already deeper than
// you are). Ranked the right way round for the record in question.
export function leaderboard(record, globals, save, limit = 5) {
  const rows = [...(globals?.[record.key] ?? [])].map((row) => ({ ...row }));
  const mineBest = save ? record.read(save) : null;
  if (mineBest) {
    const already = rows.find((row) => row.saveSeed === save.saveSeed);
    if (already) {
      already.you = true;
      // The board can be behind what this save has just done.
      if (record.better === "max" ? mineBest.value > already.value : mineBest.value < already.value) {
        Object.assign(already, mineBest);
      }
    } else {
      rows.push({ ...mineBest, name: save.player.name, saveSeed: save.saveSeed, you: true });
    }
  }
  rows.sort((a, b) => (record.better === "max" ? b.value - a.value : a.value - b.value));
  const top = rows.slice(0, limit);
  const you = rows.find((row) => row.you) ?? null;
  return {
    top,
    you,
    // Where you stand, even when you are not on the board.
    yourRank: you ? rows.indexOf(you) + 1 : null,
    total: rows.length
  };
}
