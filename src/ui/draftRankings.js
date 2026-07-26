// v3 stores each position board as { ids, tiers } instead of a bare id array:
// ids is the manual order, tiers the divider breaks cut into it. Missing
// position keys still mean "use the editable OB/Control starting order";
// explicit entries, including empty ones, are user customizations and must
// survive reconnects. v2 boards (bare arrays) are still read, as tierless.
const ONLINE_RANKINGS_STORAGE_PREFIX = "mlb-showdown-online-rankings-v3:";
const LEGACY_ONLINE_RANKINGS_PREFIX = "mlb-showdown-online-rankings-v2:";
// Notes ride the same private channel as the rankings: per room, per seat,
// never sent to the server. One short line per card.
const ONLINE_NOTES_STORAGE_PREFIX = "mlb-showdown-online-notes-v1:";
export const MAX_NOTE_LENGTH = 80;

export function normalizeDraftRankings(value) {
  if (!value || typeof value !== "object") return {};
  const normalized = {};
  for (const [managerId, rankings] of Object.entries(value)) {
    if (!rankings || typeof rankings !== "object") continue;
    const managerRankings = {};
    for (const [key, saved] of Object.entries(rankings)) {
      const ids = Array.isArray(saved) ? saved : Array.isArray(saved?.ids) ? saved.ids : null;
      if (!ids) continue;
      const clean = [...new Set(ids.filter((id) => typeof id === "string"))];
      managerRankings[key] = {
        ids: clean,
        tiers: normalizeTierBreaks(Array.isArray(saved) ? [] : saved.tiers, clean.length)
      };
    }
    if (Object.keys(managerRankings).length) normalized[managerId] = managerRankings;
  }
  return normalized;
}

export function loadOnlineDraftRankings(storage, roomId, managerId) {
  const raw = readOnlineValue(storage, ONLINE_RANKINGS_STORAGE_PREFIX, roomId, managerId)
    ?? readOnlineValue(storage, LEGACY_ONLINE_RANKINGS_PREFIX, roomId, managerId);
  if (!raw) return {};
  try {
    return normalizeDraftRankings({ [managerId]: JSON.parse(raw) });
  } catch {
    return {};
  }
}

export function saveOnlineDraftRankings(storage, roomId, managerId, rankings) {
  const key = onlineStorageKey(ONLINE_RANKINGS_STORAGE_PREFIX, roomId, managerId);
  if (!key || typeof storage?.setItem !== "function") return false;
  const ownRankings = normalizeDraftRankings(rankings)[managerId] ?? {};
  try {
    if (Object.keys(ownRankings).length) {
      storage.setItem(key, JSON.stringify(ownRankings));
    } else if (typeof storage.removeItem === "function") {
      storage.removeItem(key);
    }
    // The v2 copy has been superseded either way. Left behind, it would
    // resurrect a stale board the next time the v3 key comes up empty.
    if (typeof storage.removeItem === "function") {
      storage.removeItem(onlineStorageKey(LEGACY_ONLINE_RANKINGS_PREFIX, roomId, managerId));
    }
    return true;
  } catch {
    return false;
  }
}

export function normalizeDraftNotes(value) {
  if (!value || typeof value !== "object") return {};
  const normalized = {};
  for (const [managerId, notes] of Object.entries(value)) {
    if (!notes || typeof notes !== "object") continue;
    const clean = {};
    for (const [playerId, note] of Object.entries(notes)) {
      if (typeof note !== "string") continue;
      const trimmed = note.trim().slice(0, MAX_NOTE_LENGTH);
      if (trimmed) clean[playerId] = trimmed;
    }
    if (Object.keys(clean).length) normalized[managerId] = clean;
  }
  return normalized;
}

export function loadOnlineDraftNotes(storage, roomId, managerId) {
  const raw = readOnlineValue(storage, ONLINE_NOTES_STORAGE_PREFIX, roomId, managerId);
  if (!raw) return {};
  try {
    return normalizeDraftNotes({ [managerId]: JSON.parse(raw) });
  } catch {
    return {};
  }
}

export function saveOnlineDraftNotes(storage, roomId, managerId, notes) {
  const key = onlineStorageKey(ONLINE_NOTES_STORAGE_PREFIX, roomId, managerId);
  if (!key || typeof storage?.setItem !== "function") return false;
  const ownNotes = normalizeDraftNotes(notes)[managerId] ?? {};
  try {
    if (Object.keys(ownNotes).length) {
      storage.setItem(key, JSON.stringify(ownNotes));
    } else if (typeof storage.removeItem === "function") {
      storage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

function readOnlineValue(storage, prefix, roomId, managerId) {
  const key = onlineStorageKey(prefix, roomId, managerId);
  if (!key || typeof storage?.getItem !== "function") return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function onlineStorageKey(prefix, roomId, managerId) {
  if (typeof roomId !== "string" || !roomId || typeof managerId !== "string" || !managerId) return null;
  return `${prefix}${encodeURIComponent(roomId)}:${encodeURIComponent(managerId)}`;
}

export function moveRankedIds(ids, playerId, targetId, { after = false } = {}) {
  const list = [...ids].filter((id) => id !== playerId);
  const target = list.indexOf(targetId);
  if (playerId === targetId) return ids.includes(playerId) ? [...ids] : [...ids, playerId];
  // Dropping onto an unranked row adds or moves the player to the end of the
  // ranked group. Dropping onto a ranked row inserts on the indicated side.
  const insertion = target < 0 ? list.length : target + (after ? 1 : 0);
  list.splice(insertion, 0, playerId);
  return list;
}

export function nudgeRankedIds(ids, playerId, delta) {
  const list = [...ids];
  const from = list.indexOf(playerId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return list;
  [list[from], list[to]] = [list[to], list[from]];
  return list;
}

export function rankIdAt(ids, playerId, requestedRank) {
  const parsed = Math.trunc(Number(requestedRank));
  if (!Number.isFinite(parsed) || parsed < 1) return [...ids];
  const list = [...ids].filter((id) => id !== playerId);
  // Manual ranks are compact. Asking for #10 with only three ranked players
  // means "last in my ranked group", which is #4—not six empty ranks that
  // would misleadingly sit above the unranked board.
  const insertion = Math.min(parsed - 1, list.length);
  list.splice(insertion, 0, playerId);
  return list;
}

export function removeRankedId(ids, playerId) {
  return ids.filter((id) => id !== playerId);
}

// ---- tier breaks ----
//
// A tier break b is a divider after rank b: breaks [2, 5] cut a nine-man
// ranking into 1-2, 3-5, and 6-9. Breaks are counted in ranks, so any edit
// that changes a player's rank has to carry the dividers along with it — the
// functions below keep the two in step so a divider never drifts onto a
// different pair of players than the one it was drawn between.

export function normalizeTierBreaks(value, rankedCount) {
  if (!Array.isArray(value)) return [];
  const clean = value
    .map((entry) => Math.trunc(Number(entry)))
    .filter((entry) => Number.isFinite(entry) && entry >= 1 && entry < rankedCount);
  return [...new Set(clean)].sort((a, b) => a - b);
}

export function insertTierBreak(tiers, afterCount, rankedCount) {
  return normalizeTierBreaks([...tiers, afterCount], rankedCount);
}

export function removeTierBreak(tiers, afterCount) {
  return tiers.filter((entry) => entry !== afterCount);
}

// Which tier a rank sits in, counting from 1.
export function tierOfRank(tiers, rank) {
  return tiers.filter((entry) => entry < rank).length + 1;
}

// A drag joins the tier of the row it was dropped on — the before/after side
// only settles the order inside it. Rebuilding the breaks from that membership
// is what keeps a drop beside a divider honest: landing on the last card of
// tier 1 stays tier 1, landing on the first card of tier 2 is tier 2, even
// though both are the same seam in the list.
export function moveRankedWithTiers(entry, playerId, targetId, { after = false } = {}) {
  const ids = moveRankedIds(entry.ids, playerId, targetId, { after });
  if (!entry.tiers.length) return { ids, tiers: [] };
  const tierOf = tierMembership(entry);
  const lastTier = entry.tiers.length + 1;
  tierOf.set(playerId, tierOf.get(targetId) ?? lastTier);
  return { ids, tiers: rebuildTierBreaks(ids, tierOf) };
}

// Dropping on a divider is an exact ask: put the card immediately above this
// break, as the last card of the tier the divider closes. Nobody already
// ranked above the seam moves. Break 0 is the board's top shelf — rank 1,
// tier 1 — the one seam with nothing above it.
export function moveRankedAboveBreak(entry, playerId, breakAfter) {
  const oldIndex = entry.ids.indexOf(playerId);
  const list = entry.ids.filter((id) => id !== playerId);
  const seam = Math.max(0, Math.min(breakAfter - (oldIndex >= 0 && oldIndex < breakAfter ? 1 : 0), list.length));
  list.splice(seam, 0, playerId);
  if (!entry.tiers.length) return { ids: list, tiers: [] };
  const tierOf = tierMembership(entry);
  tierOf.set(playerId, tierOfRank(entry.tiers, Math.max(1, breakAfter)));
  return { ids: list, tiers: rebuildTierBreaks(list, tierOf) };
}

function tierMembership(entry) {
  return new Map(entry.ids.map((id, index) => [id, tierOfRank(entry.tiers, index + 1)]));
}

function rebuildTierBreaks(ids, tierOf) {
  const tiers = [];
  for (let index = 1; index < ids.length; index += 1) {
    if (tierOf.get(ids[index]) !== tierOf.get(ids[index - 1])) tiers.push(index);
  }
  return normalizeTierBreaks(tiers, ids.length);
}

// A typed rank takes the slot it names, so it takes that slot's tier with it;
// clearing a rank pulls the dividers below it up by one.
export function rankAtWithTiers(entry, playerId, requestedRank) {
  const ids = rankIdAt(entry.ids, playerId, requestedRank);
  return { ids, tiers: shiftTierBreaks(entry, ids, playerId) };
}

export function removeRankedWithTiers(entry, playerId) {
  const ids = removeRankedId(entry.ids, playerId);
  return { ids, tiers: shiftTierBreaks(entry, ids, playerId) };
}

// The arrows treat a divider as a stop of its own: pressing into it slides the
// player across into the next tier over — a membership change, nobody else
// moves — and only inside a tier do the arrows swap neighbours.
export function nudgeRankedWithTiers(entry, playerId, delta) {
  const rank = entry.ids.indexOf(playerId) + 1;
  if (!rank || !delta) return { ids: [...entry.ids], tiers: [...entry.tiers] };
  if (delta > 0 && entry.tiers.includes(rank)) {
    return {
      ids: [...entry.ids],
      tiers: normalizeTierBreaks(entry.tiers.map((b) => (b === rank ? b - 1 : b)), entry.ids.length)
    };
  }
  if (delta < 0 && entry.tiers.includes(rank - 1)) {
    return {
      ids: [...entry.ids],
      tiers: normalizeTierBreaks(entry.tiers.map((b) => (b === rank - 1 ? b + 1 : b)), entry.ids.length)
    };
  }
  return { ids: nudgeRankedIds(entry.ids, playerId, delta), tiers: [...entry.tiers] };
}

function shiftTierBreaks(entry, newIds, playerId) {
  const from = entry.ids.indexOf(playerId) + 1;
  const to = newIds.indexOf(playerId) + 1;
  if (from === to) return normalizeTierBreaks(entry.tiers, newIds.length);
  let breaks = [...entry.tiers];
  if (from) breaks = breaks.map((b) => (b >= from ? b - 1 : b));
  if (to) breaks = breaks.map((b) => (b >= to ? b + 1 : b));
  return normalizeTierBreaks(breaks, newIds.length);
}
