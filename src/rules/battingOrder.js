import { normalizeResult, RESULTS } from "./cards.js";

// Batting order follows the broad strokes of Tango/Lichtman/Dolphin's "The
// Book": the three best hitters take the 1, 2 and 4 slots (cleanup goes to
// the biggest slugger of the trio, so the best pure hitter usually bats
// second), the next two best take 5 and 3 — The Book's signature finding is
// that the third slot is the least valuable of the top five — and the rest
// fill 6-9 in descending quality with a small nudge toward speed, since
// runners ahead of the bottom of the order steal their way into scoring
// position in this engine.
//
// Hitters are compared by expected rates against a baseline league-average
// pitcher. Only the differences between teammates matter, so the baseline
// constants just need to be plausible, not exact.
const BASELINE_CONTROL = 4.5;
const BASELINE_PITCHER_CHART = {
  onBase: 0.21, // on-base share of a typical pitcher chart
  extraBases: 0.05, // extra bases per plate appearance off a pitcher chart
  wobaValue: 0.19 // linear-weight run value per plate appearance
};

// Standard linear weights (wOBA-style, also from Tango) per chart result.
const WOBA_WEIGHTS = {
  [RESULTS.BB]: 0.69,
  [RESULTS.SINGLE]: 0.89,
  [RESULTS.DOUBLE]: 1.27,
  [RESULTS.TRIPLE]: 1.62,
  [RESULTS.HR]: 2.1
};

const EXTRA_BASE_WEIGHTS = {
  [RESULTS.DOUBLE]: 1,
  [RESULTS.TRIPLE]: 2,
  [RESULTS.HR]: 3
};

const ON_BASE_RESULTS = new Set([RESULTS.BB, RESULTS.SINGLE, RESULTS.DOUBLE, RESULTS.TRIPLE, RESULTS.HR]);

// Expected per-plate-appearance rates for a hitter card against the baseline
// pitcher: how often he reaches base, how many extra bases he collects, and
// an overall linear-weight quality score.
export function hitterRates(player) {
  const shares = chartShares(player.chart);
  // The hitter's chart is used when d20 + control <= onBase. Using the
  // fractional count keeps the estimate smooth across card tiers.
  const hitterChartChance = clamp((Number(player.onBase) || 0) - BASELINE_CONTROL, 0, 20) / 20;
  const pitcherChartChance = 1 - hitterChartChance;
  return {
    onBase: hitterChartChance * shares.onBase + pitcherChartChance * BASELINE_PITCHER_CHART.onBase,
    extraBases: hitterChartChance * shares.extraBases + pitcherChartChance * BASELINE_PITCHER_CHART.extraBases,
    quality: hitterChartChance * shares.wobaValue + pitcherChartChance * BASELINE_PITCHER_CHART.wobaValue
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function chartShares(chart) {
  let onBase = 0;
  let extraBases = 0;
  let wobaValue = 0;
  let faces = 0;
  for (const entry of chart ?? []) {
    const count = entry.to - entry.from + 1;
    const result = normalizeResult(entry.result);
    faces += count;
    if (ON_BASE_RESULTS.has(result)) onBase += count;
    extraBases += count * (EXTRA_BASE_WEIGHTS[result] ?? 0);
    wobaValue += count * (WOBA_WEIGHTS[result] ?? 0);
  }
  if (!faces) return { onBase: 0, extraBases: 0, wobaValue: 0 };
  return { onBase: onBase / faces, extraBases: extraBases / faces, wobaValue: wobaValue / faces };
}

// Speed only nudges the 6-9 sort between hitters of similar quality; a
// max-speed burner gains about one slot's worth of value, no more.
const TAIL_SPEED_NUDGE = 0.002;

export function orderBattingLineup(players) {
  const rated = players.map((player) => ({ player, rates: hitterRates(player) }));
  const ranked = [...rated].sort((a, b) => b.rates.quality - a.rates.quality);
  if (ranked.length < 5) return ranked.map((item) => item.player);

  const topThree = ranked.slice(0, 3);
  const cleanup = topThree.reduce((best, item) => (item.rates.extraBases > best.rates.extraBases ? item : best));
  const [second, first] = topThree.filter((item) => item !== cleanup);
  const [fifth, third] = ranked.slice(3, 5);
  const tail = ranked
    .slice(5)
    .sort((a, b) => tailValue(b) - tailValue(a));

  return [first, second, third, cleanup, fifth, ...tail].map((item) => item.player);
}

function tailValue(item) {
  return item.rates.quality + (Number(item.player.speed) || 0) * TAIL_SPEED_NUDGE;
}
