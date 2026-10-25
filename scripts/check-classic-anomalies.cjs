// One-off audit: find likely scrape errors in classicCards.js.
// Check A: same player-year rows identical in chart/points/ob/speed but
//          disagreeing on position/fielding (one of them is a bad scrape).
// Check B: 1st Edition vs Unlimited same card number (identical printings)
//          with any stat difference.
const fs = require("fs");
const src = fs.readFileSync("src/data/classicCards.js", "utf8");
const m = src.match(/export const CLASSIC_CARD_ROWS = \[\r?\n([\s\S]*?),?\r?\n\];/);
if (!m) throw new Error("rows not found");
const rows = JSON.parse("[" + m[1] + "]");
console.log("total rows:", rows.length);

console.log("\n=== Check A: identical card, different position/fielding ===");
const groups = {};
for (const r of rows) {
  if (r[5]) continue;
  const key = JSON.stringify([r[1], r[6], r[7], r[8], r[12]]); // name+year, pts, ob, spd, chart
  (groups[key] ||= []).push(r);
}
for (const g of Object.values(groups)) {
  if (g.length < 2) continue;
  const sig = (r) => JSON.stringify([r[9], r[10]]);
  if (new Set(g.map(sig)).size > 1) {
    console.log("---", g[0][1]);
    for (const r of g) console.log("   ", r[0].padEnd(42), JSON.stringify(r[9]), JSON.stringify(r[10]));
  }
}

console.log("\n=== Check B: 1st vs UL same number, any difference ===");
const byNum = {};
for (const r of rows) {
  const idm = r[0].match(/^sd-(\d\d)-(1st|ul)-(\d+)-(.*)$/);
  if (!idm) continue;
  if (idm[1] !== "00" && idm[1] !== "01") continue;
  const key = `${idm[1]}-${idm[3]}-${idm[4]}`;
  (byNum[key] ||= {})[idm[2]] = r;
}
for (const [key, pair] of Object.entries(byNum)) {
  if (!pair["1st"] || !pair["ul"]) continue;
  const a = pair["1st"].slice(1), b = pair["ul"].slice(1);
  if (JSON.stringify(a.slice(1)) !== JSON.stringify(b.slice(1))) {
    console.log("---", key);
    console.log("   1st:", JSON.stringify(pair["1st"]));
    console.log("   ul :", JSON.stringify(pair["ul"]));
  }
}
console.log("done");
