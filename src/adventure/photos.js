// Real-player portraits, fetched at runtime from Wikipedia's public REST API
// (freely licensed / public-domain imagery served by Wikimedia, credited on
// the card). Nothing is scraped or re-hosted: the browser asks Wikipedia for
// a thumbnail by player name, and misses are cached so we only ask once.
const CACHE_KEY = "sq-photo-cache-v1";
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
    return data.thumbnail.source;
  }
  return null;
}

// Fill every photo slot inside `root` (a rendered screen or the tooltip).
// Cached hits render instantly on the next paint; fresh lookups inject when
// they land, if the slot is still on the page.
export function hydratePhotos(root) {
  for (const slot of root.querySelectorAll("[data-photo-name]")) {
    const name = slot.dataset.photoName;
    const cached = cachedPhoto(name);
    if (cached === null) {
      slot.remove();
      continue;
    }
    if (cached) {
      fill(slot, cached);
      continue;
    }
    resolvePhoto(name).then((url) => {
      if (!slot.isConnected) return;
      if (url) fill(slot, url);
      else slot.remove();
    });
  }
}

// No per-card credit: the intro text carries the Wikipedia/Wikimedia
// attribution once, so the cards stay clean.
function fill(slot, url) {
  if (slot.querySelector("img")) return;
  slot.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
}
