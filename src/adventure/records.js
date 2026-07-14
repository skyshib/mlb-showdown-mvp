import { ensureAlmanac } from "./state.js?v=20260714-d";
import { loadHallOfFame } from "./hallOfFame.js?v=20260714-d";

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

// Every record: what it is called, which way is better, and how to read it out
// of a save. `read` returns the best game for it, or null when the save has
// never done the thing.
export const RECORDS = [
  {
    key: "runs-game",
    group: "AT THE PLATE",
    title: "MOST RUNS IN A GAME",
    better: "max",
    unit: "runs",
    read: (save) => bestGame(save, "max", (game) => game.score?.[game.playerSide])
  },
  {
    key: "margin-game",
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
    group: "AT THE PLATE",
    title: "MOST HOMERS IN A GAME",
    better: "max",
    unit: "HR",
    read: (save) => bestGame(save, "max", (game) => sum(mine(game)?.hitters, "hr"))
  },
  {
    key: "strikeouts-game",
    group: "ON THE MOUND",
    title: "MOST STRIKEOUTS IN A GAME",
    better: "max",
    unit: "K",
    read: (save) => bestGame(save, "max", (game) => sum(mine(game)?.pitchers, "so"))
  },
  {
    key: "hits-allowed-win",
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
    group: "STREAKS",
    title: "MOST CONSECUTIVE HITS",
    better: "max",
    unit: "hits",
    read: (save) => bestGame(save, "max", (game) => game.hitStreak ?? null)
  },
  {
    key: "win-streak",
    group: "STREAKS",
    title: "LONGEST WINNING STREAK",
    better: "max",
    unit: "wins",
    read: (save) => longestWinStreak(save)
  },
  {
    key: "fastest-title",
    group: "THE LONG HAUL",
    title: "FASTEST CHAMPIONSHIP",
    better: "min",
    unit: "days",
    read: (save) => fastestTitle(save)
  }
];

export const RECORD_KEYS = RECORDS.map((record) => record.key);

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
// days it took. The hall of fame already keeps them.
function fastestTitle(save) {
  let best = null;
  for (const run of loadHallOfFame()) {
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
