// v2 is the private per-room/per-seat ranking namespace. Missing position keys
// now mean "use the editable OB/Control starting order"; explicit arrays,
// including empty arrays, are user customizations and must survive reconnects.
const ONLINE_RANKINGS_STORAGE_PREFIX = "mlb-showdown-online-rankings-v2:";

export function normalizeDraftRankings(value) {
  if (!value || typeof value !== "object") return {};
  const normalized = {};
  for (const [managerId, rankings] of Object.entries(value)) {
    if (!rankings || typeof rankings !== "object") continue;
    const managerRankings = {};
    for (const [key, ids] of Object.entries(rankings)) {
      if (!Array.isArray(ids)) continue;
      const clean = [...new Set(ids.filter((id) => typeof id === "string"))];
      managerRankings[key] = clean;
    }
    if (Object.keys(managerRankings).length) normalized[managerId] = managerRankings;
  }
  return normalized;
}

export function loadOnlineDraftRankings(storage, roomId, managerId) {
  const key = onlineRankingsStorageKey(roomId, managerId);
  if (!key || typeof storage?.getItem !== "function") return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    return normalizeDraftRankings({ [managerId]: JSON.parse(raw) });
  } catch {
    return {};
  }
}

export function saveOnlineDraftRankings(storage, roomId, managerId, rankings) {
  const key = onlineRankingsStorageKey(roomId, managerId);
  if (!key || typeof storage?.setItem !== "function") return false;
  const ownRankings = normalizeDraftRankings(rankings)[managerId] ?? {};
  try {
    if (Object.keys(ownRankings).length) {
      storage.setItem(key, JSON.stringify(ownRankings));
    } else if (typeof storage.removeItem === "function") {
      storage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

function onlineRankingsStorageKey(roomId, managerId) {
  if (typeof roomId !== "string" || !roomId || typeof managerId !== "string" || !managerId) return null;
  return `${ONLINE_RANKINGS_STORAGE_PREFIX}${encodeURIComponent(roomId)}:${encodeURIComponent(managerId)}`;
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
