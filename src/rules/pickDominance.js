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
//
// WORKLOAD. WPAR is a counting stat, and for an arm the count is set by the
// staff around him rather than by his card: the engine rides whoever is best in
// the pen, and a starter in front of a thin rotation takes the ball far more
// often. Measured over four rooms, 45-91% of the gaps between arms came mostly
// from workload, and in 16-57% of them the card doing the "beating" was WORSE
// per batter faced — one 7.09-ERA starter outranked a 2.23 ERA purely by facing
// 2.5x as many hitters. Comparing the totals is therefore comparing two
// different jobs.
//
// So an alternative has to clear the pick on BOTH counts: the season total AND
// a QUALITY test that holds the job fixed. Beating one without the other is not
// a swap. A workhorse keeps his credit, because an arm who threw far fewer
// innings cannot dominate him on a shiny rate alone; and a bulk arm loses his,
// because facing more hitters while being worse at facing them is the staff's
// doing, not the card's.
//
// The quality test is supplied by the caller (`equalWorkGap`), already scaled to
// the pick's own job, because the fair way to hold that job fixed differs by
// kind — and, for a bat, differs between the parts of his own line.
//
// A bat's work is not one number, and the parts run on different clocks.
//
// His BAT and his LEGS both scale with plate appearances. The legs look like
// they should be read per time on base instead, but that denominator is the
// man's own doing: he has to reach to be a candidate at all, so dividing by it
// hands back the on-base skill the hitting term just measured and flattens a
// fast man who reaches often into a fast man who never does. The job gives out
// trips to the plate; what he makes of them is his.
//
// His GLOVE runs on neither. A leadoff man and a number nine hitter field the
// same innings, so defense is read per fielding CHANCE and a difference in
// lineup slot never touches it. That denominator is safe where run chances are
// not, because a chance is counted whenever an advance is possible rather than
// when one is attempted (see attributeOpportunity), so it is driven by his
// pitchers and the other side's offense and not by how well he plays them. A
// fielder cannot shrink his own denominator by being good — the deterred runner
// still counts, with the credit falling out of the swap re-making the go
// decision.
//
// Each part is therefore scored over the pick's own count of that part.
//
// For an arm the as-pitched rate is itself bent by the workload — fatigue sits
// on a pitcher's control, and it costs the heavily-worked arms about 12% of
// their rate while costing the lightly-worked ones nothing — so judging arms on
// that alone would dock the very workhorse the season total is meant to credit.
// An arm has to clear the pick BOTH as pitched and before either of them tired,
// and the figure reported is the stingier of the two readings, so the number
// never claims more than the meaner measurement supports.
//
// Whatever the caller returns IS the gap, which means the headline number and
// the gate can never disagree: a row survives only on a non-negative gap.
//
// Volume is not all context, and the conjunction is what preserves the part
// that isn't. Measured over a classic room, depth per appearance is nearly flat
// across a rotation (27-34 batters a start, printed IP correlating with workload
// at only 0.32) while APPEARANCES run 41-93 for starters and 49-162 for
// relievers. So a better IP rating is worth a little more work per outing, which
// the totals still reward, and the 5-10x spread on top of it is the auto-manager
// riding whoever his staff left him, which the rate test refuses to pay for.
//
// The gap is then reported as a range rather than a number, because the two
// readings bracket it:
//
//   gap      = (rate left - rate taken) x the pick's own workload
//   rawGap   = the plain difference in season totals
//
// The first is the floor — what the other card was worth over the work that was
// actually there at that roster spot. The second is the ceiling, and the part
// between them (`fromVolume`) is work the pick was never offered. Both are
// positive for every row that survives the test, since it had to clear both
// counts to get here.
//
// Bats barely move under any of this (0-8% of their flags turn over). It is the
// arms the correction is for.
import { isCoach } from "./coaches.js";

// So an arm has to clear the pick on BOTH readings — as he actually pitched, and
// over the work each of them took before tiring — and the edge reported is the
// stingier of the two. Measured over three rooms the second leg is cheap
// insurance: it removes a handful of flags where a lightly-used arm had beaten a
// workhorse only because the workhorse's rate was dragged down by innings he
// never chose, and it adds none.
//
// Both readings are MEASURED. Scoring the two cards against each other over the
// pick's fatigue profile with the engine's own runsPerPa was tried and rejected:
// for starters it collapses into a plain card comparison (they are 85-99% fresh,
// so almost the whole profile sits on rung zero), it leaves only about five arms
// standing in a room, and it turns the panel's claim from recorded fact into the
// valuation model's opinion. The profile itself is still recorded, and
// `fatigueRunsSaved` below reads it for the hover line, where a modelled number
// can inform without gating anything.
export function buildEqualWorkGap(summary) {
  const per162 = (total, teamGames) => (teamGames > 0 ? (total / teamGames) * 162 : null);

  // The bat and the legs are paid out in trips to the plate; the glove is paid
  // out in fielding chances. Reading all three per plate appearance would
  // quietly charge a number nine hitter's glove for his lineup slot, and
  // reading the legs per time on base would quietly refund his on-base skill.
  const batParts = new Map();
  for (const line of summary.hitters ?? []) {
    if (line?.id == null) continue;
    const war = line.warPer162;
    // A sim that recorded no per-chance inputs cannot have its parts separated,
    // and guessing zero for the legs and the glove would quietly compare two
    // bats on their hitting alone. Those rooms fall through to the flat reading.
    if (!war || !line.warInputs) continue;
    const pa = Number.isFinite(line.paPer162) ? line.paPer162 : per162(line.pa, line.teamGames);
    const fields = line.warInputs?.fieldChancesPer162;
    batParts.set(line.id, {
      // The bat and the legs share the plate-appearance clock.
      offense: pa > 0 ? ((war.hitting ?? 0) + (war.baserunning ?? 0)) / pa : 0,
      def: fields > 0 ? (war.defense ?? 0) / fields : 0,
      pa: pa > 0 ? pa : 0,
      fields: fields > 0 ? fields : 0
    });
  }

  const freshRate = new Map();
  for (const line of summary.pitchers ?? []) {
    if (line?.id == null) continue;
    const war = line.fresh?.warPer162?.total;
    const bf = per162(line.fresh?.bf ?? 0, line.teamGames);
    if (Number.isFinite(war) && bf > 0) freshRate.set(line.id, war / bf);
  }

  return (other, entry) => {
    const mineBat = batParts.get(entry.id);
    const theirsBat = batParts.get(other.id);
    if (mineBat && theirsBat) {
      // Each part of the other card's line, replayed over the pick's own count
      // of that part. Defense rides on fielding chances, so two men who played
      // the same innings compare their gloves straight across.
      return (theirsBat.offense - mineBat.offense) * mineBat.pa
        + (theirsBat.def - mineBat.def) * mineBat.fields;
    }
    const asPitched = (other.rate - entry.rate) * entry.volume;
    const mine = freshRate.get(entry.id);
    const theirs = freshRate.get(other.id);
    // A room simmed before the split was recorded has nothing to read, so it
    // falls back to the one reading.
    if (!Number.isFinite(mine) || !Number.isFinite(theirs)) return asPitched;
    return Math.min(asPitched, (theirs - mine) * entry.volume);
  };
}

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
function eligibleEntries(picks, { wparById, volumeById, slotOf, auction }) {
  const entries = [];
  for (const pick of picks ?? []) {
    const player = pick?.player;
    if (!player || isCoach(player) || player.replacement || player.minted) continue;
    const slot = slotOf?.(player) ?? null;
    if (!slot) continue;
    const wpar = readValue(wparById, player.id);
    if (wpar === null) continue;
    // How much work the card was given, in the units its WPAR was summed over.
    // A sim that never recorded it leaves every card on 1, which collapses the
    // correction to the raw difference and is what rooms simmed before this
    // existed fall back to.
    const volume = volumeById === null ? 1 : readValue(volumeById, player.id);
    if (volume === null || !(volume > 0)) continue;
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
      volume,
      // What he was worth per unit of work, which is the part of his line that
      // belongs to the card rather than to the staff around him.
      rate: wpar / volume,
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
// least as good BOTH on the season and per unit of work, and no more expensive,
// with at least one of those strict?
//
// Requiring both is what makes this a swap rather than an argument. An arm who
// piled up WPAR only because his own staff handed him twice the batters fails
// the rate test; an arm with a pretty rate over a handful of innings fails the
// total. Only a card that was better at the job AND did more of it survives.
//
// In a snake the currency is the turn, and being taken later IS being cheaper:
// the alternative cost a pick that came after this one, so the strictness is
// already satisfied by the availability test. In an auction the currency is
// money, and a card bought later for more is no bargain however good he was.
function dominates(other, entry, auction, equalWorkGap) {
  if (other.managerId === entry.managerId) return false;
  if (other.order <= entry.order) return false;
  if (other.wpar < entry.wpar) return false;
  const gap = equalWorkGap(other, entry);
  if (!(gap >= 0)) return false;
  if (!auction) return true;
  if (other.price > entry.price) return false;
  return other.wpar > entry.wpar || gap > 0 || other.price < entry.price;
}

export function dominatedPicks(picks, options = {}) {
  const {
    wparById = null,
    volumeById = null,
    slotOf = () => null,
    auction = false,
    // How much better `other` was over the pick's OWN job, in the same units as
    // the season totals. Without one, quality is value per unit of work scaled
    // back up over the pick's work.
    equalWorkGap = (other, entry) => (other.rate - entry.rate) * entry.volume
  } = options;
  const entries = eligibleEntries(picks, { wparById, volumeById, slotOf, auction });
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
      .filter((other) => dominates(other, entry, auction, equalWorkGap))
      .map((other) => ({
        ...other,
        // Both cards at the pick's own workload. `fromVolume` is the rest of the
        // raw difference — the work the other card's team gave him and this one's
        // did not — kept so the split can be shown rather than silently dropped.
        // The two always add back to the raw difference in totals.
        gap: equalWorkGap(other, entry),
        fromVolume: (other.wpar - entry.wpar) - equalWorkGap(other, entry),
        rawGap: other.wpar - entry.wpar,
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
      fromVolume: best.fromVolume,
      rawGap: best.rawGap,
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
