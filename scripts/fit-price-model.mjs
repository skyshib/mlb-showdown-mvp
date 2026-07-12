#!/usr/bin/env node
// Fit the authentic-scale price model: from card mechanics (src/rules/pricing.js
// features) to the printed points of the 3,544 classic MLB Showdown cards, one
// model per group (hitters / SP / RP). Writes src/data/priceModel.js.
//
// Three refinements over plain least squares, each measured by 5-fold CV:
// - Set fixed effects: the six sets printed the same mechanics on different
//   price scales (2000-01 pitchers ran ~45 points hotter than 2002-05). A
//   per-set intercept absorbs that during training so the mechanics weights
//   stay clean; at export the set effects fold into the intercept at their
//   print-run shares, pricing every pool on one average-era scale.
//   (Biggest win: SP 5-fold CV MAE 56 -> 41, hitters 42 -> 37.)
// - Huber loss (delta 60): a handful of cards were printed off-mechanics —
//   injury-priced arms (Juan Guzman '00: control 5, printed 40) and prestige
//   legend inserts (Brooks Robinson '03: printed 600 on 270-point mechanics).
//   Huber caps their pull on the fit instead of letting squared error chase them.
// - Balanced buckets (hitters by on-base, SP by control): the sets printed 601
//   OB 9s and one OB 16; unweighted fits buy 5-point wins on commons by writing
//   off the stars the curve exists to price. Balancing pins the top of the
//   scale (Bonds '03 -> ~900, Pedro '97 -> ~755) at negligible average cost.
//   RP shows no top-end benefit from balancing, so it fits unbalanced.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeCardRows } from "../src/data/realCards.js";
import { CLASSIC_CARD_ROWS } from "../src/data/classicCards.js";
import { priceFeatures, priceGroup } from "../src/rules/pricing.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HUBER_DELTA = 60;
const SET_YEARS = ["00", "01", "02", "03", "04", "05"];

function solve(A, b) {
  // Gaussian elimination with partial pivoting on the normal equations.
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    if (Math.abs(m[col][col]) < 1e-9) throw new Error(`singular at column ${col}`);
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k += 1) m[row][k] -= factor * m[col][k];
    }
  }
  return m.map((row, i) => row[n] / m[i][i]);
}

function fit(rows, weights) {
  const keys = Object.keys(rows[0].features);
  const dim = keys.length + 1; // + intercept
  const XtX = Array.from({ length: dim }, () => Array(dim).fill(0));
  const Xty = Array(dim).fill(0);
  rows.forEach(({ features, y }, idx) => {
    const x = [1, ...keys.map((key) => features[key])];
    const weight = weights ? weights[idx] : 1;
    for (let i = 0; i < dim; i += 1) {
      Xty[i] += weight * x[i] * y;
      for (let j = 0; j < dim; j += 1) XtX[i][j] += weight * x[i] * x[j];
    }
  });
  const w = solve(XtX, Xty);
  return { intercept: w[0], weights: Object.fromEntries(keys.map((key, i) => [key, w[i + 1]])) };
}

function predict(model, features) {
  let total = model.intercept;
  for (const [key, weight] of Object.entries(model.weights)) total += weight * (features[key] ?? 0);
  return total;
}

function huberFit(rows, baseWeights, iters = 12) {
  let model = fit(rows, baseWeights);
  for (let it = 0; it < iters; it += 1) {
    const weights = rows.map((row, i) => {
      const err = Math.abs(predict(model, row.features) - row.y);
      return (baseWeights ? baseWeights[i] : 1) * (err <= HUBER_DELTA ? 1 : HUBER_DELTA / err);
    });
    model = fit(rows, weights);
  }
  return model;
}

// Balanced weights: every value of the bucket key counts equally in the fit,
// regardless of how many cards the sets printed at that value.
function balanceWeights(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) counts.set(keyFn(row), (counts.get(keyFn(row)) ?? 0) + 1);
  return rows.map((row) => 1 / counts.get(keyFn(row)));
}

function crossValidate(rows, trainFn, k = 5) {
  let absErr = 0, sqErr = 0, sqTot = 0, n = 0;
  const mean = rows.reduce((sum, { y }) => sum + y, 0) / rows.length;
  for (let fold = 0; fold < k; fold += 1) {
    const train = rows.filter((_, i) => i % k !== fold);
    const model = trainFn(train);
    for (const row of rows.filter((_, i) => i % k === fold)) {
      const err = predict(model, row.features) - row.y;
      absErr += Math.abs(err);
      sqErr += err * err;
      sqTot += (row.y - mean) * (row.y - mean);
      n += 1;
    }
  }
  return { mae: absErr / n, r2: 1 - sqErr / sqTot };
}

// Fold the set fixed effects into the intercept at print-run shares and drop
// them from the exported model: the runtime prices on the average-era scale.
function exportModel(model, rows) {
  const weights = { ...model.weights };
  let intercept = model.intercept;
  for (const year of SET_YEARS.slice(1)) {
    const key = `set${year}`;
    const share = rows.filter((row) => row.setYear === year).length / rows.length;
    intercept += (weights[key] ?? 0) * share;
    delete weights[key];
  }
  return { intercept, weights };
}

const cards = decodeCardRows(CLASSIC_CARD_ROWS);
const groups = { hitter: [], SP: [], RP: [] };
for (const card of cards) {
  const setYear = card.id.split("-")[1];
  if (!SET_YEARS.includes(setYear)) throw new Error(`unrecognized set year in id ${card.id}`);
  const features = { ...priceFeatures(card) };
  for (const year of SET_YEARS.slice(1)) features[`set${year}`] = setYear === year ? 1 : 0;
  groups[priceGroup(card)].push({ features, y: card.points, setYear, card });
}

const balancers = {
  hitter: (rows) => balanceWeights(rows, (row) => row.card.onBase),
  SP: (rows) => balanceWeights(rows, (row) => row.card.control),
  RP: () => null
};

const model = {};
const stats = {};
for (const [name, rows] of Object.entries(groups)) {
  const trainFn = (subset) => huberFit(subset, balancers[name](subset));
  const cv = crossValidate(rows, trainFn);
  console.error(`${name}: n=${rows.length}  5-fold CV MAE ${cv.mae.toFixed(1)} R2 ${cv.r2.toFixed(3)}`);
  model[name] = exportModel(trainFn(rows), rows);
  stats[name] = { n: rows.length, cvMae: Number(cv.mae.toFixed(1)), cvR2: Number(cv.r2.toFixed(3)) };
}

const header = `// Authentic-scale price model: printed-point weights fit against the 3,544
// classic MLB Showdown cards (2000-2005, authentic printed points). One model
// per group; feature definitions live in src/rules/pricing.js; fitting
// choices (set fixed effects, Huber loss, balanced buckets) are documented
// in scripts/fit-price-model.mjs. 5-fold CV (set effects included): ${Object.entries(stats)
    .map(([name, s]) => `${name} MAE ${s.cvMae} R2 ${s.cvR2}`)
    .join(", ")}.
// Generated by scripts/fit-price-model.mjs; do not hand-edit.
`;
writeFileSync(
  join(HERE, "../src/data/priceModel.js"),
  `${header}export const PRICE_MODEL = ${JSON.stringify(model, null, 2)};\n`
);
console.error("wrote src/data/priceModel.js");
