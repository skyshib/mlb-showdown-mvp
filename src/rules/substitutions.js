import { chartRunValue, runsPerPa } from "./pitching.js?v=20260716-records";
import { fieldingAt, playsPosition, hitterPositions } from "./cards.js?v=20260716-records";
import { minCostAssignment } from "./draft.js?v=20260716-records";

// When to go to the bench.
//
// The same shape as the pitching hook (see pitching.js): every decision is a
// COMPARISON priced in runs, not a threshold about innings or feelings. A
// pinch-hitter is worth the runs his bat adds over the man due up, minus the
// runs his glove gives back over the innings still to field; a pinch-runner
// is worth the sends his legs flip from out to safe; a defensive replacement
// is a glove bought with a bat. Leverage lowers the bar — the same trade is
// worth more when the game hangs on it — and every function here is a pure,
// rng-free read of its inputs, so a replayed game makes the identical calls.

// The bench opens in the seventh. Before that the nine you wrote down are the
// nine you play — the gate is what keeps the adventure's bench discount (a
// fifth of sticker) from buying a shadow starting lineup that walks on in the
// first. Lives here so the engine and the decisions read one number.
export const SUB_MIN_INNING = 7;

// The glove a card brings to a slot: his printed rating where the card plays
// the spot (corners lump, as everywhere), the literal -1 any glove takes at
// an unprinted first base. Anywhere else, outOfPosition means ILLEGAL — a
// defense fielding a man where his card never put him forfeits the game
// (see coverageAssignment and game.realignDefense). The DH slot rates nothing.
export function benchSlotFielding(card, label) {
  if (label === "DH") return { value: Number(card.fielding) || 0, outOfPosition: false };
  if (label === "LF" || label === "RF" || label === "LF/RF") {
    const corner = hitterPositions(card).find((entry) => entry.pos === "LF/RF" || entry.pos === "LF" || entry.pos === "RF");
    if (corner) return { value: Number(corner.fielding) || 0, outOfPosition: false };
    return { value: -1, outOfPosition: true };
  }
  const printed = fieldingAt(card, label);
  if (printed !== null) return { value: printed, outOfPosition: false };
  if (playsPosition(card, label)) return { value: Number(card.fielding) || 0, outOfPosition: false };
  return { value: -1, outOfPosition: true };
}

// What a bat is worth against THIS arm as he is right now, in runs per plate
// appearance — the batter's-side reading of the same control-roll contest
// runsPerPa prices for the mound (higher is better here).
export function batterRunsPerPa(batter, pitcher, fatiguePenalty = 0) {
  return runsPerPa(pitcher, fatiguePenalty, {
    onBase: Number(batter?.onBase) || 0,
    runValue: chartRunValue(batter?.chart)
  });
}

// What one point of glove is worth per inning fielded, in runs. A fielding
// point moves the steal, tag-up, and extra-base checks about one face in
// twenty, a few times an inning — small, real, and the price a pinch-hitter
// pays for the rest of the game.
const GLOVE_RUNS_PER_INNING = 0.06;

// The trigger bar for a pinch-hitter, in runs per plate appearance at average
// leverage: about what separates adjacent spots in a decent order. Leverage
// divides it — at leverage 3 a modest upgrade fires.
const PH_MARGIN = 0.045;

// Below this leverage the moment is not worth a man: the bench keeps for a
// spot that matters (the ninth spends freely regardless — see the decision).
const PH_LEVERAGE_FLOOR = 0.7;

const slotOf = (player) => player?.assignedPosition ?? player?.defensivePosition ?? player?.position;

// Deterministic tie-break: the replay must make the same call every time.
const byId = (a, b) => String(a.id).localeCompare(String(b.id));

// Send up a bench bat for the man due? bench is the AVAILABLE bench;
// inningsLeftToField is how many innings this side still takes the field.
// bias multiplies the bar (an aggressive skipper's is lower). Returns
// { sub, gain } or null.
export function pinchHitDecision({ bench, dueBatter, pitcher, fatigue = 0, leverage = 1, inning = 1, inningsLeftToField = 0, bias = 1 }) {
  if (!bench?.length || !dueBatter || dueBatter.kind === "pitcher") return null;
  const spendFreely = inning >= 9;
  if (!spendFreely && leverage < PH_LEVERAGE_FLOOR) return null;
  const label = slotOf(dueBatter);
  const dueValue = batterRunsPerPa(dueBatter, pitcher, fatigue);
  const dueGlove = Number(dueBatter.fielding) || 0;
  let best = null;
  for (const card of [...bench].sort(byId)) {
    const batGain = batterRunsPerPa(card, pitcher, fatigue) - dueValue;
    // The glove he gives back, over the innings this side still has to field.
    const gloveDrop = label === "DH" ? 0 : dueGlove - benchSlotFielding(card, label).value;
    const gain = batGain - Math.max(0, gloveDrop) * GLOVE_RUNS_PER_INNING * inningsLeftToField;
    if (!best || gain > best.gain) best = { sub: card, gain };
  }
  if (!best) return null;
  let bar = (PH_MARGIN * bias) / Math.max(1, leverage);
  // The LAST bench bat is the whole rest of the bench: before the ninth he
  // needs to be twice the upgrade, or he keeps his seat.
  if (bench.length === 1 && !spendFreely) bar *= 2;
  return best.gain >= bar ? best : null;
}

// Fresh legs for a slow man whose run matters? diff is the batting team's
// score edge. Returns { sub, baseIndex } or null.
const PR_LEVERAGE_FLOOR = 1.5;
const PR_SLOW = 12;
const PR_SPEED_GAIN = 5;

export function pinchRunDecision({ bases, bench, diff = 0, leverage = 1, inning = 1, bias = 1, canCover = null }) {
  if (!bench?.length) return null;
  if (leverage < PR_LEVERAGE_FLOOR * bias) return null;
  // The run has to MATTER: the tying or go-ahead run late, or thin insurance.
  if (diff < -2 || diff > 1) return null;
  // Legs are bought with a bat: before the ninth, keep at least one in reserve.
  if (inning < 9 && bench.length < 2) return null;
  // Lead-most first — the man closest to scoring is the run being bought.
  for (const baseIndex of [1, 0]) {
    const runner = bases?.[baseIndex];
    if (!runner || (Number(runner.speed) || 0) > PR_SLOW) continue;
    // The cheapest bat that clears the speed bar — and never a man whose
    // entry would strand the defense (canCover is the caller's coverage
    // check; the CPU never buys legs at the price of a forfeit).
    const fits = bench
      .filter((card) => (Number(card.speed) || 0) >= (Number(runner.speed) || 0) + PR_SPEED_GAIN)
      .filter((card) => !canCover || canCover(card, runner.id))
      .sort((a, b) => (Number(a.points) || 0) - (Number(b.points) || 0) || byId(a, b));
    if (fits.length) return { sub: fits[0], baseIndex };
  }
  return null;
}

// A better glove to protect a lead? lineup is the nine on the field; lead is
// this side's score edge (only 1-3 qualifies — a blowout needs no protecting,
// a deficit needs bats). Returns { sub, targetId, gloveGain } or null.
const DS_MIN_INNING = 8;
const DS_GLOVE_GAIN = 2;
const DS_BAT_DROP_CAP = 0.06;

// A bat's rough worth against a league-average arm, for pricing what a glove
// man costs the order: his chart, plus what his on-base buys him — each point
// of on-base moves about one face of the die from an average pitcher's chart
// (slightly negative) to his own.
export function roughBatValue(card) {
  return chartRunValue(card?.chart) + ((Number(card?.onBase) || 0) * 0.025);
}

export function defensiveSubDecision({ lineup, bench, lead = 0, inning = 1, bias = 1, canCover = null }) {
  if (!bench?.length || !lineup?.length) return null;
  if (inning < DS_MIN_INNING) return null;
  if (lead < 1 || lead > 3) return null;
  let best = null;
  for (const man of [...lineup].sort(byId)) {
    const label = slotOf(man);
    if (label === "DH") continue; // no glove there to upgrade
    const manGlove = Number(man.fielding) || 0;
    for (const card of [...bench].sort(byId)) {
      const glove = benchSlotFielding(card, label);
      if (glove.outOfPosition) continue;
      if (canCover && !canCover(card, man.id)) continue;
      const gloveGain = glove.value - manGlove;
      const batDrop = roughBatValue(man) - roughBatValue(card);
      const qualifies = gloveGain >= Math.ceil(DS_GLOVE_GAIN * bias) && batDrop <= DS_BAT_DROP_CAP
        ? true
        : gloveGain >= Math.ceil((DS_GLOVE_GAIN + 1) * bias);
      if (!qualifies) continue;
      if (!best || gloveGain > best.gloveGain || (gloveGain === best.gloveGain && batDrop < best.batDrop)) {
        best = { sub: card, targetId: man.id, gloveGain, batDrop };
      }
    }
  }
  return best;
}

// ---- Defensive coverage ------------------------------------------------------
//
// A defense is legal when all eight field positions are covered by men whose
// cards play them — first base excepted (any glove, at the literal -1) — with
// whoever is left over batting as the DH. That is a matching problem, and the
// same Kuhn-Munkres that seats the pre-game lineup answers it here: CAN these
// men cover the field, and if so, where does each glove go for the most
// leather. A nine that cannot cover the field does not take it: the engine
// completes the double-switch off the bench if it can, and forfeits if it
// cannot.

const FIELD_LABELS = ["C", "1B", "2B", "3B", "SS", "LF", "RF", "CF"];

export function defenseEligible(card, label) {
  // A pitcher standing in the batting order (see game.pitcherAtThePlate, after
  // a club has killed its own DH) covers exactly one thing: the mound. He must
  // never be matched into the eight, not even at first base, where any GLOVE
  // is allowed but no arm is.
  if (card?.kind === "pitcher") return label === "P";
  if (label === "DH" || label === "1B") return true;
  return !benchSlotFielding(card, label).outOfPosition;
}

const INELIGIBLE = 1e9;

// The best legal seating of `players` (nine on the field, or lineup-plus-bench
// when asking whether a double-switch could cover) into the eight positions:
// a Map of label -> player maximizing total fielding, or null when no legal
// coverage exists. Players left unmatched are the DH (and, in the pooled
// call, the men who stay on the bench).
export function coverageAssignment(players) {
  const bodies = (players ?? []).filter(Boolean);
  if (bodies.length < FIELD_LABELS.length) return null;
  const cost = FIELD_LABELS.map((label) => bodies.map((player) =>
    defenseEligible(player, label)
      ? 100 - benchSlotFielding(player, label).value
      : INELIGIBLE));
  const rowToCol = minCostAssignment(cost);
  const assignment = new Map();
  for (let row = 0; row < FIELD_LABELS.length; row += 1) {
    const player = bodies[rowToCol[row]];
    if (!player || !defenseEligible(player, FIELD_LABELS[row])) return null;
    assignment.set(FIELD_LABELS[row], player);
  }
  return assignment;
}

// Could this club still put a legal defense on the field, counting the bench
// men who could come on to cover? The question every substitution is asked
// before it is allowed to strand the club.
export function canCoverField(lineup, bench = []) {
  return coverageAssignment([...(lineup ?? []), ...(bench ?? [])]) !== null;
}

// Is the defense standing legally as assigned right now? Substitutions keep
// the label multiset intact (a sub inherits the outgoing man's slot), so the
// only thing that can break is a man at a label his card does not play.
export function alignmentLegal(lineup) {
  return (lineup ?? []).every((player) => {
    const label = player.assignedPosition ?? player.defensivePosition ?? player.position;
    return label === "DH" || defenseEligible(player, label);
  });
}
