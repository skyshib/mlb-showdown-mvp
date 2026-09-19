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
