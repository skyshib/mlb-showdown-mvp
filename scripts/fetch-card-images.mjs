// Politely download real MLB Showdown card images from showdowncards.com,
// with the site owner's blessing (credited in-game and in the README).
//
// Three cached, resumable stages:
//   1. Crawl the scouting-report search pages (25 rows each) and parse every
//      row's store link — the site's own card-id -> product mapping.
//   2. Fetch each linked store product page and extract its card image path.
//   3. Download the images, then emit assets/cards/ plus a manifest module
//      (src/data/cardImages.js) mapping card ids to image files.
//
// Every request carries an identifying UA and waits DELAY_MS; reruns skip
// anything already on disk, so an interrupted run resumes for free.
import { mkdir, writeFile, readFile, readdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const UA = { "User-Agent": "showdown-quest-research/1.0 (personal fan project; images credited)" };
const DELAY_MS = 350;
const BASE = "https://www.showdowncards.com";

const PAGES = new URL("./pages/", import.meta.url);
const STORE_PAGES = new URL("./store-pages/", import.meta.url);
const RAW_IMAGES = new URL("./card-images-raw/", import.meta.url);
const ASSETS = new URL("../assets/cards/", import.meta.url);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function politeFetch(url) {
  const response = await fetch(url, { headers: UA });
  await delay(DELAY_MS);
  return response;
}

// Mirrors the id slugging in parse-classic-cards.py so ids line up.
function slug(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- Stage 1: search pages ------------------------------------------------------

await mkdir(PAGES, { recursive: true });
{
  const existing = new Set(await readdir(PAGES));
  let lastMax = 3872;
  for (let offset = 0; offset <= lastMax; offset += 25) {
    const file = `page-${String(offset).padStart(5, "0")}.html`;
    if (existing.has(file)) continue;
    const url = `${BASE}/mlb/mlbsearch.php?a=general&cardnumber=&namecontains=&mascot=&year=&expansion=&rarity=&storeinfo=&submit=Get+MLB+Scouting+Report&limit=${offset}&orderby=cardnumber&sort=ASC`;
    try {
      const html = await (await politeFetch(url)).text();
      await writeFile(new URL(file, PAGES), html);
      for (const match of html.matchAll(/limit=(\d+)/g)) {
        lastMax = Math.max(lastMax, Number(match[1]));
      }
      console.log(`search ${file} ok (max ${lastMax})`);
    } catch (error) {
      console.log(`search ${file} FAILED: ${error.message}`);
    }
  }
}

// ---- Stage 2: parse rows -> store slugs -----------------------------------------

// A row looks like (whitespace trimmed):
//   <td ...>118</td><td ...>CC</td>
//   <td ...><a href='../store/118-lou-brock-mlb-2004-trading-deadline'>**Lou Brock</a><br>Team</td>
//   ... <td ...>'04</td> ...
// Foils carry a ** name prefix and share the base card's product page.
const idToSlug = new Map();
{
  for (const file of (await readdir(PAGES)).sort()) {
    const html = await readFile(new URL(file, PAGES), "utf8");
    for (const chunk of html.split(/<tr>/i)) {
      const store = /href='\.\.\/store\/([^']+)'>([^<]+)</.exec(chunk);
      if (!store) continue;
      const number = /<td[^>]*>(\d+)<\/td>/.exec(chunk)?.[1];
      const cells = [...chunk.matchAll(/<td[^>]*>([A-Za-z0-9]{1,4})<\/td>/g)].map((m) => m[1]);
      const ed = cells.find((cell) => !/^\d+$/.test(cell));
      const year = /<td[^>]*>'(\d\d)<\/td>/.exec(chunk)?.[1];
      const name = store[2].replace(/^\*+/, "").trim();
      if (!number || !ed || !year || !name) continue;
      const id = `sd-${year}-${ed.toLowerCase()}-${number}-${slug(name)}`;
      if (!idToSlug.has(id)) idToSlug.set(id, store[1]);
    }
  }
  console.log(`parsed ${idToSlug.size} card -> store links`);
}

// Only slugs for cards actually in the game matter.
const cardRows = (await readFile(new URL("../src/data/classicCards.js", import.meta.url), "utf8"))
  .split("\n")
  .filter((line) => line.trim().startsWith("[\"sd-"))
  .map((line) => JSON.parse(line.trim().replace(/,$/, "")));
const gameIds = new Set(cardRows.map((row) => row[0]));
const wanted = new Map([...idToSlug].filter(([id]) => gameIds.has(id)));
console.log(`${wanted.size}/${gameIds.size} game cards have store pages`);

// ---- Stage 3: product pages -> image URLs, then the images ----------------------

await mkdir(STORE_PAGES, { recursive: true });
await mkdir(RAW_IMAGES, { recursive: true });
await mkdir(ASSETS, { recursive: true });

const slugToImage = new Map();
const uniqueSlugs = [...new Set(wanted.values())];
let done = 0;
for (const productSlug of uniqueSlugs) {
  done += 1;
  const pageFile = new URL(`${productSlug}.html`, STORE_PAGES);
  try {
    let html;
    if (existsSync(pageFile)) {
      html = await readFile(pageFile, "utf8");
    } else {
      const response = await politeFetch(`${BASE}/store/${productSlug}`);
      if (!response.ok) {
        console.log(`store ${productSlug}: HTTP ${response.status}`);
        continue;
      }
      html = await response.text();
      await writeFile(pageFile, html);
    }
    // The store mixes quote styles: src='../images/product/1144.jpg' on the
    // old templates, src="../images/product/mlb_2004_.../....jpg" on newer.
    const image = /src=["']\.\.\/(images\/product\/[^"']+\.(?:jpg|jpeg|png|gif))["']/i.exec(html)?.[1];
    if (!image) {
      console.log(`store ${productSlug}: no product image`);
      continue;
    }
    const imageFile = new URL(`${productSlug}.jpg`, RAW_IMAGES);
    if (!existsSync(imageFile)) {
      const response = await politeFetch(`${BASE}/${image}`);
      if (!response.ok) {
        console.log(`image ${productSlug}: HTTP ${response.status}`);
        continue;
      }
      await writeFile(imageFile, Buffer.from(await response.arrayBuffer()));
    }
    slugToImage.set(productSlug, `${productSlug}.jpg`);
    if (done % 100 === 0) console.log(`store+image ${done}/${uniqueSlugs.length}`);
  } catch (error) {
    console.log(`store ${productSlug} FAILED: ${error.message}`);
  }
}

// ---- Emit assets and the manifest ------------------------------------------------

const manifest = {};
for (const [id, productSlug] of wanted) {
  const file = slugToImage.get(productSlug);
  if (!file) continue;
  manifest[id] = file;
  const target = new URL(file, ASSETS);
  if (!existsSync(target)) await copyFile(new URL(file, RAW_IMAGES), target);
}

const header = `// Real MLB Showdown card images, courtesy of ShowdownCards.com (used with
// the site owner's permission; images carry the site's watermark). Maps a
// classic card id to its file under assets/cards/.
// Generated by scripts/fetch-card-images.mjs; do not hand-edit.
`;
await writeFile(
  new URL("../src/data/cardImages.js", import.meta.url),
  `${header}export const CARD_IMAGE_FILES = ${JSON.stringify(manifest, null, 0)};\n`
);
console.log(`manifest: ${Object.keys(manifest).length} cards with images`);
