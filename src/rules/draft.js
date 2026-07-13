import { createRng } from "./rng.js?v=20260713-u";
import { CPU_PERSONALITIES, CPU_PERSONALITY_KEYS, createValuationModel, cpuPersonality } from "./valuation.js?v=20260713-u";
import { playerIdentity, hitterPositions, playsPosition, fieldingAt } from "./cards.js?v=20260713-u";

const FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const LINEUP_SLOT_LABELS = [...FIELD_POSITIONS, "DH"];
const EXACT_REQUIRED_POSITIONS = ["C", "2B", "3B", "SS", "CF"];
const CORNER_OUTFIELD_SLOTS = ["LF", "RF"];
export const CORNER_OUTFIELD_POSITION = "LF/RF";

// Corner outfielders are one group: an LF/RF card plays either corner at the
// same fielding score. Bare "LF"/"RF" card positions are accepted for
// hand-built pools that still label the corners separately.
export function isCornerOutfielder(position) {
  return position === CORNER_OUTFIELD_POSITION || CORNER_OUTFIELD_SLOTS.includes(position);
}

function cardIsCornerOutfielder(player) {
  return hitterPositions(player).some((entry) => isCornerOutfielder(entry.pos));
}

// Rewrites bare "LF"/"RF" card labels to the lumped LF/RF position so every
// pool source drafts and displays corners as one position.
export function normalizeCardPosition(player) {
  if (player?.kind !== "hitter") return player;
  const lump = (pos) => (isCornerOutfielder(pos) ? CORNER_OUTFIELD_POSITION : pos);
  const changed = lump(player.position) !== player.position
    || (Array.isArray(player.positions) && player.positions.some((entry) => lump(entry.pos) !== entry.pos));
  if (!changed) return player;
  const next = { ...player, position: lump(player.position) };
  if (Array.isArray(player.positions)) {
    next.positions = player.positions.map((entry) => ({ ...entry, pos: lump(entry.pos) }));
  }
  return next;
}

function positionMatchesSlot(player, label) {
  if (CORNER_OUTFIELD_SLOTS.includes(label)) return cardIsCornerOutfielder(player);
  return playsPosition(player, label);
}
const HITTER_TARGET = 9;
const STARTER_TARGET = 2;
const BULLPEN_TARGET = 2;
const PITCHER_TARGET = STARTER_TARGET + BULLPEN_TARGET;
const DEFAULT_ROSTER_SIZE = HITTER_TARGET + PITCHER_TARGET;

// The designated hitter is a slot, not a position: ANY bat fills it, and
// whole card sets print nobody at "DH" at all — the dead-ball decades never
// had the rule. So the DH slot draws on the hitters at large rather than on a
// DH shelf that may not exist.
export const ANY_HITTER = "HITTER";

// The active roster, slot by slot. The table sums to the 13-man roster on
// purpose: it IS the roster, spelled out. Every slot needs a supply of cards
// that can fill it, which is what sizes a board.
export const ROSTER_SLOTS = [
  ["C", 1],
  ["1B", 1],
  ["2B", 1],
  ["3B", 1],
  ["SS", 1],
  [CORNER_OUTFIELD_POSITION, 2],
  ["CF", 1],
  // Last of the hitters on purpose: the position groups take their cards
  // first, and the DH slot draws from whoever is left.
  [ANY_HITTER, 1],
  ["SP", STARTER_TARGET],
  ["RP", BULLPEN_TARGET]
];

// The pool group a card is dealt and counted under: its PRIMARY position (a
// 2B/SS card is a second baseman here, whatever else it can cover), or SP/RP
// for an arm.
export function poolGroup(player) {
  return player?.kind === "pitcher" ? pitcherRole(player) : player?.position;
}

// Can this card fill that slot's supply? Positions want the cards printed
// there; the DH slot takes any bat in the set.
export function poolGroupMatches(player, group) {
  if (group === ANY_HITTER) return player?.kind === "hitter";
  return poolGroup(player) === group;
}

// Random-nomination pool sizes, per roster slot, for a room of n managers.
//
// HIDDEN is the queue that actually comes up for bid: floor(1.4n) managers'
// worth, so there is always a little more of every position than the room
// strictly needs, and never enough to go around comfortably.
//
// VISIBLE is the board everyone reads. It has to survive the worst case: one
// manager hoards every card that comes up at a position, and the leftovers
// must STILL cover the other n-1 managers in the end-of-draft sweep. That is
// visible >= hidden + (n - 1) per slot. At three and four managers that lands
// exactly on 2n (three managers see 12 starters, eight of them come up); past
// that the hoarding case bites first and the board widens to keep the promise.
export function randomNominationCounts(managerCount) {
  const managers = Math.max(1, Math.floor(Number(managerCount) || 0));
  const hidden = Math.max(1, Math.floor(managers * 1.4));
  const visible = Math.max(2 * managers, hidden + managers - 1);
  return { managers, hiddenPerSlot: hidden, visiblePerSlot: visible };
}

// Per-position card counts for a random-nomination room: the slot quota times
// the manager multiplier. Returns [[group, count], ...] in ROSTER_SLOTS order.
export function randomNominationQuotas(managerCount) {
  const { hiddenPerSlot, visiblePerSlot } = randomNominationCounts(managerCount);
  return {
    visible: ROSTER_SLOTS.map(([group, slots]) => [group, visiblePerSlot * slots]),
    hidden: ROSTER_SLOTS.map(([group, slots]) => [group, hiddenPerSlot * slots])
  };
}

// Positions a card set is too thin to fill a random-nomination board at. A
// deep universe returns nothing; a one-franchise set may simply not own enough
// catchers to seat the room, and the setup screen has to say so rather than
// deal a board the closing sweep can't finish.
// A board is too thin when some slot cannot be supplied. The hitter groups are
// checked against what is LEFT after the position groups take theirs, because
// one card cannot be two managers' cards: nine hitters per roster means nine
// hitters' worth of board, however they are labelled.
export function randomNominationShortfalls(pool, managerCount) {
  const shortfalls = [];
  const taken = new Set();
  for (const [group, quota] of randomNominationQuotas(managerCount).visible) {
    const available = pool.filter((player) => !taken.has(player.id) && poolGroupMatches(player, group));
    for (const player of available.slice(0, quota)) taken.add(player.id);
    if (available.length < quota) shortfalls.push({ group, quota, dealt: available.length });
  }
  return shortfalls;
}

// How many managers a pool can seat: every team needs a catcher, a middle
// infield, a center fielder, two corners, two starters and two relievers —
// whichever of those runs out first caps the room. Counts read a card's
// PRIMARY position, so the answer is a floor: a pool that seats eight this
// way seats eight however the secondary listings fall.
export function maxPoolManagers(pool) {
  const hitters = pool.filter((player) => player.kind === "hitter");
  const pitchers = pool.filter((player) => player.kind === "pitcher");
  const countPosition = (position) => hitters.filter((player) => player.position === position).length;
  return Math.min(
    ...EXACT_REQUIRED_POSITIONS.map(countPosition),
    Math.floor(countPosition(CORNER_OUTFIELD_POSITION) / 2),
    Math.floor(hitters.length / HITTER_TARGET),
    Math.floor(pitchers.filter((player) => player.role === "SP").length / STARTER_TARGET),
    Math.floor(pitchers.filter((player) => player.role !== "SP").length / BULLPEN_TARGET),
    Math.floor(pool.length / DEFAULT_ROSTER_SIZE)
  );
}

export const AUCTION_MIN_BID = 5;
export const AUCTION_MIN_RAISE = 5;
export const AUCTION_DEFAULT_BUDGET = 5000;
export const AUCTION_DEFAULT_REVIEW_SECONDS = 10 * 60;
export const AUCTION_DEFAULT_CLOCK_BANK_SECONDS = 5 * 60;
export const AUCTION_DEFAULT_CLOCK_INCREMENT_SECONDS = 5;

const MS_PER_SECOND = 1000;

// An auction is timed unless it says otherwise — that is the house rule, and
// `timer: false` is how a draft opts out. Callers rebuilding a draft that was
// recorded WITHOUT a clock must pass that false explicitly: a draft timed by
// accident opens with a review period nobody started, and then cannot replay
// its own action log (the nomination that was legal when it happened throws
// "Review period is still open"). See reviveRoom and rebuildOnlineDraft, which
// both default a missing timer to off for exactly that reason.
export function normalizeAuctionTimerConfig(timer = {}) {
  if (timer === false || timer?.enabled === false) {
    return { enabled: false, reviewMs: 0, bankMs: 0, incrementMs: 0 };
  }
  return {
    enabled: true,
    reviewMs: normalizeTimerMs(timer.reviewMs, timer.reviewSeconds, AUCTION_DEFAULT_REVIEW_SECONDS),
    bankMs: normalizeTimerMs(timer.bankMs, timer.bankSeconds, AUCTION_DEFAULT_CLOCK_BANK_SECONDS),
    incrementMs: normalizeTimerMs(timer.incrementMs, timer.incrementSeconds, AUCTION_DEFAULT_CLOCK_INCREMENT_SECONDS)
  };
}

function normalizeTimerMs(ms, seconds, fallbackSeconds) {
  const value = Number.isFinite(Number(ms))
    ? Number(ms)
    : Number(seconds ?? fallbackSeconds) * MS_PER_SECOND;
  return Math.max(0, Math.round(value));
}

// 0 disables the pick clock; anything else is clamped to a sane range so a
// typo can't create a 1-second or 3-hour draft.
export function normalizePickTimerSeconds(value) {
  const seconds = Math.round(Number(value) || 0);
  if (seconds <= 0) return 0;
  return Math.min(600, Math.max(15, seconds));
}

export function normalizeAuctionBudget(budget, rosterSize = DEFAULT_ROSTER_SIZE) {
  const value = Math.round((Number(budget) || AUCTION_DEFAULT_BUDGET) / AUCTION_MIN_RAISE) * AUCTION_MIN_RAISE;
  return Math.max(rosterSize * AUCTION_MIN_BID, value);
}

// Managers arrive as plain names or as { name, cpu } descriptors; cpu
// managers play themselves (instant autopicks and sealed bids).
export function createDraft(managers, pool, rosterSize = DEFAULT_ROSTER_SIZE, seed = "showdown", options = {}) {
  // A computer manager gets an opinion, dealt from the seed so the same room
  // always faces the same table. A human's seat carries none: he has his own.
  const personaRng = createRng(`${seed}:personas`);
  const cleanManagers = managers.map((entry, index) => {
    const name = typeof entry === "string" ? entry : String(entry?.name ?? "");
    const cpu = typeof entry === "object" && entry !== null && Boolean(entry.cpu);
    const chosen = typeof entry === "object" && entry !== null && entry.persona;
    return {
      id: `team-${index + 1}`,
      name: name.trim() || `Manager ${index + 1}`,
      cpu,
      persona: cpu
        ? (CPU_PERSONALITIES[chosen] ? chosen : CPU_PERSONALITY_KEYS[Math.floor(personaRng.next() * CPU_PERSONALITY_KEYS.length)])
        : null,
      roster: []
    };
  });

  const draft = {
    managers: cleanManagers,
    pool: pool.map((player) => normalizeCardPosition({ ...player })),
    pickedIds: new Set(),
    rosterSize,
    seed,
    pickNumber: 0,
    complete: false,
    draftType: options.draftType === "auction" ? "auction" : "snake"
  };

  if (draft.draftType === "auction") {
    const budget = normalizeAuctionBudget(options.budget, rosterSize);
    const timer = normalizeAuctionTimerConfig(options.timer ?? options.auctionTimer);
    // Random nomination is an auction with nobody at the wheel: a hidden queue
    // deals the cards out, and since no manager has to reserve slots for the
    // rest of their roster, the 13 active slots stop being a cap at all.
    draft.nomination = options.nomination === "random" ? "random" : "manual";
    draft.unlimitedRoster = draft.nomination === "random";
    draft.auction = {
      budget,
      budgets: Object.fromEntries(cleanManagers.map((manager) => [manager.id, budget])),
      timer,
      clockBanks: Object.fromEntries(cleanManagers.map((manager) => [manager.id, timer.bankMs])),
      review: {
        startedAt: null,
        endsAt: null,
        completedAt: timer.enabled && timer.reviewMs === 0 ? 0 : null
      },
      nominatorIndex: 0,
      lot: null,
      pausedAt: null,
      history: []
    };
    if (draft.nomination === "random") {
      draft.auction.queue = buildNominationQueue(draft);
      draft.auction.queueIndex = 0;
    }
  }

  return draft;
}

export function isRandomNomination(draft) {
  return isAuctionDraft(draft) && draft.nomination === "random";
}

export function hasUnlimitedRoster(draft) {
  return Boolean(draft?.unlimitedRoster);
}

// Fisher-Yates on a copy, driven by the seeded rng, so every replica of the
// room deals the same queue in the same order.
function shuffleSeeded(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// The slot a card was DEALT to fill. A dealt board says so on the card; a pool
// assembled some other way (a hand-built test pool, a snake deck) doesn't, and
// falls back to reading the card's own position.
function dealtInSlot(player, group) {
  return player?.slot ? player.slot === group : poolGroupMatches(player, group);
}

// The hidden pool: a seeded subset of the visible board — floor(1.4n) managers'
// worth at every roster slot — shuffled into the order it will be nominated in.
// Everything left on the board is a card the room can see and never bid on,
// until the sweep goes looking for it.
//
// The queue draws each slot from the cards the DEAL put in that slot, and that
// is load-bearing, not bookkeeping. The board's whole promise is that every
// group keeps n-1 cards back for the closing sweep, and the margin it keeps is
// exactly n-1 — no slack. So a queue that picked its DH bats off the board at
// large would take one of them out of, say, center field, put a sixth center
// fielder up for bid, and leave two CF cards in a reserve that owed three. One
// manager who hoards center fielders and the sweep has nothing to hand the
// third man short of one. Read the tag; leave the reserve alone.
function buildNominationQueue(draft) {
  const rng = createRng(`${draft.seed}:nomination-queue`);
  const { hidden } = randomNominationQuotas(draft.managers.length);
  const queue = [];
  const queued = new Set();
  for (const [group, count] of hidden) {
    const cards = draft.pool.filter((player) => !queued.has(player.id) && dealtInSlot(player, group));
    for (const player of shuffleSeeded(cards, rng).slice(0, count)) {
      queued.add(player.id);
      queue.push(player);
    }
  }
  return shuffleSeeded(queue, rng).map((player) => player.id);
}

// The card the queue puts on the block next, or null once it runs dry.
export function nextQueuedPlayer(draft) {
  if (!isRandomNomination(draft)) return null;
  const playerId = draft.auction.queue[draft.auction.queueIndex];
  if (!playerId) return null;
  return draft.pool.find((player) => player.id === playerId) ?? null;
}

export function nominationQueueRemaining(draft) {
  if (!isRandomNomination(draft)) return 0;
  return Math.max(0, draft.auction.queue.length - draft.auction.queueIndex);
}

// Enough loop steps for a caller to run every remaining lot to a decision: one
// nomination plus a sealed bid per manager, plus a rebid round, plus slack. A
// random-nomination room runs as long as its queue, not as long as its rosters.
export function auctionStepGuard(draft) {
  if (!isAuctionDraft(draft)) return draft.managers.length * draft.rosterSize + 20;
  const lots = isRandomNomination(draft)
    ? nominationQueueRemaining(draft)
    : draft.managers.length * draft.rosterSize;
  return lots * (draft.managers.length * 2 + 4) + 20;
}

export function isAuctionDraft(draft) {
  return draft?.draftType === "auction";
}

export function currentManager(draft) {
  if (isAuctionDraft(draft)) {
    return draft.managers[draft.auction.nominatorIndex];
  }
  return managerForPickNumber(draft, draft.pickNumber);
}

function managerForPickNumber(draft, pickNumber) {
  const teamCount = draft.managers.length;
  const round = Math.floor(pickNumber / teamCount);
  const indexInRound = pickNumber % teamCount;
  const managerIndex = round % 2 === 0 ? indexInRound : teamCount - 1 - indexInRound;
  return draft.managers[managerIndex];
}

export function availablePlayers(draft) {
  return draft.pool.filter((player) => !draft.pickedIds.has(player.id));
}

// Nothing here asks whether the manager already owns another era of this man.
// The BOARD settles that: it deals each person once, so the second Ken Griffey
// a manager might have tripped over was never printed. A rule that cannot fire
// is a rule that only ever surprises somebody.
export function canPickPlayer(draft, manager, player) {
  if (!player || draft.pickedIds.has(player.id)) {
    return { ok: false, reason: "already picked" };
  }
  // With unlimited inactive slots the only thing standing between a manager
  // and a card is the money: no roster cap, no position cap, and no duty to
  // leave the rest of the league a catcher — the closing sweep guarantees
  // everyone a legal nine out of the cards the board never bid on.
  if (hasUnlimitedRoster(draft)) {
    return { ok: true, reason: "" };
  }
  if (manager.roster.length >= draft.rosterSize) {
    return { ok: false, reason: "roster full" };
  }
  const hitterLegality = canAddHitterToLineup(manager.roster, player);
  if (!hitterLegality.ok) {
    return hitterLegality;
  }
  const pitcherLegality = canAddPitcherToStaff(manager.roster, player);
  if (!pitcherLegality.ok) {
    return pitcherLegality;
  }

  const nextRoster = [...manager.roster, player];
  const remainingSlots = draft.rosterSize - nextRoster.length;
  const needs = getRosterNeeds(nextRoster);
  const remainingRequired = needs.hitter + needs.starter + needs.bullpen;
  if (remainingRequired > remainingSlots) {
    const needed = [];
    if (needs.hitter > 0) needed.push(`${needs.hitter} hitter${needs.hitter === 1 ? "" : "s"}`);
    if (needs.starter > 0) needed.push(`${needs.starter} starter${needs.starter === 1 ? "" : "s"}`);
    if (needs.bullpen > 0) needed.push(`${needs.bullpen} bullpen pitcher${needs.bullpen === 1 ? "" : "s"}`);
    return { ok: false, reason: `must reserve slots for ${needed.join(" and ")}` };
  }

  if (draft.managers.length > 1) {
    const leagueLegality = canLeagueFinishAfterPick(draft, manager, nextRoster, player);
    if (!leagueLegality.ok) return leagueLegality;
  }

  return { ok: true, reason: "" };
}

export function pickPlayer(draft, playerId) {
  if (draft.complete) return draft;
  if (isAuctionDraft(draft)) {
    throw new Error("Auction drafts add players by selling lots");
  }
  const manager = currentManager(draft);
  const player = draft.pool.find((item) => item.id === playerId);
  if (!player || draft.pickedIds.has(playerId)) {
    throw new Error("Player is not available");
  }
  if (manager.roster.length >= draft.rosterSize) {
    throw new Error("Roster is already full");
  }
  const legality = canPickPlayer(draft, manager, player);
  if (!legality.ok) {
    throw new Error(legality.reason);
  }

  manager.roster.push(player);
  draft.pickedIds.add(playerId);
  draft.pickNumber += 1;
  draft.complete = draft.managers.every((item) => item.roster.length >= draft.rosterSize);
  return draft;
}

export function auctionBudget(draft, manager) {
  return draft.auction?.budgets?.[manager.id] ?? 0;
}

// A bid can never leave a manager unable to pay the minimum bid for each of
// their remaining open roster slots — except under random nomination, where
// the sweep fills a short roster for free. There, a manager may spend the last
// point they have on one card and take replacement-level scraps at the other
// twelve slots. That is a real strategy, and it costs exactly what it looks
// like it costs.
export function auctionMaxBid(draft, manager) {
  if (hasUnlimitedRoster(draft)) return auctionBudget(draft, manager);
  const slotsAfterThisPlayer = draft.rosterSize - manager.roster.length - 1;
  return auctionBudget(draft, manager) - Math.max(0, slotsAfterThisPlayer) * AUCTION_MIN_BID;
}

export function auctionLotPlayer(draft) {
  const lot = draft.auction?.lot;
  if (!lot) return null;
  return draft.pool.find((player) => player.id === lot.playerId) ?? null;
}

export function auctionTimerEnabled(draft) {
  return Boolean(draft?.auction?.timer?.enabled);
}

export function startAuctionReview(draft, now = Date.now()) {
  if (!isAuctionDraft(draft) || !auctionTimerEnabled(draft)) return null;
  const review = draft.auction.review;
  if (review.completedAt !== null) return review;
  const timestamp = normalizeTimestamp(now);
  if (review.startedAt === null) {
    review.startedAt = timestamp;
    review.endsAt = timestamp + draft.auction.timer.reviewMs;
  }
  return review;
}

export function completeAuctionReview(draft, now = Date.now()) {
  if (!isAuctionDraft(draft)) return null;
  const review = draft.auction.review;
  if (review?.completedAt === null) review.completedAt = normalizeTimestamp(now);
  return review ?? null;
}

export function auctionReviewRemainingMs(draft, now = Date.now()) {
  if (!isAuctionDraft(draft) || !auctionTimerEnabled(draft)) return 0;
  const review = draft.auction.review;
  if (!review || review.completedAt !== null) return 0;
  if (review.startedAt === null) return draft.auction.timer.reviewMs;
  if (isAuctionPaused(draft)) return Math.max(0, Number(review.pausedRemainingMs) || 0);
  return Math.max(0, review.endsAt - normalizeTimestamp(now));
}

export function auctionReviewComplete(draft, now = Date.now()) {
  if (!isAuctionDraft(draft) || !auctionTimerEnabled(draft)) return true;
  const review = draft.auction.review;
  if (review?.completedAt !== null) return true;
  // A review that was running when the room paused is still running; it just
  // isn't running out.
  if (isAuctionPaused(draft)) return false;
  return review?.endsAt !== null && normalizeTimestamp(now) >= review.endsAt;
}

// ---- Pause ------------------------------------------------------------------
//
// A paused auction is one where no clock runs and nobody may act: the room is
// waiting for a person, not for a move. Pausing settles the clocks on the spot
// — every bidder the lot is still owed a bid from is charged the time they have
// used so far, and the review period's remainder is put in the bank — so that
// while the draft is paused, wall-clock time is simply not a thing the draft
// can see. Resuming restarts the clocks from where they stopped.
//
// Pause and resume are recorded actions like any other, so a replayed room
// stops and starts exactly where the live one did.
export function isAuctionPaused(draft) {
  return isAuctionDraft(draft) && draft.auction.pausedAt !== null && draft.auction.pausedAt !== undefined;
}

// ---- the commissioner's whistle ----
//
// An auction could always be stopped, because its clocks spend a manager's own
// bank and somebody had to be able to protect that. A snake draft could not, and
// it is the one with a doorbell going in it: a clock ticking down on a manager
// who has walked away from the table is the most ordinary thing in a draft, and
// there was nothing to do about it but watch.
//
// The snake's clock lives on the client, so the pause carries the time that was
// left on it. Everyone comes back to the same clock they left.
export function isSnakePaused(draft) {
  return !isAuctionDraft(draft) && draft?.pausedAt !== null && draft?.pausedAt !== undefined;
}

export function isDraftPaused(draft) {
  return isAuctionPaused(draft) || isSnakePaused(draft);
}

export function pauseSnake(draft, remainingMs = null, now = Date.now()) {
  if (isAuctionDraft(draft) || draft.complete || isSnakePaused(draft)) return false;
  draft.pausedAt = normalizeTimestamp(now);
  draft.pausedRemainingMs = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : null;
  return true;
}

export function resumeSnake(draft) {
  if (isAuctionDraft(draft) || !isSnakePaused(draft)) return false;
  draft.pausedAt = null;
  return true;
}

// A seat nobody is sitting in. Handing it to the computer keeps the room moving;
// handing it back is the same move in reverse, and neither touches the roster
// that seat has already built.
export function setManagerCpu(draft, managerId, cpu) {
  const manager = draft.managers.find((entry) => entry.id === managerId);
  if (!manager) return false;
  manager.cpu = Boolean(cpu);
  if (manager.cpu && !manager.persona) {
    const rng = createRng(`${draft.seed}:persona:${manager.id}`);
    manager.persona = CPU_PERSONALITY_KEYS[Math.floor(rng.next() * CPU_PERSONALITY_KEYS.length)];
  }
  return true;
}

export function pauseAuction(draft, now = Date.now()) {
  if (!isAuctionDraft(draft) || draft.complete || isAuctionPaused(draft)) return false;
  const timestamp = normalizeTimestamp(now);
  if (auctionTimerEnabled(draft)) {
    const review = draft.auction.review;
    if (review.completedAt === null && review.startedAt !== null) {
      review.pausedRemainingMs = Math.max(0, review.endsAt - timestamp);
    }
    const lot = draft.auction.lot;
    if (lot?.clock) {
      // Charge the running clocks now, so the banks are already settled and the
      // pause itself costs nobody anything.
      for (const managerId of lot.pending) {
        const manager = draft.managers.find((item) => item.id === managerId);
        if (!manager) continue;
        const elapsed = Math.max(0, timestamp - lot.clock.startedAt);
        const bank = auctionClockBankMs(draft, manager);
        draft.auction.clockBanks[manager.id] = Math.max(0, bank - Math.min(bank, elapsed));
      }
      lot.clock.startedAt = timestamp;
    }
  }
  draft.auction.pausedAt = timestamp;
  return true;
}

export function resumeAuction(draft, now = Date.now()) {
  if (!isAuctionPaused(draft)) return false;
  const timestamp = normalizeTimestamp(now);
  if (auctionTimerEnabled(draft)) {
    const review = draft.auction.review;
    if (review.completedAt === null && review.startedAt !== null) {
      const remaining = Math.max(0, Number(review.pausedRemainingMs) || 0);
      review.endsAt = timestamp + remaining;
      review.pausedRemainingMs = null;
    }
    // The banks were settled at the pause; the lot clock simply starts again.
    if (draft.auction.lot?.clock) draft.auction.lot.clock.startedAt = timestamp;
  }
  draft.auction.pausedAt = null;
  return true;
}

export function auctionClockBankMs(draft, manager) {
  return Math.max(0, Number(draft.auction?.clockBanks?.[manager?.id] ?? 0));
}

export function auctionBidTimeRemainingMs(draft, manager, now = Date.now()) {
  const lot = draft.auction?.lot;
  if (isAuctionPaused(draft)) return auctionClockBankMs(draft, manager);
  if (!lot?.clock || !lot.pending?.includes(manager?.id)) return auctionClockBankMs(draft, manager);
  const elapsed = Math.max(0, normalizeTimestamp(now) - lot.clock.startedAt);
  return Math.max(0, auctionClockBankMs(draft, manager) - elapsed);
}

export function timedOutAuctionBidderIds(draft, now = Date.now()) {
  const lot = draft.auction?.lot;
  if (!lot?.clock) return [];
  const timestamp = normalizeTimestamp(now);
  return lot.pending.filter((managerId) => {
    const manager = draft.managers.find((item) => item.id === managerId);
    return manager && auctionBidTimeRemainingMs(draft, manager, timestamp) <= 0;
  });
}

export function syncAuctionTimer(draft, now = Date.now()) {
  if (!isAuctionDraft(draft) || !auctionTimerEnabled(draft)) return false;
  if (isAuctionPaused(draft)) return false;
  const timestamp = normalizeTimestamp(now);
  let changed = false;
  const review = draft.auction.review;
  if (review?.completedAt === null && review.startedAt !== null && timestamp >= review.endsAt) {
    review.completedAt = review.endsAt;
    changed = true;
  }
  let guard = draft.managers.length * 3 + 3;
  while (draft.auction.lot && guard > 0) {
    guard -= 1;
    const expired = timedOutAuctionBidderIds(draft, timestamp);
    if (!expired.length) break;
    placeSealedBid(draft, expired[0], 0, timestamp, { timedOut: true });
    changed = true;
  }
  return changed;
}

function normalizeTimestamp(now) {
  const timestamp = Number(now);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

export function canNominatePlayer(draft, manager, player, now = Date.now()) {
  if (!isAuctionDraft(draft)) return { ok: false, reason: "not an auction draft" };
  if (draft.complete) return { ok: false, reason: "draft complete" };
  if (isAuctionPaused(draft)) return { ok: false, reason: "the draft is paused" };
  if (!auctionReviewComplete(draft, now)) return { ok: false, reason: "review period is still open" };
  if (draft.auction.lot) return { ok: false, reason: "finish the current lot first" };
  if (isRandomNomination(draft)) {
    return { ok: false, reason: "the queue nominates in this room" };
  }
  const nominator = currentManager(draft);
  if (manager.id !== nominator.id) {
    return { ok: false, reason: `${nominator.name} nominates next` };
  }
  if (auctionMaxBid(draft, manager) < AUCTION_MIN_BID) {
    return { ok: false, reason: "cannot afford the opening bid" };
  }
  return canPickPlayer(draft, manager, player);
}

// Who enters a sealed bid on this lot, in the order they enter it. Seat order
// from whoever leads the bidding, minus anyone who can't afford the minimum or
// can't legally roster the card.
function pendingBidders(draft, player) {
  const count = draft.managers.length;
  const pending = [];
  for (let offset = 0; offset < count; offset += 1) {
    const manager = draft.managers[(draft.auction.nominatorIndex + offset) % count];
    if (!hasUnlimitedRoster(draft) && manager.roster.length >= draft.rosterSize) continue;
    if (auctionMaxBid(draft, manager) < AUCTION_MIN_BID) continue;
    if (!canPickPlayer(draft, manager, player).ok) continue;
    pending.push(manager.id);
  }
  return pending;
}

// Nominating opens a sealed-bid lot: every eligible manager, starting with
// the nominator, enters one hidden bid. The nominator must open at the
// minimum bid or more; everyone else may pass (bid 0).
export function nominatePlayer(draft, playerId, now = Date.now()) {
  if (isRandomNomination(draft)) return nominateNextQueued(draft, playerId, now);
  const nominator = currentManager(draft);
  const player = draft.pool.find((item) => item.id === playerId);
  if (!player || draft.pickedIds.has(playerId)) {
    throw new Error("Player is not available");
  }
  const legality = canNominatePlayer(draft, nominator, player, now);
  if (!legality.ok) {
    throw new Error(legality.reason);
  }
  draft.auction.lot = {
    playerId,
    nominatorId: nominator.id,
    round: 1,
    bids: {},
    pending: pendingBidders(draft, player),
    tie: null,
    clock: null
  };
  draft.auction.lot.clock = createLotClock(draft, now, true);
  return draft.auction.lot;
}

// Puts the head of the hidden queue on the block. There is no nominator, so
// nobody is obliged to open at the minimum — every manager may pass, and a
// card the whole room passes on goes back to the board unsold.
export function nominateNextQueued(draft, expectedPlayerId = null, now = Date.now()) {
  if (!isRandomNomination(draft)) throw new Error("Not a random-nomination draft");
  if (draft.complete) throw new Error("Draft complete");
  if (isAuctionPaused(draft)) throw new Error("The draft is paused");
  if (!auctionReviewComplete(draft, now)) throw new Error("Review period is still open");
  if (draft.auction.lot) throw new Error("Finish the current lot first");
  const player = nextQueuedPlayer(draft);
  if (!player) throw new Error("The nomination queue is empty");
  if (expectedPlayerId && expectedPlayerId !== player.id) {
    throw new Error("The queue nominates in this room");
  }
  draft.auction.lot = {
    playerId: player.id,
    nominatorId: null,
    round: 1,
    bids: {},
    pending: pendingBidders(draft, player),
    tie: null,
    clock: null
  };
  draft.auction.lot.clock = createLotClock(draft, now, true);
  // Nobody can bid — everyone is broke or blocked. The card passes untouched.
  if (!draft.auction.lot.pending.length) return passLot(draft);
  return draft.auction.lot;
}

// The bids are sealed, so nobody is waiting on anybody: every manager the lot
// is still owed a bid from may enter it whenever they like, and the lot
// resolves when the last one is in. `pending` is a set of who still owes,
// not a queue of whose turn it is.
export function isPendingBidder(draft, managerId) {
  return Boolean(draft.auction?.lot?.pending?.includes(managerId));
}

// Someone the lot is still waiting on. Order is seat order, which is arbitrary
// but stable — it exists so the computer managers have somebody to play next,
// not because a human has to wait their turn.
export function sealedBidder(draft) {
  const pendingId = draft.auction?.lot?.pending?.[0];
  return pendingId ? draft.managers.find((manager) => manager.id === pendingId) ?? null : null;
}

export function canPlaceSealedBid(draft, manager, amount, now = Date.now()) {
  const lot = draft.auction?.lot;
  if (!lot) return { ok: false, reason: "no card is on the block" };
  if (isAuctionPaused(draft)) return { ok: false, reason: "the draft is paused" };
  if (!isPendingBidder(draft, manager?.id)) {
    const alreadyIn = manager?.id in lot.bids;
    return { ok: false, reason: alreadyIn ? "your bid is already in" : "you are not bidding on this card" };
  }
  if (lot.clock && auctionBidTimeRemainingMs(draft, manager, now) <= 0) {
    return { ok: false, reason: "bid clock expired" };
  }
  const bid = Math.round(Number(amount));
  if (!Number.isFinite(bid) || bid < 0) return { ok: false, reason: "enter a bid amount" };
  if (bid === 0) {
    if (lot.round === 2) return { ok: false, reason: `rebid at least the tied ${lot.tie.amount}` };
    if (manager.id === lot.nominatorId) {
      return { ok: false, reason: `the nominator opens at ${AUCTION_MIN_BID} or more` };
    }
    return { ok: true, reason: "" };
  }
  const minBid = lot.round === 2 ? lot.tie.amount : AUCTION_MIN_BID;
  if (bid < minBid) {
    if (lot.round === 2) return { ok: false, reason: `rebid at least the tied ${minBid}` };
    return {
      ok: false,
      reason: manager.id === lot.nominatorId ? `bid at least ${minBid}` : `bid at least ${minBid}, or 0 to pass`
    };
  }
  const maxBid = auctionMaxBid(draft, manager);
  if (bid > maxBid) {
    return { ok: false, reason: `max bid is ${Math.max(0, maxBid)} (must keep ${AUCTION_MIN_BID} per open slot)` };
  }
  return { ok: true, reason: "" };
}

// Records one sealed bid; the last bid in resolves the lot automatically.
// Returns { sold: false, lot } while bids are still out, { sold: false, tie }
// when a tie forces a rebid round, or { sold: true, manager, player, price }.
export function placeSealedBid(draft, managerId, amount, now = Date.now(), options = {}) {
  const manager = draft.managers.find((item) => item.id === managerId);
  if (!manager) throw new Error("Unknown manager");
  const timedOut = Boolean(options.timedOut);
  if (timedOut) {
    if (!isPendingBidder(draft, managerId)) throw new Error("bid is no longer pending");
    amount = 0;
  } else {
    const legality = canPlaceSealedBid(draft, manager, amount, now);
    if (!legality.ok) throw new Error(legality.reason);
  }
  const lot = draft.auction.lot;
  submitAuctionClock(draft, manager, now, timedOut);
  lot.bids[managerId] = Math.round(Number(amount));
  // Whoever this was, they are done — not necessarily the one at the front.
  lot.pending = lot.pending.filter((id) => id !== managerId);
  if (lot.pending.length === 0) return resolveSealedLot(draft, now);
  return { sold: false, lot };
}

// Vickrey-style resolution: the high bid wins at the second-highest bid + 1.
// A tie for the top starts one sealed rebid round among the tied managers
// (minimum: the tied amount); a second tie is settled by a seeded coin flip
// at that price, so every replica of the draft agrees on the winner.
function resolveSealedLot(draft, now = Date.now()) {
  const lot = draft.auction.lot;
  const live = Object.entries(lot.bids).filter(([, amount]) => amount > 0);
  const top = live.reduce((best, [, amount]) => Math.max(best, amount), 0);
  // Seat order, not the order the bids happened to land in. Bids are sealed
  // and may be entered in any order, so who typed first must not tilt a
  // coin flip — the tie is between managers, not between reflexes.
  const seat = (managerId) => draft.managers.findIndex((manager) => manager.id === managerId);
  const leaders = live
    .filter(([, amount]) => amount === top)
    .map(([managerId]) => managerId)
    .sort((a, b) => seat(a) - seat(b));

  // Under manual nomination the nominator has to open the bidding, so a lot
  // always sells. Under random nomination nobody is on the hook for it, and a
  // card the whole room passes on simply goes back to the board.
  if (!live.length) return passLot(draft);

  if (leaders.length > 1 && lot.round === 1) {
    lot.round = 2;
    lot.tie = { amount: top, managerIds: leaders };
    lot.pending = [...leaders];
    lot.clock = createLotClock(draft, now, false);
    return { sold: false, lot, tie: lot.tie };
  }

  let winnerId;
  let price;
  if (leaders.length === 1) {
    winnerId = leaders[0];
    const second = live
      .filter(([managerId]) => managerId !== winnerId)
      .reduce((best, [, amount]) => Math.max(best, amount), 0);
    price = Math.max(AUCTION_MIN_BID, second + 1);
  } else {
    const rng = createRng(`${draft.seed}:auction-tie:${draft.pickNumber}:${[...leaders].sort().join(",")}:${top}`);
    winnerId = leaders[Math.floor(rng.next() * leaders.length)];
    price = top;
  }
  return sellLotTo(draft, winnerId, price);
}

function createLotClock(draft, now, addIncrement) {
  if (!auctionTimerEnabled(draft)) return null;
  if (addIncrement) {
    for (const manager of draft.managers) {
      if (!hasUnlimitedRoster(draft) && manager.roster.length >= draft.rosterSize) continue;
      draft.auction.clockBanks[manager.id] = auctionClockBankMs(draft, manager) + draft.auction.timer.incrementMs;
    }
  }
  return { startedAt: normalizeTimestamp(now), timedOut: [] };
}

function submitAuctionClock(draft, manager, now, timedOut) {
  const lot = draft.auction?.lot;
  if (!lot?.clock) return;
  const timestamp = normalizeTimestamp(now);
  const elapsed = Math.max(0, timestamp - lot.clock.startedAt);
  const spent = Math.min(auctionClockBankMs(draft, manager), elapsed);
  draft.auction.clockBanks[manager.id] = timedOut ? 0 : Math.max(0, auctionClockBankMs(draft, manager) - spent);
  if (timedOut && !lot.clock.timedOut.includes(manager.id)) lot.clock.timedOut.push(manager.id);
}

function sellLotTo(draft, winnerId, price) {
  const lot = draft.auction.lot;
  const winner = draft.managers.find((item) => item.id === winnerId);
  const player = auctionLotPlayer(draft);
  if (!winner || !player) throw new Error("Lot is invalid");

  winner.roster.push(player);
  draft.pickedIds.add(player.id);
  draft.auction.budgets[winner.id] -= price;
  draft.auction.history.push({
    playerId: player.id,
    managerId: winner.id,
    price,
    bids: { ...lot.bids },
    nominatorId: lot.nominatorId,
    nominatorIndex: draft.auction.nominatorIndex
  });
  draft.pickNumber += 1;
  closeLot(draft);
  return { sold: true, manager: winner, player, price };
}

// A card nobody bid on. It stays on the board — unowned and un-nominated — and
// the sweep may still hand it to whoever ends the night short at its position.
function passLot(draft) {
  const lot = draft.auction.lot;
  const player = auctionLotPlayer(draft);
  draft.auction.history.push({
    playerId: lot.playerId,
    managerId: null,
    price: 0,
    passed: true,
    bids: { ...lot.bids },
    nominatorId: lot.nominatorId,
    nominatorIndex: draft.auction.nominatorIndex
  });
  closeLot(draft);
  return { sold: false, passed: true, player };
}

// Everything that happens after a lot settles, sold or passed: the block
// clears, the bidding lead rotates, the queue steps forward, and if that was
// the last card in the queue the sweep runs and the draft is done.
function closeLot(draft) {
  draft.auction.lot = null;
  draft.auction.nominatorIndex = nextNominatorIndex(draft, draft.auction.nominatorIndex);
  if (isRandomNomination(draft)) {
    draft.auction.queueIndex += 1;
    if (nominationQueueRemaining(draft) === 0) {
      sweepRosters(draft);
      draft.complete = true;
    }
    return;
  }
  draft.complete = draft.managers.every((item) => item.roster.length >= draft.rosterSize);
}

// Only an effectively untouched nomination can be canceled: instant computer
// bids don't count as touching it, a bid from another human does.
export function canCancelLot(draft) {
  const lot = draft.auction?.lot;
  if (!lot) return false;
  // Nobody chose this card, so there is no nomination to take back — the only
  // way past it is to bid on it or pass it.
  if (isRandomNomination(draft)) return false;
  return !Object.keys(lot.bids).some((managerId) => {
    if (managerId === lot.nominatorId) return false;
    const manager = draft.managers.find((item) => item.id === managerId);
    return Boolean(manager) && !manager.cpu;
  });
}

export function cancelLot(draft) {
  const lot = draft.auction?.lot;
  if (!lot || !canCancelLot(draft)) return null;
  draft.auction.lot = null;
  return lot;
}

export function upcomingNominators(draft, count) {
  if (!isAuctionDraft(draft) || draft.complete) return [];
  if (isRandomNomination(draft)) return [];
  const nominators = [];
  let index = draft.auction.nominatorIndex;
  for (let step = 0; step < count; step += 1) {
    const manager = draft.managers[index];
    if (!manager || manager.roster.length >= draft.rosterSize) break;
    nominators.push(manager);
    index = nextNominatorIndex(draft, index);
  }
  return nominators;
}

function nextNominatorIndex(draft, fromIndex) {
  const count = draft.managers.length;
  // No roster ever fills under random nomination, so there is nobody to skip:
  // the index is just the seat that leads the sealed bidding, and it rotates.
  if (hasUnlimitedRoster(draft)) return (fromIndex + 1) % count;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (fromIndex + offset) % count;
    if (draft.managers[index].roster.length < draft.rosterSize) return index;
  }
  return fromIndex;
}

export function undoLastPick(draft) {
  if (!draft) return null;
  if (isAuctionDraft(draft)) return undoAuctionAction(draft);
  if (draft.pickNumber <= 0) return null;
  const manager = managerForPickNumber(draft, draft.pickNumber - 1);
  const player = manager?.roster.pop();
  if (!manager || !player) return null;

  draft.pickedIds.delete(player.id);
  draft.pickNumber -= 1;
  draft.complete = false;
  if (manager.lineupAssignments) {
    for (const [slot, playerId] of Object.entries(manager.lineupAssignments)) {
      if (playerId === player.id) delete manager.lineupAssignments[slot];
    }
  }
  return { manager, player };
}

// Undo in an auction unwinds one step at a time: an open lot goes back to
// nomination, a finished lot refunds the sale and hands the nomination back.
function undoAuctionAction(draft) {
  if (draft.auction.lot) {
    if (isRandomNomination(draft)) return null;
    draft.auction.lot = null;
    return { canceledLot: true };
  }
  // The sweep is not a move anyone made, it is the closing bell. Undoing the
  // last lot means the draft is live again, so the free fill-ins come back off
  // the board first.
  revertSweep(draft);

  const entry = draft.auction.history.at(-1);
  if (!entry) return null;

  if (entry.passed) {
    draft.auction.history.pop();
    draft.auction.nominatorIndex = entry.nominatorIndex;
    draft.auction.queueIndex -= 1;
    draft.complete = false;
    return { passed: true, player: draft.pool.find((item) => item.id === entry.playerId) ?? null };
  }

  const manager = draft.managers.find((item) => item.id === entry.managerId);
  const rosterIndex = manager?.roster.findIndex((player) => player.id === entry.playerId) ?? -1;
  if (!manager || rosterIndex < 0) return null;

  draft.auction.history.pop();
  const [player] = manager.roster.splice(rosterIndex, 1);
  draft.auction.budgets[manager.id] += entry.price;
  draft.auction.nominatorIndex = entry.nominatorIndex;
  draft.pickedIds.delete(player.id);
  draft.pickNumber -= 1;
  draft.complete = false;
  if (isRandomNomination(draft)) draft.auction.queueIndex -= 1;
  if (manager.lineupAssignments) {
    for (const [slot, playerId] of Object.entries(manager.lineupAssignments)) {
      if (playerId === player.id) delete manager.lineupAssignments[slot];
    }
  }
  return { manager, player };
}

// Takes every free fill-in the closing sweep handed out back off the rosters.
function revertSweep(draft) {
  if (!isRandomNomination(draft)) return;
  for (;;) {
    const entry = draft.auction.history.at(-1);
    if (!entry?.swept) break;
    draft.auction.history.pop();
    const manager = draft.managers.find((item) => item.id === entry.managerId);
    if (manager) {
      manager.roster = manager.roster.filter((player) => player.id !== entry.playerId);
      if (manager.lineupAssignments) {
        for (const [slot, playerId] of Object.entries(manager.lineupAssignments)) {
          if (playerId === entry.playerId) delete manager.lineupAssignments[slot];
        }
      }
    }
    draft.pickedIds.delete(entry.playerId);
    // A printed replacement exists only because the sweep printed it. Undo the
    // sweep and it stops existing — left in the pool it would come back as an
    // unowned card on the auction board, biddable, and the next sweep would
    // print its twin under the same id.
    draft.pool = draft.pool.filter((player) => !(player.replacement && player.id === entry.playerId));
    draft.pickNumber -= 1;
  }
  draft.complete = false;
}

// Sim actions live in the shared room log so every player sees the same
// results, but they never mutate the draft — clients run the seeded sims
// locally when they see one, and log replays skip them.
export const SIM_ACTION_TYPES = new Set(["batch"]);

// Single entry point for replaying shared draft actions. Online rooms sync an
// ordered action log; the server and every client apply actions through this
// function so replicas stay byte-identical (all underlying rules are
// deterministic given the draft seed).
export function applyDraftAction(draft, action) {
  switch (action?.type) {
    case "pick":
      pickPlayer(draft, action.playerId);
      return;
    case "nominate":
      nominatePlayer(draft, action.playerId, action.at);
      return;
    case "seal-bid":
      placeSealedBid(draft, action.managerId, action.amount, action.at, { timedOut: action.timedOut });
      return;
    case "cancel-lot":
      cancelLot(draft);
      return;
    case "auto-nominate":
      // Puts the nominator's best target on the block and stops there, so a
      // stalled nomination never turns into bids nobody entered.
      nominateBestTarget(draft, action.at);
      return;
    case "start-review":
      startAuctionReview(draft, action.at);
      return;
    case "complete-review":
      completeAuctionReview(draft, action.at);
      return;
    case "pause":
      if (isAuctionDraft(draft)) pauseAuction(draft, action.at);
      else pauseSnake(draft, action.remainingMs ?? null, action.at);
      return;
    case "resume":
      if (isAuctionDraft(draft)) resumeAuction(draft, action.at);
      else resumeSnake(draft);
      return;
    case "seat":
      setManagerCpu(draft, action.managerId, action.cpu);
      return;
    case "autopick":
      autopick(draft, action.at);
      return;
    case "finish":
      completeAuctionReview(draft, action.at);
      while (!draft.complete) autopick(draft, action.at);
      return;
    case "undo":
      undoLastPick(draft);
      return;
    case "lineup": {
      const manager = draft.managers.find((item) => item.id === action.managerId);
      if (!manager) throw new Error("Unknown manager for lineup action");
      manager.lineupAssignments = { ...(action.assignments ?? {}) };
      return;
    }
    case "staff": {
      const manager = draft.managers.find((item) => item.id === action.managerId);
      if (!manager) throw new Error("Unknown manager for staff action");
      manager.staffAssignments = { ...(action.assignments ?? {}) };
      return;
    }
    case "batting-order": {
      const manager = draft.managers.find((item) => item.id === action.managerId);
      if (!manager) throw new Error("Unknown manager for batting order action");
      manager.battingOrder = [...(action.order ?? [])];
      return;
    }
    default:
      throw new Error(`Unknown draft action: ${action?.type}`);
  }
}

export function draftHistory(draft) {
  if (isAuctionDraft(draft)) {
    const playersById = new Map(draft.pool.map((player) => [player.id, player]));
    const managersById = new Map(draft.managers.map((manager) => [manager.id, manager]));
    return draft.auction.history
      .map((entry, index) => ({
        pickNumber: index + 1,
        round: Math.floor(index / draft.managers.length) + 1,
        manager: managersById.get(entry.managerId),
        player: playersById.get(entry.playerId),
        price: entry.price
      }))
      .filter((pick) => pick.manager && pick.player);
  }
  const counters = new Map();
  const picks = [];
  for (let pickNumber = 0; pickNumber < draft.pickNumber; pickNumber += 1) {
    const manager = managerForPickNumber(draft, pickNumber);
    const rosterIndex = counters.get(manager.id) ?? 0;
    counters.set(manager.id, rosterIndex + 1);
    const player = manager.roster[rosterIndex];
    if (!player) continue;
    picks.push({
      pickNumber: pickNumber + 1,
      round: Math.floor(pickNumber / draft.managers.length) + 1,
      manager,
      player
    });
  }
  return picks;
}

export function autopick(draft, now = Date.now()) {
  if (isAuctionDraft(draft)) return autoRunAuctionLot(draft, now);
  const best = bestAutopickTarget(draft, currentManager(draft));
  return pickPlayer(draft, best.id);
}

function bestAutopickTarget(draft, manager) {
  const rosterNeeds = getRosterNeeds(manager.roster);
  const candidates = availablePlayers(draft);
  const legal = candidates.filter((player) => canPickPlayer(draft, manager, player).ok);
  if (!legal.length) {
    throw new Error("No legal players are available");
  }
  const model = managerValuation(draft, manager);
  const values = new Map(legal.map((player) => [player.id, model.value(player)]));
  const dropoffs = positionDropoffs(legal, values);
  return legal
    .map((player) => ({
      player,
      score: autopickScore(draft, manager, player, rosterNeeds, values.get(player.id), dropoffs.get(player.id), model.bias)
    }))
    .sort((a, b) => b.score - a.score)[0].player;
}

// Puts the next card on the block: whatever the hidden queue deals in a
// random-nomination room, or the current nominator's best target in a manual
// one. Returns the lot, or null if the card passed with nobody able to bid.
export function nominateBestTarget(draft, now = Date.now()) {
  if (isRandomNomination(draft)) {
    nominateNextQueued(draft, null, now);
    return draft.auction.lot;
  }
  const nominator = currentManager(draft);
  nominatePlayer(draft, bestAutopickTarget(draft, nominator).id, now);
  return draft.auction.lot;
}

// A computer's sealed bid is its willingness for the card; in a rebid round
// it re-enters at least the tied amount, capped by its budget.
export function cpuSealedBid(draft, manager) {
  const lot = draft.auction?.lot;
  const player = auctionLotPlayer(draft);
  if (!lot || !player) return 0;
  const willingness = auctionWillingness(draft, manager, player);
  if (lot.round === 2) {
    return Math.min(auctionMaxBid(draft, manager), Math.max(lot.tie.amount, willingness));
  }
  if (manager.id === lot.nominatorId) return Math.max(AUCTION_MIN_BID, willingness);
  return willingness >= AUCTION_MIN_BID ? willingness : 0;
}

// Computer managers bid the moment their turn comes up, so a lot only ever
// waits on humans. Returns the last placeSealedBid result (or null).
export function submitCpuSealedBids(draft) {
  let result = null;
  for (;;) {
    const next = sealedBidder(draft);
    if (!next?.cpu) return result;
    result = placeSealedBid(draft, next.id, cpuSealedBid(draft, next));
  }
}

// Auto for auctions resolves one full lot: nominate the nominator's best
// target if nothing is on the block, then sealed-bid every manager's
// willingness (the rebid round resolves the same way if bids tie).
function autoRunAuctionLot(draft, now = Date.now()) {
  if (draft.complete) return draft;
  if (!draft.auction.lot) nominateBestTarget(draft, now);
  let guard = draft.managers.length * 4 + 8;
  while (draft.auction.lot && guard > 0) {
    guard -= 1;
    const next = sealedBidder(draft);
    placeSealedBid(draft, next.id, cpuSealedBid(draft, next), now);
  }
  return draft;
}

// Prices scale with the room budget: a manager's willingness for a card is
// their per-slot budget share times how the card's personal valuation compares
// to the rest of the pool at that kind, with a premium when it fills an open
// roster need.
function auctionWillingness(draft, manager, player) {
  const maxBid = auctionMaxBid(draft, manager);
  if (maxBid < AUCTION_MIN_BID) return 0;
  const needs = getRosterNeeds(manager.roster);
  // A computer under random nomination budgets against the holes it still has,
  // not against a roster cap it no longer has. Once its nine and its staff are
  // whole it stops bidding: hoarding a bench is a human's idea.
  const openSlots = hasUnlimitedRoster(draft)
    ? needs.hitter + needs.starter + needs.bullpen
    : draft.rosterSize - manager.roster.length;
  if (hasUnlimitedRoster(draft) && openSlots <= 0) return 0;
  const model = managerValuation(draft, manager);
  const sameKind = availablePlayers(draft).filter((item) => item.kind === player.kind);
  const meanValue = sameKind.reduce((sum, item) => sum + model.value(item), 0) / Math.max(1, sameKind.length);
  const relativeValue = meanValue > 0 ? model.value(player) / meanValue : 1;
  const fairShare = auctionBudget(draft, manager) / Math.max(1, openSlots);
  const needPremium = managerNeedsPositionGroup(manager, player, needs) ? 1.15 : 1;
  const raw = fairShare * relativeValue * needPremium;
  // Sealed bids are whole points, not raise steps — odd amounts make ties rare.
  return Math.max(AUCTION_MIN_BID, Math.min(maxBid, Math.round(raw)));
}

export function managerValuation(draft, manager) {
  const persona = manager.persona ?? "balanced";
  const key = `${draft.seed ?? "showdown"}:valuation:${manager.id}:${persona}`;
  let model = valuationModels.get(key);
  if (!model) {
    model = createValuationModel(key, persona);
    valuationModels.set(key, model);
  }
  return model;
}

const valuationModels = new Map();

// The four staff slots. A capped roster holds exactly these four arms, so the
// choice makes itself; an unlimited one can hold a dozen, and then WHICH two
// starters and which two relievers suit up is the manager's call — the same
// call the lineup slots ask about the bats. staffAssignments answers it.
export const STAFF_SLOT_LABELS = ["SP1", "SP2", "RP1", "RP2"];

const staffSlotRole = (label) => (label.startsWith("SP") ? "SP" : "RP");

export function assignStaffSlots(roster, assignments = {}) {
  const pitchers = roster.filter((player) => player.kind === "pitcher");
  const slots = STAFF_SLOT_LABELS.map((label) => ({ label, role: staffSlotRole(label), player: null }));
  const used = new Set();

  // What the manager asked for, where it is legal.
  for (const slot of slots) {
    const wanted = pitchers.find((player) => player.id === assignments?.[slot.label]
      && !used.has(player.id)
      && pitcherRole(player) === slot.role);
    if (wanted) {
      slot.player = wanted;
      used.add(wanted.id);
    }
  }
  // The rest fill in roster order, so a manager who never touched the board
  // still takes the field with the arms they drafted.
  for (const slot of slots) {
    if (slot.player) continue;
    const next = pitchers.find((player) => !used.has(player.id) && pitcherRole(player) === slot.role);
    if (!next) continue;
    slot.player = next;
    used.add(next.id);
  }
  return slots;
}

// The cards a manager actually takes the field with: nine bats and four arms.
// Everything else they own is a bench.
export function activeRoster(manager) {
  const lineup = assignLineupSlots(manager.roster, manager.lineupAssignments).slots
    .map((slot) => slot.player)
    .filter(Boolean);
  const staff = assignStaffSlots(manager.roster, manager.staffAssignments)
    .map((slot) => slot.player)
    .filter(Boolean);
  return [...lineup, ...staff];
}

export function benchPlayers(manager) {
  const active = new Set(activeRoster(manager).map((player) => player.id));
  return manager.roster.filter((player) => !active.has(player.id));
}

export function buildTeam(manager, options = {}) {
  const lineup = applyBattingOrder(
    assignLineupSlots(manager.roster, manager.lineupAssignments).slots
      .filter((slot) => slot.player)
      .map((slot) => lineupPlayer(slot)),
    manager.battingOrder
  );
  // The staff is the four arms the manager put in the slots — not simply the
  // first four in roster order. On an unlimited roster that is the difference
  // between the two relievers you chose and the two you happened to buy first.
  const staff = assignStaffSlots(manager.roster, manager.staffAssignments);
  const starters = staff.filter((slot) => slot.role === "SP" && slot.player).map((slot) => slot.player);
  const bullpen = staff.filter((slot) => slot.role === "RP" && slot.player).map((slot) => slot.player);
  const starterIndex = starters.length ? Number(options.starterIndex ?? 0) % starters.length : 0;
  const activeStarter = starters[starterIndex];
  return {
    name: manager.name,
    lineup,
    starters,
    bullpen,
    starterIndex,
    pitchers: [activeStarter, ...bullpen].filter(Boolean)
  };
}

// Reorder a built lineup to the manager's preferred batting order (a list of
// player ids). Players missing from the list bat last, in slot order, so a
// stale order after a roster swap still fields nine.
export function applyBattingOrder(lineup, battingOrder) {
  if (!Array.isArray(battingOrder) || !battingOrder.length) return lineup;
  const rank = new Map(battingOrder.map((id, index) => [id, index]));
  return [...lineup].sort((a, b) => {
    const rankA = rank.has(a.id) ? rank.get(a.id) : battingOrder.length + lineup.indexOf(a);
    const rankB = rank.has(b.id) ? rank.get(b.id) : battingOrder.length + lineup.indexOf(b);
    return rankA - rankB;
  });
}

// One era of a real player per team: 1990s Barry Bonds and 2000s Barry
// Bonds can't both suit up. Returns one name per offending person.
//
// A COLLECTION rule, not a draft rule. Adventure builds rosters out of packs
// and trades, where both Bondses can turn up; a draft board deals each person
// once, so a drafted roster cannot break this and nothing in the draft checks
// it. See cardPerson.
export function duplicateEraPeople(roster) {
  const seen = new Map();
  const names = [];
  for (const player of roster) {
    const identity = playerIdentity(player.id);
    if (!identity) continue;
    const prior = seen.get(identity.person);
    if (prior && prior !== identity.slice) {
      if (!names.includes(player.name)) names.push(player.name);
    } else {
      seen.set(identity.person, identity.slice);
    }
  }
  return names;
}

// Roster issues that keep a manager from fielding a legal nine. With unlimited
// inactive slots a surplus hitter is a bench bat, not a problem, so the
// "too many" complaint only applies to rooms that cap the roster.
export function validateRoster(manager, options = {}) {
  const unlimited = Boolean(options.unlimitedRoster);
  const lineup = lineupStatus(manager.roster);
  const staff = staffStatus(manager.roster);
  const issues = [];
  const eraDupes = duplicateEraPeople(manager.roster);
  if (eraDupes.length) issues.push(`two eras of ${eraDupes.join("/")}`);
  if (lineup.hitters.length < HITTER_TARGET) issues.push(`needs ${HITTER_TARGET - lineup.hitters.length} more hitter${HITTER_TARGET - lineup.hitters.length === 1 ? "" : "s"}`);
  if (lineup.missingPositions.length) issues.push(`missing ${lineup.missingPositions.join("/")}`);
  if (!unlimited && lineup.extraDuplicates.length) issues.push(`too many ${lineup.extraDuplicates.join("/")} hitters`);
  if (staff.starters.length < STARTER_TARGET) issues.push(`needs ${STARTER_TARGET - staff.starters.length} more starter${STARTER_TARGET - staff.starters.length === 1 ? "" : "s"}`);
  if (staff.bullpen.length < BULLPEN_TARGET) issues.push(`needs ${BULLPEN_TARGET - staff.bullpen.length} more bullpen pitcher${BULLPEN_TARGET - staff.bullpen.length === 1 ? "" : "s"}`);
  return issues;
}

// What a manager is still missing to field a legal nine plus a legal staff.
// 1B and DH never appear here: any glove covers first, any bat DHs, so those
// two slots are a question of hitter COUNT, not of position.
function activeRosterGaps(roster) {
  const needs = getRosterNeeds(roster);
  const lineup = lineupStatus(roster);
  return {
    positions: lineup.missingPositions.filter((position) => position !== "1B"),
    hitter: needs.hitter,
    starter: needs.starter,
    bullpen: needs.bullpen
  };
}

function hasRosterGaps(gaps) {
  return gaps.positions.length > 0 || gaps.hitter > 0 || gaps.starter > 0 || gaps.bullpen > 0;
}

// The slot whose reserve a hole should be filled out of, best first. A hole at
// a position spends that position's reserve. A hole that is only a missing BAT
// spends the two slots the board keeps bats in without a position attached:
// the DH, and the first baseman activeRosterGaps folds into the hitter count
// because any glove can cover the bag.
function reserveSlots(kind, role, position) {
  if (kind === "pitcher") return [role === "SP" ? "SP" : "RP"];
  if (!position) return [ANY_HITTER, "1B"];
  return [CORNER_OUTFIELD_SLOTS.includes(position) ? CORNER_OUTFIELD_POSITION : position];
}

// The closing sweep. The hidden queue has run dry and some managers are short —
// outbid all night, or broke, or hoarding nine bats and no arms. Every hole
// left in an active roster is filled, for free, with the CHEAPEST card still
// sitting unsold on the visible board.
//
// This is the promise the visible pool is sized to keep: the board always
// holds enough leftovers to finish every roster in the room, so the sweep
// never has to invent a player. Managers are swept in seat order.
export function sweepRosters(draft) {
  const swept = [];
  for (const manager of draft.managers) {
    let guard = 0;
    for (;;) {
      const gaps = activeRosterGaps(manager.roster);
      if (!hasRosterGaps(gaps)) break;
      guard += 1;
      if (guard > draft.rosterSize * 2) break;

      // Scarce positions first — a catcher is harder to come by than a bat —
      // then the hitter count, then the staff.
      const neededPosition = gaps.positions[0] ?? null;
      const neededKind = neededPosition || gaps.hitter > 0 ? "hitter" : "pitcher";
      const neededRole = neededKind === "pitcher" ? (gaps.starter > 0 ? "SP" : "RP") : null;

      // Out of the right pile, then the cheapest in it. The board keeps n - 1
      // cards back at EVERY slot, which finishes every roster only if each hole
      // is filled from the reserve kept for it. Take the cheapest card that
      // merely fits and a center fielder who moonlights at second goes to the
      // first manager short a second baseman — and the manager swept last, who
      // actually needed a center fielder, finds the pile empty.
      const reserve = reserveSlots(neededKind, neededRole, neededPosition);
      const fromReserve = (player) => {
        const index = reserve.indexOf(player.slot);
        return index === -1 ? reserve.length : index;
      };

      const replacement = availablePlayers(draft)
        .filter((player) => !player.replacement)
        .filter((player) => player.kind === neededKind)
        .filter((player) => !neededRole || pitcherRole(player) === neededRole)
        .filter((player) => !neededPosition || positionMatchesSlot(player, neededPosition))
        .sort((a, b) => fromReserve(a) - fromReserve(b) || a.points - b.points || a.id.localeCompare(b.id))[0]
        ?? makeReplacementPlayer(draft, manager, neededKind, neededRole, neededPosition);

      manager.roster.push(replacement);
      draft.pickedIds.add(replacement.id);
      draft.pickNumber += 1;
      draft.auction.history.push({
        playerId: replacement.id,
        managerId: manager.id,
        price: 0,
        swept: true,
        bids: {},
        nominatorId: null,
        nominatorIndex: draft.auction.nominatorIndex
      });
      swept.push({ managerId: manager.id, playerId: replacement.id });
    }
  }
  return swept;
}

export function repairDraftRosters(draft) {
  for (const manager of draft.managers) {
    repairManagerRoster(draft, manager);
  }
  draft.complete = draft.managers.every((item) => item.roster.length >= draft.rosterSize);
  return draft;
}

export function getRosterNeeds(roster) {
  const hitters = roster.filter((player) => player.kind === "hitter").length;
  const staff = staffStatus(roster);
  const starter = Math.max(0, STARTER_TARGET - staff.starters.length);
  const bullpen = Math.max(0, BULLPEN_TARGET - staff.bullpen.length);
  return {
    hitter: Math.max(0, HITTER_TARGET - hitters),
    pitcher: starter + bullpen,
    starter,
    bullpen
  };
}

export function staffStatus(roster) {
  const pitchers = roster.filter((player) => player.kind === "pitcher");
  return {
    pitchers,
    starters: pitchers.filter((player) => pitcherRole(player) === "SP"),
    bullpen: pitchers.filter((player) => pitcherRole(player) === "RP")
  };
}

export function lineupStatus(roster) {
  const hitters = roster.filter((player) => player.kind === "hitter");
  const assigned = assignLineupSlots(roster);
  const counts = new Map();
  for (const hitter of hitters) {
    counts.set(hitter.position, (counts.get(hitter.position) ?? 0) + 1);
  }
  const missingPositions = assigned.slots.filter((slot) => slot.label !== "DH" && !slot.player).map((slot) => slot.label);
  const duplicatePositions = assigned.slots
    .filter((slot) => slot.player && !positionMatchesSlot(slot.player, slot.label) && slot.label !== "DH")
    .map((slot) => `${slot.player.position}->${slot.label}`);
  const extraDuplicates = assigned.extras.map((player) => player.position);

  return {
    hitters,
    counts,
    missingPositions,
    duplicatePositions,
    dhFilled: Boolean(assigned.slots.find((slot) => slot.label === "DH")?.player),
    extraDuplicates
  };
}

export function assignLineupSlots(roster, assignments = {}) {
  const hitters = roster.filter((player) => player.kind === "hitter");
  const slots = LINEUP_SLOT_LABELS.map((label) => ({ label, player: null, fielding: null, outOfPosition: false }));
  const used = new Set();
  const manualAssignments = assignments ?? {};

  for (const label of LINEUP_SLOT_LABELS) {
    const player = hitters.find((item) => item.id === manualAssignments[label] && !used.has(item.id));
    if (player && canPlayerFillLineupSlot(player, label)) assignFirst(slots, used, label, player, slotOptions(player, label));
  }

  // The exact slots (1B included, for cards that actually list it) fill as a
  // MATCHING, not first-fit: with multi-position cards a greedy pass can
  // strand a slot (the 2B/SS card grabs 2B and the pure 2B ends up at DH
  // while SS sits empty). Kuhn's augmenting paths over at most 9 hitters x 8
  // slots; each card tries its primary spot first, so the utility man only
  // slides over when that seats one more starter.
  for (const [label, player] of matchExactSlots(slots, hitters, used)) {
    assignFirst(slots, used, label, player);
  }

  // Nobody lists first base: any glove covers it at a flat -1.
  if (!slots.find((slot) => slot.label === "1B").player) {
    const fallbackFirstBase = hitters.find((player) => !used.has(player.id));
    assignFirst(slots, used, "1B", fallbackFirstBase, { firstBaseOutOfPosition: Boolean(fallbackFirstBase) });
  }

  const dh = hitters.find((player) => !used.has(player.id));
  assignFirst(slots, used, "DH", dh);

  return {
    slots,
    extras: hitters.filter((player) => !used.has(player.id))
  };
}

// Maximum matching of unassigned hitters onto the open exact slots
// (C/2B/3B/SS/CF, 1B, and the two corners). Hitters seat in roster order;
// each tries the slots it plays, primary position first, and may push an
// earlier card to one of its other spots to make room. Returns a Map of
// label -> player. 1B only matches cards that actually LIST first base —
// the anyone-covers-1B rule stays a fallback outside the matching.
function matchExactSlots(slots, hitters, used) {
  const openLabels = [...EXACT_REQUIRED_POSITIONS, "1B", ...CORNER_OUTFIELD_SLOTS]
    .filter((label) => !slots.find((slot) => slot.label === label)?.player);
  const fits = (player, label) =>
    CORNER_OUTFIELD_SLOTS.includes(label) ? cardIsCornerOutfielder(player) : playsPosition(player, label);
  const primaryFirst = (player) => {
    const primary = (label) =>
      CORNER_OUTFIELD_SLOTS.includes(label) ? isCornerOutfielder(player.position) : player.position === label;
    return [...openLabels].sort((a, b) => Number(primary(b)) - Number(primary(a)));
  };
  const seated = new Map();
  const tryPlace = (player, visited) => {
    const labels = primaryFirst(player).filter((label) => fits(player, label) && !visited.has(label));
    // A free slot always wins before bumping anyone — two LF/RF cards land
    // LF then RF in roster order, exactly as the greedy filler used to.
    for (const label of labels) {
      if (!seated.get(label)) {
        seated.set(label, player);
        return true;
      }
    }
    for (const label of labels) {
      visited.add(label);
      if (tryPlace(seated.get(label), visited)) {
        seated.set(label, player);
        return true;
      }
    }
    return false;
  };
  // Primary-position players seat before secondary-only ones, so a DH bat
  // with a 3B side-listing never bumps the true third baseman to DH.
  const primarySlot = (player) =>
    EXACT_REQUIRED_POSITIONS.includes(player.position) || player.position === "1B" || isCornerOutfielder(player.position);
  const order = [...hitters.filter(primarySlot), ...hitters.filter((player) => !primarySlot(player))];
  for (const player of order) {
    if (!used.has(player.id)) tryPlace(player, new Set());
  }
  return seated;
}

export function canPlayerFillLineupSlot(player, label) {
  if (player?.kind !== "hitter") return false;
  if (label === "DH") return true;
  if (label === "1B") return true;
  return positionMatchesSlot(player, label);
}

function repairManagerRoster(draft, manager) {
  let guard = 0;
  while (validateRoster(manager).length > 0 && guard < draft.rosterSize * 2) {
    guard += 1;
    const needs = getRosterNeeds(manager.roster);
    const lineup = lineupStatus(manager.roster);
    const neededPosition = lineup.missingPositions.find((position) => position !== "1B");
    const neededKind = needs.starter > 0 || needs.bullpen > 0 ? "pitcher" : "hitter";
    const neededRole = needs.starter > 0 ? "SP" : needs.bullpen > 0 ? "RP" : null;
    const replacement = availablePlayers(draft)
      .filter((player) => player.kind === neededKind)
      .filter((player) => !neededRole || pitcherRole(player) === neededRole)
      .filter((player) => !neededPosition || positionMatchesSlot(player, neededPosition))
      .filter((player) => neededKind !== "hitter" || canAddHitterToLineup(manager.roster, player).ok)
      .sort((a, b) => b.points - a.points)[0] ?? makeReplacementPlayer(draft, manager, neededKind, neededRole, neededPosition);

    if (manager.roster.length >= draft.rosterSize) {
      const removableKind = neededKind === "pitcher" ? "hitter" : "pitcher";
      const removable = manager.roster
        .filter((player) => player.kind === removableKind)
        .sort((a, b) => a.points - b.points)[0];
      if (!removable) return;
      manager.roster = manager.roster.filter((player) => player.id !== removable.id);
      draft.pickedIds.delete(removable.id);
    }

    manager.roster.push(replacement);
    draft.pickedIds.add(replacement.id);
  }
}

function canLeagueFinishAfterPick(draft, pickingManager, nextRoster, pickedPlayer) {
  const pickedIds = new Set(draft.pickedIds);
  pickedIds.add(pickedPlayer.id);
  const remaining = draft.pool.filter((player) => !pickedIds.has(player.id));
  const demand = emptyLeagueDemand();

  for (const manager of draft.managers) {
    addRosterDemand(demand, manager === pickingManager ? nextRoster : manager.roster);
  }

  const supply = leagueSupply(remaining);
  const shortages = [];
  for (const position of EXACT_REQUIRED_POSITIONS) {
    if (demand.positions[position] > supply.positions[position]) shortages.push(position);
  }
  if (demand.cornerOutfield > supply.cornerOutfield) shortages.push("LF/RF");
  if (demand.starter > supply.starter) shortages.push("starter");
  if (demand.bullpen > supply.bullpen) shortages.push("bullpen");
  if (demand.hitters > supply.hitters) shortages.push("hitter");
  if (shortages.length) {
    return { ok: false, reason: `would leave league without enough ${shortages.join(", ")}` };
  }
  return { ok: true, reason: "" };
}

function emptyLeagueDemand() {
  return {
    positions: Object.fromEntries(EXACT_REQUIRED_POSITIONS.map((position) => [position, 0])),
    cornerOutfield: 0,
    hitters: 0,
    starter: 0,
    bullpen: 0
  };
}

function addRosterDemand(demand, roster) {
  const lineup = lineupStatus(roster);
  const needs = getRosterNeeds(roster);
  for (const position of lineup.missingPositions) {
    if (EXACT_REQUIRED_POSITIONS.includes(position)) demand.positions[position] += 1;
    if (CORNER_OUTFIELD_SLOTS.includes(position)) demand.cornerOutfield += 1;
  }
  demand.hitters += needs.hitter;
  demand.starter += needs.starter;
  demand.bullpen += needs.bullpen;
}

function leagueSupply(players) {
  const positions = Object.fromEntries(EXACT_REQUIRED_POSITIONS.map((position) => [position, 0]));
  let cornerOutfield = 0;
  let hitters = 0;
  let starter = 0;
  let bullpen = 0;

  for (const player of players) {
    if (player.kind === "hitter") {
      hitters += 1;
      // A multi-position card supplies every spot it lists — it can only
      // fill one at a time, but this check is a loose feasibility bound.
      for (const entry of hitterPositions(player)) {
        if (EXACT_REQUIRED_POSITIONS.includes(entry.pos)) positions[entry.pos] += 1;
      }
      if (cardIsCornerOutfielder(player)) cornerOutfield += 1;
    } else if (pitcherRole(player) === "SP") {
      starter += 1;
    } else {
      bullpen += 1;
    }
  }

  return { positions, cornerOutfield, hitters, starter, bullpen };
}

// REPLACEMENT LEVEL. The board is out of cards that can fill a hole, so the
// manager is handed the worst card on the board that plays the slot — printed
// under a plain name, stripped to that one position, and copied rather than
// moved. Copies repeat on purpose: two managers short a center fielder get the
// same replacement center fielder, and a hole costs every manager the same.
//
// The card it copies is the CHEAPEST that plays the slot, owned or not, which
// is the honest floor. The old fabricated card was a 180-point invention on a
// board whose worst center fielder went for 20 — being swept was a reward.
function makeReplacementPlayer(draft, manager, neededKind, neededRole, neededPosition) {
  const slot = replacementSlot(neededKind, neededRole, neededPosition);
  const priorAtSlot = manager.roster.filter((player) => player.replacement && player.slot === slot).length;
  // "Replacement LF/RF", then "Replacement LF/RF #2" — the corner slots are the
  // only place one roster takes two of the same, but the numbering costs
  // nothing and a roster that lists the same name twice with no way to tell
  // them apart is a roster nobody can read.
  const name = priorAtSlot === 0 ? `Replacement ${slot}` : `Replacement ${slot} #${priorAtSlot + 1}`;
  const id = `replacement-${manager.id}-${slot.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${priorAtSlot + 1}`;
  const source = replacementSource(draft, neededKind, neededRole, neededPosition);
  const replacement = source
    ? copyAsReplacement(source, { id, name, slot, kind: neededKind })
    : fabricateReplacement({ id, name, slot, kind: neededKind });
  draft.pool.push(replacement);
  return replacement;
}

// The slot a replacement is printed at: the corner slots share one printing,
// and a manager who is simply a bat short (no position to fill) gets a DH.
function replacementSlot(kind, role, position) {
  if (kind === "pitcher") return role === "SP" ? "SP" : "RP";
  if (!position) return "DH";
  return CORNER_OUTFIELD_SLOTS.includes(position) ? CORNER_OUTFIELD_POSITION : position;
}

// The worst card on the board that can do the job. Replacements don't breed:
// a replacement is never the source for another one.
function replacementSource(draft, kind, role, position) {
  return draft.pool
    .filter((player) => !player.replacement && player.kind === kind)
    .filter((player) => kind !== "pitcher" || !role || pitcherRole(player) === role)
    .filter((player) => kind !== "hitter" || !position || positionMatchesSlot(player, position))
    .sort((a, b) => a.points - b.points || a.id.localeCompare(b.id))[0] ?? null;
}

// His numbers, not his name: the chart, the on-base, the arm and the price
// come across; the face, the team and the season don't. He fields the one slot
// he was called up for and nothing else.
function copyAsReplacement(source, { id, name, slot, kind }) {
  const card = {
    ...source,
    id,
    name,
    slot,
    replacement: true,
    sourceId: source.id,
    team: "FA",
    setTag: "Replacement",
    mlbam: null,
    foil: false
  };
  if (kind === "pitcher") return { ...card, role: slot };
  const fielding = fieldingAt(source, slot) ?? 0;
  return { ...card, position: slot, positions: [{ pos: slot, fielding }], fielding };
}

// Only when the board holds nothing at all that plays the slot — a pool too
// thin to have dealt one, which the setup screen is supposed to refuse.
function fabricateReplacement({ id, name, slot, kind }) {
  const shared = { id, name, slot, replacement: true, team: "FA", setTag: "Replacement", points: 10 };
  if (kind === "pitcher") {
    return {
      ...shared,
      kind: "pitcher",
      role: slot,
      throws: "R",
      control: 1,
      ip: slot === "SP" ? 5 : 1,
      chart: [
        { from: 1, to: 2, result: "PU" },
        { from: 3, to: 7, result: "SO" },
        { from: 8, to: 13, result: "GB" },
        { from: 14, to: 17, result: "FB" },
        { from: 18, to: 19, result: "BB" },
        { from: 20, to: 20, result: "1B" }
      ]
    };
  }
  return {
    ...shared,
    kind: "hitter",
    position: slot,
    positions: [{ pos: slot, fielding: 0 }],
    fielding: 0,
    bats: "R",
    onBase: 7,
    speed: 10,
    chart: [
      { from: 1, to: 4, result: "SO" },
      { from: 5, to: 8, result: "GB" },
      { from: 9, to: 12, result: "FB" },
      { from: 13, to: 14, result: "BB" },
      { from: 15, to: 20, result: "1B" }
    ]
  };
}

function autopickScore(draft, manager, player, needs, personalValue, dropoff, bias = null) {
  const lean = bias ?? cpuPersonality(manager.persona).bias;
  const remainingSlots = draft.rosterSize - manager.roster.length;
  const matchingNeed = player.kind === "pitcher" ? pitcherNeed(player, needs) : needs.hitter;
  const forcedNeed = matchingNeed > 0 && matchingNeed >= remainingSlots;
  const needBonus = matchingNeed > 0 ? 80 + (matchingNeed / Math.max(1, remainingSlots)) * 120 : 0;
  const balanceBonus = player.kind === "pitcher" && pitcherNeed(player, needs) > 0 ? 35 : 0;
  const positionBonus = hitterPositionBonus(manager.roster, player);
  const scarcityBonus = positionScarcityBonus(manager, player, needs, dropoff) * lean.scarcity;
  // The ace-first man reaches for arms; the slugger lets them come to him.
  const armLean = player.kind === "pitcher" ? (lean.pitcher - 1) * 140 : 0;
  // The bargain hunter is the only one who reads the price tag. He does not want
  // bad cards — he wants the same card cheaper — so the tag is a discount on the
  // score, not a prize for being worthless. Reward value-per-point directly and
  // he fills a roster with ten-point scrubs and calls it shrewd.
  const thrift = lean.thrift ? -lean.thrift * (player.points ?? 0) * 0.22 : 0;
  return (
    personalValue + needBonus + balanceBonus + positionBonus + scarcityBonus + armLean + thrift +
    (forcedNeed ? 1000 : 0)
  );
}

function positionDropoffs(players, values) {
  const groupTops = new Map();
  for (const player of players) {
    const group = positionGroup(player);
    const value = values.get(player.id);
    const top = groupTops.get(group) ?? { first: -Infinity, second: -Infinity };
    if (value > top.first) {
      top.second = top.first;
      top.first = value;
    } else if (value > top.second) {
      top.second = value;
    }
    groupTops.set(group, top);
  }

  const dropoffs = new Map();
  for (const player of players) {
    const top = groupTops.get(positionGroup(player));
    const value = values.get(player.id);
    const bestOther = value >= top.first ? Math.max(0, top.second === -Infinity ? 0 : top.second) : top.first;
    dropoffs.set(player.id, Math.max(0, value - bestOther));
  }
  return dropoffs;
}

function positionGroup(player) {
  // Dropoff scarcity groups by the PRIMARY position: that's the job the
  // card usually holds down, and one group per card keeps the math simple.
  if (player.kind === "pitcher") return `pitcher-${pitcherRole(player)}`;
  if (isCornerOutfielder(player.position)) return `hitter-${CORNER_OUTFIELD_POSITION}`;
  return `hitter-${player.position}`;
}

function positionScarcityBonus(manager, player, needs, dropoff) {
  if (!dropoff || dropoff <= 0) return 0;
  if (!managerNeedsPositionGroup(manager, player, needs)) return 0;
  return Math.min(120, dropoff * 0.8);
}

function managerNeedsPositionGroup(manager, player, needs) {
  if (player.kind === "pitcher") return pitcherNeed(player, needs) > 0;
  if (needs.hitter <= 0) return false;
  const lineup = lineupStatus(manager.roster);
  return hitterPositions(player).some((entry) =>
    isCornerOutfielder(entry.pos)
      ? lineup.missingPositions.includes("LF") || lineup.missingPositions.includes("RF")
      : lineup.missingPositions.includes(entry.pos));
}

function canAddPitcherToStaff(roster, player) {
  if (player?.kind !== "pitcher") return { ok: true, reason: "" };
  const staff = staffStatus(roster);
  if (pitcherRole(player) === "SP" && staff.starters.length >= STARTER_TARGET) {
    return { ok: false, reason: "starter slots are already filled" };
  }
  if (pitcherRole(player) === "RP" && staff.bullpen.length >= BULLPEN_TARGET) {
    return { ok: false, reason: "bullpen slots are already filled" };
  }
  return { ok: true, reason: "" };
}

function pitcherNeed(player, needs) {
  return pitcherRole(player) === "SP" ? needs.starter : needs.bullpen;
}

function pitcherRole(player) {
  return player?.role === "SP" ? "SP" : "RP";
}

function canAddHitterToLineup(roster, player) {
  if (player?.kind !== "hitter") return { ok: true, reason: "" };
  const lineup = lineupStatus(roster);
  if (lineup.hitters.length >= HITTER_TARGET) {
    return { ok: false, reason: "lineup already has 9 hitters" };
  }
  const nextLineup = lineupStatus([...roster, player]);
  const remainingHitterSlots = HITTER_TARGET - nextLineup.hitters.length;
  if (nextLineup.extraDuplicates.length) {
    return { ok: false, reason: "lineup slots are already filled" };
  }
  if (nextLineup.missingPositions.length > remainingHitterSlots) {
    return { ok: false, reason: "must fill remaining positions" };
  }
  return { ok: true, reason: "" };
}

function hitterPositionBonus(roster, player) {
  if (player.kind !== "hitter") return 0;
  const lineup = lineupStatus(roster);
  const fillsMissing = hitterPositions(player).some((entry) =>
    isCornerOutfielder(entry.pos)
      ? lineup.missingPositions.includes("LF") || lineup.missingPositions.includes("RF")
      : lineup.missingPositions.includes(entry.pos));
  if (fillsMissing) return 60;
  if (lineup.missingPositions.includes("1B")) return 20;
  if (!lineup.dhFilled) return 15;
  return 0;
}

function assignFirst(slots, used, label, player, options = {}) {
  if (!player) return;
  const slot = slots.find((item) => item.label === label);
  if (!slot || slot.player) return;
  slot.player = player;
  slot.outOfPosition = Boolean(options.firstBaseOutOfPosition);
  slot.fielding = options.firstBaseOutOfPosition ? -1 : slotFielding(player, label);
  used.add(player.id);
}

// The glove a card brings to a specific slot: the listed rating for that
// position (a 2B+3/SS+2 card fields +2 at short), the corner rating at
// either LF or RF, and the primary rating everywhere else (DH, out-of-slot).
function slotFielding(player, label) {
  if (CORNER_OUTFIELD_SLOTS.includes(label)) {
    const corner = hitterPositions(player).find((entry) => isCornerOutfielder(entry.pos));
    if (corner) return Number(corner.fielding) || 0;
  }
  return fieldingAt(player, label) ?? (Number(player.fielding) || 0);
}

function slotOptions(player, label) {
  return {
    firstBaseOutOfPosition: label === "1B" && !playsPosition(player, "1B")
  };
}

function lineupPlayer(slot) {
  return {
    ...slot.player,
    cardPosition: slot.player.position,
    defensivePosition: slot.label,
    assignedPosition: slot.label,
    fielding: slot.fielding ?? (Number(slot.player.fielding) || 0),
    outOfPosition: slot.outOfPosition
  };
}