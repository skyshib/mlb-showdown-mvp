import { cardById } from "./packs.js";

const SAVE_KEY = "showdown-quest-save";
export const SAVE_VERSION = 1;

// Roster point cap by badge count: the level-cap analog. Spec §3.2.
const POINT_CAPS = [2600, 3000, 3400, 3800, 4200, 4600, 5000, 5400, 6000];

export const LOSS_FEE = 50;

export function createSave({ name, saveSeed }) {
  return {
    version: SAVE_VERSION,
    saveSeed,
    player: {
      name,
      coins: 0,
      badges: []
    },
    collection: {},
    roster: { cardIds: [], lineupAssignments: {} },
    progress: {
      trainersBeaten: {},
      counters: { packsOpened: 0, battlesWon: 0, battlesLost: 0 }
    },
    activeSeries: null,
    pendingPacks: [],
    log: []
  };
}

export function pointCap(save) {
  return POINT_CAPS[Math.min(save.player.badges.length, POINT_CAPS.length - 1)];
}

export function deriveSeed(save, ...parts) {
  return [save.saveSeed, ...parts].join(":");
}

// ---- Persistence -----------------------------------------------------------

export function loadSave(storage = defaultStorage()) {
  const raw = storage?.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    const save = JSON.parse(raw);
    return migrateSave(save);
  } catch {
    return null;
  }
}

export function persistSave(save, storage = defaultStorage()) {
  storage?.setItem(SAVE_KEY, JSON.stringify(save));
  return save;
}

export function clearSave(storage = defaultStorage()) {
  storage?.removeItem(SAVE_KEY);
}

function defaultStorage() {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function migrateSave(save) {
  if (!save || typeof save !== "object") return null;
  if (save.version !== SAVE_VERSION) return null;
  return save;
}

export function exportSaveCode(save) {
  const json = JSON.stringify(save);
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(json)));
  return Buffer.from(json, "utf8").toString("base64");
}

export function importSaveCode(code) {
  try {
    const json = typeof atob === "function"
      ? decodeURIComponent(escape(atob(code.trim())))
      : Buffer.from(code.trim(), "base64").toString("utf8");
    return migrateSave(JSON.parse(json));
  } catch {
    return null;
  }
}

// ---- Collection ------------------------------------------------------------

export function addCardToCollection(save, cardId, count = 1) {
  save.collection[cardId] = (save.collection[cardId] ?? 0) + count;
}

export function ownedCount(save, cardId) {
  return save.collection[cardId] ?? 0;
}

// Removing a card refuses to break the active roster: roster copies are the
// last to go.
export function removeCardFromCollection(save, cardId) {
  const owned = ownedCount(save, cardId);
  const inRoster = save.roster.cardIds.includes(cardId) ? 1 : 0;
  if (owned - 1 < inRoster) return false;
  if (owned <= 1) delete save.collection[cardId];
  else save.collection[cardId] = owned - 1;
  return true;
}

export function collectionCards(save) {
  return Object.entries(save.collection)
    .map(([id, count]) => ({ card: cardById(id), count }))
    .filter((entry) => entry.card)
    .sort((a, b) => b.card.points - a.card.points || a.card.name.localeCompare(b.card.name));
}

// ---- Roster ----------------------------------------------------------------

export function rosterCards(save) {
  return save.roster.cardIds.map((id) => cardById(id)).filter(Boolean);
}

export function rosterPoints(save) {
  return rosterCards(save).reduce((sum, card) => sum + card.points, 0);
}

// A manager object in the shape src/rules/draft.js expects.
export function managerFor(save) {
  return {
    id: "player",
    name: save.player.name,
    roster: rosterCards(save),
    lineupAssignments: save.roster.lineupAssignments,
    battingOrder: save.roster.battingOrder ?? []
  };
}

export function setRoster(save, cardIds, lineupAssignments = {}) {
  const battingOrder = (save.roster?.battingOrder ?? []).filter((id) => cardIds.includes(id));
  save.roster = { cardIds: [...cardIds], lineupAssignments: { ...lineupAssignments }, battingOrder };
}

// Persist the player's preferred batting order (a list of card ids, leadoff
// first). Ids that leave the roster are dropped on the next setRoster.
export function setBattingOrder(save, cardIds) {
  save.roster.battingOrder = [...cardIds];
}

// ---- Coins -----------------------------------------------------------------

export function grantCoins(save, amount) {
  save.player.coins += amount;
}

export function spendCoins(save, amount) {
  if (save.player.coins < amount) return false;
  save.player.coins -= amount;
  return true;
}

// ---- Trainer progress ------------------------------------------------------

export function timesBeaten(save, trainerId) {
  return save.progress.trainersBeaten[trainerId] ?? 0;
}

export function recordTrainerWin(save, trainerId) {
  save.progress.trainersBeaten[trainerId] = timesBeaten(save, trainerId) + 1;
  save.progress.counters.battlesWon += 1;
}

export function recordTrainerLoss(save) {
  save.progress.counters.battlesLost += 1;
  save.player.coins = Math.max(0, save.player.coins - LOSS_FEE);
}

export function grantBadge(save, badge) {
  if (!save.player.badges.includes(badge)) save.player.badges.push(badge);
}

export function addLog(save, message) {
  save.log.push(message);
  if (save.log.length > 30) save.log.shift();
}

// ---- Series ----------------------------------------------------------------

export function startSeries(save, trainerId, bestOf) {
  save.activeSeries = {
    trainerId,
    bestOf,
    attempt: attemptNumber(save, trainerId),
    wins: 0,
    losses: 0,
    nextGame: 1
  };
  return save.activeSeries;
}

// Attempts salt battle seeds so a retry is a different game. Track them
// per-trainer in a counter that only moves forward.
export function attemptNumber(save, trainerId) {
  const key = `attempts:${trainerId}`;
  save.progress.counters[key] = (save.progress.counters[key] ?? 0) + 1;
  return save.progress.counters[key];
}

export function seriesNeeded(series) {
  return Math.floor(series.bestOf / 2) + 1;
}

export function recordSeriesGame(save, playerWon) {
  const series = save.activeSeries;
  if (!series) return null;
  if (playerWon) series.wins += 1;
  else series.losses += 1;
  series.nextGame += 1;
  const needed = seriesNeeded(series);
  if (series.wins >= needed) return "won";
  if (series.losses >= needed) return "lost";
  return "live";
}

export function clearSeries(save) {
  save.activeSeries = null;
}
