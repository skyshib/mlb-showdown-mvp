export const RESULTS = {
  PU: "PU",
  SO: "SO",
  GB: "GB",
  FB: "FB",
  BB: "BB",
  SINGLE: "1B",
  DOUBLE: "2B",
  TRIPLE: "3B",
  HR: "HR"
};

// MLB pool card ids are mlb-<slice>-<lahmanId>[-bat]: the slice names the
// pool the card was cut from (a decade, a franchise, all-time) and the
// lahman id names the human. Multi-decade pools carry one card per player
// per decade, so the same person can appear several times; playerIdentity
// is how roster rules recognize him. A two-way player's bat and arm halves
// share a slice — same person, same era — and are the one legal pairing.
export function playerIdentity(id) {
  const match = /^mlb-([^-]+)-([^-]+?)(-bat)?$/.exec(id ?? "");
  return match ? { person: match[2], slice: match[1] } : null;
}

// The rostered player that makes `player` illegal to add: the same human
// from a different era. Pass excludeId when evaluating a swap, so the
// outgoing card doesn't block its own replacement.
export function personConflict(roster, player, excludeId = null) {
  const identity = playerIdentity(player?.id);
  if (!identity) return null;
  return roster.find((rostered) => {
    if (rostered.id === player.id || rostered.id === excludeId) return false;
    const other = playerIdentity(rostered.id);
    return other && other.person === identity.person && other.slice !== identity.slice;
  }) ?? null;
}

export function resolveChart(chart, roll) {
  const match = chart.find((entry) => roll >= entry.from && roll <= entry.to);
  if (!match) {
    throw new Error(`No chart result for roll ${roll}`);
  }
  return normalizeResult(match.result);
}

export function compactChart(chart) {
  return chart.map((entry) => `${formatRange(entry)}: ${normalizeResult(entry.result)}`).join(", ");
}

export function formatRange(entry) {
  // Open-ended ranges print as the card does ("21+"), even past the d20.
  if (!Number.isFinite(entry.to)) return `${entry.from}+`;
  return entry.from === entry.to ? String(entry.from) : `${entry.from}-${entry.to}`;
}

export function normalizeResult(result) {
  return result === "1B+" ? RESULTS.SINGLE : result;
}
