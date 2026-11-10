import { chartRunValue, lineupProfile, runsPerPa } from "./pitching.js?v=20260716-records";
import { benchSlotFielding } from "./substitutions.js?v=20260716-records";
import {
  CORNER_OUTFIELD_POSITION,
  MAX_BULLPEN_SLOTS,
  UNLIMITED_BULLPEN,
  isAuctionDraft,
  minCostAssignment,
  normalizeBullpenSlots,
  normalizeStartingPitchers,
  positionMatchesSlot,
  standingReplacement,
  standingReplacements
} from "./draft.js?v=20260716-records";
import { isCoach } from "./coaches.js?v=20260910-coaches";

// WHAT A CARD IS MEASURED AGAINST, when the thing he cost was a PICK.
//
// The standing replacements (draft.js) are the floor of the board: the cheapest
// real card at each slot, handed out free. In an AUCTION that is exactly the
// right zero, because it is an option a manager can actually exercise — the free
// card is unbiddable and printed into any roster that needs one, so the
// alternative to an $80 bat really is "take the free card and keep the $80."
// The money saved is the other half of the comparison, and it is real money.
//
// A SNAKE draft has no such option. You cannot decline a pick to bank the
// resource, every manager gets the same number of them, and nobody rosters a
// free card unless the board runs dry. So the floor of the board is the one
// alternative a snake drafter never faces, and measured against it every roster
// in the room banks a large, nearly identical credit just for turning up — the
// part of the number that carries information is the small residual on top.
//
// What a pick's alternative really is: the next man at the position. If you pass
// on a second baseman you fall down the second-base list, and in equilibrium
// somebody in the room starts the last one. That is the original VORP idea — the
// worst REGULAR at the position, not the worst card in existence.
//
// Reading it off the board rather than off the finished draft is what makes it
// usable. "The worst second baseman anybody actually started" is the minimum of
// a handful of draws: one manager reaching, or one autopick blunder, drags the
// baseline for every second baseman in the room, so a player's number moves for
// reasons that have nothing to do with him. The Nth-best card on the BOARD is
// the same quantity with the draft's idiosyncrasy averaged out — a deterministic
// function of the deck and the room's rules, settled before the first pick. It
// is what the worst starter WOULD be if the room drafted efficiently, and it
// does not care who was seated where, which a stat printed next to the standings
// has to not care about.
//
// Scarcity comes along for free and in the right amount. Where a position cliffs
// after five cards the Nth is dreadful and the men above him earn a lot; where
// it is deep the Nth is nearly average and they earn little. No coefficient to
// fit.

// Nine bats, and where they stand. The corners lump, as everywhere, so one slot
// key seats two men.
const HITTER_SLOTS = ["C", "1B", "2B", "3B", "SS", "CF", "DH"];
// Seven slots seat one man each and the corner slot seats two: nine bats.
const LINEUP_SEATS = 9;
const PITCHER_SLOTS = ["SP", "RP"];

const DIE = 20;

// PUTTING A BAT AND A GLOVE ON ONE SCALE.
//
// A card has three parts worth something and they are printed in three different
// units, so ranking him at a slot needs an exchange rate between them. These are
// MEASURED off the engine, not assumed: 24 CPU-drafted snake rooms (fictional,
// 6 teams, 15-man rosters, 300 seasons each), regressing each man's own measured
// WPAR on the part of his card it comes from.
//
//   bat     83.8 wins a season per run per plate appearance   (n=216, r=0.880)
//   glove   1.50e-4 wins per fielding point x chance fielded  (n=127, r=0.336)
//   speed   4.53e-4 wins per speed point x chance run         (n=209, r=0.918)
//
// The first guess here was substitutions.js's 0.06 runs per inning per fielding
// point — a pinch-hitting constant, where it is traded against ONE plate
// appearance and is the right size for that. Spread over a season it reads 87
// runs a glove point, eighteen times the measured rate, and it wrecked this
// file: the glove term buried the bat, every fielding seat in the room filled
// with cheap elite-glove cards, and the DH floor — the one slot that rates no
// glove — came out a 411-point slugger. A rate borrowed from a decision about
// one plate appearance does not survive being asked about a season.
const BAT_WINS_PER_RUN_PA = 83.8;
const GLOVE_WINS_PER_POINT_CHANCE = 1.5e-4;
const SPEED_WINS_PER_POINT_CHANCE = 4.53e-4;

// Why a fielding point is worth eight times as much behind the plate: the
// catcher is in every steal, tag-up and extra-base check the defense faces, and
// a corner infielder is in a fraction of them. Chances a season, measured at the
// slot each man actually played (same rooms as above). This is what keeps a
// good-glove catcher from being seated at first base by a solver that cannot see
// the difference.
const FIELD_CHANCES = {
  C: 2567,
  "1B": 323,
  "2B": 323,
  "3B": 323,
  SS: 323,
  CF: 814,
  "LF/RF": 814,
  DH: 0
};
// Baserunning chances barely move by slot (367-492 measured), so one number.
const RUN_CHANCES = 430;

// Deterministic throughout: the same board must name the same card every time,
// or a replay stops being a replay.
const byId = (a, b) => String(a.id).localeCompare(String(b.id));

function boardCards(draft, kind) {
  return (draft?.pool ?? []).filter((card) => card.kind === kind && !card.replacement && !isCoach(card));
}

const isStarter = (card) => card.role === "SP";

// How many of each slot the ROOM fields — the N in "the Nth-best card at the
// position." Read off the rules, never a constant: the corners seat two, the
// rotation is a house rule from one to five, and the pen is a count or the lot.
export function replacementSeats(draft) {
  const teams = Math.max(1, draft?.managers?.length ?? 1);
  const pen = normalizeBullpenSlots(draft?.bullpenSlots);
  const relievers = pen === UNLIMITED_BULLPEN ? MAX_BULLPEN_SLOTS : pen;
  return {
    C: teams,
    "1B": teams,
    "2B": teams,
    "3B": teams,
    SS: teams,
    CF: teams,
    DH: teams,
    [CORNER_OUTFIELD_POSITION]: teams * 2,
    SP: teams * normalizeStartingPitchers(draft?.startingPitchers),
    // A pen of none still gets a card: relievers who never pitch are measured
    // against somebody, and the number simply never comes up.
    RP: teams * Math.max(1, relievers)
  };
}

// Can this card stand at this slot at all? The DH seat is bat-shaped and draws
// on everyone; the corner slot reads the lumped group.
function slotEligible(card, slot) {
  if (slot === "DH") return true;
  if (slot === CORNER_OUTFIELD_POSITION) return positionMatchesSlot(card, "LF");
  return positionMatchesSlot(card, slot);
}

// The batter's-side reading of the control roll, against the STAFF a room this
// size runs out rather than one card. On-base is the share of plate appearances
// settled on his own chart — d20 + control has to clear it — so it multiplies
// his chart and fills the rest in with the arm's. Same contest runsPerPa prices
// from the mound, same linear weights, read from the other dugout. Higher is
// better here.
//
// The ladder matters: clamping at nought and twenty makes this bend, so an
// average control is not the same as the average over real controls, and the
// bend is biggest exactly at the ends of the on-base range.
export function hitterRunsPerPa(card, staff) {
  const own = chartRunValue(card?.chart);
  if (!staff?.controls?.length) return own;
  const onBase = Number(card?.onBase) || 0;
  let total = 0;
  for (const control of staff.controls) {
    const usage = Math.max(0, Math.min(DIE, onBase - control)) / DIE;
    total += usage * own + (1 - usage) * staff.runValue;
  }
  return total / staff.controls.length;
}

// What a card is worth at a slot, in wins a season: his bat, plus the glove he
// brings to the spot he would be standing in, plus his legs. The DH slot rates
// no glove, which is the whole reason a bat-only card is not a shortstop.
export function hitterSlotValue(card, slot, staff) {
  const bat = hitterRunsPerPa(card, staff) * BAT_WINS_PER_RUN_PA;
  const legs = (Number(card?.speed) || 0) * SPEED_WINS_PER_POINT_CHANCE * RUN_CHANCES;
  if (slot === "DH") return bat + legs;
  const glove = benchSlotFielding(card, slot);
  if (glove.outOfPosition) return bat + legs - 1e6;
  return bat + legs + glove.value * GLOVE_WINS_PER_POINT_CHANCE * (FIELD_CHANCES[slot] ?? 0);
}

// The arms a room this size actually fields, as a control ladder and an average
// chart. Starters only: a bat's season is spent against rotations.
function staffProfile(draft, batters) {
  const fielded = Math.max(1, (draft?.managers?.length ?? 1) * normalizeStartingPitchers(draft?.startingPitchers));
  const starters = boardCards(draft, "pitcher").filter(isStarter)
    .sort((a, b) => runsPerPa(a, 0, batters) - runsPerPa(b, 0, batters) || byId(a, b))
    .slice(0, fielded);
  const arms = starters.length ? starters : boardCards(draft, "pitcher");
  if (!arms.length) return { controls: [], runValue: 0 };
  return {
    controls: arms.map((card) => Number(card.control) || 0),
    runValue: arms.reduce((sum, card) => sum + chartRunValue(card.chart), 0) / arms.length
  };
}

// Ranking bats needs the staff and ranking the staff needs the bats, so this
// bootstraps once off the whole board's average and then re-reads both against
// the players a room this size will really field. One iteration is enough: the
// second pass moves the ladder by a fraction of a control point, and only the
// ORDER is ever taken from it.
function roomProfiles(draft) {
  const bats = boardCards(draft, "hitter");
  const seats = Math.max(1, (draft?.managers?.length ?? 1) * LINEUP_SEATS);
  let batters = lineupProfile(bats);
  let staff = staffProfile(draft, batters);
  const fielded = [...bats]
    .sort((a, b) => hitterRunsPerPa(b, staff) - hitterRunsPerPa(a, staff) || byId(a, b))
    .slice(0, seats);
  if (fielded.length) {
    batters = lineupProfile(fielded);
    staff = staffProfile(draft, batters);
  }
  return { batters, staff };
}

// WHY AN ASSIGNMENT AND NOT A SORT PER SLOT.
//
// A card who plays second and short sits in both lists, so counting him twice
// pads the supply at a position he will not be standing at, and the floor comes
// out better than it really is — the under-credit lands on exactly the thin
// positions the floor is supposed to expose. Counting him once at his printed
// spot makes the opposite error: genuine multi-position depth goes missing and a
// thin slot looks thinner than the room will field.
//
// So seat the whole room: nine-times-teams seats, every bat on the board, each
// man in one seat, by total runs. The marginal man at each slot — the lowest
// value anybody assigned there brings to it — is that slot's floor. Supply is
// then counted exactly once, where the room would really use it.
function seatTheRoom(draft, staff) {
  const seatCounts = replacementSeats(draft);
  const seats = [...HITTER_SLOTS, CORNER_OUTFIELD_POSITION]
    .flatMap((slot) => new Array(seatCounts[slot]).fill(slot));
  const bats = boardCards(draft, "hitter").sort(byId);
  if (!seats.length || !bats.length) return new Map();
  const BIG = 1e9;
  const cols = Math.max(seats.length, bats.length);
  const cost = seats.map((slot) => Array.from({ length: cols }, (unused, col) => {
    const card = bats[col];
    if (!card || !slotEligible(card, slot)) return BIG;
    return -hitterSlotValue(card, slot, staff);
  }));
  const rowToCol = minCostAssignment(cost);
  const floors = new Map();
  rowToCol.forEach((col, row) => {
    const slot = seats[row];
    const card = bats[col];
    // A seat the board could not fill legally: the solver still had to put
    // something in it. Not a floor.
    if (!card || !slotEligible(card, slot)) return;
    const value = hitterSlotValue(card, slot, staff);
    const standing = floors.get(slot);
    if (!standing || value < standing.value || (value === standing.value && byId(card, standing.card) < 0)) {
      floors.set(slot, { card, value });
    }
  });
  return floors;
}

// The Nth-best arm in his own half of the staff, by what the engine says he
// gives up against the bats this room fields. Rate, not season: the pitching
// baseline is replayed one plate appearance at a time, so innings are the job
// he was given rather than part of what he is.
function armFloor(draft, batters, role, seats) {
  const arms = boardCards(draft, "pitcher").filter((card) => isStarter(card) === (role === "SP"));
  if (!arms.length) return null;
  const ranked = arms.sort((a, b) => runsPerPa(a, 0, batters) - runsPerPa(b, 0, batters) || byId(a, b));
  return ranked[Math.min(ranked.length, Math.max(1, seats)) - 1];
}

// The floor at every slot, shaped exactly like standingReplacements so the two
// are interchangeable wherever a sim is handed its baseline: real cards carrying
// a `slot`, one per slot, never added to the pool.
//
// Where the board holds fewer cards at a slot than the room has seats there is
// no Nth, and the floor gives before the slot does: fall back to the standing
// replacement, which is the board's own worst card there.
export function rankedReplacements(draft) {
  if (!draft?.pool?.length || !draft?.managers?.length) return [];
  const { batters, staff } = roomProfiles(draft);
  const seats = replacementSeats(draft);
  const floors = seatTheRoom(draft, staff);
  const cards = [];
  for (const slot of [...HITTER_SLOTS, CORNER_OUTFIELD_POSITION]) {
    const picked = floors.get(slot)?.card ?? standingReplacement(draft, slot);
    if (picked) cards.push({ ...picked, slot, replacementSeats: seats[slot] });
  }
  for (const slot of PITCHER_SLOTS) {
    const picked = armFloor(draft, batters, slot, seats[slot]) ?? standingReplacement(draft, slot);
    if (picked) cards.push({ ...picked, slot, replacementSeats: seats[slot] });
  }
  return cards;
}

// Which baseline a room is measured against. The two formats price different
// resources — dollars in an auction, where the free card is a real option;
// roster slots in a snake, where it is not — so the zero point follows the
// format rather than being one number for the whole site.
export function replacementBaseline(draft, mode = "format") {
  if (mode === "board") return standingReplacements(draft);
  if (mode === "ranked") return rankedReplacements(draft);
  return isAuctionDraft(draft) ? standingReplacements(draft) : rankedReplacements(draft);
}
