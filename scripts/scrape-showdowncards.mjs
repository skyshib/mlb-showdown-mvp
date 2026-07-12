// Polite scraper for showdowncards.com scouting-report search pages.
// Saves raw HTML per page; parsing happens in a separate pass.
import { mkdir, writeFile, readdir } from "node:fs/promises";

const OUT = new URL("./pages/", import.meta.url);
await mkdir(OUT, { recursive: true });
const BASE = "https://www.showdowncards.com/mlb/mlbsearch.php?a=general&cardnumber=&namecontains=&mascot=&year=&expansion=&rarity=&storeinfo=&submit=Get+MLB+Scouting+Report";

const existing = new Set(await readdir(OUT));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastMax = 3872;
for (let offset = 0; offset <= lastMax; offset += 25) {
  const file = `page-${String(offset).padStart(5, "0")}.html`;
  if (existing.has(file)) continue;
  const url = `${BASE}&limit=${offset}&orderby=cardnumber&sort=ASC`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": "showdown-quest-research/1.0 (personal fan project)" } });
    const html = await response.text();
    await writeFile(new URL(file, OUT), html);
    // Track the true max offset from pagination links as we go.
    for (const match of html.matchAll(/limit=(\d+)/g)) {
      const value = Number(match[1]);
      if (value > lastMax) lastMax = value;
    }
    console.log(`${file} ok (${html.length}b), max=${lastMax}`);
  } catch (error) {
    console.log(`${file} FAILED: ${error.message}`);
  }
  await delay(400);
}
console.log("done");
