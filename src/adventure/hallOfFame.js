import { uploadRun } from "./gameArchive.js?v=20260716-records";
import { submitRunRecords } from "./records.js?v=20260716-records";
import {
  catalogProgress,
  ensureAlmanac,
  ensureSeasonStats,
  rosterCards,
  rosterPoints,
  seasonHitters,
  seasonPitchers
} from "./state.js?v=20260716-records";

// The hall of fame outlives any single save: it keeps its own storage key, so
// deleting or replacing a campaign never erases the plaques it earned.
const HOF_KEY = "showdown-quest-hall-of-fame";

export const MODE_LABELS = { budget: "BUDGET LEAGUE", uncapped: "UNCAPPED", gauntlet: "THE GAUNTLET" };

// "Is there a localStorage?" is not the same question as "is there a localStorage
// I can READ", and on modern Node it is not the same answer: Node defines the
// global and then throws on it unless the runtime was started with web storage
// enabled. Ask for the method, not the name.
function defaultStorage() {
  const store = typeof localStorage === "undefined" ? null : localStorage;
  return typeof store?.getItem === "function" ? store : null;
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
  const standing = entries.findIndex((entry) => entry.saveSeed === save.saveSeed);
  if (standing >= 0) return deepenPlaque(entries, standing, save, storage);
  const entry = buildEntry(save);
  entries.push(entry);
  storage?.setItem(HOF_KEY, JSON.stringify(entries));
  // Best effort: the run also goes up to the shared board. If the network is
  // down it stays local, and the leaderboard screen resubmits it next visit.
  submitRun(entry);
  // And its title marks go to the record book, under this manager's name — a
  // finished run belongs in both without anyone having to open the record screen
  // first. Same best-effort deal: the records screen catches up any that missed
  // (see submitMissingRunRecords).
  submitRunRecords(entry);
  // And the games under it — the afternoons that got him there. One request each
  // (see gameArchive), quietly, so a plaque somebody opens has something behind
  // it besides a roster.
  uploadRun(save);
  return entry;
}

// A save already on the board. A budget campaign ends once, so its plaque is
// written once and only syncRunProgress touches it after. A GAUNTLET save can
// end many times — IMMORTAL is meant to be taken again — so its plaque keeps the
// DEEPEST run the save has made and is rewritten when a later one gets further,
// rather than one manager filling the board with forty goes at the same wall.
function deepenPlaque(entries, index, save, storage) {
  const held = entries[index];
  const fields = gauntletFields(save);
  if (!fields.gauntletTier) return null;
  const deeper = fields.gauntletCleared > (held.gauntletCleared ?? -1);
  const tried = fields.gauntletAttempts > (held.gauntletAttempts ?? 1);
  if (!deeper && !tried) return null;
  // A deeper run is a different run: it was a different club on a different day,
  // so the plaque is rebuilt rather than patched. A run that only added another
  // attempt just updates the count.
  const entry = deeper
    ? { ...buildEntry(save), finishedAt: Date.now() }
    : { ...held, gauntletAttempts: fields.gauntletAttempts };
  entries[index] = entry;
  storage?.setItem(HOF_KEY, JSON.stringify(entries));
  submitRun(entry);
  submitRunRecords(entry);
  if (deeper) uploadRun(save);
  return entry;
}

// What a gauntlet run has to show for itself. A budget campaign ends one way —
// the trophy — so its plaque needs no score. A gauntlet run ends wherever it
// ended, and how deep it got IS the run; six clubs at CONTENDER and six at
// IMMORTAL are not the same six clubs, so the tier rides along with the number.
function gauntletFields(save) {
  if (save?.mode !== "gauntlet") return {};
  const run = save.gauntlet ?? {};
  const cleared = Math.max(run.best ?? 0, run.cleared?.length ?? 0);
  return {
    gauntletTier: save.gauntletTier ?? "elite",
    gauntletCleared: cleared,
    gauntletTotal: 6,
    gauntletAttempts: run.attempt ?? 1,
    gauntletSwept: cleared >= 6
  };
}

function buildEntry(save) {
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
    // The trophy is one ending. The catalog is the other, and it is not finished
    // when the trophy lands — so the plaque carries it and keeps carrying it.
    // See syncRunProgress: the plaque is written once and amended forever after.
    ...catalogFields(save),
    roster: rosterCards(save),
    hitters: seasonHitters(save).filter((line) => rosterIds.includes(line.id)),
    pitchers: seasonPitchers(save).filter((line) => rosterIds.includes(line.id)),
    ...gauntletFields(save)
  };
  return entry;
}

function catalogFields(save) {
  const catalog = catalogProgress(save);
  return {
    cardsOwned: catalog.owned,
    cardsTotal: catalog.total,
    catalogComplete: catalog.complete,
    catalogCompletedOn: save.progress?.catalogCompletedOn ?? null
  };
}

// A run can finish at a moment nobody is filing anything: the tab was on an
// older build, the browser was closed on the result screen, the network was out.
// The board asks for this every time it is opened, and filing is idempotent —
// deepenPlaque only writes when the plaque actually moves — so a run that missed
// its moment is picked up the next time anybody looks. Mirrors the way the record
// screen catches up its own missing marks (submitMissingRunRecords).
export function fileFinishedGauntletRun(save, storage = defaultStorage()) {
  if (save?.mode !== "gauntlet") return null;
  const run = save.gauntlet;
  if (!run) return null;
  // Something to show means: this run ended, an earlier one did, or the table
  // has been run. A first run still in progress has not scored yet.
  const scored = run.over || (run.best ?? 0) > 0 || (run.cleared?.length ?? 0) >= 6;
  if (!scored) return null;
  const filed = recordCompletedRun(save, storage);
  if (filed) return filed;
  // The plaque is already right and recordCompletedRun had nothing to add — but
  // the league's copy of it may still be wrong, from a run that went up before
  // the server understood gauntlet plaques. Send ours over the top of it.
  const standing = loadHallOfFame(storage).find((entry) => entry.saveSeed === save.saveSeed);
  if (standing) submitRun(standing);
  return standing ?? null;
}

// A finished run keeps going: the champion is still out there buying cards. The
// plaque is written the day the trophy is won and AMENDED every time the hall is
// opened, so the board shows how much of the league that manager has actually
// collected — and marks the ones who got all of it. Nothing else on the plaque
// moves; the run's record is the run's record.
export function syncRunProgress(save, storage = defaultStorage()) {
  if (!save) return null;
  const entries = loadHallOfFame(storage);
  const entry = entries.find((item) => item.saveSeed === save.saveSeed);
  if (!entry) return null;
  const fields = catalogFields(save);
  const changed = Object.entries(fields).some(([key, value]) => entry[key] !== value);
  if (!changed) return entry;
  Object.assign(entry, fields);
  storage?.setItem(HOF_KEY, JSON.stringify(entries));
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

// The league's board, with YOUR plaques laid over it. One row per campaign, and
// where both have the same campaign the LOCAL copy wins — local storage is the
// source of truth for your own runs, and the server's copy can be the older
// story: a gauntlet sweep filed before the board knew what a gauntlet run was
// came back down as a budget campaign, and taking the league's word for it hid
// the run from its own manager.
export function mergeEntries(local, global) {
  const merged = [];
  const at = new Map();
  for (const entry of [...local, ...(global ?? [])]) {
    if (at.has(entry.saveSeed)) continue;
    at.set(entry.saveSeed, merged.length);
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
      // A championship board ranks on the clock: fastest to the trophy wins. The
      // gauntlet has no trophy to be fast to — the run ends where it ends — so it
      // ranks on depth, deepest first, and only then on the clock.
      entries: modes.get(mode).sort((a, b) => (mode === "gauntlet"
        ? (b.gauntletCleared ?? 0) - (a.gauntletCleared ?? 0) || a.days - b.days
        : a.days - b.days || a.losses - b.losses) || a.finishedAt - b.finishedAt)
    }));
}
