import { assignLineupSlots, staffStatus } from "../rules/draft.js?v=20260716-records";

// The two roster formats an adventure save can play. A format is chosen at
// new-game time and never changes: it decides how many cards a roster holds,
// what the budget cap buys, and whether the dugout has a bench to manage.
//
//   classic — the original thirteen: nine bats who play every inning, two
//             starters who alternate, two relievers. No bench, no subs.
//   full    — the real product's twenty: nine starting bats, a four-man
//             rotation drawn at random each game, and seven FLEX slots that
//             split any way between relievers and bench hitters. Bench bats
//             count a fifth of their sticker toward the cap, and from the
//             seventh inning on they can enter the game.
//
// priceSlots is the format's roster shape as the economy sees it: one
// [group, weight] entry per slot, in the order a greedy fill should draw
// them (full-price slots first, so the discounted bench prices what's left).
// packs.js sums pool means and ceilings over this list, which is what the
// budget cap and the whole NPC ladder hang from.

// A bench bat costs a fifth of its printed points. The discount is what makes
// a real bench affordable under the cap — a man who pinch-hits once a game is
// not a man who plays nine innings — and the seventh-inning substitution gate
// (game.js SUB_MIN_INNING) is what keeps the discount from buying a shadow
// starting nine.
export const BENCH_WEIGHT = 0.2;

const CLASSIC_PRICE_SLOTS = [
  ["C", 1], ["1B", 1], ["2B", 1], ["3B", 1], ["SS", 1],
  ["LF/RF", 1], ["LF/RF", 1], ["CF", 1], ["HITTER", 1],
  ["SP", 1], ["SP", 1], ["RP", 1], ["RP", 1]
];

const FULL_PRICE_SLOTS = [
  ["C", 1], ["1B", 1], ["2B", 1], ["3B", 1], ["SS", 1],
  ["LF/RF", 1], ["LF/RF", 1], ["CF", 1], ["HITTER", 1],
  ["SP", 1], ["SP", 1], ["SP", 1], ["SP", 1],
  ["RP", 1], ["RP", 1], ["RP", 1],
  ["HITTER", BENCH_WEIGHT], ["HITTER", BENCH_WEIGHT], ["HITTER", BENCH_WEIGHT], ["HITTER", BENCH_WEIGHT]
];

export function benchPrice(points) {
  return Math.round((Number(points) || 0) * BENCH_WEIGHT);
}

// The full-format cap calibration: the cap buys this multiple of the pool's
// mean legal 20-man roster (bench discounted). Chosen so the CLASSIC SHOWDOWN
// universe — real cards, authentic printed points — lands on the real game's
// 5000-point cap: 5000 / 4246, the measured mean full-roster cost of that
// pool at true prices. Every other universe scales off its own mean, so the
// figure stays proportional pool to pool. Re-derive by printing
// poolMean("full") for the classic universe (see test coverage) — the mean
// moves whenever the classic card set does, as it did when the by-number
// re-crawl recovered 247 cards the offset crawl had dropped (4223 -> 4246).
export const FULL_CAP_CALIBRATION = 5000 / 4246;

export const ROSTER_FORMATS = {
  classic: {
    key: "classic",
    name: "CLASSIC",
    size: 13,
    startingPitchers: 2,
    flexSlots: 0,
    rareCount: 2,
    priceSlots: CLASSIC_PRICE_SLOTS,
    capCalibration: 1
  },
  full: {
    key: "full",
    name: "FULL ROSTER",
    size: 20,
    startingPitchers: 4,
    flexSlots: 7,
    rareCount: 3,
    priceSlots: FULL_PRICE_SLOTS,
    capCalibration: FULL_CAP_CALIBRATION
  }
};

// Saves from before formats existed read as classic — the shape they are.
export function rosterFormat(save) {
  return ROSTER_FORMATS[save?.rosterFormat] ?? ROSTER_FORMATS.classic;
}

// What a roster costs against the cap: every pitcher and every SEATED hitter
// at full sticker, every unseated hitter at the bench discount. Membership is
// the seating itself — the nine the lineup fields pay full price, whoever is
// left is the bench — so the price always describes the team actually fielded.
// One function for the save's cap check, the starter pack's budget repair,
// and the NPC's shopping, so the three can never disagree.
export function discountedRosterCost(cards, lineupAssignments = {}, formatKey = "classic") {
  const total = cards.reduce((sum, card) => sum + (Number(card.points) || 0), 0);
  if (formatKey !== "full") return total;
  const seated = new Set(
    assignLineupSlots(cards, lineupAssignments).slots
      .map((slot) => slot.player?.id)
      .filter(Boolean)
  );
  return cards.reduce((sum, card) => {
    if (card.kind === "hitter" && !seated.has(card.id)) return sum + benchPrice(card.points);
    return sum + (Number(card.points) || 0);
  }, 0);
}

// The manager fields buildTeam/validateRoster read to shape a full-format
// team: the whole rotation, the whole pen (however the flex split fell), and
// the bench riding along to the game engine.
export function formatManagerFields(formatKey, roster) {
  const format = ROSTER_FORMATS[formatKey] ?? ROSTER_FORMATS.classic;
  if (format.key !== "full") return {};
  return {
    rosterFormat: format.key,
    rosterSize: format.size,
    startingPitchers: format.startingPitchers,
    bullpenSlots: staffStatus(roster).bullpen.length,
    includeBench: true
  };
}

// The rotation draw lives in the shared rules layer (the sim-series runner
// draws the same way); re-exported here for the adventure screens.
export { maxSeriesStarts, pickRandomStarter } from "../rules/draft.js?v=20260716-records";
