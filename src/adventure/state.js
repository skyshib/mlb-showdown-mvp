import { cardById, dualPartnerId, dualPrimaryId, adventurePool, budgetCap } from "./packs.js?v=20260714-h";

const SAVE_KEY = "showdown-quest-save";
// v2: per-save card universes, flat point cap, starter packs. v1 saves point
// at the old shared universe, so they don't migrate.
export const SAVE_VERSION = 2;

// The roster budget in BUDGET mode scales with the pool like the whole NPC
// ladder does: 3500 in the fictional reference league (1.4x the first
// scout's rung), proportionally less in thinner pools. Getting ahead means
// finding bargains, not raising the cap. UNCAPPED saves have no limit at
// all — and face far richer bosses.

// A loss costs nothing but the game. It used to cost 50 coins, which taxed the
// one thing a player most needs to do to get better — go and lose to somebody
// stronger — and hit hardest exactly when a manager could least afford it. The
// export stays at zero so the screens that used to name a fee still compile
// against something honest.
export const LOSS_FEE = 0;

export function createSave({ name, saveSeed, universe = "fictional", mode = "budget" }) {
  return {
    version: SAVE_VERSION,
    saveSeed,
    universe,
    mode,
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
    log: [],
    seasonStats: { games: 0, hitters: {}, pitchers: {} }
  };
}

// Older saves predate modes and read as "budget".
export function pointCap(save) {
  return save?.mode === "uncapped" ? Infinity : budgetCap();
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

// The save is written after every decision, and now it carries the play-by-play
// of every game ever played. That is bounded — a long run is a couple of
// megabytes against a browser's five — but "bounded" and "impossible" are not the
// same word, and the failure mode here was appalling: setItem throws when the
// disk is full, and it was throwing straight up through the middle of a ballgame,
// after every pitch, with nothing caught and nothing saved.
//
// So a full disk costs you the OLDEST GAME'S LOG, and then the next oldest, and
// so on until the save fits. Losing an old play-by-play is a shame. Losing the
// campaign is not a shame, it is a bug, and this is the difference between them.
export function persistSave(save, storage = defaultStorage()) {
  if (!storage) return save;
  const logged = () => ensureAlmanac(save).filter((game) => game.events);
  for (;;) {
    try {
      storage.setItem(SAVE_KEY, JSON.stringify(save));
      return save;
    } catch (error) {
      const games = logged();
      if (!games.length) {
        // Nothing left to give: the save itself no longer fits. Say so rather
        // than pretending, and leave what is already on the disk alone.
        console.error(`The save no longer fits in this browser: ${error.message}`);
        return save;
      }
      // Oldest first — the almanac is in the order it was played.
      delete games[0].events;
    }
  }
}

export function clearSave(storage = defaultStorage()) {
  storage?.removeItem(SAVE_KEY);
}

// See hallOfFame.js: Node defines a localStorage global that has no getItem on
// it, so the name being present proves nothing. Ask for the method.
function defaultStorage() {
  const store = typeof localStorage === "undefined" ? null : localStorage;
  return typeof store?.getItem === "function" ? store : null;
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

// The name a backup downloads under: the manager's, so several saves don't
// land in a Downloads folder as file (1), file (2), file (3).
export function saveFileName(save) {
  const name = (save?.player?.name ?? "manager")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `showdown-quest-${name || "manager"}.sav`;
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

// A simultaneous two-way player is one owned card: either half arrives with
// its partner (packs.dualPartnerId knows the pairs).
export function addCardToCollection(save, cardId, count = 1) {
  save.collection[cardId] = (save.collection[cardId] ?? 0) + count;
  const partner = dualPartnerId(cardId);
  if (partner) save.collection[partner] = (save.collection[partner] ?? 0) + count;
  noteCatalogComplete(save);
}

// ---- The catalog ------------------------------------------------------------
//
// The other way to finish this game. The trophy is one ending; owning every card
// the league ever printed is the other, and it is the one that outlasts the
// championship — which is why the bosses stay on the map afterwards and keep
// paying, small, forever.
//
// A card and its two-way partner are one card here, the way they are one card
// everywhere else: the catalog lists the pair once, so it counts the pair once.
export function catalogProgress(save) {
  const pool = adventurePool().filter((card) => dualPrimaryId(card.id) === card.id);
  const owned = pool.filter((card) => (save?.collection?.[card.id] ?? 0) > 0).length;
  return { owned, total: pool.length, complete: pool.length > 0 && owned >= pool.length };
}

// The moment it happens, it is written down: the day, and a line in the log. It
// is checked on the way IN — you complete a catalog by acquiring a card, never
// by selling one — so a spare sold off later cannot un-write the day you did it.
function noteCatalogComplete(save) {
  if (!save || save.progress?.catalogCompletedOn) return;
  const { complete } = catalogProgress(save);
  if (!complete) return;
  save.progress.catalogCompletedOn = ensureSeasonStats(save).games;
  addLog(save, "THE CATALOG IS COMPLETE. Every card in the league is yours.");
}

export function ownedCount(save, cardId) {
  return save.collection[cardId] ?? 0;
}

// Removing a card refuses to break the active roster: roster copies are the
// last to go. A two-way pair leaves together — selling either half sells
// both, and either half's roster copy protects the pair.
export function removeCardFromCollection(save, cardId) {
  const ids = [cardId];
  const partner = dualPartnerId(cardId);
  if (partner && ownedCount(save, partner) > 0) ids.push(partner);
  for (const id of ids) {
    const owned = ownedCount(save, id);
    const inRoster = save.roster.cardIds.includes(id) ? 1 : 0;
    if (owned - 1 < inRoster) return false;
  }
  for (const id of ids) {
    const owned = ownedCount(save, id);
    if (owned <= 1) delete save.collection[id];
    else save.collection[id] = owned - 1;
  }
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

export function setRoster(save, cardIds, lineupAssignments = null) {
  const battingOrder = (save.roster?.battingOrder ?? []).filter((id) => cardIds.includes(id));
  // Slot assignments (the DH flip) survive roster edits by default: keep
  // every assignment that still points at a rostered card unless the caller
  // supplies a fresh mapping.
  const kept = lineupAssignments ?? save.roster?.lineupAssignments ?? {};
  const assignments = Object.fromEntries(
    Object.entries(kept).filter(([, cardId]) => cardIds.includes(cardId))
  );
  save.roster = { cardIds: [...cardIds], lineupAssignments: assignments, battingOrder };
}

// Persist the player's preferred batting order (a list of card ids, leadoff
// first). Ids that leave the roster are dropped on the next setRoster.
export function setBattingOrder(save, cardIds) {
  save.roster.battingOrder = [...cardIds];
}

// ---- Season stats ------------------------------------------------------------

const HITTER_STAT_KEYS = ["pa", "ab", "h", "d", "t", "hr", "bb", "so", "r", "rbi", "sb", "cs", "gidp", "wpa"];
const PITCHER_STAT_KEYS = ["bf", "outs", "h", "bb", "so", "hr", "r", "wpa"];

// Older saves predate season stats; grow the field in place instead of
// invalidating them with a version bump.
export function ensureSeasonStats(save) {
  if (!save.seasonStats) save.seasonStats = { games: 0, hitters: {}, pitchers: {} };
  return save.seasonStats;
}

// Fold one game's box score for the player's team into the rolling season
// totals. Every game counts: interactive battles and simulated series alike.
export function recordGameStats(save, teamBox) {
  const season = ensureSeasonStats(save);
  season.games += 1;
  for (const line of teamBox.hitters) {
    const row = season.hitters[line.id] ??
      (season.hitters[line.id] = { id: line.id, name: line.name, games: 0, ...Object.fromEntries(HITTER_STAT_KEYS.map((key) => [key, 0])) });
    row.games += 1;
    for (const key of HITTER_STAT_KEYS) row[key] += line[key] ?? 0;
  }
  for (const line of teamBox.pitchers) {
    const row = season.pitchers[line.id] ??
      (season.pitchers[line.id] = { id: line.id, name: line.name, games: 0, ...Object.fromEntries(PITCHER_STAT_KEYS.map((key) => [key, 0])) });
    row.games += 1;
    for (const key of PITCHER_STAT_KEYS) row[key] += line[key] ?? 0;
  }
  return season;
}

// Season lines with the rate stats the batch sim reports: AVG/OBP/SLG/OPS for
// bats, RA9 and K/9 for arms. Sorted the same way, too.
// A season here is however many games you have played, and a man who arrived in
// the pack you opened this morning has played one of them. Summed WPA ranks that
// man last no matter what he did, and ranks the man who has been on the roster
// since day one first no matter how little he has done — it is a counting stat
// being read as a rating. Per 162 is the rate: what he is WORTH, not how long he
// has been here.
function per162(wpa, games) {
  return games > 0 ? (wpa * 162) / games : 0;
}

export function seasonHitters(save) {
  return Object.values(ensureSeasonStats(save).hitters)
    .map((line) => {
      const singles = line.h - line.d - line.t - line.hr;
      const totalBases = singles + line.d * 2 + line.t * 3 + line.hr * 4;
      const obp = line.pa ? (line.h + line.bb) / line.pa : 0;
      const slg = line.ab ? totalBases / line.ab : 0;
      return {
        ...line,
        avg: line.ab ? line.h / line.ab : 0,
        obp,
        slg,
        ops: obp + slg,
        wpa162: per162(line.wpa, line.games)
      };
    })
    .sort((a, b) => b.ops - a.ops || b.pa - a.pa);
}

// The CLUB's season, which is the one number nobody could read: the men each had
// their line, and the team they add up to had none. Nine bats and four arms are a
// team, and a team has a record, runs for and against, and rates of its own.
//
// The record and the runs come from the almanac — the games themselves — because
// a box score knows who won and a stat line does not.
export function seasonTeam(save) {
  const games = ensureSeasonStats(save).games;
  const bats = seasonHitters(save);
  const arms = seasonPitchers(save);
  const sum = (lines, key) => lines.reduce((total, line) => total + (Number(line[key]) || 0), 0);

  const ab = sum(bats, "ab");
  const h = sum(bats, "h");
  const bb = sum(bats, "bb");
  const pa = sum(bats, "pa");
  const doubles = sum(bats, "d");
  const triples = sum(bats, "t");
  const hr = sum(bats, "hr");
  const singles = h - doubles - triples - hr;
  const totalBases = singles + doubles * 2 + triples * 3 + hr * 4;
  const obp = pa ? (h + bb) / pa : 0;
  const slg = ab ? totalBases / ab : 0;

  const outs = sum(arms, "outs");
  const runsAllowedByArms = sum(arms, "r");

  let wins = 0;
  let losses = 0;
  let runsFor = 0;
  let runsAgainst = 0;
  for (const game of ensureAlmanac(save)) {
    if (!game?.score || !game.playerSide) continue;
    const mine = game.score[game.playerSide];
    const theirs = game.score[game.playerSide === "home" ? "away" : "home"];
    if (typeof mine !== "number" || typeof theirs !== "number") continue;
    runsFor += mine;
    runsAgainst += theirs;
    if (game.won) wins += 1;
    else losses += 1;
  }

  return {
    games,
    wins,
    losses,
    winPct: wins + losses > 0 ? wins / (wins + losses) : 0,
    runsFor,
    runsAgainst,
    runDiff: runsFor - runsAgainst,
    runsPerGame: games ? runsFor / games : 0,
    runsAllowedPerGame: games ? runsAgainst / games : 0,
    avg: ab ? h / ab : 0,
    obp,
    slg,
    ops: obp + slg,
    hr,
    rbi: sum(bats, "rbi"),
    sb: sum(bats, "sb"),
    so: sum(arms, "so"),
    outs,
    // The arms' own runs allowed, per nine, which is not the same as the runs the
    // CLUB gave up: a run that scores on a fielding play is charged to the game,
    // not to the man on the mound.
    runsPerNine: outs ? (runsAllowedByArms * 27) / outs : 0,
    strikeoutsPerNine: outs ? (sum(arms, "so") * 27) / outs : 0
  };
}

export function seasonPitchers(save) {
  return Object.values(ensureSeasonStats(save).pitchers)
    .map((line) => ({
      ...line,
      runsPerNine: line.outs ? (line.r * 27) / line.outs : 0,
      strikeoutsPerNine: line.outs ? (line.so * 27) / line.outs : 0,
      wpa162: per162(line.wpa, line.games)
    }))
    .sort((a, b) => (a.outs === 0) - (b.outs === 0) || a.runsPerNine - b.runsPerNine || b.outs - a.outs);
}

// ---- Starred cards -------------------------------------------------------------

// Keepers, flagged by the player in the binder or catalog. Older saves grow
// the field in place. The sell screen's sweeps can spare them.
export function ensureStarred(save) {
  if (!Array.isArray(save.starred)) save.starred = [];
  return save.starred;
}

export function isStarred(save, cardId) {
  return ensureStarred(save).includes(cardId);
}

export function toggleStar(save, cardId) {
  const starred = ensureStarred(save);
  const at = starred.indexOf(cardId);
  if (at >= 0) starred.splice(at, 1);
  else starred.push(cardId);
  return at < 0;
}

// ---- Almanac and trophy case -------------------------------------------------

// Older saves predate the almanac and the trophy case; grow the fields in
// place instead of invalidating them with a version bump.
export function ensureAlmanac(save) {
  if (!save.almanac) save.almanac = [];
  return save.almanac;
}

export function ensureTrophies(save) {
  if (!save.trophies) save.trophies = [];
  return save.trophies;
}

// One line of campaign history per finished game — day, opponent, the score,
// the feats worth retelling, and the full box score so the almanac can reopen
// the game later. Sim-series games record too: every game is a day.
export function recordAlmanacGame(save, entry) {
  ensureAlmanac(save).push(entry);
  return entry;
}

// Rare feats persist in the display case: the feat, its hero card, and the
// day it happened. A second perfect game earns a second plaque.
export function addTrophies(save, feats, { day, opponent }) {
  const trophies = ensureTrophies(save);
  for (const feat of feats) {
    trophies.push({ title: feat.title, blurb: feat.blurb, cardId: feat.cardId ?? null, day, opponent });
  }
  return trophies;
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
