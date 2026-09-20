// A finished draft, written down.
//
// The visit log records that somebody dealt a draft; this records what they
// came out with. One record per finished draft — the settings it was played
// under, every manager's roster in the order it was filled, and what each card
// cost — small enough to keep hundreds of, and complete enough that a draft can
// be read months later without the room file it came from.
//
// It is built here rather than on either side of the wire because both sides
// hold the same draft object: a browser files its own local draft, and the room
// server files an online one off the draft it replays. One shape, one builder,
// so the two cannot drift.
import { auctionBudget, draftHistory, isAuctionDraft } from "./draft.js";
import { positionsLabel } from "./cards.js";
import { deckEntry } from "../data/universes.js";

// Roster entries are trimmed to what a reader wants at a glance. The card id
// rides along so a curious record can still be traced back to the card.
function cardEntry(player, pick) {
  return {
    id: player.id,
    name: player.name,
    pos: positionsLabel(player),
    kind: player.kind,
    pts: Number(player.points) || 0,
    ...(pick ? { pick: pick.pickNumber, round: pick.round } : {}),
    ...(pick && Number.isFinite(pick.price) ? { price: pick.price } : {}),
    ...(player.replacement ? { replacement: true } : {})
  };
}

// Every lot, in the order it was called, with the bids that settled it.
//
// A snake draft is recreated from its picks alone, because a pick is the whole
// move. An auction is not: the price on a card is the SECOND-highest bid plus
// one, so a record that keeps only what a card sold for has thrown away the
// thing that decided it. This keeps the bidding — every manager's sealed
// amount, the nominator, and whether the lot passed or was swept — so the
// night can be played back move for move rather than guessed at.
//
// A lot that went to a rebid keeps each manager's LAST bid, which is what the
// lot resolved on: a rebid's minimum is the tied amount, so no bid from the
// first round can outrank it afterwards, and replaying the final map in one
// round settles exactly as the night did.
function auctionLog(draft) {
  return (draft.auction?.history ?? []).map((entry) => ({
    playerId: entry.playerId,
    managerId: entry.managerId ?? null,
    price: Number(entry.price) || 0,
    bids: { ...(entry.bids ?? {}) },
    nominatorId: entry.nominatorId ?? null,
    ...(entry.passed ? { passed: true } : {}),
    ...(entry.swept ? { swept: true } : {})
  }));
}

export function draftRecord(draft, meta = {}) {
  const auction = isAuctionDraft(draft);
  // Where each card landed, keyed by card: the roster keeps the order a manager
  // filled his team in, and this says what the room paid and when.
  const picks = new Map();
  for (const pick of draftHistory(draft)) {
    if (pick.player && !picks.has(pick.player.id)) picks.set(pick.player.id, pick);
  }
  return {
    at: new Date().toISOString(),
    seed: draft.seed,
    draftType: draft.draftType,
    nomination: draft.nomination ?? null,
    rosterSize: draft.rosterSize,
    startingPitchers: draft.startingPitchers,
    bullpenSlots: draft.bullpenSlots ?? null,
    bullpenMin: draft.bullpenMin ?? null,
    hidePoints: Boolean(draft.hidePoints),
    coaches: Boolean(draft.coaches),
    budget: auction ? draft.auction?.budget ?? null : null,
    picks: draft.pickNumber,
    complete: Boolean(draft.complete),
    // The board as it was dealt, card by card, in the order it was dealt. A
    // deal is code, and code changes; a room that wrote its deck down can be
    // rebuilt years later, and one that only wrote down its seed can only be
    // re-dealt by whatever the dealer has become since.
    deck: draft.pool.map(deckEntry),
    ...(auction ? { auction: { budget: draft.auction?.budget ?? null, log: auctionLog(draft) } } : {}),
    ...meta,
    managers: draft.managers.map((manager) => {
      const roster = manager.roster.map((player) => cardEntry(player, picks.get(player.id)));
      return {
        id: manager.id,
        name: manager.name,
        cpu: Boolean(manager.cpu),
        persona: manager.persona ?? null,
        points: roster.reduce((sum, card) => sum + card.pts, 0),
        ...(auction
          ? {
              spent: roster.reduce((sum, card) => sum + (card.price ?? 0), 0),
              left: auctionBudget(draft, manager)
            }
          : {}),
        roster
      };
    })
  };
}
