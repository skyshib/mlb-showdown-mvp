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
// Both readings below are pure functions of a card's id (and, for the
// Showdown sets, its name) — and they are asked a LOT: the NPC's climb runs
// personConflict over every candidate in every slot's bucket on every pass,
// which is tens of thousands of id parses per team. Parsing is regex work,
// so the answers are memoized by id. Ids are stable strings within a pool;
// the caches are bounded by the number of distinct cards ever seen.
const identityCache = new Map();
const personCache = new Map();

export function playerIdentity(id) {
  const key = id ?? "";
  if (identityCache.has(key)) return identityCache.get(key);
  const match = /^mlb-([^-]+)-([^-]+?)(-bat)?$/.exec(key);
  const identity = match ? { person: match[2], slice: match[1] } : null;
  identityCache.set(key, identity);
  return identity;
}

// The human behind a card, however his league names him. MLB pools spell the
// person out in the id; the Showdown sets don't, but they print the season on
// the face ("Mike Piazza '93"), so the name with the season filed off is the
// man. A deal uses this to put each person on the board once — and a board
// that holds one Ken Griffey needs no roster rule about the other three.
export function cardPerson(card) {
  const key = card?.id ?? "";
  if (key && personCache.has(key)) return personCache.get(key);
  const identity = playerIdentity(card?.id);
  const person = identity
    ? identity.person
    : (() => {
        const name = String(card?.name ?? "").replace(/\s+'\d{2,4}$/, "").trim();
        return name ? `name:${name.toLowerCase()}` : null;
      })();
  if (key) personCache.set(key, person);
  return person;
}

// The rostered player that makes `player` illegal to add: the same human
// from a different era. Pass excludeId when evaluating a swap, so the
// outgoing card doesn't block its own replacement.
//
// This is a COLLECTION rule — adventure packs, NPC teams, roster swaps. Draft
// rooms don't need it: their board deals each person once (see cardPerson),
// so a drafting manager cannot reach a second era of a man he already owns.
//
// The man is named by cardPerson, not by the id alone. Only the MLB pools spell
// him out in the id; a Showdown-set card says who he is on its FACE ("Sammy
// Sosa '00"), and asking the id was answering "nobody" for every card in the
// classic league — which switched this whole rule off there and let a club field
// two Brant Browns and a pair of Pedro Martinezes.
//
// The same-era pass is the two-way exemption and nothing else: a man's bat and
// his arm are one card in two halves, same person, same slice, and the one legal
// pairing. It only applies where both cards carry an era in the id, because that
// is the only pool that cuts a player in half. Elsewhere a man is himself, once.
// The same rule asked many times over one roster — which is exactly how the
// NPC's climb asks it: thousands of candidates against the same twenty men.
// Building the roster's side of the question ONCE turns each candidate check
// from a roster scan into a map lookup. personIndex + conflictsWithIndex are
// exactly personConflict, split in two; see the equivalence test in
// test/rules.test.js.
export function personIndex(roster, excludeId = null) {
  const index = new Map();
  for (const card of roster) {
    if (card.id === excludeId) continue;
    const person = cardPerson(card);
    if (!person) continue;
    let entry = index.get(person);
    if (!entry) index.set(person, (entry = { ids: new Set(), slices: new Set(), bare: false }));
    entry.ids.add(card.id);
    const identity = playerIdentity(card.id);
    if (identity) entry.slices.add(identity.slice);
    else entry.bare = true;
  }
  return index;
}

export function conflictsWithIndex(index, player) {
  const person = cardPerson(player);
  if (!person) return false;
  const entry = index.get(person);
  if (!entry) return false;
  const identity = playerIdentity(player?.id);
  // A card whose id carries no era (the Showdown sets) is the man himself,
  // once: any other rostered card of his conflicts.
  if (!identity) {
    for (const id of entry.ids) if (id !== player?.id) return true;
    return false;
  }
  // He carries an era. A rostered card of his with no era at all conflicts;
  // so does one from a DIFFERENT era. Same era is the two-way pairing.
  if (entry.bare) return true;
  for (const slice of entry.slices) if (slice !== identity.slice) return true;
  return false;
}

export function personConflict(roster, player, excludeId = null) {
  const person = cardPerson(player);
  if (!person) return null;
  const identity = playerIdentity(player?.id);
  const playerId = player?.id;
  for (const rostered of roster) {
    if (rostered.id === playerId || rostered.id === excludeId) continue;
    if (cardPerson(rostered) !== person) continue;
    const other = playerIdentity(rostered.id);
    if (identity && other ? other.slice !== identity.slice : true) return rostered;
  }
  return null;
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
  // Open-ended top ranges are held as `to: Infinity`, but JSON.stringify turns
  // that into null when a save round-trips through localStorage. Treat any
  // non-finite upper bound as open-ended so a rehydrated chart still resolves.
  const match = chart.find((entry) => roll >= entry.from && roll <= (Number.isFinite(entry.to) ? entry.to : Infinity));
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
