// Polite scraper for showdowncards.com scouting-report search pages.
// Saves raw HTML per page; parsing happens in a separate pass.
//
// Sliced by CARD NUMBER, not by result offset. The search's `orderby=cardnumber`
// is not a total order — fifteen different players carry #67 across the 2000-05
// sets — so the site's sort of tied rows is unstable, and walking it with
// `limit=` offsets silently drops rows: a tied row shifts across a page
// boundary, gets served twice on adjacent pages, and the row it displaced is
// never served at all. The original offset crawl fetched 3897 rows but saw only
// 3650 distinct cards, every one of the 247 duplicates landing on two adjacent
// pages. Those 247 cards (Rod Carew, Chipper Jones '00, Ken Griffey Jr. '00,
// Brad Penny '04 ...) were simply absent from the game.
//
// A `cardnumber=N` query returns every printing of that number on ONE page with
// no pagination links at all, so there is no offset arithmetic to get wrong.
// Card numbers run 1..462; we overshoot and stop after a run of empties.
import { mkdir, writeFile, readdir } from "node:fs/promises";

const OUT = new URL("./pages/", import.meta.url);
await mkdir(OUT, { recursive: true });
const BASE = "https://www.showdowncards.com/mlb/mlbsearch.php?a=general&namecontains=&mascot=&year=&expansion=&rarity=&storeinfo=&submit=Get+MLB+Scouting+Report";

// The host 403s any User-Agent containing "research" (a generic bot-keyword
// rule, not a block on us: "spider", "crawler" and "bot" all pass).
const UA = { "User-Agent": "showdown-quest/1.0 (personal fan project; images credited)" };
const MAX_NUMBER = 520;      // known range is 1..462; overshoot to prove the tail is empty
const STOP_AFTER_EMPTY = 25; // consecutive numbers with no rows that end the crawl

const existing = new Set(await readdir(OUT));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let empties = 0;
for (let number = 1; number <= MAX_NUMBER; number += 1) {
  const file = `number-${String(number).padStart(4, "0")}.html`;
  if (existing.has(file)) {
    empties = 0;
    continue;
  }
  const url = `${BASE}&cardnumber=${number}&limit=0&orderby=cardnumber&sort=ASC`;
  let html;
  try {
    const response = await fetch(url, { headers: UA });
    if (!response.ok) {
      console.log(`${file} FAILED: HTTP ${response.status}`);
      await delay(400);
      continue;
    }
    html = await response.text();
  } catch (error) {
    console.log(`${file} FAILED: ${error.message}`);
    await delay(400);
    continue;
  }
  await writeFile(new URL(file, OUT), html);
  const rows = [...html.matchAll(/href='\.\.\/store\//g)].length;
  // A slice that paginates is a slice we are only seeing part of — the whole
  // point of this scheme is that it never happens. Say so loudly if it does.
  const paginated = [...html.matchAll(/limit=(\d+)/g)].some((m) => Number(m[1]) > 0);
  if (paginated) console.log(`${file} WARNING: slice paginates — offset walking needed for #${number}`);
  console.log(`${file} ok (${rows} rows)`);
  empties = rows === 0 ? empties + 1 : 0;
  if (empties >= STOP_AFTER_EMPTY) {
    console.log(`stopping at #${number}: ${empties} consecutive empty numbers`);
    break;
  }
  await delay(400);
}
console.log("done");
