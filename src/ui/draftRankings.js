const ONLINE_RANKINGS_STORAGE_PREFIX = "mlb-showdown-online-rankings-v1:";

export function normalizeDraftRankings(value) {
  if (!value || typeof value !== "object") return {};
  const normalized = {};
  for (const [managerId, rankings] of Object.entries(value)) {
    if (!rankings || typeof rankings !== "object") continue;
    const managerRankings = {};
    for (const [key, ids] of Object.entries(rankings)) {
      if (!Array.isArray(ids)) continue;
      const clean = [...new Set(ids.filter((id) => typeof id === "string"))];
      if (clean.length) managerRankings[key] = clean;
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
  const list = [...ids];
  const from = list.indexOf(playerId);
  const target = list.indexOf(targetId);
  if (from < 0 || target < 0 || from === target) return list;
  list.splice(from, 1);
  const adjustedTarget = list.indexOf(targetId);
  list.splice(adjustedTarget + (after ? 1 : 0), 0, playerId);
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
