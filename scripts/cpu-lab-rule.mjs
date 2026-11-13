// WHEN A CANDIDATE HAS BEEN DECIDED, and how close it is to being decided.
//
// Its own module because two readers need it and only one of them is a command
// line: scripts/cpu-lab.mjs stops runs with it, and cpu-lab.html shows how near
// a candidate is to being stopped. Importing cpu-lab.mjs for it would run the
// CLI — and keeping a second copy of the arithmetic on the page is exactly how
// the page and the bench came to disagree about the positive control.
//
// THE RULE. A candidate keeps being measured until the readings say one of two
// things:
//
//   ACCEPT  the average is above zero with 99% confidence
//   KILL    90% of the posterior sits below zero
//
// Deliberately asymmetric: accepting only means "measure this one properly", so
// a wrong accept costs time, while killing ends the run and should be the
// easier call for something going nowhere.
//
// THE NUMBERS ARE FITTED, not chosen by taste — at most 5% of true nulls
// accepted and at most 20% of genuine gains killed, simulated against the
// spread the readings actually have (2.26 win points, measured on the positive
// control across sixteen two-seat rooms). A NOMINAL FIGURE HERE READS FAR
// LOOSER THAN IT SOUNDS, because the question is asked after every reading:
// 99% nominal is a 5% rate in practice over four sweeps of the grid. They
// cannot be reasoned about and must be re-simulated whenever the spread moves.
export const RULE = Object.freeze({
  prior: 0.5,        // most tweaks land inside ±0.5 win points; centred on zero
  accept: 0.99,      // confidence that the average is above `above`
  kill: 0.90,        // share of the posterior below zero
  above: 0,          // what the average must beat to be accepted
  minLooks: 5,
  passes: 4
});

// Φ, good to about 1e-7 — plenty for a stopping rule.
export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

// What the readings so far say about the true average effect. Each reading is
// one room at one adoption level; they are taken as normal around the truth
// with a spread estimated from themselves, against a prior centred at zero —
// because the overwhelming majority of tweaks ARE zero, and a prior that
// pretends otherwise is how a bench talks itself into noise.
export function chances(samples, rule = RULE) {
  const n = samples.length;
  if (n < 2) return null;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const spread = Math.sqrt(samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1));
  // A spread of zero (the null fixture, every reading exactly 0) would divide
  // by nothing; floor it at something small but real.
  const s = Math.max(spread, 0.05);
  const post = 1 / (1 / (rule.prior * rule.prior) + n / (s * s));
  const centre = post * (n * mean / (s * s));
  const sd = Math.sqrt(post);
  return {
    n,
    mean,
    centre,
    sd,
    above: 1 - normalCdf((rule.above - centre) / sd),
    below: normalCdf((0 - centre) / sd)
  };
}

// Accept, kill, or keep going.
export function verdictSoFar(samples, rule = RULE) {
  if (!samples || samples.length < Math.max(2, rule.minLooks)) return null;
  const odds = chances(samples, rule);
  if (!odds) return null;
  if (odds.above > rule.accept) return { ...odds, call: "accept" };
  if (odds.below > rule.kill) return { ...odds, call: "kill" };
  return null;
}
