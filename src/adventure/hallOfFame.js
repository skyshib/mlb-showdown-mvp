import {
  ensureAlmanac,
  ensureSeasonStats,
  rosterCards,
  rosterPoints,
  seasonHitters,
  seasonPitchers
} from "./state.js?v=20260713-j";

// The hall of fame outlives any single save: it keeps its own storage key, so
// deleting or replacing a campaign never erases the plaques it earned.
const HOF_KEY = "showdown-quest-hall-of-fame";

export const MODE_LABELS = { budget: "BUDGET LEAGUE", uncapped: "UNCAPPED" };

function defaultStorage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function loadHallOfFame(storage = defaultStorage()) {
  const raw = storage?.getItem(HOF_KEY);
  if (!raw) return [];
  try {
    const entries = JSON.parse(raw);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

// One plaque per finished campaign, written the moment the Commissioner's
// Trophy lands. Everything is snapshotted as plain data — the roster's full
// card objects included — because each save lives in its own card universe,
// and that universe is gone once the save is.
export function recordCompletedRun(save, storage = defaultStorage()) {
  const entries = loadHallOfFame(storage);
  if (entries.some((entry) => entry.saveSeed === save.saveSeed)) return null;
  const games = ensureAlmanac(save);
  const wins = games.filter((game) => game.won).length;
  const rosterIds = save.roster.cardIds;
  const entry = {
    saveSeed: save.saveSeed,
    name: save.player.name,
    mode: save.mode ?? "budget",
    universe: save.universe ?? "fictional",
    finishedAt: Date.now(),
    days: ensureSeasonStats(save).games,
    wins,
    losses: games.length - wins,
    battlesWon: save.progress.counters.battlesWon,
    battlesLost: save.progress.counters.battlesLost,
    badges: [...save.player.badges],
    rosterPoints: rosterPoints(save),
    roster: rosterCards(save),
    hitters: seasonHitters(save).filter((line) => rosterIds.includes(line.id)),
    pitchers: seasonPitchers(save).filter((line) => rosterIds.includes(line.id))
  };
  entries.push(entry);
  storage?.setItem(HOF_KEY, JSON.stringify(entries));
  // Best effort: the run also goes up to the shared board. If the network is
  // down it stays local, and the leaderboard screen resubmits it next visit.
  submitRun(entry);
  return entry;
}

// ---- Global board -----------------------------------------------------------
//
// The rooms server keeps one shared hall of fame at /api/hall-of-fame.
// Local storage stays the source of truth for YOUR runs; the global list is
// fetched when the leaderboard opens and merged on top. Everything degrades
// to local-only when the server is unreachable.

let globalEntries = null;

function inBrowser() {
  return typeof document !== "undefined" && typeof fetch === "function";
}

export function cachedGlobalEntries() {
  return globalEntries;
}

export async function fetchGlobalEntries() {
  const response = await fetch("/api/hall-of-fame");
  if (!response.ok) throw new Error(`Hall of fame fetch failed (${response.status})`);
  const data = await response.json();
  globalEntries = Array.isArray(data.entries) ? data.entries : [];
  return globalEntries;
}

export function submitRun(entry) {
  if (!inBrowser()) return Promise.resolve(false);
  return fetch("/api/hall-of-fame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry)
  }).then((response) => response.ok, () => false);
}

// Global entries first, local plaques filling any the server has not seen
// (offline finishes, or a board trimmed past them). One row per campaign.
export function mergeEntries(local, global) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...(global ?? []), ...local]) {
    if (seen.has(entry.saveSeed)) continue;
    seen.add(entry.saveSeed);
    merged.push(entry);
  }
  return merged;
}

// The leaderboard, one group per rule set (budget before uncapped), each
// ranked by fewest days to the trophy — losses, then the earlier finish,
// break ties.
export function hallOfFameByMode(entries) {
  const modes = new Map();
  for (const entry of entries) {
    const mode = entry.mode ?? "budget";
    if (!modes.has(mode)) modes.set(mode, []);
    modes.get(mode).push(entry);
  }
  const order = [...Object.keys(MODE_LABELS), ...[...modes.keys()].sort()];
  return [...new Set(order)]
    .filter((mode) => modes.has(mode))
    .map((mode) => ({
      mode,
      entries: modes.get(mode).sort(
        (a, b) => a.days - b.days || a.losses - b.losses || a.finishedAt - b.finishedAt
      )
    }));
}
