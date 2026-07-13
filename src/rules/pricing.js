import { chartSpan } from "./cards.js?v=20260713-n";
import { hitterPositions } from "./cards.js?v=20260713-n";

// ---- Authentic-scale pricing -------------------------------------------------
//
// The classic 2000-2005 Showdown sets printed points on an absolute scale: a
// card's price follows from its mechanics, not from who else is in the box.
// The MLB pools price on that same scale so a Control 5 / IP 5 starter costs
// Wakefield money in every league, whether the pool is one franchise or all
// of history. The weights live in src/data/priceModel.js, fit by least
// squares against the 3,544 classic cards (scripts/fit-price-model.mjs);
// this module owns the feature definitions so the fit and the runtime can
// never disagree about what a feature means.

// Slots each result occupies on the d20 face of a chart ("21+" rows never
// land and count zero).
export function chartSlots(card) {
  const slots = {};
  for (const entry of card.chart) {
    const span = chartSpan(entry);
    if (!span) continue;
    slots[entry.result] = (slots[entry.result] ?? 0) + span;
  }
  return slots;
}

export function priceGroup(card) {
  return card.kind === "hitter" ? "hitter" : card.role === "RP" ? "RP" : "SP";
}

export function priceFeatures(card) {
  const s = chartSlots(card);
  if (card.kind === "hitter") {
    const positions = hitterPositions(card);
    // The fitted model was trained back when the decoder played a printed
    // 1B+ as a double (the engine had no auto-advance single yet) — keep
    // pricing it that way so the trained weights still apply without a
    // refit, even though it now resolves as a single in play.
    const bb = s.BB ?? 0, single = s["1B"] ?? 0, double = (s["2B"] ?? 0) + (s["1B+"] ?? 0), triple = s["3B"] ?? 0, hr = s.HR ?? 0;
    // The engine's advantage math says a batter's production scales with
    // BOTH his on-base (how often his chart is live) and his chart's total
    // bases (what it pays when it is) — so the workhorse feature is the
    // product, not either alone.
    const totalBases = single + 2 * double + 3 * triple + 4 * hr;
    // Printed points grow convexly with how good a card is, not linearly —
    // the sets charged a superstar premium. It rides two smooth power bases:
    // expected production (on-base × the chart's reach-base slots — how
    // often the chart is live times how often it pays) as a cubic whose
    // fitted negative cube saturates near the Bonds '03 extreme, and
    // on-base itself as a cube, because the sets priced the on-base axis
    // steeper than production alone explains (Edgar '95 printed 660 while
    // equal-production Helton '05 printed 500, one OB apart).
    const reach = bb + single + double + triple + hr;
    const production = (card.onBase * reach) / 20;
    return {
      onBase: card.onBase,
      onBaseSq: card.onBase * card.onBase,
      obCube: card.onBase * card.onBase * card.onBase,
      prodSq: production * production,
      prodCube: production * production * production,
      obTotalBases: card.onBase * totalBases,
      obWalks: card.onBase * bb,
      speed: card.speed,
      fielding: positions[0].fielding,
      extraPositions: positions.length - 1,
      so: s.SO ?? 0,
      bb,
      single,
      double,
      triple,
      hr
    };
  }
  const outs = (s.PU ?? 0) + (s.SO ?? 0) + (s.GB ?? 0) + (s.FB ?? 0);
  // Pitcher production mirrors the hitter feature: control (how often the
  // pitcher's chart is the one rolled) times its out slots (what the chart
  // pays when it is). Convex powers and the stamina interaction let ace
  // value grow superlinearly the way the printed sets charged for it.
  const quality = (card.control * outs) / 20;
  return {
    control: card.control,
    controlSq: card.control * card.control,
    ip: card.ip,
    // An out-heavy chart is worth more the longer the arm stays in, and
    // control decides how often that chart is the one rolled.
    ctrlIp: card.control * card.ip,
    ctrlOuts: card.control * outs,
    qualitySq: quality * quality,
    qualityCube: quality * quality * quality,
    qualityIp: quality * card.ip,
    so: s.SO ?? 0,
    pu: s.PU ?? 0,
    bb: s.BB ?? 0,
    single: s["1B"] ?? 0,
    extraBase: (s["2B"] ?? 0) + (s["3B"] ?? 0),
    hr: s.HR ?? 0
  };
}

// truePoints on the authentic printed scale. Clamped to the plausible print
// range so an extrapolated outlier (an OB 16 all-time chart the classic set
// never printed) can't run away.
export function authenticPoints(card, model) {
  const group = model[priceGroup(card)];
  const features = priceFeatures(card);
  let total = group.intercept;
  for (const [key, weight] of Object.entries(group.weights)) {
    total += weight * (features[key] ?? 0);
  }
  return Math.max(30, Math.min(1000, Math.round(total)));
}
