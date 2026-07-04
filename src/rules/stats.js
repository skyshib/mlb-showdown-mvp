export function rate(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function distribution(values) {
  if (!values.length) {
    return { count: 0, sum: 0, min: 0, p10: 0, median: 0, mean: 0, p90: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    sum,
    min: sorted[0],
    p10: percentile(sorted, 0.1),
    median: percentile(sorted, 0.5),
    mean: sum / sorted.length,
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1]
  };
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
