export const RESULTS = {
  PU: "PU",
  SO: "SO",
  GB: "GB",
  FB: "FB",
  BB: "BB",
  SINGLE: "1B",
  // The real cards' 1B+: a single, plus an automatic uncontested advance to
  // second when it's open. Batter-only — pitcher charts never print it.
  SINGLE_PLUS: "1B+",
  DOUBLE: "2B",
  TRIPLE: "3B",
  HR: "HR"
};

// MLB pool card ids are mlb-<slice>-<lahmanId>[-bat]: the slice names the
// era the card was cut from (a decade, a franchise, all-time, or "tw" — a
// player's simultaneous two-way window) and the lahman id names the human.
// Multi-decade pools carry one card per player per decade, so the same
// person can appear several times; playerIdentity is how roster rules
// recognize him. A two-way player's bat and arm halves share a slice —
// same person, same era — and are the one legal pairing; his windowed tw
// printing is a different era, so it conflicts with his career cards.
export function playerIdentity(id) {
  const match = /^mlb-([^-]+)-([^-]+?)(-bat)?$/.exec(id ?? "");
  return match ? { person: match[2], slice: match[1] } : null;
}

// The human behind a card, however his league names him. MLB pools spell the
// person out in the id; the Showdown sets don't, but they print the season on
// the face ("Mike Piazza '93"), so the name with the season filed off is the
// man. A deal uses this to put each person on the board once — and a board
// that holds one Ken Griffey needs no roster rule about the other three.
export function cardPerson(card) {
  const identity = playerIdentity(card?.id);
  if (identity) return identity.person;
  const name = String(card?.name ?? "").replace(/\s+'\d{2,4}$/, "").trim();
  return name ? `name:${name.toLowerCase()}` : null;
}

// The rostered player that makes `player` illegal to add: the same human
// from a different era. Pass excludeId when evaluating a swap, so the
// outgoing card doesn't block its own replacement.
//
// This is a COLLECTION rule — adventure packs, NPC teams, roster swaps. Draft
// rooms don't need it: their board deals each person once (see cardPerson),
// so a drafting manager cannot reach a second era of a man he already owns.
export function personConflict(roster, player, excludeId = null) {
  const identity = playerIdentity(player?.id);
  if (!identity) return null;
  return roster.find((rostered) => {
    if (rostered.id === player.id || rostered.id === excludeId) return false;
    const other = playerIdentity(rostered.id);
    return other && other.person === identity.person && other.slice !== identity.slice;
  }) ?? null;
}

// A hitter's defensive eligibility, primary spot first: [{ pos, fielding }].
// Multi-position cards (real Showdown "2B+3 / SS+2" printings, MLB players
// with a real secondary spot) carry a positions array; single-position cards
// read as a one-entry list, so every consumer can treat the two the same.
export function hitterPositions(card) {
  if (Array.isArray(card?.positions) && card.positions.length) return card.positions;
  return [{ pos: card?.position, fielding: Number(card?.fielding) || 0 }];
}

export function playsPosition(card, pos) {
  return hitterPositions(card).some((entry) => entry.pos === pos);
}

// Fielding at a listed position, or null when the card doesn't list it.
export function fieldingAt(card, pos) {
  const entry = hitterPositions(card).find((item) => item.pos === pos);
  return entry ? Number(entry.fielding) || 0 : null;
}

// Two hitters cover the same ground if any listed position overlaps.
export function positionsOverlap(a, b) {
  return hitterPositions(a).some((entry) => playsPosition(b, entry.pos));
}

const signedFielding = (value) => `${value >= 0 ? "+" : ""}${value}`;

// Display-only grouping: a card that lists EVERY infield spot at one rating
// reads "IF+1" (outfield likewise "OF+2"), the way the real printings
// compressed the true utility men. Eligibility math keeps the full list.
const POSITION_GROUPS = [["IF", ["1B", "2B", "3B", "SS"]], ["OF", ["LF/RF", "CF"]]];

function displayPositions(card) {
  let entries = hitterPositions(card).map((entry) => ({ pos: entry.pos, fielding: Number(entry.fielding) || 0 }));
  for (const [label, group] of POSITION_GROUPS) {
    const members = entries.filter((entry) => group.includes(entry.pos));
    if (members.length !== group.length) continue;
    if (new Set(members.map((entry) => entry.fielding)).size !== 1) continue;
    const first = entries.findIndex((entry) => group.includes(entry.pos));
    entries = entries.filter((entry) => !group.includes(entry.pos));
    entries.splice(Math.min(first, entries.length), 0, { pos: label, fielding: members[0].fielding });
  }
  return entries;
}

// "2B·SS" — position text for table cells and compact lines.
export function positionsLabel(card) {
  return displayPositions(card).map((entry) => entry.pos).join("·");
}

// "+3/+2" — the matching fielding text, one value per listed position.
export function fieldingLabel(card) {
  return displayPositions(card).map((entry) => signedFielding(entry.fielding)).join("/");
}

// "2B+3, SS+2" — the card-face pairing, comma-separated.
export function positionFieldingLabel(card) {
  return displayPositions(card)
    .map((entry) => `${entry.pos}${signedFielding(entry.fielding)}`)
    .join(", ");
}

export function resolveChart(chart, roll) {
  const match = chart.find((entry) => roll >= entry.from && roll <= entry.to);
  if (!match) {
    throw new Error(`No chart result for roll ${roll}`);
  }
  return match.result;
}

export function compactChart(chart) {
  return chart.map((entry) => `${formatRange(entry)}: ${entry.result}`).join(", ");
}

export function formatRange(entry) {
  // Open-ended ranges print as the card does ("21+"), even past the d20.
  if (!Number.isFinite(entry.to)) return `${entry.from}+`;
  return entry.from === entry.to ? String(entry.from) : `${entry.from}-${entry.to}`;
}

// The swing is a d20, so the die is the ceiling: a card's open top row ("20+",
// stored as `to: Infinity`) is worth the faces it can actually land on, and a
// row that starts past 20 is worth nothing at all.
//
// Everything that weighs a chart has to agree on this. Three places worked it
// out for themselves and two of them forgot — and an infinitely wide row makes
// a card infinitely valuable, which quietly poisons every comparison it touches.
// One helper now, so it can only be got right.
export const MAX_ROLL = 20;

export function chartSpan(entry) {
  const from = Math.max(1, Number(entry.from) || 1);
  const to = Math.min(MAX_ROLL, Number.isFinite(entry.to) ? Number(entry.to) : MAX_ROLL);
  return Math.max(0, to - from + 1);
}
