import { createRng } from "./rng.js";
import { createValuationModel } from "./valuation.js";

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

// Rewrites bare "LF"/"RF" card labels to the lumped LF/RF position so every
// pool source drafts and displays corners as one position.
export function normalizeCardPosition(player) {
  if (player?.kind !== "hitter" || !isCornerOutfielder(player.position)) return player;
  if (player.position === CORNER_OUTFIELD_POSITION) return player;
  return { ...player, position: CORNER_OUTFIELD_POSITION };
}

function positionMatchesSlot(position, label) {
  if (CORNER_OUTFIELD_SLOTS.includes(label)) return isCornerOutfielder(position);
  return position === label;
}
const HITTER_TARGET = 9;
const STARTER_TARGET = 2;
const BULLPEN_TARGET = 2;
const PITCHER_TARGET = STARTER_TARGET + BULLPEN_TARGET;
const DEFAULT_ROSTER_SIZE = HITTER_TARGET + PITCHER_TARGET;

export const AUCTION_MIN_BID = 5;
export const AUCTION_MIN_RAISE = 5;
export const AUCTION_DEFAULT_BUDGET = 5000;

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
  const cleanManagers = managers.map((entry, index) => {
    const name = typeof entry === "string" ? entry : String(entry?.name ?? "");
    return {
      id: `team-${index + 1}`,
      name: name.trim() || `Manager ${index + 1}`,
      cpu: typeof entry === "object" && entry !== null && Boolean(entry.cpu),
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
    draft.auction = {
      budget,
      budgets: Object.fromEntries(cleanManagers.map((manager) => [manager.id, budget])),
      nominatorIndex: 0,
      lot: null,
      history: []
    };
  }

  return draft;
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

export function canPickPlayer(draft, manager, player) {
  if (!player || draft.pickedIds.has(player.id)) {
    return { ok: false, reason: "already picked" };
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
// their remaining open roster slots.
export function auctionMaxBid(draft, manager) {
  const slotsAfterThisPlayer = draft.rosterSize - manager.roster.length - 1;
  return auctionBudget(draft, manager) - Math.max(0, slotsAfterThisPlayer) * AUCTION_MIN_BID;
}

export function auctionLotPlayer(draft) {
  const lot = draft.auction?.lot;
  if (!lot) return null;
  return draft.pool.find((player) => player.id === lot.playerId) ?? null;
}

export function canNominatePlayer(draft, manager, player) {
  if (!isAuctionDraft(draft)) return { ok: false, reason: "not an auction draft" };
  if (draft.complete) return { ok: false, reason: "draft complete" };
  if (draft.auction.lot) return { ok: false, reason: "finish the current lot first" };
  const nominator = currentManager(draft);
  if (manager.id !== nominator.id) {
    return { ok: false, reason: `${nominator.name} nominates next` };
  }
  if (auctionMaxBid(draft, manager) < AUCTION_MIN_BID) {
    return { ok: false, reason: "cannot afford the opening bid" };
  }
  return canPickPlayer(draft, manager, player);
}

// Nominating opens a sealed-bid lot: every eligible manager, starting with
// the nominator, enters one hidden bid. The nominator must open at the
// minimum bid or more; everyone else may pass (bid 0).
export function nominatePlayer(draft, playerId) {
  const nominator = currentManager(draft);
  const player = draft.pool.find((item) => item.id === playerId);
  if (!player || draft.pickedIds.has(playerId)) {
    throw new Error("Player is not available");
  }
  const legality = canNominatePlayer(draft, nominator, player);
  if (!legality.ok) {
    throw new Error(legality.reason);
  }
  const count = draft.managers.length;
  const pending = [];
  for (let offset = 0; offset < count; offset += 1) {
    const manager = draft.managers[(draft.auction.nominatorIndex + offset) % count];
    if (manager.roster.length >= draft.rosterSize) continue;
    if (auctionMaxBid(draft, manager) < AUCTION_MIN_BID) continue;
    if (!canPickPlayer(draft, manager, player).ok) continue;
    pending.push(manager.id);
  }
  draft.auction.lot = {
    playerId,
    nominatorId: nominator.id,
    round: 1,
    bids: {},
    pending,
    tie: null
  };
  return draft.auction.lot;
}

// The manager whose sealed bid the lot is waiting on (bids come in seat
// order from the nominator so a hotseat table can pass the keyboard).
export function sealedBidder(draft) {
  const pendingId = draft.auction?.lot?.pending?.[0];
  return pendingId ? draft.managers.find((manager) => manager.id === pendingId) ?? null : null;
}

export function canPlaceSealedBid(draft, manager, amount) {
  const lot = draft.auction?.lot;
  if (!lot) return { ok: false, reason: "no card is on the block" };
  if (lot.pending[0] !== manager?.id) {
    const next = sealedBidder(draft);
    return { ok: false, reason: next ? `${next.name} bids next` : "all bids are in" };
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
export function placeSealedBid(draft, managerId, amount) {
  const manager = draft.managers.find((item) => item.id === managerId);
  if (!manager) throw new Error("Unknown manager");
  const legality = canPlaceSealedBid(draft, manager, amount);
  if (!legality.ok) {
    throw new Error(legality.reason);
  }
  const lot = draft.auction.lot;
  lot.bids[managerId] = Math.round(Number(amount));
  lot.pending.shift();
  if (lot.pending.length === 0) return resolveSealedLot(draft);
  return { sold: false, lot };
}

// Vickrey-style resolution: the high bid wins at the second-highest bid + 1.
// A tie for the top starts one sealed rebid round among the tied managers
// (minimum: the tied amount); a second tie is settled by a seeded coin flip
// at that price, so every replica of the draft agrees on the winner.
function resolveSealedLot(draft) {
  const lot = draft.auction.lot;
  const live = Object.entries(lot.bids).filter(([, amount]) => amount > 0);
  const top = live.reduce((best, [, amount]) => Math.max(best, amount), 0);
  const leaders = live.filter(([, amount]) => amount === top).map(([managerId]) => managerId);

  if (leaders.length > 1 && lot.round === 1) {
    lot.round = 2;
    lot.tie = { amount: top, managerIds: leaders };
    lot.pending = [...leaders];
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
  draft.auction.lot = null;
  draft.auction.nominatorIndex = nextNominatorIndex(draft, draft.auction.nominatorIndex);
  draft.complete = draft.managers.every((item) => item.roster.length >= draft.rosterSize);
  return { sold: true, manager: winner, player, price };
}

// Only an effectively untouched nomination can be canceled: instant computer
// bids don't count as touching it, a bid from another human does.
export function cancelLot(draft) {
  const lot = draft.auction?.lot;
  if (!lot) return null;
  const touched = Object.keys(lot.bids).some((managerId) => {
    if (managerId === lot.nominatorId) return false;
    const manager = draft.managers.find((item) => item.id === managerId);
    return Boolean(manager) && !manager.cpu;
  });
  if (touched) return null;
  draft.auction.lot = null;
  return lot;
}

export function upcomingNominators(draft, count) {
  if (!isAuctionDraft(draft) || draft.complete) return [];
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
    draft.auction.lot = null;
    return { canceledLot: true };
  }
  const entry = draft.auction.history.at(-1);
  if (!entry) return null;
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
  if (manager.lineupAssignments) {
    for (const [slot, playerId] of Object.entries(manager.lineupAssignments)) {
      if (playerId === player.id) delete manager.lineupAssignments[slot];
    }
  }
  return { manager, player };
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
      nominatePlayer(draft, action.playerId);
      return;
    case "seal-bid":
      placeSealedBid(draft, action.managerId, action.amount);
      return;
    case "cancel-lot":
      cancelLot(draft);
      return;
    case "autopick":
      autopick(draft);
      return;
    case "finish":
      while (!draft.complete) autopick(draft);
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

export function autopick(draft) {
  if (isAuctionDraft(draft)) return autoRunAuctionLot(draft);
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
      score: autopickScore(draft, manager, player, rosterNeeds, values.get(player.id), dropoffs.get(player.id))
    }))
    .sort((a, b) => b.score - a.score)[0].player;
}

// Nominates the current nominator's best autopick target and returns the lot.
export function nominateBestTarget(draft) {
  const nominator = currentManager(draft);
  nominatePlayer(draft, bestAutopickTarget(draft, nominator).id);
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
function autoRunAuctionLot(draft) {
  if (draft.complete) return draft;
  if (!draft.auction.lot) nominateBestTarget(draft);
  let guard = draft.managers.length * 4 + 8;
  while (draft.auction.lot && guard > 0) {
    guard -= 1;
    const next = sealedBidder(draft);
    placeSealedBid(draft, next.id, cpuSealedBid(draft, next));
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
  const model = managerValuation(draft, manager);
  const sameKind = availablePlayers(draft).filter((item) => item.kind === player.kind);
  const meanValue = sameKind.reduce((sum, item) => sum + model.value(item), 0) / Math.max(1, sameKind.length);
  const relativeValue = meanValue > 0 ? model.value(player) / meanValue : 1;
  const fairShare = auctionBudget(draft, manager) / Math.max(1, draft.rosterSize - manager.roster.length);
  const needPremium = managerNeedsPositionGroup(manager, player, getRosterNeeds(manager.roster)) ? 1.15 : 1;
  const raw = fairShare * relativeValue * needPremium;
  // Sealed bids are whole points, not raise steps — odd amounts make ties rare.
  return Math.max(AUCTION_MIN_BID, Math.min(maxBid, Math.round(raw)));
}

export function managerValuation(draft, manager) {
  const key = `${draft.seed ?? "showdown"}:valuation:${manager.id}`;
  let model = valuationModels.get(key);
  if (!model) {
    model = createValuationModel(key);
    valuationModels.set(key, model);
  }
  return model;
}

const valuationModels = new Map();

export function buildTeam(manager, options = {}) {
  const lineup = applyBattingOrder(
    assignLineupSlots(manager.roster, manager.lineupAssignments).slots
      .filter((slot) => slot.player)
      .map((slot) => lineupPlayer(slot)),
    manager.battingOrder
  );
  const starters = manager.roster.filter((player) => player.kind === "pitcher" && pitcherRole(player) === "SP");
  const bullpen = manager.roster.filter((player) => player.kind === "pitcher" && pitcherRole(player) === "RP");
  const starterIndex = starters.length ? Number(options.starterIndex ?? 0) % starters.length : 0;
  const activeStarter = starters[starterIndex];
  return {
    name: manager.name,
    lineup,
    starters,
    bullpen: bullpen.slice(0, BULLPEN_TARGET),
    starterIndex,
    pitchers: [activeStarter, ...bullpen.slice(0, BULLPEN_TARGET)].filter(Boolean)
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

export function validateRoster(manager) {
  const lineup = lineupStatus(manager.roster);
  const staff = staffStatus(manager.roster);
  const issues = [];
  if (lineup.hitters.length < HITTER_TARGET) issues.push(`needs ${HITTER_TARGET - lineup.hitters.length} more hitter${HITTER_TARGET - lineup.hitters.length === 1 ? "" : "s"}`);
  if (lineup.missingPositions.length) issues.push(`missing ${lineup.missingPositions.join("/")}`);
  if (lineup.extraDuplicates.length) issues.push(`too many ${lineup.extraDuplicates.join("/")} hitters`);
  if (staff.starters.length < STARTER_TARGET) issues.push(`needs ${STARTER_TARGET - staff.starters.length} more starter${STARTER_TARGET - staff.starters.length === 1 ? "" : "s"}`);
  if (staff.bullpen.length < BULLPEN_TARGET) issues.push(`needs ${BULLPEN_TARGET - staff.bullpen.length} more bullpen pitcher${BULLPEN_TARGET - staff.bullpen.length === 1 ? "" : "s"}`);
  return issues;
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
    .filter((slot) => slot.player && !positionMatchesSlot(slot.player.position, slot.label) && slot.label !== "DH")
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

  for (const label of EXACT_REQUIRED_POSITIONS) {
    assignFirst(slots, used, label, hitters.find((player) => player.position === label && !used.has(player.id)));
  }

  for (const label of CORNER_OUTFIELD_SLOTS) {
    assignFirst(slots, used, label, hitters.find((player) => isCornerOutfielder(player.position) && !used.has(player.id)));
  }

  const exactFirstBase = hitters.find((player) => player.position === "1B" && !used.has(player.id));
  const fallbackFirstBase = hitters.find((player) => !used.has(player.id));
  assignFirst(slots, used, "1B", exactFirstBase ?? fallbackFirstBase, { firstBaseOutOfPosition: !exactFirstBase && Boolean(fallbackFirstBase) });

  const dh = hitters.find((player) => !used.has(player.id));
  assignFirst(slots, used, "DH", dh);

  return {
    slots,
    extras: hitters.filter((player) => !used.has(player.id))
  };
}

export function canPlayerFillLineupSlot(player, label) {
  if (player?.kind !== "hitter") return false;
  if (label === "DH") return true;
  if (label === "1B") return true;
  return positionMatchesSlot(player.position, label);
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
      .filter((player) => !neededPosition || positionMatchesSlot(player.position, neededPosition))
      .filter((player) => neededKind !== "hitter" || canAddHitterToLineup(manager.roster, player).ok)
      .sort((a, b) => b.points - a.points)[0] ?? makeEmergencyReplacement(draft, manager, neededKind, neededRole, neededPosition);

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
      if (EXACT_REQUIRED_POSITIONS.includes(player.position)) positions[player.position] += 1;
      if (isCornerOutfielder(player.position)) cornerOutfield += 1;
    } else if (pitcherRole(player) === "SP") {
      starter += 1;
    } else {
      bullpen += 1;
    }
  }

  return { positions, cornerOutfield, hitters, starter, bullpen };
}

function makeEmergencyReplacement(draft, manager, neededKind, neededRole, neededPosition) {
  const index = draft.pool.length + 1;
  const teamName = manager.name.split(/[ /]+/)[0] || "Team";
  const replacement = neededKind === "pitcher"
    ? makeEmergencyPitcher(index, teamName, neededRole)
    : makeEmergencyHitter(index, teamName, neededPosition ?? "1B");
  draft.pool.push(replacement);
  return replacement;
}

function makeEmergencyHitter(index, teamName, position) {
  const cardPosition = CORNER_OUTFIELD_SLOTS.includes(position) ? CORNER_OUTFIELD_POSITION : position;
  return {
    id: `emergency-h-${index}`,
    kind: "hitter",
    name: `${teamName} Replacement ${cardPosition}`,
    position: cardPosition,
    bats: "R",
    onBase: 8,
    speed: 8,
    fielding: emergencyFielding(cardPosition),
    points: 180,
    chart: [
      { from: 1, to: 3, result: "SO" },
      { from: 4, to: 6, result: "GB" },
      { from: 7, to: 9, result: "FB" },
      { from: 10, to: 11, result: "BB" },
      { from: 12, to: 18, result: "1B" },
      { from: 19, to: 20, result: "2B" }
    ]
  };
}

function makeEmergencyPitcher(index, teamName, role) {
  return {
    id: `emergency-p-${index}`,
    kind: "pitcher",
    name: `${teamName} Replacement ${role === "SP" ? "Starter" : "Bullpen"}`,
    role: role === "SP" ? "SP" : "RP",
    throws: "R",
    control: 1,
    ip: role === "SP" ? 5 : 1,
    points: 120,
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

function emergencyFielding(position) {
  if (position === "C") return 4;
  if (position === "2B" || position === "SS") return 2;
  if (position === "3B" || position === "CF") return 1;
  return 0;
}

function autopickScore(draft, manager, player, needs, personalValue, dropoff) {
  const remainingSlots = draft.rosterSize - manager.roster.length;
  const matchingNeed = player.kind === "pitcher" ? pitcherNeed(player, needs) : needs.hitter;
  const forcedNeed = matchingNeed > 0 && matchingNeed >= remainingSlots;
  const needBonus = matchingNeed > 0 ? 80 + (matchingNeed / Math.max(1, remainingSlots)) * 120 : 0;
  const balanceBonus = player.kind === "pitcher" && pitcherNeed(player, needs) > 0 ? 35 : 0;
  const positionBonus = hitterPositionBonus(manager.roster, player);
  const scarcityBonus = positionScarcityBonus(manager, player, needs, dropoff);
  return personalValue + needBonus + balanceBonus + positionBonus + scarcityBonus + (forcedNeed ? 1000 : 0);
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
  if (isCornerOutfielder(player.position)) {
    return lineup.missingPositions.includes("LF") || lineup.missingPositions.includes("RF");
  }
  return lineup.missingPositions.includes(player.position);
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
  if (lineup.missingPositions.includes(player.position)) return 60;
  if (isCornerOutfielder(player.position) && (lineup.missingPositions.includes("LF") || lineup.missingPositions.includes("RF"))) return 60;
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
  slot.fielding = options.firstBaseOutOfPosition ? -1 : Number(player.fielding) || 0;
  used.add(player.id);
}

function slotOptions(player, label) {
  return {
    firstBaseOutOfPosition: label === "1B" && player?.position !== "1B"
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
