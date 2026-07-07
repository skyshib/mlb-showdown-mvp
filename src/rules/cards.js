export const RESULTS = {
  PU: "PU",
  SO: "SO",
  GB: "GB",
  FB: "FB",
  BB: "BB",
  SINGLE: "1B",
  DOUBLE: "2B",
  TRIPLE: "3B",
  HR: "HR"
};

export function resolveChart(chart, roll) {
  const match = chart.find((entry) => roll >= entry.from && roll <= entry.to);
  if (!match) {
    throw new Error(`No chart result for roll ${roll}`);
  }
  return normalizeResult(match.result);
}

export function compactChart(chart) {
  return chart.map((entry) => `${formatRange(entry)}: ${normalizeResult(entry.result)}`).join(", ");
}

export function formatRange(entry) {
  // Open-ended ranges print as the card does ("21+"), even past the d20.
  if (!Number.isFinite(entry.to)) return `${entry.from}+`;
  return entry.from === entry.to ? String(entry.from) : `${entry.from}-${entry.to}`;
}

export function normalizeResult(result) {
  return result === "1B+" ? RESULTS.SINGLE : result;
}
