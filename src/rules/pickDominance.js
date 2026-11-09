// Picks that were already beaten on the board.
//
// Everything else on the post-draft screen asks what a card was WORTH, and
// every answer to that needs a model: a replacement baseline that was never on
// the board, a positional average that is an output of the draft rather than a
// choice anyone had, a re-simulated swap that only means something if the rest
// of the room would have drafted the same way afterwards. This asks a smaller
// question that needs no model at all.
//
// A pick is DOMINATED when a card at the same spot — still unsold when this one
// was taken — finished the season at least as good and cost no more. Every term
// in that sentence is recorded fact: who was still on the board is the pick
// order, what each one cost is the ledger, and how each turned out is the sim's
// own WPAR. Nothing is counterfactual, nothing depends on what another manager
// would have done with a card he never saw, and no pick is ever measured
// against anything but a card that was sitting right there when it was made.
//
// Three deliberate limits:
//
// - Same spot means the SLOT THE CARD FILLED, matched exactly. A better
//   shortstop who could also have played second is not counted against a second
//   baseman, so the flag under-reports rather than argues. It also means arms
//   are only ever read against arms in the same role, which is what keeps
//   pitching's inflated per-batter WPAR out of the comparison: both sides carry
//   the same inflation and it cancels in the difference. An SP is never allowed
//   to dominate an RP, whose inflation is a different size.
//
// - A card already on the manager's own roster is no alternative to a pick he
//   also made. Dominance is only ever claimed by somebody else's card, or by
//   one he could have had instead of this one.
//
// - It is hindsight. WPAR is what happened, so a dominated pick is not
//   necessarily a bad decision: the cheaper card may have been cheaper for
//   reasons that were good at the time. What the flag does say is that the
//   dollars or the turn bought nothing at that spot, which is worth knowing
//   whichever way the reasoning went.
import { isCoach } from "./coaches.js";

// A WPAR lookup that takes either a Map or a plain object, since the batch
// recap holds one and a filed record would hold the other.
function readValue(source, id) {
  if (!source) return null;
  const value = typeof source.get === "function" ? source.get(id) : source[id];
  return Number.isFinite(value) ? value : null;
}

// The picks this test can speak about: a real card, at a known slot, with a
// measured season behind it. A coach is not a position and has no substitute; a
// swept replacement was handed out rather than chosen, so neither counts as a
// pick nor as something that was available to take instead.
function eligibleEntries(picks, { wparById, slotOf, auction }) {
  const entries = [];
  for (const pick of picks ?? []) {
    const player = pick?.player;
    if (!player || isCoach(player) || player.replacement || player.minted) continue;
    const slot = slotOf?.(player) ?? null;
    if (!slot) continue;
    const wpar = readValue(wparById, player.id);
    if (wpar === null) continue;
    const price = Number.isFinite(pick.price) ? pick.price : null;
    // An auction pick with no price on it cannot be compared on money.
    if (auction && price === null) continue;
    entries.push({
      id: player.id,
      player,
      name: player.name,
      managerId: pick.manager?.id ?? null,
      managerName: pick.manager?.name ?? "",
      order: pick.pickNumber,
      round: pick.round,
      slot,
      wpar,
      price
    });
  }
  return entries;
}

// When each manager next had the board, keyed by the pick it follows. A snake
// alternative who was still unsold at that point is one the manager could have
// had WITHOUT giving this pick up at all — he could have spent this turn
// elsewhere and still taken him next time around. An auction has no turns to
// wait for, so it has no such map: there, waiting is measured in money.
function nextTurnByPick(entries) {
  const byManager = new Map();
  for (const entry of entries) {
    const list = byManager.get(entry.managerId) ?? [];
    list.push(entry);
    byManager.set(entry.managerId, list);
  }
  const next = new Map();
  for (const list of byManager.values()) {
    const ordered = [...list].sort((a, b) => a.order - b.order);
    for (let index = 0; index < ordered.length; index += 1) {
      const following = ordered[index + 1];
      if (following) next.set(ordered[index].order, following.order);
    }
  }
  return next;
}

// Was `other` an alternative to `entry` — on the board, at the same spot, at
// least as good, and no more expensive, with at least one of those strict?
//
// In a snake the currency is the turn, and being taken later IS being cheaper:
// the alternative cost a pick that came after this one, so the strictness is
// already satisfied by the availability test. In an auction the currency is
// money, and a card bought later for more is no bargain however good he was.
function dominates(other, entry, auction) {
  if (other.managerId === entry.managerId) return false;
  if (other.order <= entry.order) return false;
  if (other.wpar < entry.wpar) return false;
  if (!auction) return true;
  if (other.price > entry.price) return false;
  return other.wpar > entry.wpar || other.price < entry.price;
}

export function dominatedPicks(picks, options = {}) {
  const { wparById = null, slotOf = () => null, auction = false } = options;
  const entries = eligibleEntries(picks, { wparById, slotOf, auction });
  const bySlot = new Map();
  for (const entry of entries) {
    const list = bySlot.get(entry.slot) ?? [];
    list.push(entry);
    bySlot.set(entry.slot, list);
  }
  const nextTurn = auction ? null : nextTurnByPick(entries);

  const rows = [];
  for (const entry of entries) {
    const alternatives = (bySlot.get(entry.slot) ?? [])
      .filter((other) => dominates(other, entry, auction))
      .map((other) => ({
        ...other,
        gap: other.wpar - entry.wpar,
        saved: auction ? entry.price - other.price : null,
        waited: other.order - entry.order,
        // Snake only: he was still unsold when this manager's next turn came
        // round, so the pick did not have to be spent here at all.
        stillThereNextTurn: auction
          ? false
          : Number.isFinite(nextTurn?.get(entry.order)) && other.order > nextTurn.get(entry.order)
      }))
      // The headline alternative is the best card the pick passed on, and among
      // equals the one that would have cost the least.
      .sort((a, b) => b.gap - a.gap || (b.saved ?? 0) - (a.saved ?? 0) || a.order - b.order);
    if (!alternatives.length) continue;
    const best = alternatives[0];
    const cheapest = auction
      ? [...alternatives].sort((a, b) => b.saved - a.saved || b.gap - a.gap)[0]
      : null;
    rows.push({
      ...entry,
      alternatives,
      best,
      cheapest,
      gap: best.gap,
      saved: best.saved,
      waited: best.waited,
      stillThereNextTurn: alternatives.some((other) => other.stillThereNextTurn)
    });
  }
  rows.sort((a, b) => b.gap - a.gap || (b.saved ?? 0) - (a.saved ?? 0) || a.order - b.order);

  // One line per manager, every manager, so a clean sheet reads as a clean
  // sheet rather than as a missing row.
  const managers = new Map();
  for (const entry of entries) {
    const row = managers.get(entry.managerId) ?? {
      managerId: entry.managerId,
      name: entry.managerName,
      picks: 0,
      dominated: 0,
      wparLeftBehind: 0,
      savings: 0
    };
    row.picks += 1;
    managers.set(entry.managerId, row);
  }
  for (const row of rows) {
    const manager = managers.get(row.managerId);
    if (!manager) continue;
    manager.dominated += 1;
    manager.wparLeftBehind += row.gap;
    // What the pick could have saved is read off the alternative that saved the
    // most, not the best card: the two questions are asked separately.
    if (auction) manager.savings += Math.max(0, row.cheapest?.saved ?? 0);
  }

  return {
    auction,
    considered: entries.length,
    rows,
    byManager: [...managers.values()].sort((a, b) => b.dominated - a.dominated || b.wparLeftBehind - a.wparLeftBehind)
  };
}
