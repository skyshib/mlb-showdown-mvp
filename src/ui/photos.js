// Real-player portraits, fetched at runtime from Wikipedia's public REST API
// (freely licensed / public-domain imagery served by Wikimedia, credited on
// the card). Nothing is scraped or re-hosted: the browser asks Wikipedia for
// a thumbnail by player name, and misses are cached so we only ask once.
// v2: the lookup grew a search-API second pass — retire v1's cached misses
// so the old-timers get their retry.
import { surname as cardSurname } from "./cardFace.js?v=20260715-a";

const CACHE_KEY = "sq-photo-cache-v2";
const MISS = "none";

let cache = null;
const pending = new Map();

function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {};
  } catch {
    cache = {};
  }
  return cache;
}

function persistCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage full or unavailable: stay in-memory only
  }
}

// Synchronous peek: url string, null (known miss), or undefined (not asked yet).
export function cachedPhoto(name) {
  const hit = loadCache()[name];
  if (hit === undefined) return undefined;
  return hit === MISS ? null : hit;
}

export async function resolvePhoto(name) {
  const hit = cachedPhoto(name);
  if (hit !== undefined) return hit;
  if (pending.has(name)) return pending.get(name);
  const promise = lookup(name)
    .then((url) => {
      loadCache()[name] = url ?? MISS;
      persistCache();
      pending.delete(name);
      return url;
    })
    .catch(() => {
      pending.delete(name);
      return null; // offline: retry next session, don't cache the miss
    });
  pending.set(name, promise);
  return promise;
}

async function lookup(name) {
  // Try the plain title first, then the baseball disambiguation. The plain
  // page must at least talk about baseball so "Frank Thomas" doesn't return
  // an actor.
  for (const [title, requireBaseball] of [[name, true], [`${name} (baseball)`, false]]) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) continue;
    const data = await response.json();
    if (data.type !== "standard" || !data.thumbnail?.source) continue;
    if (requireBaseball && !`${data.description ?? ""} ${data.extract ?? ""}`.toLowerCase().includes("baseball")) continue;
    // The summary thumbnail is ~320px; the card window deserves double.
    return data.thumbnail.source.replace(/\/320px-/, "/640px-");
  }
  return searchLookup(name);
}

// Second pass, mostly for the old-timers: a full-text Wikipedia search that
// takes the thumbnail straight off the best baseball match. Catches
// birth-year disambiguations ("Billy Hamilton (baseball, born 1866)"),
// middle initials, and nickname titles the direct summary lookup misses.
async function searchLookup(name) {
  const url = "https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*"
    + `&generator=search&gsrsearch=${encodeURIComponent(`${name} baseball`)}&gsrlimit=5`
    + "&prop=pageimages%7Cdescription&piprop=thumbnail&pithumbsize=640";
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  const data = await response.json();
  const pages = Object.values(data?.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  // The man's name, not his suffix: matching Wikipedia titles on "jr." would
  // accept any junior in the search results.
  const family = cardSurname(name).toLowerCase();
  for (const page of pages) {
    if (!page.thumbnail?.source) continue;
    if (!page.title.toLowerCase().includes(family)) continue;
    const description = (page.description ?? "").toLowerCase();
    if (description && !description.includes("baseball")) continue;
    return page.thumbnail.source;
  }
  return null;
}

// MLB's official headshot CDN, keyed by MLBAM id — the most reliable and
// relevant source for the modern era. No generic-silhouette fallback param:
// a missing photo 404s, and the error handler walks down the cascade
// (Wikipedia, then a generated pixel portrait) instead of showing a blank
// gray stock bust.
function mlbHeadshotUrl(mlbam) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best,f_auto/v1/people/${mlbam}/headshot/67/current`;
}

// The same CDN's game-action shots — the 2004-05 printed cards were action
// photos, so these are the preferred faces. VERTICAL is a purpose-built
// portrait crop (recent players only); HERO is the wide banner everyone
// else has, which the window letterboxes.
function mlbVerticalUrl(mlbam) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_426,q_auto:best,f_auto/v1/people/${mlbam}/action/vertical/current`;
}

function mlbActionUrl(mlbam) {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_426,q_auto:best,f_auto/v1/people/${mlbam}/action/hero/current`;
}

// MLBAM ids whose CDN photo already 404'd this session — skip straight to
// the next source instead of re-requesting.
const mlbMisses = new Set();
const actionMisses = new Set();
const verticalMisses = new Set();

// Fill every photo slot inside `root` (a rendered screen or the tooltip).
// The cascade: official MLB headshot (when the card carries an MLBAM id),
// then the Wikipedia lookup, then a deterministic DMG pixel portrait — every
// real player gets a face, even the 1884 guys no camera ever loved.
export function hydratePhotos(root) {
  // The cascade prefers game photos, best-shaped first: the MLB portrait
  // action shot, the wide action hero, the MLB headshot, Wikipedia, and
  // finally the drawn pixel portrait.
  for (const slot of root.querySelectorAll("[data-photo-name]")) {
    // A replacement card is nobody: it carries a real card's numbers under a
    // plain name, and it gets the drawn portrait without a lookup. Searching
    // for him would be worse than useless — "Replacement C" hunts a surname of
    // "c", which is a substring of half of Wikipedia, and the card would come
    // back wearing some real catcher's face.
    if (slot.dataset.photoAnon !== undefined) {
      drawPortrait(slot);
      continue;
    }
    const mlbam = slot.dataset.mlbam;
    if (mlbam && !verticalMisses.has(mlbam)) {
      fill(slot, mlbVerticalUrl(mlbam), () => {
        verticalMisses.add(mlbam);
        heroOrHeadshot(slot);
      }, "gq-action-shot");
      continue;
    }
    heroOrHeadshot(slot);
  }
  // Team marks: the club's Wikipedia page image is its logo. The era-correct
  // code text stands until the logo lands, and stays on a miss.
  for (const slot of root.querySelectorAll("[data-team-logo]")) {
    const club = slot.dataset.teamLogo;
    const cached = cachedPhoto(club);
    if (cached === null) continue;
    if (cached) {
      fill(slot, cached);
      continue;
    }
    resolvePhoto(club).then((url) => {
      if (url && slot.isConnected) fill(slot, url);
    });
  }
}

function heroOrHeadshot(slot) {
  const mlbam = slot.dataset.mlbam;
  if (mlbam && !actionMisses.has(mlbam)) {
    fill(slot, mlbActionUrl(mlbam), () => {
      actionMisses.add(mlbam);
      headshotOrWiki(slot);
    }, "gq-action-shot");
    return;
  }
  headshotOrWiki(slot);
}

function headshotOrWiki(slot) {
  const mlbam = slot.dataset.mlbam;
  if (mlbam && !mlbMisses.has(mlbam)) {
    fill(slot, mlbHeadshotUrl(mlbam), () => {
      mlbMisses.add(mlbam);
      wikiOrPortrait(slot);
    });
    return;
  }
  wikiOrPortrait(slot);
}

function wikiOrPortrait(slot) {
  const name = slot.dataset.photoName;
  const cached = cachedPhoto(name);
  if (cached === null) return drawPortrait(slot);
  if (cached) return fill(slot, cached);
  resolvePhoto(name).then((url) => {
    if (!slot.isConnected) return;
    if (url) fill(slot, url);
    else drawPortrait(slot);
  });
}

// No per-card credit: the intro text carries the Wikipedia/Wikimedia
// attribution once, so the cards stay clean.
function fill(slot, url, onError = null, className = "") {
  if (slot.querySelector("img, svg")) return;
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  if (className) img.className = className;
  if (onError) {
    img.onerror = () => {
      img.remove();
      if (slot.isConnected) onError();
    };
  }
  // Ultra-wide action heroes (the CDN's are ~3:1 banners) can't fill a
  // portrait window without cropping the player out — letterbox the full
  // shot over a blurred cover of itself instead.
  img.onload = () => {
    if (!img.classList.contains("gq-action-shot")) return;
    if (img.naturalWidth < img.naturalHeight * 1.5) return;
    const backdrop = img.cloneNode();
    backdrop.className = "gq-photo-backdrop";
    backdrop.onerror = null;
    backdrop.onload = null;
    img.classList.add("gq-wide-shot");
    slot.prepend(backdrop);
  };
  img.src = url;
  slot.replaceChildren(img);
}

function drawPortrait(slot) {
  if (slot.querySelector("img, svg")) return;
  slot.innerHTML = silhouettePhotoSvg(slot.dataset.photoName ?? "");
}

// The no-photo last resort: the card lab's placeholder scene — blurred
// crowd bokeh, an outfield wall, and a batting-stance silhouette — seeded
// by the player's name so his crowd never changes.
export function silhouettePhotoSvg(name) {
  let seed = nameHash(name) || 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const uid = `gqsil${(nameHash(name) % 99991).toString(36)}`;
  const blobs = [];
  for (let i = 0; i < 110; i += 1) {
    const x = (rand() * 400).toFixed(1);
    const y = (rand() * 330).toFixed(1);
    const r = (7 + rand() * 16).toFixed(1);
    const hue = ((nameHash(name) % 360) * 3 + rand() * 60) % 360;
    const sat = (8 + rand() * 12).toFixed(0);
    const light = (22 + rand() * 34).toFixed(0);
    blobs.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(${hue.toFixed(0)} ${sat}% ${light}%)"/>`);
  }
  return `<svg viewBox="0 0 400 538" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="">
    <rect width="400" height="538" fill="#39434c"/>
    <g filter="url(#${uid}c)">
      <rect width="400" height="335" fill="#414c56"/>
      ${blobs.join("")}
    </g>
    <rect y="322" width="400" height="30" fill="#16301f"/>
    <rect y="350" width="400" height="188" fill="url(#${uid}t)"/>
    <g filter="url(#${uid}b)" fill="#171c22" opacity="0.93">
      <rect x="216" y="118" width="10" height="128" rx="5" transform="rotate(32 221 246)"/>
      <circle cx="196" cy="176" r="19"/>
      <path d="M 186 196 C 214 200 228 226 226 262 L 220 320 L 236 448 L 210 452 L 194 342 L 172 450 L 146 446 L 168 316 L 166 252 C 164 220 168 200 186 196 Z"/>
      <path d="M 196 206 C 212 200 224 214 228 232 L 236 250 L 222 258 L 210 238 C 204 226 196 218 188 216 Z"/>
      <circle cx="230" cy="248" r="10"/>
      <path d="M 186 210 C 172 218 166 232 168 246 L 182 246 C 182 234 188 224 196 220 Z"/>
    </g>
    <defs>
      <filter id="${uid}c"><feGaussianBlur stdDeviation="8"/></filter>
      <filter id="${uid}b"><feGaussianBlur stdDeviation="1.1"/></filter>
      <linearGradient id="${uid}t" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#31573a"/>
        <stop offset="1" stop-color="#48744c"/>
      </linearGradient>
    </defs>
  </svg>`;
}

// ---- Pixel portraits ---------------------------------------------------------

// The last resort is drawn, not fetched: a deterministic 1-bit trading-card
// bust in the four DMG greens, seeded by the player's name and styled by his
// era — pillbox caps and handlebar mustaches for the pre-war leagues, modern
// caps after. The same player always gets the same face.
const INK = { 0: "#9bbc0f", 1: "#8bac0f", 2: "#306230", 3: "#0f380f" };
const W = 16;
const H = 16;

function nameHash(name) {
  let hash = 5381;
  for (const char of String(name)) hash = ((hash * 33) ^ char.codePointAt(0)) >>> 0;
  return hash;
}

export function pixelPortraitSvg(name, era = 2000) {
  const seed = nameHash(name);
  const pick = (shift, n) => (seed >>> shift) % n;
  const vintage = era < 1940;
  const grid = Array.from({ length: H }, () => new Array(W).fill(0));
  const put = (row, colFrom, colTo, ink) => {
    for (let col = colFrom; col <= colTo; col += 1) {
      if (row >= 0 && row < H && col >= 0 && col < W) grid[row][col] = ink;
    }
  };

  const wide = pick(0, 2); // 0: narrow face, 1: wide face
  const left = 5 - wide;
  const right = 10 + wide;

  // Face and ears.
  for (let row = 5; row <= 11; row += 1) put(row, left, right, 1);
  put(12, left + 1, right - 1, 1);

  // Cap: vintage pillbox sits flat with a band; the modern dome curves.
  if (vintage && pick(2, 3) > 0) {
    put(2, left, right, 2);
    put(3, left, right, pick(3, 2) ? 3 : 2); // band
    put(4, left - 1, right + 1, 3);          // short flat brim
  } else {
    put(2, left + 1, right - 1, 3);
    put(3, left, right, 3);
    put(4, pick(3, 2) ? left : left + 4, right + 1, 3); // brim, sometimes cocked
  }
  put(5, left, right, pick(4, 3) === 0 ? 3 : 1); // hair peeking out (or not)

  // Eyes: dots or a squint line.
  const eyeInk = 3;
  if (pick(5, 3) === 0) {
    put(7, left + 2, left + 3, eyeInk);
    put(7, right - 3, right - 2, eyeInk);
  } else {
    put(7, left + 2, left + 2, eyeInk);
    put(7, right - 2, right - 2, eyeInk);
  }
  put(9, 7, 8, 2); // nose

  // Facial hair: the old leagues are mustache country.
  const styles = vintage ? ["stache", "handlebar", "handlebar", "beard", "none"] : ["none", "none", "none", "stache", "beard"];
  const facial = styles[pick(8, styles.length)];
  if (facial === "stache") {
    put(10, left + 2, right - 2, 3);
  } else if (facial === "handlebar") {
    put(10, left + 1, right - 1, 3);
    put(11, left + 1, left + 1, 3);
    put(11, right - 1, right - 1, 3);
  } else if (facial === "beard") {
    put(10, left + 1, right - 1, 3);
    put(11, left + 1, right - 1, 3);
    put(12, left + 1, right - 1, 3);
  }
  if (facial === "none" || facial === "stache") put(11, 7, 8, 3); // mouth

  // Shoulders and jersey; vintage collars ride high.
  put(13, 2, 13, 2);
  put(14, 1, 14, 2);
  put(15, 1, 14, 2);
  if (vintage) put(13, left + 1, right - 1, 0);
  put(14, 7, 8, pick(9, 2) ? 3 : 0); // buttons or lace

  // Emit one rect per horizontal run.
  const rects = [];
  for (let row = 0; row < H; row += 1) {
    let col = 0;
    while (col < W) {
      const ink = grid[row][col];
      let end = col;
      while (end + 1 < W && grid[row][end + 1] === ink) end += 1;
      if (ink !== 0) {
        rects.push(`<rect x="${col}" y="${row}" width="${end - col + 1}" height="1" fill="${INK[ink]}"/>`);
      }
      col = end + 1;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="">
    <rect width="${W}" height="${H}" fill="${INK[0]}"/>${rects.join("")}</svg>`;
}
