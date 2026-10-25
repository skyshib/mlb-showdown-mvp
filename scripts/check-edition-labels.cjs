// Audit: compare each classic card's edition tag against the set encoded in
// its card-image filename (the source site's own store slug, which names the
// true set even when the search table's edition column didn't).
const fs = require("fs");

const cardsSrc = fs.readFileSync("src/data/classicCards.js", "utf8");
const m = cardsSrc.match(/export const CLASSIC_CARD_ROWS = \[\r?\n([\s\S]*?),?\r?\n\];/);
const rows = JSON.parse("[" + m[1] + "]");

const imgSrc = fs.readFileSync("src/data/cardImages.js", "utf8");
const im = imgSrc.match(/export const CARD_IMAGE_FILES = (\{[\s\S]*?\});/);
const images = JSON.parse(im[1]);

// filename fragment -> edition code (order matters: longest match first)
const SETS = [
  ["1st-edition-pennant-run", "PR"],
  ["unlimited-pennant-run", "PR"],
  ["pennant-run", "PR"],
  ["trading-deadline", "TD"],
  ["all-star-game", "ASG"],
  ["league-promo", "P"],
  ["super-season", "SS"],
  ["rookie-season", "RS"],
  ["1st-edition", "1st"],
  ["unlimited", "UL"],
  ["base-set", "UL"],
];
function setOf(file) {
  for (const [frag, code] of SETS) if (file.includes(frag)) return code;
  return null;
}

const counts = {};
const mismatches = [];
let noImage = 0, unknown = 0;
for (const r of rows) {
  const file = images[r[0]];
  if (!file) { noImage++; continue; }
  const code = setOf(file);
  if (!code) { unknown++; console.log("unrecognized set:", file); continue; }
  if (code !== r[4]) {
    mismatches.push([r[0], r[4], code, file]);
    counts[`${r[4]} -> ${code}`] = (counts[`${r[4]} -> ${code}`] || 0) + 1;
  }
}
console.log("rows:", rows.length, " no image:", noImage, " unknown set:", unknown);
console.log("mismatches:", mismatches.length);
console.log(counts);
for (const [id, cur, truth, file] of mismatches.slice(0, 40))
  console.log("  ", id.padEnd(44), cur.padEnd(4), "->", truth.padEnd(4), file);
fs.writeFileSync("scripts/edition-mismatches.json", JSON.stringify(mismatches, null, 1));
