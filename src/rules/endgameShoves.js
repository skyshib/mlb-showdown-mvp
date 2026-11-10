// The picks a worst-value board has no business judging.
//
// Money at the end of an auction has nowhere left to go. A manager holding $300
// with one hole to fill is not making a judgment when he shoves $260 at the last
// man on the board — the dollars have no other use, and spending them is strictly
// better than carrying them out. A card bought that way lands among the dearest
// in the room for reasons that have nothing to do with what the room thought of
// him, and the bust and worst-value boards read a price as an opinion. So these
// picks are kept off the worst end. They are left on the best end: a late shove
// that actually produced was a good buy by any reading.
//
// What counts as one, in the draft-value chart's own terms: a card bought in the
// closing rounds that sits RIGHT OF THE TREND LINE — the least squares fit of
// value against dollars over everyone who played. Right of the line and below it
// are the same side of it as long as a dollar buys anything at all (a positive
// slope), and the vertical residual is the one that keeps its meaning if a room's
// slope ever comes out flat or backwards, so that is what is measured.
//
// Snake rooms are left alone. There is no money to shove, and on a pick-number
// axis the far side of the line is the late pick who PRODUCED rather than the
// reach — the same test would throw out the opposite picks.
export const ENDGAME_SHOVE_ROUNDS = 5;

// `order` is the lot each card was bought in (1-based) and `perRound` the number
// of managers, so `rounds` of them is what the closing phase means. `lots`
// defaults to the last lot that sold anything.
export function endgameShoves(summary, {
  prices = null,
  order = null,
  perRound = 0,
  lots = 0,
  rounds = ENDGAME_SHOVE_ROUNDS,
  value = null
} = {}) {
  const shoves = new Set();
  if (!prices || !order || !(perRound > 0) || !(rounds > 0)) return shoves;
  const worthOf = value ?? defaultValue(summary);
  const points = [];
  for (const line of [...(summary?.hitters ?? []), ...(summary?.pitchers ?? [])]) {
    const cost = Number(prices[line.id]);
    const worth = Number(worthOf(line));
    if (!Number.isFinite(cost) || !Number.isFinite(worth)) continue;
    points.push({ id: line.id, cost, worth, lot: Number(order[line.id]) });
  }
  const fit = bestFit(points);
  if (!fit) return shoves;
  const lastLot = lots > 0
    ? lots
    : points.reduce((high, point) => (Number.isFinite(point.lot) && point.lot > high ? point.lot : high), 0);
  const closingOpens = lastLot - rounds * perRound;
  for (const point of points) {
    if (!Number.isFinite(point.lot) || point.lot <= closingOpens) continue;
    if (point.worth < fit.intercept + fit.slope * point.cost) shoves.add(point.id);
  }
  return shoves;
}

// The measure the value awards rank on, when the caller has not named one.
function defaultValue(summary) {
  return summary?.attribution
    ? (line) => line.warPer162?.total
    : (line) => line.wpaPerSeason;
}

// Least squares, the same fit the draft-value chart draws over the same cloud
// (scatterBestFit in ui/render.js). Null when there is nothing to fit: fewer
// than three cards, or every card at one price.
function bestFit(points) {
  if (points.length < 3) return null;
  const n = points.length;
  const meanCost = points.reduce((sum, point) => sum + point.cost, 0) / n;
  const meanWorth = points.reduce((sum, point) => sum + point.worth, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const point of points) {
    const dx = point.cost - meanCost;
    sxx += dx * dx;
    sxy += dx * (point.worth - meanWorth);
  }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, intercept: meanWorth - slope * meanCost };
}
